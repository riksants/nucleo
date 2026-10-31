/**
 * "Feito pelo Núcleo" (Etapa 4.2) — read-only views over the runs that really exist:
 * - what each run turned out to be (concluída, corrigida, desfeita, não concluída, pulada, esperando);
 * - the sentences of the week ("O Núcleo registrou 3 pagamentos automaticamente esta semana"), counted, never estimated;
 * - everything that waits for the person (Pendências), each with the next step;
 * - per automation: last run, result and how many times.
 * Nothing here writes. A sentence only appears when its count is real and above zero.
 */
import type { AutomationId, AutomationRun, DataState, Rule } from '../../data/types'
import { isLate, overdueAmount } from '../../data/sales'
import { formatMoney } from '../../lib/money'
import { addDaysToDate, weekStart } from '../period'
import { offersRetry } from '../rules/retry'

export type RunOutcome = 'pending' | 'awaiting' | 'done' | 'corrected' | 'undone' | 'notDone' | 'skipped'

export const OUTCOME_LABEL: Record<RunOutcome, string> = {
  pending: 'esperando você',
  awaiting: 'aguardando confirmação',
  done: 'concluída',
  corrected: 'corrigida',
  undone: 'desfeita',
  notDone: 'não concluída',
  skipped: 'pulada',
}

export const isCharge = (r: AutomationRun) => r.automation === 'subscriberCharge' || r.automation === 'toolCharge'
/** A rule run that waits for the person to confirm it (4.3, "Pedir minha confirmação antes"). */
export const isAwaitingRule = (r: AutomationRun) => r.automation === 'rule' && r.status === 'pending'

/** What a run turned out to be, from its own record (older runs included: nothing new is needed). */
export function runOutcome(r: AutomationRun): RunOutcome {
  if (r.status === 'pending') return r.automation === 'rule' ? 'awaiting' : 'pending'
  if (r.status === 'undone') return 'undone'
  if (r.status === 'skipped') {
    // Chosen by the person: "Não recebi / Não paguei", "Pular este mês", a confirmation dismissed.
    if (isCharge(r)) return 'skipped'
    if (r.automation === 'goalSave') return (r.amount ?? 0) > 0 || r.detail === 'Mês pulado.' ? 'skipped' : 'notDone'
    if (r.automation === 'rule' && r.declined) return 'skipped'
    return 'notDone'
  }
  // done
  if (r.actions?.some((a) => a.undone) || r.actions?.some((a) => a.attempts?.some((t) => t.ok))) return 'corrected'
  if (r.automation === 'goalSave' && r.detail === 'Valor deste mês alterado por você.') return 'corrected'
  if (r.automation === 'rule' && r.actions?.some((a) => !a.ok)) return 'corrected'
  return 'done'
}

/** Why a run was not concluded, in words (shown under "não concluída"). */
export function notDoneReason(r: AutomationRun): string | null {
  if (runOutcome(r) !== 'notDone') return null
  return r.detail ?? r.actions?.filter((a) => !a.ok).map((a) => a.text).join('; ') ?? null
}

/** The record the run produced (to open it), when there is one. */
export function createdRecord(r: AutomationRun): { collection: AutomationRun['created'][number]['collection']; id: string } | null {
  const c = r.created.find((x) => !(x.action !== undefined && r.actions?.[x.action]?.undone))
  return c ? { collection: c.collection, id: c.id } : null
}

const inWeek = (date: string, today: string) => date >= weekStart(today) && date <= today
const day = (iso: string) => iso.slice(0, 10)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export interface Digest {
  key: string
  text: string
  tone: 'neutral' | 'warn'
  /** Where tapping goes inside the screen. */
  tab: 'activity' | 'pending' | 'automations'
  filter?: ActivityFilter
}

