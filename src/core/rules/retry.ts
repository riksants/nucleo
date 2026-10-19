/**
 * "Tentar de novo" (2.1): one action of a rule run that was not done — and only that action.
 *
 * Safety first (it may reserve money):
 * - only actions not done for a reason that can change (no rate, no Disponível, goal not in the balance);
 * - only actions whose definition was kept in the run (2.1 runs): a later edit of the rule never changes it;
 * - never when the run was undone, the action is done/undone, or anything was already written for it;
 * - each attempt has a fixed id (`<run>-a<action>-t<n>`): applied once, kept in the run's history;
 * - signed in, only with the sync idle and nothing waiting to be sent: otherwise another device might
 *   have tried it already, and the Núcleo would rather block than reserve twice.
 * The actions that were done are never touched.
 */
import type { BatchOp } from '../../data/repository'
import type { AutomationRun, DataState } from '../../data/types'
import { runPut } from '../automation/types'
import { planAction, RETRYABLE, type ActionsPlan } from './actions'
import { assertNoInventedFacts } from './engine'
import type { RuleCtx, RuleEvent } from './types'
import { Work } from './work'

export const NOT_SYNCED = 'Conecte-se e espere a sincronização terminar: assim o Núcleo tem certeza de que esta ação não foi feita em outro aparelho.'

/** Why "Tentar de novo" is not offered (or not allowed now), or null when it is safe. */
export function retryBlock(run: AutomationRun, i: number, syncSafe: boolean): string | null {
  const a = run.actions?.[i]
  if (run.automation !== 'rule' || !a) return 'Não há o que tentar de novo.'
  if (run.status === 'undone') return 'Esta execução foi desfeita.'
  if (a.ok) return 'Esta ação já foi feita.'
  if (a.undone) return 'Esta ação foi desfeita.'
  if (!a.def) return 'Esta execução é de antes do “Tentar de novo”: faça à mão, se quiser.'
  if (!a.code || !RETRYABLE.has(a.code)) return 'O motivo não muda sozinho; ajuste a regra ou faça à mão.'
  if ([...run.created, ...run.changed].some((e) => e.action === i)) return 'Já existe algo feito por esta ação; o Núcleo não repete.'
  if ((a.def.kind === 'reservePercent' && (run.cause?.amount === undefined || !run.cause.currency)) || !run.rule) return 'Faltam os dados do acontecimento original para refazer a conta.'
  if (!syncSafe) return NOT_SYNCED
  return null
}

/** Only shown for actions that could become possible (the button may still say why it is blocked now). */
export const offersRetry = (run: AutomationRun, i: number) => {
  const a = run.actions?.[i]
  return Boolean(run.automation === 'rule' && run.status !== 'undone' && a && !a.ok && !a.undone && a.def && a.code && RETRYABLE.has(a.code))
}

export const attemptId = (run: AutomationRun, i: number) => `${run.id}-a${i}-t${(run.actions?.[i]?.attempts?.length ?? 0) + 1}`

/** The writes of one attempt (or the reason it is blocked). The run keeps every attempt. */
export function planRetry(run: AutomationRun, i: number, data: DataState, ctx: RuleCtx, syncSafe: boolean): { ops: BatchOp[]; ok: boolean; text: string } | string {
  const block = retryBlock(run, i, syncSafe)
  if (block) return block
  const a = run.actions![i]
  const id = attemptId(run, i)
  if (a.attempts?.some((t) => t.id === id)) return 'Esta tentativa já foi feita.'

  const ev: RuleEvent = { key: run.cause?.key ?? run.id, kind: 'moneyIn', date: run.date, origin: run.origin, label: run.cause?.label ?? '', amount: run.cause?.amount, currency: run.cause?.currency, txId: run.cause?.txId, names: {} }
  const work = new Work(data)
  const plan: ActionsPlan = { results: [], created: [], changed: [] }
  let n = 0
  const res = planAction({ name: run.rule!.name }, a.def!, i, ev, work, ctx, () => `${id}-${++n}`, plan)
  const attempt = { id, at: ctx.now.toISOString(), ok: res.ok, text: res.text }
  const actions = run.actions!.map((x, k) => (k === i ? { ...x, ok: res.ok, text: res.text, code: res.ok ? undefined : res.code, attempts: [...(x.attempts ?? []), attempt] } : x))
  for (const x of actions) if (x.code === undefined) delete x.code
  const done = actions.filter((x) => x.ok && !x.undone).map((x) => x.text)
  const notDone = actions.filter((x) => !x.ok).map((x) => x.text)
  const next: AutomationRun = {
    ...run,
    actions,
    created: [...run.created, ...plan.created],
    changed: [...run.changed, ...plan.changed],
    status: done.length ? 'done' : run.status,
    summary: done.length ? `Regra “${run.rule!.name}”: ${done.join(' · ')}` : run.summary,
  }
  if (notDone.length) next.detail = `Não fez: ${notDone.join('; ')}`
  else delete next.detail
  const ops = [...work.ops(), runPut(next)]
  assertNoInventedFacts(data, ops)
  return { ops, ok: res.ok, text: res.text }
}
