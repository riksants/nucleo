import { useCallback, useEffect, useRef } from 'react'
import { planAll, sinceDefaults } from '../core/automation/engine'
import { changeGoalMonth } from '../core/automation/goalSave'
import { confirmSubscriberCharge, declineRun } from '../core/automation/subscriberCharge'
import { confirmToolCharge, confirmToolChargeNoExpense, payToolNow } from '../core/automation/toolCharge'
import { runPut } from '../core/automation/types'
import type { AutomationCtx } from '../core/automation/types'
import { linkedRuleRuns, undoAction, undoRun } from '../core/automation/undo'
import { attemptId, planRetry } from '../core/rules/retry'
import { planScheduledRules } from '../core/rules/schedule'
import { todayIn, useToday, zoneOf } from '../core/period'
import { applyOps } from '../core/rules/work'
import type { SyncStatus } from './repository'
import { useStore } from './store'
import type { AutomationId, AutomationRun, Cents, Tool } from './types'

/**
 * Whether the device has the account's latest data, so automations can act on it: the last sync
 * downloaded everything and nothing of this device waits to be sent. Items the server refused for
 * good (too large, account limit) stay on the device and no longer pause the automations (M1):
 * the sync around them completed.
 */
export function syncAllowsAutomations(s: SyncStatus | null): boolean {
  if (!s) return true
  const refused = s.rejected ?? 0
  return s.pending - refused <= 0 && (s.state === 'idle' || (s.state === 'error' && refused > 0))
}

/** Why the automations are waiting, in the person's words, or null when they run (or are about to). */
export function automationPause(s: SyncStatus | null): string | null {
  if (syncAllowsAutomations(s) || !s || s.state === 'syncing') return null
  if (s.state === 'offline') return 'Automações pausadas: sem internet. Voltam a rodar quando este aparelho sincronizar.'
  if (s.state === 'error') return `Automações pausadas até a sincronização terminar: ${s.error ?? 'erro ao sincronizar'}`
  return null
}

/**
 * Runs the date-based automations: when the app opens, when the day turns, when data changes
 * (another device, an edit) and when the app comes back. Signed in, only with the sync idle and
 * nothing queued, so a device that hasn't received the latest changes doesn't act on old data.
 * Passes never overlap; fixed ids make a repeated pass (or another device) write the same records.
 */
