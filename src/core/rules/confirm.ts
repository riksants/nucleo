/**
 * "Pedir minha confirmação antes" (Etapa 4): confirming or declining a rule run that waits in Pendências.
 *
 * Safe between devices:
 * - only with this device in sync (nothing waiting to be sent, last sync complete): otherwise another device
 *   may already have answered, and the Núcleo blocks instead of guessing;
 * - only while the run is still waiting in the data as it is now (answered elsewhere → says so);
 * - the run keeps its fixed id and the records it creates get ids derived from it, so even two devices that
 *   confirm at the same moment write the very same records (never twice).
 *
 * Re-checked at that moment, with the data of now: the rule still exists, is on and not paused; the record
 * that started it still exists (a movement keeps its value, currency and direction — or the event is rebuilt
 * from what it is now); the trigger still matches the (possibly edited) rule; every condition passes again.
 * Only then the actions run — the same planner as always, with the same guards (no invented facts).
 */
import type { BatchOp } from '../../data/repository'
import type { AutomationRun, DataState, Rule, Transaction } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { runPut } from '../automation/types'
import { planActions } from './actions'
import { triggerInfo } from './catalog'
import { checkConditions, triggerMatches } from './conditions'
import { assertNoInventedFacts } from './engine'
import type { RuleCtx, RuleEvent } from './types'
import { Work } from './work'

export type ConfirmResult = { ops: BatchOp[]; ok: boolean; text: string } | string

export const NOT_IN_SYNC = 'Espere este aparelho terminar de sincronizar para confirmar (outro aparelho pode já ter respondido).'

/** The event as it is now, or why it no longer exists. */
function refresh(ev: RuleEvent, data: DataState): RuleEvent | string {
  if (ev.txId) {
    const tx = data.transactions.find((t) => t.id === ev.txId) as Transaction | undefined
    if (!tx) return 'a movimentação que originou isto foi apagada'
    const kind = tx.type === 'in' ? 'moneyIn' : tx.type === 'out' ? 'moneyOut' : null
    if (kind !== ev.kind) return 'a movimentação mudou de tipo'
    const valor = formatMoney(tx.amount, tx.currency)
    return { ...ev, amount: tx.amount, currency: tx.currency, category: tx.category, text: tx.reason, names: { ...ev.names, valor, descricao: tx.reason } }
  }
  const list = (data[ev.origin.collection] ?? []) as { id: string }[]
  if (ev.origin.id && ev.origin.collection !== 'rules' && !list.some((x) => x.id === ev.origin.id)) return 'o registro que originou isto foi apagado'
  return ev
}

export function confirmRuleRun(run: AutomationRun, data: DataState, ctx: RuleCtx, syncSafe: boolean): ConfirmResult {
  if (!syncSafe) return NOT_IN_SYNC
  const current = data.automationRuns.find((r) => r.id === run.id)
  if (!current || current.status !== 'pending' || current.automation !== 'rule') return 'Este pedido já foi respondido (talvez em outro aparelho).'
  const rule = data.rules.find((r) => r.id === current.rule?.id) as Rule | undefined
  if (!rule) return 'A regra foi excluída. Nada foi feito.'
  if (!rule.on || rule.paused) return 'A regra está desligada. Ligue-a em Minhas regras para confirmar.'
  const stored = current.awaiting?.event as RuleEvent | undefined
  if (!stored || !current.awaiting) return 'Este pedido não tem os dados necessários. Dispense-o.'
  if (rule.trigger.kind !== current.awaiting.trigger) return 'A regra mudou de “quando” depois do pedido. Dispense-o.'

  const ev = refresh(stored, data)
  const decline = (why: string): ConfirmResult => ({ ops: [runPut({ ...current, status: 'skipped', declined: true, detail: `Não feito: ${why}.`, confirmedAt: ctx.now.toISOString() })], ok: false, text: `Não dá mais: ${why}. Nada foi feito.` })
  if (typeof ev === 'string') return decline(ev)
  if (!triggerInfo(rule.trigger.kind).scheduled && !triggerMatches(rule, ev)) return decline('a regra não vale mais para isto')
  const check = checkConditions(rule.conditions, ev, ctx)
  if (check.ok === null) return `Não deu para conferir a condição agora: ${check.reason}. Tente de novo mais tarde.`
  if (check.ok === false) return decline('as condições da regra não valem mais')

  const work = new Work(data)
  const plan = planActions(rule, ev, work, ctx, current.id)
  const done = plan.results.filter((r) => r.ok)
  const next: AutomationRun = {
    ...current,
    status: done.length ? 'done' : 'skipped',
    summary: done.length ? `Regra “${rule.name}”: ${done.map((r) => r.text).join(' · ')}` : `Regra “${rule.name}” não fez nada`,
    created: plan.created,
    changed: plan.changed,
    actions: plan.results,
    confirmedAt: ctx.now.toISOString(),
    ...(plan.notice ? { notice: plan.notice } : {}),
  }
  const notDone = plan.results.filter((r) => !r.ok).map((r) => r.text)
  if (notDone.length) next.detail = `Não fez: ${notDone.join('; ')}`
  else delete next.detail
  work.put('automationRuns', next)
  const ops = work.ops()
  assertNoInventedFacts(data, ops)
  return { ops, ok: done.length > 0, text: done.length ? `Feito: ${done.map((r) => r.text).join(' · ')}` : `Nada pôde ser feito: ${notDone.join('; ')}` }
}

/** "Não fazer": the run closes without doing anything (never asked again for the same event). */
export function declineRuleRun(run: AutomationRun, data: DataState, now: Date): BatchOp[] | string {
  const current = data.automationRuns.find((r) => r.id === run.id)
  if (!current || current.status !== 'pending') return 'Este pedido já foi respondido (talvez em outro aparelho).'
  return [runPut({ ...current, status: 'skipped', declined: true, detail: 'Você escolheu não fazer.', confirmedAt: now.toISOString() })]
}
