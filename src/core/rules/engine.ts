/**
 * The rules engine. One engine, two doors:
 * - on a write made on this device (store save/commit): the events of that write are found and the
 *   actions of the matching rules are added to the SAME write (all saved together, or nothing);
 * - by date (schedule.ts), in the automations pass.
 *
 * Safety:
 * - writes made by rules (and undos) never produce events: no rule triggers another, nor itself;
 * - each run has a fixed id (rule + event key): a run already written is never done again;
 * - a rule that runs MAX_RUNS_PER_RULE_PER_DAY times in one day is turned off ("pausada");
 * - rules never create movements, mark payments or remove records (checked before writing).
 */
import type { BatchOp } from '../../data/repository'
import type { AutomationRun, DataState, Rule, Settings } from '../../data/types'
import type { Converter } from '../../lib/rates'
import { todayIn, zoneOf } from '../period'
import { makeRun, runPut } from '../automation/types'
import { matches } from './conditions'
import { detectEvents } from './events'
import { hash16 } from './hash'
import { planActions } from './actions'
import { EVENT_ACTORS, MAX_RUNS_PER_RULE_PER_DAY, type RuleCtx, type RuleEvent, type WriteActor } from './types'
import { applyOps, Work } from './work'
import { triggerInfo } from './catalog'

export const ruleRunId = (ruleId: string, eventKey: string) => `rule-${ruleId}-${hash16(eventKey)}`

