/**
 * NÚCLEO IA — from proposed actions to a plan (preview) and from a confirmed plan to ONE atomic write.
 *
 * - buildPlan: resolves names against the current data, links dependent actions, validates with the
 *   app's own validators, flags duplicates / agenda conflicts / areas off. Pure: run again after every
 *   edit in the preview, and again right before writing (the data may have changed).
 * - compilePlan: the chosen items → BatchOp[] through the same builders the screens use (saleSaveOps,
 *   projectSaveOps, transactionDraft, withSaved…). Ids are fixed per plan, edits and goal reserves are
 *   absolute values with a precondition → applying the same plan twice never duplicates anything.
 *
 * Money is never "received/paid" unless the person said so (ja_recebido_ou_pago === true).
 */
import { isEnabled } from '../../../../app/modules'
import type { BatchOp } from '../../../../data/repository'
import { instantFor, projectPaymentProblem } from '../../../../data/receipts'
import { paymentProblem, salePaid, withPayment } from '../../../../data/sales'
import { projectSaveOps, saleSaveOps } from '../../../../data/saveOps'
import { transactionDraft } from '../../../../data/store'
import type { CollectionName, Currency, DataState, Entity, ModuleId, Project, ProjectPayment, Sale, Settings, Task, Transaction } from '../../../../data/types'
import { formatMoney, isCurrencyCode } from '../../../../lib/money'
import type { Converter } from '../../../../lib/rates'
import { buildAgenda } from '../../../agenda'
import { dayOfTransaction } from '../../../finance'
import { startHistory, withSaved } from '../../../financeGoals'
import { todayIn, weekStart, zoneOf } from '../../../period'
import { buildInstallments } from '../../../salesSmart'
import { busyOf } from '../../../timeline'
import { categoryIdFor } from '../areas/finance'
import { dayLabel, fold } from '../areas/shared'
import type { Action, ActionType } from '../../../../../supabase/functions/_shared/ia/actions.ts'
import type { Area } from '../../../../../supabase/functions/_shared/ia/tools.ts'

export type ItemState = 'pronto' | 'aviso' | 'erro' | 'existente'
export type EditableField = 'titulo' | 'data' | 'hora' | 'valor' | 'ja_recebido_ou_pago'

export interface PlanItem {
  ref: string
  action: Action
  area: Area
  /** "Tarefa · Briefing · seg, 03/11" */
  label: string
  details: string[]
  messages: { level: 'aviso' | 'erro'; text: string }[]
  state: ItemState
  /** Ticked when the preview opens (duplicates and errors start unticked). */
  defaultOn: boolean
  /** Refs of actions of this plan this one needs. */
  depends: string[]
  money: boolean
  editable: EditableField[]
}

export interface Plan {
  id: string
  /** The account the plan was built for: applying under another login is refused. */
  uid: string
  summary: string
  actions: Action[]
  items: PlanItem[]
  /**
   * What the preview resolved, fixed while the action is unchanged: the existing record it points to
   * and, for a goal reserve, the value before and after. Rebuilding against newer data (before writing,
   * or after a first confirm) keeps these, so a second confirm finds "already done" instead of doing
   * it again, and a change made elsewhere in the meantime is caught.
   */
  pins: Record<string, Pin>
}

export interface Pin {
  sig: string
  targetId?: string
  goalBefore?: number
  goalAfter?: number
}
const sigOf = (a: Action) => JSON.stringify(a)

export interface PlanCtx {
  data: DataState
  settings: Settings
  now: Date
  areasOff: Area[]
}

const AREA: Record<ActionType, Area> = {
  criar_tarefa: 'tarefas',
  mover_tarefa: 'tarefas',
  concluir_tarefa: 'tarefas',
  criar_compromisso: 'agenda',
  mover_compromisso: 'agenda',
  criar_cliente: 'clientes',
  criar_projeto: 'clientes',
  criar_venda: 'vendas',
  registrar_recebimento: 'vendas',
  registrar_despesa: 'financas',
  registrar_entrada: 'financas',
  registrar_transferencia: 'financas',
  reservar_meta: 'metas',
  criar_meta_financeira: 'metas',
  criar_nota: 'anotacoes',
  criar_habito: 'habitos',
  adicionar_compra: 'alimentacao',
}
const MODULE: Record<ActionType, ModuleId> = {
  criar_tarefa: 'tasks',
  mover_tarefa: 'tasks',
  concluir_tarefa: 'tasks',
  criar_compromisso: 'agenda',
  mover_compromisso: 'agenda',
  criar_cliente: 'clients',
  criar_projeto: 'projects',
  criar_venda: 'sales',
  registrar_recebimento: 'sales',
  registrar_despesa: 'finance',
  registrar_entrada: 'finance',
  registrar_transferencia: 'finance',
  reservar_meta: 'finance',
  criar_meta_financeira: 'finance',
  criar_nota: 'notes',
  criar_habito: 'habits',
  adicionar_compra: 'meals',
}
const KIND_LABEL: Record<ActionType, string> = {
  criar_tarefa: 'Nova tarefa',
  mover_tarefa: 'Mover tarefa',
  concluir_tarefa: 'Concluir tarefa',
  criar_compromisso: 'Novo compromisso',
  mover_compromisso: 'Mover compromisso',
  criar_cliente: 'Novo cliente',
  criar_projeto: 'Novo projeto',
  criar_venda: 'Nova venda',
  registrar_recebimento: 'Recebimento',
  registrar_despesa: 'Despesa paga',
  registrar_entrada: 'Entrada recebida',
  registrar_transferencia: 'Transferência entre suas contas',
  reservar_meta: 'Reservar para meta',
  criar_meta_financeira: 'Nova meta de dinheiro',
  criar_nota: 'Nova anotação',
  criar_habito: 'Novo hábito',
  adicionar_compra: 'Lista de compras',
}
const MONEY: ActionType[] = ['criar_venda', 'registrar_recebimento', 'registrar_despesa', 'registrar_entrada', 'registrar_transferencia', 'reservar_meta', 'criar_projeto', 'criar_meta_financeira']
const EDITABLE: Record<ActionType, EditableField[]> = {
  criar_tarefa: ['titulo', 'data', 'hora'],
  mover_tarefa: ['data', 'hora'],
  concluir_tarefa: [],
  criar_compromisso: ['titulo', 'data', 'hora'],
  mover_compromisso: ['data', 'hora'],
  criar_cliente: ['titulo'],
  criar_projeto: ['titulo', 'valor', 'data'],
  criar_venda: ['titulo', 'valor', 'data'],
  registrar_recebimento: ['valor', 'data', 'ja_recebido_ou_pago'],
  registrar_despesa: ['titulo', 'valor', 'data', 'ja_recebido_ou_pago'],
  registrar_entrada: ['titulo', 'valor', 'data', 'ja_recebido_ou_pago'],
  registrar_transferencia: ['valor', 'data', 'ja_recebido_ou_pago'],
  reservar_meta: ['valor'],
  criar_meta_financeira: ['titulo', 'valor', 'data'],
  criar_nota: ['titulo'],
  criar_habito: ['titulo'],
  adicionar_compra: ['titulo'],
}

