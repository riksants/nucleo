import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { navigate } from '../../app/router'
import { computeInsights, HOME_LIMIT, markInsight, visibleInsights, type Insight, type InsightPriority } from '../../core/insights'
import { addDaysToDate, useToday, weekStart, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import { Badge } from '../../ui/Display'

const TONE: Record<InsightPriority, 'warn' | 'accent' | 'neutral'> = { high: 'warn', medium: 'accent', low: 'neutral' }
const LABEL: Record<InsightPriority, string> = { high: 'alta', medium: 'média', low: 'baixa' }

/** Last computed suggestions, reused while the records and the day are the same. */
let lastInsights: { data: unknown; settings: unknown; today: string; all: Insight[] } | null = null

/** Suggestions to show now (computed from the records; memoized per data/day). */
export function useInsights() {
  const { data, settings } = useStore()
  const today = useToday(zoneOf(settings))
  const cached = lastInsights && lastInsights.data === data && lastInsights.settings === settings && lastInsights.today === today ? lastInsights.all : null
  // Computed just after the screen shows (never blocks the first paint); dismiss/snooze still apply instantly.
  // Coming back to a screen, the last result is shown right away — the card doesn't pop in and push the page again.
  const [all, setAll] = useState<Insight[]>(() => cached ?? [])
  useEffect(() => {
    if (cached) return
    const timer = window.setTimeout(() => {
      const next = computeInsights(data, settings)
      lastInsights = { data, settings, today, all: next }
      setAll(next)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [data, settings, today, cached])
  return { all: visibleInsights(all, settings.insightState, today), today }
}

export function useMarkInsight() {
  const { settings, updateSettings } = useStore()
  const today = useToday(zoneOf(settings))
  return (key: string, s: 'dismissed' | 'accepted' | 'snoozed', until?: 'tomorrow' | 'week') =>
    updateSettings({ insightState: markInsight(settings.insightState, key, { s, ...(s === 'snoozed' ? { until: until === 'week' ? addDaysToDate(weekStart(today), 7) : addDaysToDate(today, 1) } : {}) }) })
}

/** One suggestion: title, priority, "Por quê?", its action, Adiar and Descartar. */
export function InsightCard({ insight, onAction }: { insight: Insight; onAction(i: Insight): void }) {
  const mark = useMarkInsight()
  const [why, setWhy] = useState(false)
  const [snooze, setSnooze] = useState(false)
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[15px] leading-snug">{insight.title}</p>
        <Badge tone={TONE[insight.priority]}>{LABEL[insight.priority]}</Badge>
      </div>
      {why && <p className="mt-1.5 text-[13px] leading-relaxed text-soft">{insight.why}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        {insight.action && (
          <button type="button" onClick={() => onAction(insight)} className="hit relative font-medium text-accent-hi hover:text-ink">
            {insight.action.label}
          </button>
        )}
        <button type="button" aria-expanded={why} onClick={() => setWhy(!why)} className="text-faint hover:text-soft">
          Por quê?
        </button>
        {snooze ? (
          <>
            <button type="button" onClick={() => mark(insight.key, 'snoozed', 'tomorrow')} className="text-faint hover:text-soft">
              Até amanhã
            </button>
            <button type="button" onClick={() => mark(insight.key, 'snoozed', 'week')} className="text-faint hover:text-soft">
              Semana que vem
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setSnooze(true)} className="text-faint hover:text-soft">
            Adiar
          </button>
        )}
        <button type="button" onClick={() => mark(insight.key, 'dismissed')} className="text-faint hover:text-soft">
          Descartar
        </button>
      </div>
    </div>
  )
}

/** Início / Hoje: at most 3 suggestions, highest priority first; opens the Assistant. */
export function AttentionCard() {
  const { all } = useInsights()
  const top = all.slice(0, HOME_LIMIT)
  // Already known when the screen opens: shown in place. Arriving a moment later: opens smoothly (200 ms)
  // instead of shoving the page down. Reduced motion: appears without animating.
  return (
    <AnimatePresence initial={false}>
      {top.length > 0 && (
        <motion.div
          key="attention"
          className="overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <AttentionButton all={all} top={top} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function AttentionButton({ all, top }: { all: Insight[]; top: Insight[] }) {
  return (
    <button type="button" onClick={() => navigate('/assistant')} className="card mb-5 block w-full p-4 text-left hover:border-line-strong">
      <span className="flex items-center gap-2">
        <Sparkles size={17} className="shrink-0 text-accent-hi" />
        <span className="min-w-0 flex-1 text-[15px] font-medium">
          {all.length === 1 ? '1 coisa pode precisar da sua atenção' : `${Math.min(all.length, 8)} coisas podem precisar da sua atenção`}
        </span>
        <ChevronRight size={18} className="shrink-0 text-faint" />
      </span>
      <span className="mt-2 block space-y-1">
        {top.map((i) => (
          <span key={i.key} className="flex items-start gap-2 text-[13px] leading-snug text-soft">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${i.priority === 'high' ? 'bg-warn' : i.priority === 'medium' ? 'bg-accent-hi' : 'bg-faint'}`} />
            <span className="min-w-0 flex-1">{i.title}</span>
          </span>
        ))}
      </span>
    </button>
  )
}
