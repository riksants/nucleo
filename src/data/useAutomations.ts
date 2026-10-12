import { useCallback, useEffect, useRef } from 'react'
import { planAll, sinceDefaults } from '../core/automation/engine'
import { changeGoalMonth } from '../core/automation/goalSave'
import { confirmSubscriberCharge, declineRun } from '../core/automation/subscriberCharge'
import { confirmToolCharge } from '../core/automation/toolCharge'
import type { AutomationCtx } from '../core/automation/types'
import { undoRun } from '../core/automation/undo'
import { todayIn, useToday, zoneOf } from '../core/period'
import { useStore } from './store'
import type { AutomationId, AutomationRun, Cents } from './types'

/**
 * Runs the date-based automations: when the app opens, when the day turns, when data changes
 * (another device, an edit) and when the app comes back. Signed in, only with the sync idle and
 * nothing queued, so a device that hasn't received the latest changes doesn't act on old data.
 * Passes never overlap; fixed ids make a repeated pass (or another device) write the same records.
 */
export function useAutomations() {
  const { ready, data, settings, convert, commit, updateSettings, syncStatus } = useStore()
  const idle = !syncStatus || (syncStatus.state === 'idle' && syncStatus.pending === 0)
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
        const ops = planAll({ data, settings, today, convert, now: new Date() }).flatMap((p) => p.ops)
        if (ops.length) await commit(ops)
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
  const { data, settings, convert, commit, updateSettings } = useStore()
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

  const undo = useCallback(
    async (run: AutomationRun, status: 'undone' | 'skipped' = 'undone') => {
      const { ops, partial } = undoRun(run, data, todayIn(zoneOf(settings)), status)
      await commit(ops)
      return { partial }
    },
    [data, settings, commit],
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

  return { confirm, decline, undo, changeMonth, setEnabled }
}