/** Fixed id of a record this plan creates (same plan → same id → no duplicate on a second apply). */
export const planRecordId = (planId: string, ref: string, part = '') => `ia-${planId}-${ref}${part ? `-${part}` : ''}`
const cents = (v: number | null) => (v == null ? null : Math.round(v * 100))
const isTime = (s: string | null | undefined) => Boolean(s && /^\d{2}:\d{2}$/.test(s))

interface Found<T> {
  one: T | null
  many: T[]
}
function findByName<T>(list: T[], name: (x: T) => string, q: string | null): Found<T> {
  if (!q) return { one: null, many: [] }
  const f = fold(q)
  const exact = list.filter((x) => fold(name(x)) === f)
  if (exact.length === 1) return { one: exact[0], many: exact }
  if (exact.length > 1) return { one: null, many: exact }
  const part = list.filter((x) => fold(name(x)).includes(f) || (fold(name(x)).length > 3 && f.includes(fold(name(x)))))
  return part.length === 1 ? { one: part[0], many: part } : { one: null, many: part }
}

/** Facts the plan resolved for an item (target record, money in cents, currency, ids it writes). */
interface Resolved {
  targetId?: string
  targetCollection?: CollectionName
  clientId?: string | null
  clientName?: string
  projectId?: string | null
  amount?: number
  currency?: Currency
  date?: string
  goalAfter?: number
  goalBefore?: number
}