/** The sentences of the week, all counted from real runs (nothing appears with a zero). */
export function weekDigest(runs: AutomationRun[], data: Pick<DataState, 'rules'>, today: string, pendingCount: number): Digest[] {
  const out: Digest[] = []
  const week = runs.filter((r) => inWeek(r.date, today) || inWeek(day(r.updatedAt), today))
  const autoPaid = week.filter((r) => isCharge(r) && r.status === 'done' && !r.fromPending && !r.presumed && inWeek(r.date, today)).length
  if (autoPaid) out.push({ key: 'paid', text: `O Núcleo registrou ${plural(autoPaid, 'pagamento', 'pagamentos')} automaticamente esta semana.`, tone: 'neutral', tab: 'activity', filter: 'payments' })
  const charges = week.filter((r) => isCharge(r) && r.status === 'pending' && inWeek(r.date, today)).length
  if (charges) out.push({ key: 'charges', text: `${charges === 1 ? 'Foi criada 1 cobrança' : `Foram criadas ${charges} cobranças`} esta semana que ${charges === 1 ? 'aguarda' : 'aguardam'} confirmação.`, tone: 'neutral', tab: 'pending' })
  if (pendingCount) out.push({ key: 'pending', text: pendingCount === 1 ? 'Existe 1 item esperando uma decisão sua.' : `Existem ${pendingCount} itens esperando uma decisão sua.`, tone: 'warn', tab: 'pending' })
  const rules = week.filter((r) => r.automation === 'rule' && (r.status === 'done') && inWeek(r.date, today)).length
  if (rules) out.push({ key: 'rules', text: `Suas regras agiram ${plural(rules, 'vez', 'vezes')} esta semana.`, tone: 'neutral', tab: 'activity', filter: 'rules' })
  const notDone = week.filter((r) => runOutcome(r) === 'notDone' && inWeek(r.date, today))
  if (notDone.length) {
    const missing = notDone.filter((r) => /conferir a condição|saldo disponível insuficiente|sem cotação|faltava/i.test(`${r.summary} ${r.detail ?? ''}`)).length
    out.push({
      key: 'notDone',
      text: missing === notDone.length ? `${notDone.length === 1 ? 'Uma automação não foi executada' : `${notDone.length} automações não foram executadas`} porque faltava uma informação.` : `${notDone.length === 1 ? 'Uma automação não foi concluída' : `${notDone.length} automações não foram concluídas`} esta semana. Veja o motivo.`,
      tone: 'warn',
      tab: 'activity',
      filter: 'failed',
    })
  }
  const undone = week.filter((r) => r.status === 'undone' && inWeek(day(r.updatedAt), today)).length
  if (undone) out.push({ key: 'undone', text: undone === 1 ? 'Uma ação foi desfeita esta semana.' : `${undone} ações foram desfeitas esta semana.`, tone: 'neutral', tab: 'activity', filter: 'undone' })
  const paused = data.rules.filter((r) => r.paused).length
  if (paused) out.push({ key: 'paused', text: paused === 1 ? 'Uma regra está pausada por segurança.' : `${paused} regras estão pausadas por segurança.`, tone: 'warn', tab: 'pending' })
  return out
}

// ---------------------------------------------------------------- Atividade

export type ActivityFilter = 'all' | 'payments' | 'rules' | 'imports' | 'undone' | 'failed'

export const ACTIVITY_FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'payments', label: 'Pagamentos' },
  { value: 'rules', label: 'Regras' },
  { value: 'imports', label: 'Importações' },
  { value: 'undone', label: 'Desfeitas' },
  { value: 'failed', label: 'Não concluídas' },
]

const PAYMENT_KINDS = new Set<AutomationId>(['subscriberCharge', 'toolCharge', 'saleRecurring', 'goalSave'])

export function matchesFilter(r: AutomationRun, f: ActivityFilter): boolean {
  if (f === 'all') return true
  if (f === 'payments') return PAYMENT_KINDS.has(r.automation)
  if (f === 'rules') return r.automation === 'rule'
  if (f === 'imports') return r.automation === 'bankImport' || r.automation === 'smartImport'
  if (f === 'undone') return r.status === 'undone' || Boolean(r.actions?.some((a) => a.undone))
  return runOutcome(r) === 'notDone'
}

// ---------------------------------------------------------------- Pendências

export type PendingKind = 'charge' | 'ruleConfirm' | 'review' | 'retry' | 'pausedRule' | 'lateSale'

export interface PendingItem {
  key: string
  kind: PendingKind
  title: string
  detail: string
  /** The next step, in words ("Confirmar o recebimento"). */
  next: string
  date: string
  run?: AutomationRun
  /** For a retry: which action. */
  action?: number
  rule?: Rule
  /** Where "Abrir" goes. */
  link?: { path: string; params?: Record<string, string> }
  /** Can be put off for a few days. */
  snoozable: boolean
}

const snoozed = (r: AutomationRun, today: string) => Boolean(r.snoozedUntil && r.snoozedUntil > today)

/**
 * Everything waiting for the person, oldest first. Each source is real: a charge run, a rule run waiting for
 * confirmation or review, a rule action that can be tried again, a rule paused by safety, a late sale.
 * Items put off ("Adiar") come back on their day; dismissed ones don't come back.
 */
