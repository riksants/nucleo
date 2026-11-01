/**
 * NÚCLEO IA — lookups run in the app, over the signed-in account's own data, with the app's own
 * calculations (core/finance, core/agenda, core/financeGoals, features/search). They only READ.
 *
 * What reaches the model is an ALLOWLIST per lookup: titles, dates, times, statuses, amounts and
 * category names. Never passwords, vault, accesses (Senhas), notes of an access, e-mails, phones or
 * internal ids of records. Every value comes out as a fact with a seal (FactBook).
 */
import { isEnabled } from '../../../app/modules'
import { categoryRanking, financeIndex, monthBounds, monthForecast, monthLabel, monthOf, monthSummary, totalsBetween, dayOfTransaction } from '../../finance'
import { allCategories, categoryLabel } from '../../financeCategories'
import { goalPlan } from '../../financeGoals'
import { addDaysToDate, todayIn, weekStart, zoneOf } from '../../period'
import { buildAgenda, KIND_LABEL, type AgendaItem } from '../../agenda'
import { buildRecordIndex } from '../../../features/search/records'
import { searchRecords } from '../../../features/search/search'
import { parseQuery } from '../../../features/search/engine'
import type { DataState, Settings } from '../../../data/types'
import { formatMoney } from '../../../lib/money'
import { factForModel, type Fact, type FactBook } from '../../../../supabase/functions/_shared/ia/facts.ts'
import { AREA_LABEL, MAX_RESULT_CHARS, TOOL_AREA, type Area, type ToolName } from '../../../../supabase/functions/_shared/ia/tools.ts'

export interface LookupCtx {
  data: DataState
  settings: Settings
  now: Date
  book: FactBook
  /** Areas the person turned off for the AI. */
  areasOff: Area[]
}

export interface LookupResult {
  /** JSON for the model. */
  content: string
  isError: boolean
}

