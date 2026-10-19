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
import { checkConditions, triggerMatches, type ConditionCheck } from './conditions'
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

/** Chains (2.1): at most this many rules in one chain, and this many runs in one write. */
export const MAX_CHAIN_DEPTH = 3
export const MAX_RUNS_PER_WRITE = 20

export type Matcher = (r: Rule, ev: RuleEvent) => ConditionCheck

export interface ExecuteOptions {
  /** Rules a chained event may reach (the write-time ones). Default: the same list. */
  chainRules?: Rule[]
}

interface ChainState {
  root: string | null
  path: { id: string; name: string }[]
  keys: Set<string>
  budget: { runs: number; stopped: boolean }
}

/** Default matcher: trigger, then every condition (a value condition may convert, see checkCondition). */
export const matcherFor =
  (ctx: RuleCtx): Matcher =>
  (r, ev) =>
    triggerMatches(r, ev) ? checkConditions(r.conditions, ev, ctx) : { ok: false }

/** The records a run wrote (its own created/changed entries, as they are now in `work`). */
function runOps(work: Work, run: AutomationRun): BatchOp[] {
  const seen = new Set<string>()
  const ops: BatchOp[] = []
  for (const e of [...run.created, ...run.changed]) {
    const key = `${e.collection}:${e.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const item = work.get(e.collection, e.id)
    if (item) ops.push({ op: 'put', collection: e.collection, item })
  }
  return ops
}

function stopRun(rule: Rule, ev: RuleEvent, ctx: RuleCtx, why: string): AutomationRun {
  return makeRun(
    { id: `rule-${rule.id}-stop-${hash16(ev.key)}`, automation: 'rule', date: ctx.today, summary: `Cadeia interrompida por segurança antes da regra “${rule.name}”`, detail: why, origin: ev.origin, created: [], changed: [], status: 'skipped', rule: { id: rule.id, name: rule.name } },
    ctx.now,
  )
}

/**
 * Runs the matching rules for each event on the working copy. Returns nothing: the writes are in
 * `work`. A rule with `chain` on lets the events of what IT wrote reach the other rules, with every
 * guard: at most MAX_CHAIN_DEPTH rules per chain, no rule twice in a chain (no A→A, no A→B→A), no
 * event twice in a chain, MAX_RUNS_PER_WRITE runs per write, and the daily limit.
 */
export function executeEvents(events: RuleEvent[], rules: Rule[], work: Work, ctx: RuleCtx, match: Matcher = matcherFor(ctx), opts: ExecuteOptions = {}, chain?: ChainState): void {
  const state: ChainState = chain ?? { root: null, path: [], keys: new Set(), budget: { runs: 0, stopped: false } }
  const paused = new Set<string>()
  for (const ev of events) {
    if (state.path.length) {
      if (state.keys.has(ev.key)) continue
      state.keys.add(ev.key)
    }
    for (const rule of rules) {
      if (paused.has(rule.id) || state.path.some((p) => p.id === rule.id)) continue
      const check = match(rule, ev)
      if (check.ok === false) continue
      // A movement dated before the rule was turned on (e.g. an old payment whose income only now got a rate).
      if (ev.date < rule.since) continue
      const id = ruleRunId(rule.id, ev.key)
      if (work.get('automationRuns', id)) continue
      if (state.budget.runs >= MAX_RUNS_PER_WRITE) {
        if (!state.budget.stopped) work.put('automationRuns', stopRun(rule, ev, ctx, `Mais de ${MAX_RUNS_PER_WRITE} execuções numa só ação. Nada além disso foi feito.`))
        state.budget.stopped = true
        return
      }
      if (runsToday(work, rule.id, ctx.today) >= MAX_RUNS_PER_RULE_PER_DAY) {
        paused.add(rule.id)
        const reason = `Rodou ${MAX_RUNS_PER_RULE_PER_DAY} vezes hoje`
        const current = work.get('rules', rule.id) ?? rule
        work.put('rules', { ...current, on: false, paused: { at: ctx.now.toISOString(), reason } })
        const pausedRun = makeRun({ id: `rule-${rule.id}-paused-${ctx.today}`, automation: 'rule', date: ctx.today, summary: `Regra “${rule.name}” pausada por segurança`, detail: `${reason}. Confira a regra e ligue de novo em Minhas regras.`, origin: { collection: 'rules', id: rule.id, label: rule.name }, created: [], changed: [], status: 'skipped', rule: { id: rule.id, name: rule.name } }, ctx.now)
        work.put('automationRuns', pausedRun)
        continue
      }
      state.budget.runs++
      const cause: NonNullable<AutomationRun['cause']> = {
        key: ev.key,
        label: ev.label,
        ...(ev.txId ? { txId: ev.txId } : {}),
        ...(ev.amount !== undefined && ev.currency ? { amount: ev.amount, currency: ev.currency } : {}),
        ...(check.conversion ? { conversion: check.conversion } : {}),
      }
      const chainInfo = state.path.length ? { chain: { rootRunId: state.root!, path: [...state.path, { id: rule.id, name: rule.name }], depth: state.path.length } } : {}
      if (check.ok === null) {
        // A value condition could not be checked (no rate): the rule does not run, and says why.
        work.put('automationRuns', makeRun({ id, automation: 'rule', date: ctx.today, summary: `Regra “${rule.name}” não rodou`, detail: `Não deu para conferir a condição: ${check.reason}.`, origin: ev.origin, created: [], changed: [], status: 'skipped', rule: { id: rule.id, name: rule.name }, cause, ...chainInfo }, ctx.now))
        continue
      }
      const beforeRun = work.snapshot()
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
          cause,
          actions: plan.results,
          ...chainInfo,
        },
        ctx.now,
      )
      if (!run.detail) delete run.detail
      work.put('automationRuns', run)

      // Chain: only when this rule allows it, only from what this run wrote, never past the depth.
      const path = [...state.path, { id: rule.id, name: rule.name }]
      if (rule.chain && ok.length && path.length < MAX_CHAIN_DEPTH) {
        const next = detectEvents(beforeRun, runOps(work, run), ctx)
        if (next.length) executeEvents(next, opts.chainRules ?? rules, work, ctx, matcherFor(ctx), opts, { root: state.root ?? id, path, keys: new Set([...state.keys, ev.key]), budget: state.budget })
        if (state.budget.stopped) return
      }
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
  executeEvents(events, rules, work, ctx, matcherFor(ctx), { chainRules: rules })
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