export function pendingItems(data: Pick<DataState, 'automationRuns' | 'rules' | 'sales' | 'clients'>, today: string, opts: { includeSnoozed?: boolean } = {}): PendingItem[] {
  const out: PendingItem[] = []
  const keep = (r: AutomationRun) => opts.includeSnoozed || !snoozed(r, today)
  for (const r of data.automationRuns) {
    if (r.dismissedAt) continue
    if (r.status === 'pending' && isCharge(r) && keep(r)) {
      const income = r.automation === 'subscriberCharge'
      out.push({
        key: r.id, kind: 'charge', run: r, date: r.date, snoozable: true,
        title: r.origin.label,
        detail: `${income ? 'A receber' : 'A pagar'}${r.amount !== undefined && r.currency ? ` · ${formatMoney(r.amount, r.currency)}` : ''}`,
        next: income ? 'Confirmar o recebimento' : 'Confirmar o pagamento',
      })
    } else if (isAwaitingRule(r) && keep(r)) {
      out.push({
        key: r.id, kind: 'ruleConfirm', run: r, date: r.date, snoozable: true,
        title: r.rule ? `Regra “${r.rule.name}”` : r.summary,
        detail: `Por causa de: ${r.cause?.label ?? r.origin.label}. Quer que eu faça: ${(r.actions ?? []).map((a) => a.text.replace(/^Não fez — /, '')).join(' · ')}`,
        next: 'Confirmar ou não fazer',
      })
    } else if (r.automation === 'rule' && r.status === 'done' && r.notice && !r.notice.seenAt && keep(r)) {
      // "Pedir revisão" / "Me avisar": stays until the person marks it as seen.
      out.push({
        key: `${r.id}#notice`, kind: 'review', run: r, date: r.date, snoozable: true,
        title: r.notice.text,
        detail: `Regra “${r.rule?.name ?? ''}” · por causa de: ${r.cause?.label ?? r.origin.label}`,
        next: r.notice.kind === 'review' ? 'Revisar' : 'Ver',
        link: r.cause?.txId ? { path: '/finance', params: { open: r.cause.txId } } : undefined,
      })
    }
    if (r.automation === 'rule' && r.status !== 'undone' && r.status !== 'pending' && keep(r)) {
      r.actions?.forEach((a, i) => {
        if (!offersRetry(r, i)) return
        out.push({
          key: `${r.id}#${i}`, kind: 'retry', run: r, action: i, date: r.date, snoozable: true,
          title: r.rule ? `Regra “${r.rule.name}”` : 'Regra',
          detail: `Não fez: ${a.text}`,
          next: 'Tentar de novo',
        })
      })
    }
  }
  for (const rule of data.rules) {
    if (!rule.paused) continue
    out.push({ key: `paused-${rule.id}`, kind: 'pausedRule', rule, date: rule.paused.at.slice(0, 10), snoozable: false, title: `Regra “${rule.name}” pausada`, detail: `Por segurança: ${rule.paused.reason.toLowerCase()}.`, next: 'Conferir e ligar de novo', link: { path: '/rules', params: { open: rule.id } } })
  }
  const clients = new Map(data.clients.map((c) => [c.id, c]))
  for (const s of data.sales) {
    if (!isLate(s, today)) continue
    const owed = overdueAmount(s, today)
    if (owed <= 0) continue
    const who = (s.clientId ? (clients.get(s.clientId)?.name ?? '') : s.clientName).trim()
    out.push({ key: `sale-${s.id}`, kind: 'lateSale', date: s.dueDate || s.date, snoozable: false, title: `${who || 'Venda'} · ${s.product || 'venda'}`, detail: `Em atraso: ${formatMoney(owed, s.currency)}`, next: 'Cobrar ou registrar o pagamento', link: { path: '/sales', params: { open: s.id } } })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** How many things wait for the person (the number on "Feito pelo Núcleo"). */
export function pendingCount(data: Pick<DataState, 'automationRuns' | 'rules' | 'sales' | 'clients'>, today: string): number {
  return pendingItems(data, today).length
}

/** "Adiar": the day the item comes back. */
export const snoozeDate = (today: string, days = 3) => addDaysToDate(today, days)

// ---------------------------------------------------------------- Automações

export interface AutomationStats {
  last: AutomationRun | null
  count: number
  /** Runs this month. */
  month: number
}

export function automationStats(runs: AutomationRun[], id: AutomationId, today: string): AutomationStats {
  let last: AutomationRun | null = null
  let count = 0
  let month = 0
  for (const r of runs) {
    if (r.automation !== id) continue
    count++
    if (r.date.slice(0, 7) === today.slice(0, 7)) month++
    if (!last || r.date > last.date || (r.date === last.date && r.createdAt > last.createdAt)) last = r
  }
  return { last, count, month }
}