const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
const dayLabel = (d: string) => `${WD[new Date(`${d}T12:00:00Z`).getUTCDay()]}, ${d.slice(8, 10)}/${d.slice(5, 7)}`
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const monthLong = (m: string) => `${MONTHS_LONG[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/** Which app sections each area needs (section off → area off). */
export function areaAvailable(area: Area, settings: Settings): boolean {
  if (area === 'financas' || area === 'metas') return isEnabled(settings, 'finance')
  if (area === 'agenda') return isEnabled(settings, 'agenda') || isEnabled(settings, 'tasks') || isEnabled(settings, 'today')
  return true
}

export function areasOffFor(settings: Settings, chosenOff: Area[] = []): Area[] {
  const all: Area[] = ['agenda', 'financas', 'metas', 'busca']
  return all.filter((a) => chosenOff.includes(a) || !areaAvailable(a, settings))
}

const out = (payload: unknown): LookupResult => {
  let content = JSON.stringify(payload)
  if (content.length > MAX_RESULT_CHARS) content = JSON.stringify({ aviso: 'Resultado reduzido: muitos itens. Peça um período menor ou um filtro.', ...(payload as object), lista: undefined })
  return { content, isError: false }
}
const err = (message: string): LookupResult => ({ content: JSON.stringify({ erro: message }), isError: true })

export function runLookup(name: string, input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const tool = name as ToolName
  const area = TOOL_AREA[tool]
  if (!area) return err('Consulta desconhecida.')
  if (ctx.areasOff.includes(area)) return err(`A área ${AREA_LABEL[area]} está desligada para a IA.`)
  try {
    switch (tool) {
      case 'consultar_agenda':
        return agenda(input, ctx)
      case 'resumo_financeiro':
        return finance(input, ctx)
      case 'metas_financeiras':
        return goals(input, ctx)
      case 'buscar':
        return search(input, ctx)
    }
  } catch {
    return err('Não foi possível fazer essa consulta agora.')
  }
  return err('Consulta desconhecida.')
}

/* ------------------------------------------------------------------ agenda */

const STATUS: Record<AgendaItem['status'], string> = { done: 'feito', skipped: 'pulado', pending: 'pendente', ended: 'horário encerrado' }

function agenda(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const { de, ate } = input
  if (!isDay(de) || !isDay(ate) || ate < de) return err('Datas inválidas: use AAAA-MM-DD, com "ate" depois de "de".')
  const days = Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1
  if (days > 14) return err('Intervalo grande demais: no máximo 14 dias por consulta.')
  const items = buildAgenda(ctx.data, ctx.settings, de, ate, ctx.now)
  const byDay: { dia: unknown; total: unknown; itens: unknown[] }[] = []
  for (let d = de; d <= ate; d = addDaysToDate(d, 1)) {
    const list = items.filter((i) => i.date === d)
    // Dates only inside facts (labels say "do dia"), so the answer cites the day instead of writing it.
    const day = ctx.book.add({ kind: 'data', label: 'Dia', display: dayLabel(d), seal: 'confirmado', open: { path: '/agenda' } })
    const total = ctx.book.add({ kind: 'contagem', label: 'Total de compromissos do dia', display: String(list.length), seal: list.length ? 'confirmado' : 'ausente', open: { path: '/agenda' } })
    byDay.push({
      dia: factForModel(day),
      total: factForModel(total),
      itens: list.slice(0, 25).map((i) => {
        const when = i.start ? `${i.start}${i.end ? `–${i.end}` : ''}` : 'sem horário'
        // The fact shows time + title: the answer cites it once, without repeating either.
        const f = ctx.book.add({
          kind: 'compromisso',
          label: `${KIND_LABEL[i.kind]} do dia`,
          display: i.start ? `${when} · ${i.title}` : i.title,
          seal: 'confirmado',
          open: { path: '/agenda' },
        })
        return { fato: factForModel(f), tipo: KIND_LABEL[i.kind], titulo: i.title, situacao: STATUS[i.status] }
      }),
    })
  }
  return out({
    dias: byDay,
    observacao: 'Para citar um dia, use o fato do dia; para citar um compromisso, use o fato dele, que já mostra horário e título — não repita o título nem o horário ao lado.',
  })
}

/* ------------------------------------------------------------------ finance */

/** How people say it → the app's default category id (used only if that category exists). */
const SYNONYMS: Record<string, string> = {
  mercado: 'food', supermercado: 'food', comida: 'food', restaurante: 'food', restaurantes: 'food', ifood: 'food', lanche: 'food', padaria: 'food',
  uber: 'transport', gasolina: 'transport', combustivel: 'transport', onibus: 'transport', metro: 'transport', taxi: 'transport',
  aluguel: 'housing', condominio: 'housing', casa: 'housing',
  luz: 'bills', agua: 'bills', internet: 'bills', telefone: 'bills', celular: 'bills',
  farmacia: 'health', remedio: 'health', medico: 'health', academia: 'health',
  roupa: 'shopping', roupas: 'shopping',
  curso: 'education', cursos: 'education', faculdade: 'education',
  streaming: 'subscriptions', netflix: 'subscriptions', spotify: 'subscriptions',
  viagens: 'travel', passagem: 'travel', passagens: 'travel', hotel: 'travel',
}

function categoryIdFor(name: string, ctx: LookupCtx): { id: string; label: string } | null {
  const q = fold(name)
  if (!q) return null
  const cats = allCategories(ctx.settings).filter((c) => c.type === 'out')
  const syn = SYNONYMS[q] ? cats.find((c) => c.id === SYNONYMS[q]) : undefined
  if (syn) return { id: syn.id, label: syn.label }
  const exact = cats.find((c) => fold(c.label) === q)
  if (exact) return { id: exact.id, label: exact.label }
  const part = cats.filter((c) => fold(c.label).includes(q) || q.includes(fold(c.label)))
  return part.length === 1 ? { id: part[0].id, label: part[0].label } : null
}

function finance(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const { settings, data, now, book } = ctx
  const base = settings.baseCurrency
  const tz = zoneOf(settings)
  const today = todayIn(tz, now)
  const money = (cents: number, label: string, seal: Fact['seal'], baseText?: string) => factForModel(book.add({ kind: 'dinheiro', label, display: formatMoney(cents, base), seal, base: baseText, open: { path: '/finance' } }))
  const periodo = input.periodo
  const ref = String(input.referencia ?? '')
  let from: string
  let to: string
  let label: string
  let prev: { from: string; to: string; label: string } | null = null
  if (periodo === 'mes') {
    if (!/^\d{4}-\d{2}$/.test(ref)) return err('Referência do mês inválida: use AAAA-MM.')
    const b = monthBounds(ref)
    from = b.from
    to = ref === monthOf(today) ? today : b.to
    label = monthLong(ref)
  } else if (periodo === 'semana') {
    if (!isDay(ref)) return err('Referência da semana inválida: use AAAA-MM-DD.')
    from = weekStart(ref)
    const sunday = addDaysToDate(from, 6)
    to = sunday > today && from <= today ? today : sunday
    label = `semana de ${dayLabel(from)}`
  } else return err('Período inválido: use "mes" ou "semana".')
  if (from > today) return out({ periodo: label, aviso: 'Esse período ainda não começou.', fatos: [factForModel(book.add({ kind: 'texto', label: `Movimentações em ${label}`, display: 'nenhuma (período futuro)', seal: 'ausente' }))] })

  const cat = typeof input.categoria === 'string' && input.categoria.trim() ? categoryIdFor(input.categoria, ctx) : null
  if (typeof input.categoria === 'string' && input.categoria.trim() && !cat) {
    const names = allCategories(settings).filter((c) => c.type === 'out').map((c) => c.label)
    return err(`Categoria "${input.categoria}" não encontrada. Categorias de saída: ${names.join(', ')}.`)
  }

  const index = financeIndex(data.transactions, settings)
  const totals = totalsBetween(index, from, to)
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1
  // the same days of the previous period, for a fair comparison
  if (periodo === 'mes') {
    const pm = monthBounds(addMonth(ref, -1))
    const upto = Math.min(days, pm.days)
    prev = { from: pm.from, to: addDaysToDate(pm.from, upto - 1), label: `${monthLong(addMonth(ref, -1))}${to < monthBounds(ref).to ? ` (até o dia ${upto})` : ''}` }
  } else {
    prev = { from: addDaysToDate(from, -7), to: addDaysToDate(to, -7), label: 'mesmos dias da semana anterior' }
  }
  const before = totalsBetween(index, prev.from, prev.to)

  // the movements behind the numbers (allowlist: reason, day, amount, category)
  const flows = data.transactions.filter((t) => t.type !== 'adjust' && !t.transfer)
  const inRange = flows.filter((t) => {
    const d = dayOfTransaction(t, tz)
    return d >= from && d <= to
  })
  const outs = inRange.filter((t) => t.type === 'out' && (!cat || (t.category ?? '') === cat.id))
  const top = [...outs].sort((a, b) => a.baseAmount - b.baseAmount).slice(0, 5)
  const n = (k: number) => (k === 1 ? '1 lançamento' : `${k} lançamentos`)

  const fatos: unknown[] = []
  let comparacao: unknown = null
  if (cat) {
    const now$ = totals.byCategory[cat.id] ?? 0
    const was = before.byCategory[cat.id] ?? 0
    const prevCount = flows.filter((t) => {
      const d = dayOfTransaction(t, tz)
      return t.type === 'out' && (t.category ?? '') === cat.id && d >= prev!.from && d <= prev!.to
    }).length
    fatos.push(now$ ? money(now$, `Gasto com ${cat.label} em ${label}`, 'confirmado', n(outs.length)) : factForModel(book.add({ kind: 'dinheiro', label: `Gasto com ${cat.label} em ${label}`, display: formatMoney(0, base), seal: 'ausente', base: 'nenhum lançamento nessa categoria' })))
    if (was || now$) {
      comparacao = {
        periodo_anterior: prev.label,
        gasto_anterior: was ? money(was, `Gasto com ${cat.label} em ${prev.label}`, 'confirmado', n(prevCount)) : 'nenhum',
        diferenca: money(now$ - was, `Diferença de ${cat.label}: ${label} menos ${prev.label}`, 'confirmado'),
        ...(was > 0 ? { variacao: factForModel(book.add({ kind: 'porcentagem', label: `Variação de ${cat.label}`, display: `${now$ >= was ? '+' : '−'}${Math.round(Math.abs((now$ - was) / was) * 100)}%`, seal: 'confirmado' })) } : {}),
      }
    }
  } else {
    fatos.push(
      totals.income ? money(totals.income, `Entradas em ${label}`, 'confirmado') : factForModel(book.add({ kind: 'dinheiro', label: `Entradas em ${label}`, display: formatMoney(0, base), seal: 'ausente', base: 'nenhuma entrada registrada' })),
      totals.expense ? money(totals.expense, `Saídas em ${label}`, 'confirmado', n(totals.expenseCount)) : factForModel(book.add({ kind: 'dinheiro', label: `Saídas em ${label}`, display: formatMoney(0, base), seal: 'ausente', base: 'nenhuma saída registrada' })),
      money(totals.income - totals.expense, `Resultado (entradas − saídas) em ${label}`, 'confirmado'),
    )
    if (before.count) {
      comparacao = {
        periodo_anterior: prev.label,
        entradas_antes: money(before.income, `Entradas em ${prev.label}`, 'confirmado'),
        saidas_antes: money(before.expense, `Saídas em ${prev.label}`, 'confirmado'),
        diferenca_saidas: money(totals.expense - before.expense, `Diferença de saídas: ${label} menos ${prev.label}`, 'confirmado'),
      }
    }
  }

  const categorias = cat
    ? undefined
    : categoryRanking(totals)
        .slice(0, 8)
        .map((c) => ({ categoria: categoryLabel(settings, c.category || undefined), valor: money(c.amount, `Gasto com ${categoryLabel(settings, c.category || undefined)} em ${label}`, 'confirmado') }))
  const maiores = top.map((t) => ({
    descricao: t.reason || 'Sem descrição',
    dia: factForModel(book.add({ kind: 'data', label: `Dia de “${t.reason}”`, display: dayLabel(dayOfTransaction(t, tz)), seal: 'confirmado' })),
    valor: money(-t.baseAmount, `Saída “${t.reason}”`, 'confirmado'),
    categoria: categoryLabel(settings, t.category),
  }))

  let saldo: unknown = undefined
  if (periodo === 'mes' && !cat) {
    const s = monthSummary(data, settings, ref, now)
    saldo = { inicio_do_periodo: money(s.opening, `Saldo no início de ${label}`, 'confirmado'), fim_do_periodo: money(s.closing, ref === monthOf(today) ? 'Saldo hoje' : `Saldo no fim de ${label}`, 'confirmado') }
    if (ref === monthOf(today)) {
      const f = monthForecast(data, settings, now)
      ;(saldo as Record<string, unknown>).previsao_fim_do_mes = f.ready
        ? money(f.estimate, `Previsão de saldo em ${dayLabel(monthBounds(ref).to)}`, 'previsto', `saldo de hoje menos o ritmo de gastos variáveis (${formatMoney(f.dailyVariable, base)}/dia por ${f.daysLeft} dias) e ${f.upcomingCount} cobrança(s) de ferramentas até o fim do mês`)
        : 'Ainda sem dados suficientes para prever (o app precisa de pelo menos 7 dias e 5 saídas no mês).'
    }
  }

  return out({
    periodo: label,
    moeda_principal: base,
    observacoes: [
      'Valores na moeda principal; movimentos em outras moedas entram convertidos pela cotação do dia em que foram lançados.',
      'Transferências entre contas próprias e ajustes de saldo não contam como entrada nem saída.',
      ...(to !== (periodo === 'mes' ? monthBounds(ref).to : addDaysToDate(from, 6)) ? ['Período em andamento: considera até hoje.'] : []),
    ],
    categoria: cat?.label ?? null,
    fatos,
    saldo,
    categorias,
    maiores_saidas: maiores,
    comparacao,
  })
}

function addMonth(m: string, n: number): string {
  const y = Number(m.slice(0, 4))
  const mo = Number(m.slice(5, 7)) - 1 + n
  const d = new Date(Date.UTC(y, mo, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ goals */

function goals(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const today = todayIn(zoneOf(ctx.settings), ctx.now)
  const q = typeof input.nome === 'string' ? fold(input.nome) : ''
  const list = (ctx.data.financeGoals ?? []).filter((g) => g.status === 'active' && (!q || fold(g.name).includes(q)))
  if (!list.length) {
    const f = ctx.book.add({ kind: 'texto', label: q ? `Meta “${input.nome}”` : 'Metas de dinheiro ativas', display: 'nenhuma encontrada', seal: 'ausente', open: { path: '/finance' } })
    return out({ fatos: [factForModel(f)] })
  }
  return out({
    metas: list.slice(0, 10).map((g) => {
      const p = goalPlan(g, today)
      const m = (cents: number, label: string, seal: Fact['seal'] = 'confirmado', base?: string) => factForModel(ctx.book.add({ kind: 'dinheiro', label, display: formatMoney(cents, g.currency), seal, base, open: { path: '/finance' } }))
      return {
        nome: g.name,
        alvo: m(g.target, `Alvo da meta “${g.name}”`),
        guardado: m(g.saved, `Guardado na meta “${g.name}”`),
        falta: m(p.missing, `Falta para a meta “${g.name}”`),
        progresso: factForModel(ctx.book.add({ kind: 'porcentagem', label: `Progresso da meta “${g.name}”`, display: `${p.percent}%`, seal: 'confirmado' })),
        prazo: factForModel(ctx.book.add({ kind: 'data', label: `Prazo da meta “${g.name}”`, display: dayLabel(g.deadline) + `/${g.deadline.slice(0, 4)}`, seal: 'confirmado' })),
        dias_restantes: factForModel(ctx.book.add({ kind: 'contagem', label: `Dias até o prazo da meta “${g.name}”`, display: p.daysLeft === 1 ? '1 dia' : `${p.daysLeft} dias`, seal: 'confirmado' })),
        guardar_por_mes: p.perMonth != null ? m(p.perMonth, `Quanto guardar por mês para “${g.name}” chegar no prazo`, 'previsto', 'o que falta dividido pelos meses até o prazo') : null,
        guardar_por_semana: p.perWeek != null ? m(p.perWeek, `Quanto guardar por semana para “${g.name}” chegar no prazo`, 'previsto', 'o que falta dividido pelas semanas até o prazo') : null,
        no_ritmo: p.reached ? 'meta atingida' : p.due ? 'prazo encerrado' : p.onPace == null ? 'cedo demais para dizer' : p.onPace ? 'sim' : 'não',
        conta_no_saldo: Boolean(g.inBalance),
        guardar_todo_mes_automatico: Boolean(g.autoSave),
      }
    }),
    observacao: 'Reservar para uma meta não é uma saída de dinheiro: o valor continua no saldo como reservado.',
  })
}

/* ------------------------------------------------------------------ search */

/** Search groups the AI may see. Senhas (accesses) never. */
const SEARCH_BLOCKED = /senha|acesso|cofre/i

function search(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const text = typeof input.texto === 'string' ? input.texto.trim().slice(0, 120) : ''
  if (text.length < 2) return err('Texto de busca curto demais.')
  const settings = { ...ctx.settings, modules: { ...(ctx.settings.modules ?? {}), accounts: false } } as Settings
  const index = buildRecordIndex(ctx.data, settings)
  const groups = searchRecords(index, parseQuery(text)).filter((g) => !SEARCH_BLOCKED.test(g.label))
  const hits = groups.flatMap((g) => g.hits.slice(0, 5).map((h) => ({ tipo: g.label, titulo: h.title, score: h.score }))).sort((a, b) => b.score - a.score)
  if (!hits.length) return out({ fatos: [factForModel(ctx.book.add({ kind: 'texto', label: `Busca por “${text}”`, display: 'nada encontrado', seal: 'ausente' }))] })
  return out({ resultados: hits.slice(0, 10).map(({ tipo, titulo }) => ({ tipo, titulo })) })
}

export { monthLabel }