/** Rules that can act now, in their order ("Minhas regras": top first; then oldest). */
export function activeRules(rules: Rule[]): Rule[] {
  return rules
    .filter((r) => r.on && !r.paused && r.actions.length > 0)
    .sort((a, b) => a.order - b.order || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
}

export class InventedFactError extends Error {}

/**
 * The guard of "never invent facts": rules may only write tasks, notes, Inbox items, goals (saved),
 * projects/clients (status), rules (pause), runs — and a movement only to give it a category.
 */
export function assertNoInventedFacts(before: DataState, ops: BatchOp[]): void {
  for (const o of ops) {
    if (o.op === 'remove') throw new InventedFactError(`regra tentou remover ${o.collection}`)
    if (o.collection !== 'transactions') continue
    const prev = before.transactions.find((t) => t.id === o.item.id)
    if (!prev) throw new InventedFactError('regra tentou criar uma movimentação')
    const { category: _a, updatedAt: _b, ...was } = prev
    const { category: _c, updatedAt: _d, ...now } = o.item as typeof prev
    void [_a, _b, _c, _d]
    if (JSON.stringify(was) !== JSON.stringify(now)) throw new InventedFactError('regra tentou alterar uma movimentação')
  }
}

function runsToday(work: Work, ruleId: string, today: string): number {
  return work.list('automationRuns').filter((r) => r.rule?.id === ruleId && r.date === today).length
}

/**
 * Runs the matching rules for each event on the working copy. `match` decides whether a rule
 * answers an event (default: trigger + conditions). Returns nothing: the writes are in `work`.
 */
export function executeEvents(events: RuleEvent[], rules: Rule[], work: Work, ctx: RuleCtx, match: (r: Rule, ev: RuleEvent) => boolean = matches): void {
  const known = new Set(work.list('automationRuns').map((r) => r.id))
  const paused = new Set<string>()
  for (const ev of events) {
    for (const rule of rules) {
      if (paused.has(rule.id) || !match(rule, ev)) continue
      // A movement dated before the rule was turned on (e.g. an old payment whose income only now got a rate).
      if (ev.date < rule.since) continue
      const id = ruleRunId(rule.id, ev.key)
      if (known.has(id)) continue
      if (runsToday(work, rule.id, ctx.today) >= MAX_RUNS_PER_RULE_PER_DAY) {
        paused.add(rule.id)
        const reason = `Rodou ${MAX_RUNS_PER_RULE_PER_DAY} vezes hoje`
        const current = work.get('rules', rule.id) ?? rule
        work.put('rules', { ...current, on: false, paused: { at: ctx.now.toISOString(), reason } })
        const pausedRun = makeRun({ id: `rule-${rule.id}-paused-${ctx.today}`, automation: 'rule', date: ctx.today, summary: `Regra “${rule.name}” pausada por segurança`, detail: `${reason}. Confira a regra e ligue de novo em Minhas regras.`, origin: { collection: 'rules', id: rule.id, label: rule.name }, created: [], changed: [], status: 'skipped', rule: { id: rule.id, name: rule.name } }, ctx.now)
        work.put('automationRuns', pausedRun)
        continue
      }
      const plan = planActions(rule, ev, work, ctx, id)
      const ok = plan.results.filter((r) => r.ok).map((r) => r.text)
      const notDone = plan.results.filter((r) => !r.ok).map((r) => r.text)
      const run: AutomationRun = makeRun(
        {
          id,
          automation: 'rule',
          date: ctx.today,
          summary: ok.length ? `Regra “${rule.name}”: ${ok.join(' · ')}` : `Regra “${rule.name}” não fez nada`,
          detail: notDone.length ? `Não fez: ${notDone.join('; ')}` : undefined,
          origin: ev.origin,
          created: plan.created,
          changed: plan.changed,
          status: ok.length ? 'done' : 'skipped',
          rule: { id: rule.id, name: rule.name },
          cause: { key: ev.key, label: ev.label, ...(ev.txId ? { txId: ev.txId } : {}) },
          actions: plan.results,
        },
        ctx.now,
      )
      if (!run.detail) delete run.detail
      work.put('automationRuns', run)
      known.add(id)
    }
  }
}

/**
 * The writes the rules add to one write of this device (`ops`, by `actor`), given the data just
 * before it. Empty when nothing matches, or the write was made by a rule or an undo.
 */
export function planRulesForWrite(before: DataState, ops: BatchOp[], actor: WriteActor, ctx: RuleCtx): BatchOp[] {
  if (!EVENT_ACTORS.has(actor) || !ops.length) return []
  const rules = activeRules(before.rules ?? []).filter((r) => !triggerInfo(r.trigger.kind).scheduled)
  if (!rules.length) return []
  const events = detectEvents(before, ops, ctx)
  if (!events.length) return []
  const after = applyOps(before, ops)
  const work = new Work(after)
  executeEvents(events, rules, work, ctx)
  const extra = work.ops()
  assertNoInventedFacts(after, extra)
  return extra
}

/** Logged (best effort) when the engine itself fails: the person's write goes on without the rules. */
export function engineErrorRun(ctx: RuleCtx): AutomationRun {
  return makeRun(
    {
      // One per day: a broken engine does not flood the history.
      id: `rule-error-${ctx.today}`,
      automation: 'rule',
      date: ctx.today,
      summary: 'As regras não conseguiram rodar nesta ação',
      detail: 'O que você fez foi salvo normalmente; só as regras ficaram de fora desta vez.',
      origin: { collection: 'rules', id: '', label: 'Minhas regras' },
      created: [],
      changed: [],
      status: 'skipped',
    },
    ctx.now,
  )
}

/**
 * What the store adds to a write. If the engine fails, the write goes on without the rules — it
 * never blocks what the person is doing — and the failure is noted in "Feito pelo Núcleo".
 */
export function safeRulesForWrite(before: DataState, settings: Settings, convert: Converter, ops: BatchOp[], actor: WriteActor, now = new Date()): BatchOp[] {
  if (!settings.onboarded || !before.rules?.length) return []
  const ctx: RuleCtx = { settings, today: todayIn(zoneOf(settings), now), convert, now }
  try {
    return planRulesForWrite(before, ops, actor, ctx)
  } catch (err) {
    console.error('Regras: falha no motor (a gravação segue sem as regras)', err)
    try {
      return [runPut(engineErrorRun(ctx))]
    } catch {
      return []
    }
  }
}