export function buildPlan(planId: string, uid: string, summary: string, actions: Action[], ctx: PlanCtx, prevPins: Record<string, Pin> = {}): Plan {
  const { data, settings, now } = ctx
  const tz = zoneOf(settings)
  const today = todayIn(tz, now)
  const base = settings.baseCurrency
  const byRef = new Map(actions.map((a) => [a.ref, a]))
  const resolved = new Map<string, Resolved>()
  const items: PlanItem[] = []
  const pins: Record<string, Pin> = {}

  for (const a of actions) {
    const pin = prevPins[a.ref]?.sig === sigOf(a) ? prevPins[a.ref] : undefined
    const msgs: PlanItem['messages'] = []
    const err = (text: string) => msgs.push({ level: 'erro', text })
    const warn = (text: string) => msgs.push({ level: 'aviso', text })
    const details: string[] = []
    let state: ItemState = 'pronto'
    const r: Resolved = {}
    const depends = a.depende_de.filter((d) => byRef.has(d) && d !== a.ref)
    for (const d of a.depende_de) if (!byRef.has(d)) err(`Depende de uma ação que não está no plano (${d}).`)
    const area = AREA[a.tipo]
    if (ctx.areasOff.includes(area)) err('Essa área está desligada em "Privacidade da IA".')
    if (!isEnabled(settings, MODULE[a.tipo])) err('A seção dessa área está desligada no Núcleo.')
    const money = (c: number, cur: Currency) => formatMoney(c, cur)
    const curOf = (fallback: Currency) => {
      const c = (a.moeda ?? fallback).toUpperCase()
      if (!isCurrencyCode(c)) {
        err(`Moeda desconhecida: ${a.moeda}.`)
        return fallback
      }
      return c
    }
    const date = a.data ?? today
    // A record created by an action of this plan, by ref (via depende_de) or by name.
    const planned = (tipo: ActionType, name: string | null) => {
      const viaDep = depends.map((d) => byRef.get(d)!).find((x) => x.tipo === tipo)
      if (viaDep) return viaDep
      if (!name) return undefined
      return actions.find((x) => x.tipo === tipo && x.ref !== a.ref && fold(x.titulo ?? x.pessoa ?? '') === fold(name))
    }
    const requirePaid = (what: string) => {
      if (a.ja_recebido_ou_pago !== true) err(`Confirme se ${what} já aconteceu: o Núcleo só registra dinheiro realizado quando você diz que foi. Se ainda vai acontecer, crie uma tarefa ou lembrete.`)
    }

    switch (a.tipo) {
      case 'criar_cliente': {
        const name = (a.pessoa ?? a.titulo ?? '').trim()
        if (!name) err('Falta o nome do cliente.')
        const existing = name ? findByName(data.clients, (c) => c.name, name) : { one: null, many: [] }
        if (existing.one && fold(existing.one.name) === fold(name)) {
          state = 'existente'
          r.clientId = existing.one.id
          details.push('Já existe um cliente com esse nome: será usado o cadastro atual.')
        } else r.clientId = planRecordId(planId, a.ref)
        r.clientName = name
        break
      }
      case 'criar_projeto': {
        if (!a.titulo?.trim()) err('Falta o nome do projeto.')
        const viaPlan = planned('criar_cliente', a.pessoa)
        if (viaPlan) r.clientId = resolved.get(viaPlan.ref)?.clientId ?? planRecordId(planId, viaPlan.ref)
        else if (a.pessoa) {
          const c = findByName(data.clients, (x) => x.name, a.pessoa)
          if (c.one) r.clientId = c.one.id
          else if (c.many.length > 1) err(`Há mais de um cliente parecido com “${a.pessoa}”: ${c.many.slice(0, 4).map((x) => x.name).join(', ')}.`)
          else warn(`Cliente “${a.pessoa}” não encontrado: o projeto fica sem cliente (ou inclua “Novo cliente” no plano).`)
        }
        const cur = curOf(base)
        r.currency = cur
        r.amount = cents(a.valor) ?? 0
        const dup = data.projects.find((p) => fold(p.name) === fold(a.titulo ?? '') && (p.clientId ?? null) === (r.clientId ?? null))
        if (dup) warn('Já existe um projeto com esse nome para esse cliente: provavelmente é o mesmo pedido de antes.')
        details.push(r.amount ? `Valor cobrado ${money(r.amount, cur)} · nada recebido ainda` : 'Sem valor cobrado')
        if (a.data) details.push(`Prazo ${dayLabel(a.data)}`)
        break
      }
      case 'criar_venda': {
        const total = cents(a.valor)
        if (!a.titulo?.trim()) err('Falta o que foi vendido.')
        if (!total || total <= 0) err('Falta o valor total da venda.')
        const cur = curOf(base)
        r.currency = cur
        r.amount = total ?? 0
        r.date = date
        const viaPlan = planned('criar_cliente', a.pessoa)
        if (viaPlan) r.clientId = resolved.get(viaPlan.ref)?.clientId ?? planRecordId(planId, viaPlan.ref)
        else if (a.pessoa) {
          const c = findByName(data.clients, (x) => x.name, a.pessoa)
          r.clientId = c.one?.id ?? null
          r.clientName = c.one ? '' : a.pessoa.trim()
        } else err('Falta o nome do comprador.')
        const down = cents(a.entrada_recebida) ?? 0
        if (down > 0 && a.ja_recebido_ou_pago !== true) err('Você disse que recebeu uma entrada? Confirme “Já recebido” para registrá-la — senão a venda fica toda a receber.')
        if (total && down > total) err('A entrada recebida é maior que o total da venda.')
        const owed = Math.max(0, (total ?? 0) - (a.ja_recebido_ou_pago === true ? down : 0))
        if (a.parcelas && owed > 0 && !a.primeira_parcela) err('Falta a data da primeira parcela.')
        if (a.parcelas && owed <= 0) err('Não há saldo a parcelar.')
        details.push(`Total ${money(total ?? 0, cur)} · ${a.ja_recebido_ou_pago === true && down ? `recebido agora ${money(down, cur)} (vira entrada no Financeiro)` : 'nada recebido agora'}`)
        if (a.parcelas && a.primeira_parcela && owed > 0) {
          const inst = buildInstallments(owed, a.parcelas, a.primeira_parcela, a.intervalo_parcelas === 'semana' ? 'week' : 'month', () => 'x')
          details.push(`${inst.length} parcelas a receber: ${inst.map((i) => `${dayLabel(i.due)} ${money(i.amount, cur)}`).join(' · ')}`)
        } else if (owed > 0) details.push(`A receber: ${money(owed, cur)}`)
        // A project for the same person in this plan already holds what is owed: a sale too would count it twice.
        const twin = actions.find((x) => x.tipo === 'criar_projeto' && x.ref !== a.ref && (x.valor ?? 0) > 0 && fold(x.pessoa ?? '') === fold(a.pessoa ?? ''))
        if (twin) warn(`O projeto “${twin.titulo}” deste plano já guarda quanto o cliente deve. Registrar também uma venda faria o mesmo valor ficar a receber duas vezes — use um dos dois.`)
        const who = r.clientId ? (data.clients.find((c) => c.id === r.clientId)?.name ?? a.pessoa ?? '') : (a.pessoa ?? '')
        const dup = data.sales.find((s) => s.date === date && s.total === total && s.currency === cur && fold(s.product) === fold(a.titulo ?? '') && fold(s.clientId ? (data.clients.find((c) => c.id === s.clientId)?.name ?? '') : s.clientName) === fold(who))
        if (dup) warn('Já existe uma venda igual (mesmo comprador, produto, valor e dia): provavelmente é o mesmo pedido de antes.')
        break
      }
      case 'registrar_recebimento': {
        requirePaid('o recebimento')
        const amount = cents(a.valor)
        if (!amount || amount <= 0) err('Falta o valor recebido.')
        r.amount = amount ?? 0
        r.date = date
        // the sale/project it belongs to: one created in this plan, or an existing one by name
        const viaSale = depends.map((d) => byRef.get(d)!).find((x) => x.tipo === 'criar_venda')
        const viaProject = depends.map((d) => byRef.get(d)!).find((x) => x.tipo === 'criar_projeto')
        if (viaSale) {
          r.targetCollection = 'sales'
          r.targetId = planRecordId(planId, viaSale.ref)
          r.currency = (viaSale.moeda ?? base).toUpperCase()
          // the same check as "Recebi" on a sale: never more than what is still owed
          const owedNew = (cents(viaSale.valor) ?? 0) - (viaSale.ja_recebido_ou_pago === true ? (cents(viaSale.entrada_recebida) ?? 0) : 0)
          if (r.amount > owedNew) err(`O valor passa do que falta receber dessa venda (${formatMoney(Math.max(0, owedNew), r.currency)}).`)
        } else if (viaProject) {
          r.targetCollection = 'projects'
          r.targetId = planRecordId(planId, viaProject.ref)
          r.currency = (viaProject.moeda ?? base).toUpperCase()
        } else {
          const q = a.alvo ?? a.pessoa
          const nameOfSale = (s: Sale) => `${s.clientId ? (data.clients.find((c) => c.id === s.clientId)?.name ?? '') : s.clientName} ${s.product}`
          const pinnedSale = pin?.targetId ? data.sales.find((s) => s.id === pin.targetId) : undefined
          const pinnedProject = pin?.targetId ? data.projects.find((p) => p.id === pin.targetId) : undefined
          const paidHere = (list: { id: string }[]) => list.some((x) => x.id === planRecordId(planId, a.ref, 'pag'))
          const openSales = pinnedSale ? [pinnedSale] : pinnedProject ? [] : data.sales.filter((s) => s.total - salePaid(s) > 0)
          const sales = q ? openSales.filter((s) => fold(nameOfSale(s)).includes(fold(q)) || fold(q).split(/\s+/).every((w) => fold(nameOfSale(s)).includes(w))) : []
          const projects = pinnedProject ? [pinnedProject] : pinnedSale ? [] : q ? data.projects.filter((p) => fold(p.name).includes(fold(q)) || fold(data.clients.find((c) => c.id === p.clientId)?.name ?? '') === fold(q)) : []
          const total = sales.length + projects.length
          if (!q && !pin?.targetId) err('Diga de qual venda ou projeto foi o recebimento.')
          else if (total === 0) err(`Não encontrei venda em aberto nem projeto com “${q}”.`)
          else if (total > 1) err(`Há mais de um registro com “${q}”: ${[...sales.map((s) => `venda ${nameOfSale(s).trim()}`), ...projects.map((p) => `projeto ${p.name}`)].slice(0, 4).join(', ')}. Diga qual.`)
          else if (sales[0]) {
            r.targetCollection = 'sales'
            r.targetId = sales[0].id
            r.currency = sales[0].currency
            // already applied by this plan: nothing to check (the payment is there)
            const problem = paidHere(sales[0].payments) ? null : paymentProblem(sales[0], { id: 'novo', amount: r.amount, date })
            if (problem) err(problem)
            if (!paidHere(sales[0].payments) && sales[0].payments.some((p) => p.amount === r.amount && p.date === date)) warn('Já existe um pagamento igual nessa venda (mesmo valor e dia): provavelmente já foi registrado.')
            details.push(`Venda: ${nameOfSale(sales[0]).trim()} · falta receber ${money(sales[0].total - salePaid(sales[0]), sales[0].currency)}`)
          } else {
            const p = projects[0]
            r.targetCollection = 'projects'
            r.targetId = p.id
            r.currency = p.currency
            const problem = paidHere(p.payments ?? []) ? null : projectPaymentProblem(p, { id: 'novo', amount: r.amount, date })
            if (problem) err(problem)
            if (!paidHere(p.payments ?? []) && (p.payments ?? []).some((x) => x.amount === r.amount && x.date === date)) warn('Já existe um pagamento igual nesse projeto (mesmo valor e dia): provavelmente já foi registrado.')
            details.push(`Projeto: ${p.name}`)
          }
        }
        if (a.moeda && r.currency && a.moeda.toUpperCase() !== r.currency) err(`Esse registro é em ${r.currency}; o recebimento precisa ser na mesma moeda.`)
        if (r.currency) details.push(`${money(r.amount, r.currency)} em ${dayLabel(date)} · vira uma entrada no Financeiro (uma só)`)
        break
      }
      case 'registrar_despesa':
      case 'registrar_entrada':
      case 'registrar_transferencia': {
        const what = a.tipo === 'registrar_despesa' ? 'o pagamento' : a.tipo === 'registrar_entrada' ? 'a entrada' : 'a transferência'
        requirePaid(what)
        const amount = cents(a.valor)
        if (!amount || amount <= 0) err('Falta o valor.')
        if (a.tipo !== 'registrar_transferencia' && !a.titulo?.trim()) err('Falta a descrição.')
        const cur = curOf(base)
        r.amount = amount ?? 0
        r.currency = cur
        r.date = date
        if (date > today) err('Data no futuro: o Financeiro registra o que já aconteceu. Para algo futuro, crie uma tarefa ou lembrete.')
        const type = a.tipo === 'registrar_entrada' || (a.tipo === 'registrar_transferencia' && a.sentido === 'entrada') ? 'in' : 'out'
        if (a.tipo !== 'registrar_transferencia' && a.categoria) {
          const c = categoryIdFor(a.categoria, { data, settings, now, book: null as never, areasOff: [] }, type)
          if (!c) warn(`Categoria “${a.categoria}” não encontrada: fica sem categoria.`)
          else details.push(`Categoria ${c.label}`)
        }
        const reason = (a.titulo ?? (a.tipo === 'registrar_transferencia' ? 'Transferência entre contas' : '')).trim()
        const near = (d: string) => Math.abs(Date.parse(d) - Date.parse(date)) <= 86_400_000
        const dup = data.transactions.find((t) => t.type === type && t.amount === amount && t.currency === cur && near(dayOfTransaction(t, tz)) && (fold(t.reason) === fold(reason) || Boolean(t.transfer) === (a.tipo === 'registrar_transferencia')))
        if (dup) warn(`Já existe ${type === 'in' ? 'uma entrada' : 'uma saída'} de ${money(amount ?? 0, cur)} perto desse dia (“${dup.reason}”): provavelmente já foi registrada.`)
        details.push(`${type === 'in' ? 'Entrada' : 'Saída'} de ${money(amount ?? 0, cur)} em ${dayLabel(date)}${a.tipo === 'registrar_transferencia' ? ' · entre contas suas: não conta como receita nem despesa' : ''}`)
        break
      }
      case 'reservar_meta': {
        const amount = cents(a.valor)
        if (!amount || amount <= 0) err('Falta o valor a reservar.')
        const viaPlan = planned('criar_meta_financeira', a.alvo)
        if (viaPlan) {
          r.targetCollection = 'financeGoals'
          r.targetId = planRecordId(planId, viaPlan.ref)
          r.goalBefore = 0
          r.goalAfter = amount ?? 0
          r.currency = (viaPlan.moeda ?? base).toUpperCase()
        } else {
          const pinned = pin?.targetId ? data.financeGoals.find((x) => x.id === pin.targetId) : undefined
          const g = pinned ? { one: pinned, many: [pinned] } : findByName(data.financeGoals.filter((x) => x.status === 'active'), (x) => x.name, a.alvo)
          if (!a.alvo && !pinned) err('Diga em qual meta reservar.')
          else if (!g.one) err(g.many.length ? `Há mais de uma meta parecida: ${g.many.map((x) => x.name).join(', ')}.` : `Meta “${a.alvo}” não encontrada.`)
          else {
            r.targetCollection = 'financeGoals'
            r.targetId = g.one.id
            r.currency = g.one.currency
            r.goalBefore = pin?.goalBefore ?? g.one.saved
            r.goalAfter = pin?.goalAfter ?? g.one.saved + (amount ?? 0)
            if (g.one.saved !== r.goalBefore && g.one.saved !== r.goalAfter) err(`O valor guardado em “${g.one.name}” mudou desde a prévia. Peça de novo para recalcular.`)
            details.push(`${g.one.name}: guardado passa de ${money(g.one.saved, g.one.currency)} para ${money(r.goalAfter, g.one.currency)}`)
          }
        }
        if (a.moeda && r.currency && a.moeda.toUpperCase() !== r.currency) err(`A meta é em ${r.currency}; a reserva precisa ser na mesma moeda.`)
        details.push('Reserva não é saída de dinheiro: o valor continua no seu saldo, como reservado.')
        break
      }
      case 'criar_meta_financeira': {
        if (!a.titulo?.trim()) err('Falta o nome da meta.')
        if (!a.valor) err('Falta o valor da meta.')
        if (!a.data) err('Falta o prazo da meta.')
        else if (a.data <= today) err('O prazo da meta precisa ser no futuro.')
        r.currency = curOf(base)
        if (data.financeGoals.some((g) => g.status === 'active' && fold(g.name) === fold(a.titulo ?? ''))) warn('Já existe uma meta ativa com esse nome.')
        details.push(`Alvo ${money(cents(a.valor) ?? 0, r.currency)}${a.data ? ` até ${dayLabel(a.data)}/${a.data.slice(0, 4)}` : ''} · começa com nada guardado`)
        break
      }
      case 'criar_tarefa': {
        if (!a.titulo?.trim()) err('Falta o título da tarefa.')
        const viaProject = depends.map((d) => byRef.get(d)!).find((x) => x.tipo === 'criar_projeto')
        if (viaProject) r.projectId = planRecordId(planId, viaProject.ref)
        else if (a.alvo) {
          const p = findByName(data.projects, (x) => x.name, a.alvo)
          if (p.one) r.projectId = p.one.id
          else warn(`Projeto “${a.alvo}” não encontrado: a tarefa fica sem projeto.`)
        }
        if (a.hora && !a.data) warn('Horário sem data: a tarefa fica sem horário.')
        if (a.data && data.tasks.some((t) => t.status !== 'done' && fold(t.title) === fold(a.titulo ?? '') && t.dueDate === a.data)) warn('Já existe uma tarefa aberta igual nesse dia.')
        if (a.data && a.data < today) warn('Data no passado: a tarefa já nasce atrasada.')
        break
      }
      case 'mover_tarefa':
      case 'concluir_tarefa': {
        const pinned = pin?.targetId ? data.tasks.find((x) => x.id === pin.targetId) : undefined
        const open = data.tasks.filter((t) => t.status !== 'done')
        const t = pinned ? { one: pinned, many: [pinned] } : findByName(open, (x) => x.title, a.alvo)
        if (!a.alvo && !pinned) err('Diga qual tarefa.')
        else if (!t.one) err(t.many.length ? `Há mais de uma tarefa parecida: ${t.many.slice(0, 4).map((x) => x.title).join(', ')}. Diga qual.` : `Não encontrei tarefa aberta “${a.alvo}”.`)
        else {
          r.targetCollection = 'tasks'
          r.targetId = t.one.id
          if (a.tipo === 'mover_tarefa') {
            if (!a.data) err('Falta a nova data.')
            details.push(`Antes: ${t.one.dueDate ? dayLabel(t.one.dueDate) : 'sem data'}${t.one.dueTime ? ` ${t.one.dueTime}` : ''}`)
          }
        }
        break
      }
      case 'criar_compromisso':
      case 'mover_compromisso': {
        let start = a.hora
        let end = a.hora_fim
        let day = a.data
        if (a.tipo === 'mover_compromisso') {
          const pinnedEv = pin?.targetId ? data.events.find((e) => e.id === pin.targetId) : undefined
          const ev = pinnedEv ? { one: pinnedEv, many: [pinnedEv] } : findByName(data.events.filter((e) => e.date >= today), (e) => e.title, a.alvo)
          if (!a.alvo && !pinnedEv) err('Diga qual compromisso.')
          else if (!ev.one) err(ev.many.length ? `Há mais de um compromisso parecido: ${ev.many.slice(0, 4).map((e) => `${e.title} (${dayLabel(e.date)})`).join(', ')}.` : `Não encontrei compromisso futuro “${a.alvo}”.`)
          else {
            r.targetCollection = 'events'
            r.targetId = ev.one.id
            day = day ?? (pin?.targetId ? (resolvedTimes.get(`${planId}:${a.ref}`)?.day ?? ev.one.date) : ev.one.date)
            if (!start) start = pin?.targetId ? (resolvedTimes.get(`${planId}:${a.ref}`)?.start ?? ev.one.start) : ev.one.start
            if (!end && pin?.targetId && resolvedTimes.get(`${planId}:${a.ref}`)) end = resolvedTimes.get(`${planId}:${a.ref}`)!.end
            if (!end && ev.one.start && ev.one.end && start) {
              const dur = toMin(ev.one.end) - toMin(ev.one.start)
              end = fromMin(toMin(start) + dur)
            }
            details.push(`Antes: ${dayLabel(ev.one.date)} ${ev.one.start}${ev.one.end ? `–${ev.one.end}` : ''}`)
          }
        } else {
          if (!a.titulo?.trim()) err('Falta o título do compromisso.')
          if (!day) err('Falta o dia do compromisso.')
          if (!start) err('Falta o horário do compromisso.')
        }
        if (end && start && end <= start) err('O fim precisa ser depois do início.')
        r.date = day ?? undefined
        if (day && start && isTime(start)) {
          const s = toMin(start)
          const e = end && isTime(end) ? toMin(end) : s + 60
          const clash = busyOf(buildAgenda(data, settings, day, day, now)).filter((b) => b.item.source.kind !== 'event' || (b.item.source as { event: { id: string } }).event.id !== r.targetId).filter((b) => b.start < e && s < b.end)
          if (clash.length) warn(`Conflito de horário com ${clash.map((b) => b.title).join(', ')}.`)
        }
        resolvedTimes.set(`${planId}:${a.ref}`, { day: day ?? '', start: start ?? '', end: end ?? '' })
        break
      }
      case 'criar_nota':
        if (!a.titulo?.trim() && !a.observacao?.trim()) err('A anotação está vazia.')
        break
      case 'criar_habito':
        if (!a.titulo?.trim()) err('Falta o nome do hábito.')
        if (data.habits.some((h) => h.active && fold(h.name) === fold(a.titulo ?? ''))) warn('Já existe um hábito ativo com esse nome.')
        break
      case 'adicionar_compra': {
        if (!a.titulo?.trim()) err('Falta o item.')
        const week = weekStart(today)
        if (data.shoppingItems.some((s) => s.week === week && !s.checked && fold(s.name) === fold(a.titulo ?? ''))) warn('Esse item já está na lista desta semana.')
        break
      }
    }

    if (depends.length) details.push(`Precisa de: ${depends.map((d) => { const x = byRef.get(d)!; return `${KIND_LABEL[x.tipo].toLowerCase()} ${x.titulo ?? x.pessoa ?? ''}`.trim() }).join('; ')}`)
    if ((a.tipo === 'criar_tarefa' || a.tipo === 'criar_compromisso') && a.lembrete_minutos != null) details.push(a.tipo === 'criar_tarefa' && !(a.data && a.hora) ? 'Lembrete às 09:00 do dia' : a.lembrete_minutos === 0 ? 'Lembrete na hora' : `Lembrete ${a.lembrete_minutos} min antes`)
    // A dependency that failed makes this one fail too (it would point to nothing).
    for (const d of depends) {
      const dep = items.find((x) => x.ref === d)
      if (dep && dep.state === 'erro') err(`Depende de “${dep.label}”, que tem um problema.`)
    }
    if (state !== 'existente') state = msgs.some((m) => m.level === 'erro') ? 'erro' : msgs.length ? 'aviso' : 'pronto'
    resolved.set(a.ref, r)
    pins[a.ref] = { sig: sigOf(a), ...(r.targetId && r.targetCollection ? { targetId: r.targetId } : {}), ...(r.goalBefore != null ? { goalBefore: r.goalBefore, goalAfter: r.goalAfter } : {}) }
    const dup = msgs.some((m) => m.level === 'aviso' && /provavelmente|Já existe|já está|duas vezes/.test(m.text))
    items.push({
      ref: a.ref,
      action: a,
      area,
      label: labelOf(a, r, today),
      details,
      messages: msgs,
      state,
      defaultOn: state === 'pronto' || (state === 'aviso' && !dup),
      depends,
      money: MONEY.includes(a.tipo),
      editable: EDITABLE[a.tipo],
    })
  }
  resolvedCache.set(planId, resolved)
  return { id: planId, uid, summary, actions, items, pins }
}