export function useAutomations() {
  const { ready, data, settings, convert, commit, updateSettings, syncStatus } = useStore()
  const idle = syncAllowsAutomations(syncStatus)
  const today = useToday(zoneOf(settings))
  const running = useRef(false)

  useEffect(() => {
    if (!ready || !settings.onboarded || !idle) return
    const timer = window.setTimeout(async () => {
      if (running.current) return
      running.current = true
      try {
        // First pass: every automation starts "on, since today" (nothing before today is caught up).
        const defaults = sinceDefaults(settings, today)
        if (defaults) {
          await updateSettings({ automations: defaults })
          return
        }
        const ctx = { data, settings, today, convert, now: new Date() }
        const ops = planAll(ctx).flatMap((p) => p.ops)
        // Parte 1 first (its writes may trigger rules); the date rules run in the next pass, on the new data.
        if (ops.length) await commit(ops, { by: 'automation' })
        else {
          const ruleOps = planScheduledRules(ctx)
          if (ruleOps.length) await commit(ruleOps, { by: 'rule' })
        }
      } catch (err) {
        console.error('Automações: falha numa passada', err)
      } finally {
        running.current = false
      }
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [ready, idle, data, settings, today, convert, commit, updateSettings])
}

/** What the person can do with the runs: confirm, decline, undo, change a month, turn on/off. */
export function useAutomationActions() {
  const { data, settings, convert, commit, updateSettings, syncStatus } = useStore()
  const ctx = useCallback((): AutomationCtx => ({ data, settings, today: todayIn(zoneOf(settings)), convert, now: new Date() }), [data, settings, convert])

  /** Error message, or null when confirmed. */
  const confirm = useCallback(
    async (run: AutomationRun, input: { amount: Cents; date: string }) => {
      const ops = run.automation === 'subscriberCharge' ? confirmSubscriberCharge(run, input, ctx()) : confirmToolCharge(run, input, ctx())
      if (typeof ops === 'string') return ops
      await commit(ops)
      return null
    },
    [ctx, commit],
  )

  const decline = useCallback((run: AutomationRun) => commit(declineRun(run, 'Marcado como não pago')), [commit])

  /** `alsoLinked`: the rule runs caused by a movement of this run are undone in the same write. */
  const undo = useCallback(
    async (run: AutomationRun, status: 'undone' | 'skipped' = 'undone', alsoLinked = false) => {
      const today = todayIn(zoneOf(settings))
      const first = undoRun(run, data, today, status)
      let ops = first.ops
      let partial = first.partial
      if (alsoLinked) {
        // Each rule undo sees the records as the previous undos left them.
        let state = data
        for (const linked of linkedRuleRuns(run, data.automationRuns)) {
          state = applyOps(state, ops)
          const next = undoRun(linked, state, today)
          ops = [...ops, ...next.ops]
          partial ||= next.partial
        }
      }
      await commit(ops, { by: 'undo' })
      return { partial }
    },
    [data, settings, commit],
  )

  const linkedRuns = useCallback((run: AutomationRun) => linkedRuleRuns(run, data.automationRuns), [data.automationRuns])

  /** Assinaturas: "Confirmar sem descontar" (settled, nothing in Financeiro). */
  const confirmNoExpense = useCallback((run: AutomationRun) => commit(confirmToolChargeNoExpense(run, ctx())), [commit, ctx])

  /** Assinaturas: "Já paguei" for the current cycle, with or without the expense. Error message or null. */
  const payNow = useCallback(
    async (tool: Tool, input: { amount: Cents; date: string; deduct: boolean }) => {
      const ops = payToolNow(tool, input, ctx())
      if (typeof ops === 'string') return ops
      await commit(ops)
      return null
    },
    [commit, ctx],
  )

  /**
   * Assinaturas: "Ainda não paguei" after the due date. A waiting charge stays "A pagar" without the assisted
   * question; a presumed one goes back to "A pagar" (its expense, if any, is removed) and is not presumed again.
   */
  const notYet = useCallback(
    async (run: AutomationRun) => {
      if (run.status === 'pending') return commit([runPut({ ...run, presumeDeclined: true })])
      const { ops } = undoRun(run, data, todayIn(zoneOf(settings)))
      const fixed = ops.map((o) => (o.op === 'put' && o.collection === 'automationRuns' && o.item.id === run.id ? runPut({ ...(o.item as AutomationRun), presumed: undefined, noExpense: undefined, presumeDeclined: true }) : o))
      return commit(fixed, { by: 'undo' })
    },
    [commit, data, settings],
  )

  const changeMonth = useCallback(
    async (run: AutomationRun, amount: Cents) => {
      const ops = changeGoalMonth(run, amount, ctx())
      if (typeof ops === 'string') return ops
      await commit(ops)
      return null
    },
    [ctx, commit],
  )

  /** Turning one back on starts from today: the time it was off is not caught up. */
  const setEnabled = useCallback(
    (id: AutomationId, on: boolean) => {
      const current = settings.automations?.[id]
      const today = todayIn(zoneOf(settings))
      return updateSettings({ automations: { ...settings.automations, [id]: { on, since: on ? today : (current?.since ?? today) } } })
    },
    [settings, updateSettings],
  )

  /** "Desfazer só esta ação" (2.1). */
  const undoOne = useCallback(
    async (run: AutomationRun, i: number) => {
      const r = undoAction(run, i, data, todayIn(zoneOf(settings)))
      if (!r) return null
      await commit(r.ops, { by: 'undo' })
      return { partial: r.partial }
    },
    [data, settings, commit],
  )

  // Attempts already sent from this screen: a second tap (before the screen updates) never repeats one.
  const sent = useRef(new Set<string>())
  /**
   * "Tentar de novo" (2.1): only the action that was not done. Signed in, only with the sync idle and
   * nothing waiting — otherwise another device may have done it, and the Núcleo blocks instead.
   * Returns the message to show.
   */
  const retry = useCallback(
    async (run: AutomationRun, i: number): Promise<{ ok: boolean; text: string }> => {
      const syncSafe = syncAllowsAutomations(syncStatus) && navigator.onLine !== false
      const id = attemptId(run, i)
      if (sent.current.has(id)) return { ok: false, text: 'Esta tentativa já foi feita.' }
      const now = new Date()
      const plan = planRetry(run, i, data, { settings, today: todayIn(zoneOf(settings), now), convert, now }, syncSafe)
      if (typeof plan === 'string') return { ok: false, text: plan }
      sent.current.add(id)
      await commit(plan.ops, { by: 'rule' })
      return { ok: plan.ok, text: plan.ok ? `Feito: ${plan.text}` : `Ainda não deu: ${plan.text}` }
    },
    [data, settings, convert, commit, syncStatus],
  )

  /** "Adiar": the item leaves Pendências until `until` (nothing else changes). */
  const snooze = useCallback((run: AutomationRun, until: string) => commit([runPut({ ...run, snoozedUntil: until })], { by: 'undo' }), [commit])

  /** "Dispensar" a waiting item that is not a charge (a failed action, a review): it never comes back. */
  const dismiss = useCallback((run: AutomationRun) => commit([runPut({ ...run, dismissedAt: new Date().toISOString() })], { by: 'undo' }), [commit])

  return { confirm, decline, undo, changeMonth, setEnabled, linkedRuns, undoOne, retry, confirmNoExpense, payNow, notYet, snooze, dismiss }
}