const resolvedTimes = new Map<string, { day: string; start: string; end: string }>()
const resolvedCache = new Map<string, Map<string, Resolved>>()
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const fromMin = (m: number) => `${String(Math.min(23, Math.floor(m / 60))).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

function labelOf(a: Action, r: Resolved, today: string): string {
  const when = [a.data ? dayLabel(a.data) : '', a.hora ?? ''].filter(Boolean).join(' ')
  const name = a.titulo ?? a.pessoa ?? a.alvo ?? ''
  const amount = r.amount && r.currency ? formatMoney(r.amount, r.currency) : ''
  switch (a.tipo) {
    case 'registrar_recebimento':
      return `${KIND_LABEL[a.tipo]} · ${a.alvo ?? a.pessoa ?? 'da venda/projeto'}${amount ? ` · ${amount}` : ''}`
    case 'reservar_meta':
      return `${KIND_LABEL[a.tipo]} · ${a.alvo ?? ''}${amount ? ` · ${amount}` : ''}`
    case 'mover_tarefa':
    case 'mover_compromisso':
      return `${KIND_LABEL[a.tipo]} · ${a.alvo ?? ''} → ${when || dayLabel(today)}`
    case 'concluir_tarefa':
      return `${KIND_LABEL[a.tipo]} · ${a.alvo ?? ''}`
    default:
      return [KIND_LABEL[a.tipo], name, amount, when].filter(Boolean).join(' · ')
  }
}

/* ------------------------------------------------------------------ dependencies */

/** Turning an item off also turns off what depends on it; turning one on turns on what it needs. */
export function toggle(plan: Plan, chosen: Set<string>, ref: string): { chosen: Set<string>; also: string[] } {
  const next = new Set(chosen)
  const also: string[] = []
  if (next.has(ref)) {
    const drop = (r: string) => {
      next.delete(r)
      for (const i of plan.items) if (i.depends.includes(r) && next.has(i.ref)) {
        also.push(i.ref)
        drop(i.ref)
      }
    }
    drop(ref)
  } else {
    const add = (r: string) => {
      const item = plan.items.find((i) => i.ref === r)
      if (!item || item.state === 'erro') return
      next.add(r)
      for (const d of item.depends) if (!next.has(d) && plan.items.find((i) => i.ref === d)?.state !== 'existente') {
        also.push(d)
        add(d)
      }
    }
    add(ref)
  }
  return { chosen: next, also }
}

export const initialChoice = (plan: Plan) => new Set(plan.items.filter((i) => i.defaultOn && i.state !== 'existente').map((i) => i.ref))

/** Edits a field of an action in the preview (then the plan is built again, locally). */
export function editAction(plan: Plan, ref: string, field: EditableField, value: string | number | boolean | null): Action[] {
  return plan.actions.map((a) => (a.ref === ref ? { ...a, [field === 'hora' ? 'hora' : field]: value } : a))
}

/* ------------------------------------------------------------------ compile */

export interface Compiled {
  ops: BatchOp[]
  problems: string[]
  /** What each written record looked like before (null = created): for undo. */
  before: { collection: CollectionName; id: string; item: (Entity & Record<string, unknown>) | null }[]
  /** Items already applied (a second confirm of the same plan): nothing to write for them. */
  alreadyApplied: string[]
}

export interface CompileCtx extends PlanCtx {
  convert: Converter
}

/**
 * The chosen items → one list of writes, built against the CURRENT data (the plan is rebuilt first:
 * anything that changed since the preview is caught). Nothing is written here.
 */
export function compilePlan(plan: Plan, chosen: Set<string>, ctx: CompileCtx): Compiled {
  const { data, settings, now, convert } = ctx
  const tz = zoneOf(settings)
  const today = todayIn(tz, now)
  const fresh = buildPlan(plan.id, plan.uid, plan.summary, plan.actions, ctx, plan.pins)
  const resolved = resolvedCache.get(plan.id)!
  const problems: string[] = []
  const alreadyApplied: string[] = []
  const items = fresh.items.filter((i) => chosen.has(i.ref))
  for (const i of items) {
    if (i.state === 'erro') problems.push(`${i.label}: ${i.messages.filter((m) => m.level === 'erro').map((m) => m.text).join(' ')}`)
    for (const d of i.depends) {
      const dep = fresh.items.find((x) => x.ref === d)
      if (dep && dep.state !== 'existente' && !chosen.has(d)) problems.push(`${i.label} precisa de “${dep.label}”, que foi desmarcado.`)
    }
  }
  if (problems.length) return { ops: [], problems, before: [], alreadyApplied }

  const ops: BatchOp[] = []
  const before: Compiled['before'] = []
  const current = <T extends Entity>(collection: CollectionName, id: string) => (data[collection] as unknown as T[]).find((x) => x.id === id)
  const put = (collection: CollectionName, item: Entity & Record<string, unknown>) => {
    ops.push({ op: 'put', collection, item: item as never })
    if (!before.some((b) => b.collection === collection && b.id === item.id)) before.push({ collection, id: item.id, item: (current(collection, item.id) as never) ?? null })
  }
  const toBase = (amount: number, currency: Currency) => {
    const v = convert(amount, currency, settings.baseCurrency)
    if (v === null) throw new Error(`Sem cotação para ${currency}: atualize as cotações e tente de novo.`)
    return v
  }
  const created = (ref: string, part = '') => planRecordId(plan.id, ref, part)
  const exists = (collection: CollectionName, id: string) => Boolean(current(collection, id))
  const stamp = { createdAt: now.toISOString(), updatedAt: now.toISOString() }

  // Sales and projects are saved once each, with every change of this plan merged in.
  const sales = new Map<string, Sale>()
  const projects = new Map<string, Project>()
  const saleOf = (id: string) => sales.get(id) ?? (current<Sale>('sales', id) ? structuredClone(current<Sale>('sales', id)!) : undefined)
  const projectOf = (id: string) => projects.get(id) ?? (current<Project>('projects', id) ? structuredClone(current<Project>('projects', id)!) : undefined)

  try {
    for (const i of items) {
      if (i.state === 'existente') continue
      const a = i.action
      const r = resolved.get(a.ref)!
      const id = created(a.ref)
      switch (a.tipo) {
        case 'criar_cliente':
          if (exists('clients', id)) alreadyApplied.push(a.ref)
          else put('clients', { id, ...stamp, name: (a.pessoa ?? a.titulo ?? '').trim(), company: '', phone: '', whatsapp: '', email: '', location: '', notes: a.observacao ?? '', status: 'active' })
          break
        case 'criar_projeto':
          if (exists('projects', id)) {
            alreadyApplied.push(a.ref)
            break
          }
          projects.set(id, { id, ...stamp, name: a.titulo!.trim(), clientId: r.clientId ?? null, kind: 'other', status: 'notStarted', startDate: today, dueDate: a.data ?? '', endDate: '', charged: r.amount ?? 0, received: 0, currency: r.currency!, link: '', notes: a.observacao ?? '', payments: [] })
          break
        case 'criar_venda': {
          if (exists('sales', id)) {
            alreadyApplied.push(a.ref)
            break
          }
          const total = r.amount!
          const down = a.ja_recebido_ou_pago === true ? (cents(a.entrada_recebida) ?? 0) : 0
          const owed = total - down
          const installments = a.parcelas && a.primeira_parcela && owed > 0 ? buildInstallments(owed, a.parcelas, a.primeira_parcela, a.intervalo_parcelas === 'semana' ? 'week' : 'month', (() => {
            let n = 0
            return () => created(`${a.ref}-p${++n}`)
          })()) : undefined
          let sale: Sale = {
            id,
            ...stamp,
            clientId: r.clientId ?? null,
            clientName: r.clientId ? '' : (r.clientName ?? a.pessoa ?? '').trim(),
            product: a.titulo!.trim(),
            quantity: 1,
            date: r.date!,
            total,
            currency: r.currency!,
            dueDate: installments ? installments[installments.length - 1].due : '',
            payments: [],
            notes: a.observacao ?? '',
            ...(installments ? { installments } : {}),
          }
          // the down payment the person said was received: one payment, one income (fixed ids)
          if (down > 0) sale = withPayment(sale, { id: created(a.ref, 'entrada'), date: r.date!, amount: down, note: 'Pago na venda', finance: true })
          sales.set(id, sale)
          break
        }
        case 'registrar_recebimento': {
          const payId = created(a.ref, 'pag')
          if (r.targetCollection === 'sales') {
            const s = saleOf(r.targetId!)
            if (!s) throw new Error('A venda desse recebimento não está mais no Núcleo.')
            if (s.payments.some((p) => p.id === payId)) {
              alreadyApplied.push(a.ref)
              break
            }
            sales.set(s.id, withPayment(s, { id: payId, date: r.date!, amount: r.amount!, note: 'Registrado pelo Assistente', finance: true }))
          } else {
            const p = projectOf(r.targetId!)
            if (!p) throw new Error('O projeto desse recebimento não está mais no Núcleo.')
            if ((p.payments ?? []).some((x) => x.id === payId)) {
              alreadyApplied.push(a.ref)
              break
            }
            const pay: ProjectPayment = { id: payId, date: r.date!, amount: r.amount!, currency: p.currency, note: 'Registrado pelo Assistente' }
            projects.set(p.id, { ...p, payments: [...(p.payments ?? []), pay] })
          }
          break
        }
        case 'registrar_despesa':
        case 'registrar_entrada':
        case 'registrar_transferencia': {
          if (exists('transactions', id)) {
            alreadyApplied.push(a.ref)
            break
          }
          const type = a.tipo === 'registrar_entrada' || (a.tipo === 'registrar_transferencia' && a.sentido === 'entrada') ? 'in' : 'out'
          const cat = a.tipo !== 'registrar_transferencia' && a.categoria ? categoryIdFor(a.categoria, { data, settings, now, book: null as never, areasOff: [] }, type) : null
          const draft = transactionDraft(
            { type, amount: r.amount!, currency: r.currency!, reason: (a.titulo ?? 'Transferência entre contas').trim(), ...(cat ? { category: cat.id } : {}), ...(a.tipo === 'registrar_transferencia' ? { transfer: true } : {}) },
            toBase,
          )
          const at = instantFor(r.date!, tz, now)
          put('transactions', { ...(draft as unknown as Record<string, unknown>), id, createdAt: at, updatedAt: at } as never)
          break
        }
        case 'reservar_meta': {
          const g = current<typeof data.financeGoals[number]>('financeGoals', r.targetId!) ?? (items.some((x) => x.action.tipo === 'criar_meta_financeira' && created(x.action.ref) === r.targetId) ? null : undefined)
          if (g === undefined) throw new Error('A meta não está mais no Núcleo.')
          if (g === null) break // created below with the reserve already in it
          // absolute value with a precondition: already at the target = applied before; changed meanwhile = stop
          if (g.saved === r.goalAfter) {
            alreadyApplied.push(a.ref)
            break
          }
          if (g.saved !== r.goalBefore) throw new Error(`O valor guardado em “${g.name}” mudou desde a prévia. Revise o plano.`)
          put('financeGoals', { ...g, saved: r.goalAfter!, history: withSaved(g, r.goalAfter!, today) } as never)
          break
        }
        case 'criar_meta_financeira': {
          if (exists('financeGoals', id)) {
            alreadyApplied.push(a.ref)
            break
          }
          const reserve = items.find((x) => x.action.tipo === 'reservar_meta' && resolved.get(x.ref)?.targetId === id)
          const saved = reserve ? (resolved.get(reserve.ref)?.goalAfter ?? 0) : 0
          put('financeGoals', { id, ...stamp, name: a.titulo!.trim(), target: cents(a.valor)!, saved, deadline: a.data!, currency: r.currency!, note: '', status: 'active', history: startHistory(saved, today) })
          break
        }
        case 'criar_tarefa': {
          if (exists('tasks', id)) {
            alreadyApplied.push(a.ref)
            break
          }
          const time = a.data && a.hora ? a.hora : ''
          const alerts = a.lembrete_minutos == null ? undefined : time ? [{ id: created(a.ref, 'alerta'), type: 'min' as const, minutes: a.lembrete_minutos }] : a.data ? [{ id: created(a.ref, 'alerta'), type: 'day' as const, days: 0, at: '09:00' }] : undefined
          put('tasks', { id, ...stamp, title: a.titulo!.trim(), projectId: r.projectId ?? null, dueDate: a.data ?? '', dueTime: time, priority: 'none', status: 'todo', completedAt: null, notes: a.observacao ?? '', ...(alerts ? { alerts } : {}) })
          break
        }
        case 'mover_tarefa': {
          const t = current<Task>('tasks', r.targetId!)!
          if (t.dueDate === a.data && (t.dueTime ?? '') === (a.hora ?? (a.data === t.dueDate ? (t.dueTime ?? '') : ''))) {
            alreadyApplied.push(a.ref)
            break
          }
          put('tasks', { ...t, dueDate: a.data!, dueTime: a.hora ?? '' } as never)
          break
        }
        case 'concluir_tarefa': {
          const t = current<Task>('tasks', r.targetId!)!
          if (t.status === 'done') {
            alreadyApplied.push(a.ref)
            break
          }
          put('tasks', { ...t, status: 'done', completedAt: now.toISOString() } as never)
          break
        }
        case 'criar_compromisso': {
          if (exists('events', id)) {
            alreadyApplied.push(a.ref)
            break
          }
          const tm = resolvedTimes.get(`${plan.id}:${a.ref}`)!
          const alerts = a.lembrete_minutos == null ? undefined : [{ id: created(a.ref, 'alerta'), type: 'min' as const, minutes: a.lembrete_minutos }]
          put('events', { id, ...stamp, title: a.titulo!.trim(), date: tm.day, start: tm.start, end: tm.end, notes: a.observacao ?? '', ...(alerts ? { alerts } : {}) })
          break
        }
        case 'mover_compromisso': {
          const e = current<typeof data.events[number]>('events', r.targetId!)!
          const tm = resolvedTimes.get(`${plan.id}:${a.ref}`)!
          if (e.date === tm.day && e.start === tm.start && e.end === tm.end) {
            alreadyApplied.push(a.ref)
            break
          }
          put('events', { ...e, date: tm.day, start: tm.start, end: tm.end } as never)
          break
        }
        case 'criar_nota':
          if (exists('notes', id)) alreadyApplied.push(a.ref)
          else put('notes', { id, ...stamp, title: (a.titulo ?? '').trim(), body: a.observacao ?? '', pinned: false })
          break
        case 'criar_habito':
          if (exists('habits', id)) alreadyApplied.push(a.ref)
          else put('habits', { id, ...stamp, name: a.titulo!.trim(), rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: today })
          break
        case 'adicionar_compra':
          if (exists('shoppingItems', id)) alreadyApplied.push(a.ref)
          else put('shoppingItems', { id, ...stamp, week: weekStart(today), kind: 'manual', name: a.titulo!.trim(), qty: '', unit: '', category: '', checked: false })
          break
      }
    }
    // Projects and sales through the screens' own write builders (payments → one income each, fixed ids).
    const receipt = { settings, convert, now }
    for (const p of projects.values()) {
      const opsP = projectSaveOps(p, data, settings, receipt, now)
      for (const o of opsP) if (o.op === 'put') put(o.collection, o.item as never)
      else {
        ops.push(o)
        before.push({ collection: o.collection, id: o.id, item: (current(o.collection, o.id) as never) ?? null })
      }
    }
    if (sales.size) {
      for (const o of saleSaveOps([...sales.values()], data, receipt)) if (o.op === 'put') put(o.collection, o.item as never)
      else {
        ops.push(o)
        before.push({ collection: o.collection, id: o.id, item: (current(o.collection, o.id) as never) ?? null })
      }
    }
  } catch (e) {
    return { ops: [], problems: [e instanceof Error ? e.message : 'Não foi possível montar as alterações.'], before: [], alreadyApplied }
  }
  return { ops, problems, before, alreadyApplied }
}

/** Money facts of a compiled write, for tests and the summary: incomes / expenses / transfers created. */
export function moneyWrites(ops: BatchOp[]): Transaction[] {
  return ops.filter((o) => o.op === 'put' && o.collection === 'transactions').map((o) => (o as unknown as { item: Transaction }).item)
}

export { KIND_LABEL as ACTION_LABEL }

/** What the preview of one action will write, with precise names (for the model to cite as "proposto" facts). */
export function previewValues(plan: Plan, ref: string, ctx: Pick<PlanCtx, 'data' | 'settings'>): { kind: 'dinheiro' | 'data' | 'horario' | 'contagem'; label: string; display: string }[] {
  const a = plan.actions.find((x) => x.ref === ref)
  if (!a) return []
  const out: { kind: 'dinheiro' | 'data' | 'horario' | 'contagem'; label: string; display: string }[] = []
  const base = ctx.settings.baseCurrency
  const pin = plan.pins[ref]
  const cur = (a.moeda ?? base).toUpperCase()
  const money = (v: number) => formatMoney(Math.round(v), cur)
  switch (a.tipo) {
    case 'criar_venda': {
      const total = cents(a.valor) ?? 0
      const down = a.ja_recebido_ou_pago === true ? (cents(a.entrada_recebida) ?? 0) : 0
      out.push({ kind: 'dinheiro', label: 'Total da venda', display: money(total) })
      if (a.data) out.push({ kind: 'data', label: 'Dia da venda', display: dayLabel(a.data) })
      if (down) out.push({ kind: 'dinheiro', label: 'Entrada já recebida (vira uma entrada no Financeiro)', display: money(down) })
      if (total - down > 0) out.push({ kind: 'dinheiro', label: 'Fica a receber', display: money(total - down) })
      if (a.parcelas && a.primeira_parcela && total - down > 0) {
        const inst = buildInstallments(total - down, a.parcelas, a.primeira_parcela, a.intervalo_parcelas === 'semana' ? 'week' : 'month', () => 'x')
        inst.forEach((i, n) => {
          out.push({ kind: 'data', label: `Vencimento da parcela ${n + 1}`, display: dayLabel(i.due) })
          out.push({ kind: 'dinheiro', label: `Valor da parcela ${n + 1}`, display: money(i.amount) })
        })
      }
      break
    }
    case 'reservar_meta': {
      const goal = pin?.targetId ? ctx.data.financeGoals.find((g) => g.id === pin.targetId) : undefined
      out.push({ kind: 'dinheiro', label: 'Valor a reservar', display: money(cents(a.valor) ?? 0) })
      if (goal && pin?.goalAfter != null && pin.goalBefore != null) {
        const gm = (v: number) => formatMoney(v, goal.currency)
        out.push({ kind: 'dinheiro', label: 'Guardado ANTES da reserva', display: gm(pin.goalBefore) })
        out.push({ kind: 'dinheiro', label: 'Guardado DEPOIS da reserva', display: gm(pin.goalAfter) })
        out.push({ kind: 'dinheiro', label: 'Falta para a meta DEPOIS da reserva', display: gm(Math.max(0, goal.target - pin.goalAfter)) })
      }
      break
    }
    case 'mover_compromisso':
    case 'criar_compromisso': {
      const t = resolvedTimes.get(`${plan.id}:${ref}`)
      if (t?.day) out.push({ kind: 'data', label: a.tipo === 'mover_compromisso' ? 'Novo dia' : 'Dia', display: dayLabel(t.day) })
      if (t?.start) out.push({ kind: 'horario', label: a.tipo === 'mover_compromisso' ? 'Novo horário (a duração é mantida)' : 'Horário', display: t.end ? `${t.start}–${t.end}` : t.start })
      if (t?.end) out.push({ kind: 'horario', label: 'Novo fim', display: t.end })
      if (t?.start && t.end) {
        const mins = toMin(t.end) - toMin(t.start)
        out.push({ kind: 'contagem', label: 'Duração', display: mins % 60 === 0 ? `${mins / 60} ${mins === 60 ? 'hora' : 'horas'}` : `${mins} min` })
      }
      break
    }
    default: {
      if (a.valor != null) out.push({ kind: 'dinheiro', label: a.tipo === 'registrar_recebimento' ? 'Valor recebido' : a.tipo === 'criar_projeto' ? 'Valor cobrado no projeto' : a.tipo === 'criar_meta_financeira' ? 'Alvo da meta' : 'Valor', display: money(cents(a.valor) ?? 0) })
      if (a.data) out.push({ kind: 'data', label: a.tipo.startsWith('criar_tarefa') || a.tipo === 'mover_tarefa' ? 'Prazo da tarefa' : a.tipo === 'criar_projeto' ? 'Prazo do projeto' : a.tipo === 'criar_meta_financeira' ? 'Prazo da meta' : 'Dia', display: dayLabel(a.data) })
      if (a.hora) out.push({ kind: 'horario', label: 'Horário', display: a.hora })
      if (a.lembrete_minutos != null) out.push({ kind: 'horario', label: 'Lembrete', display: a.hora ? (a.lembrete_minutos === 0 ? a.hora : `${a.lembrete_minutos} min antes`) : '09:00' })
    }
  }
  return out
}
