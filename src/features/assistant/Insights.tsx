import { ChevronRight, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { navigate } from '../../app/router'
import { computeInsights, HOME_LIMIT, markInsight, visibleInsights, type Insight, type InsightPriority } from '../../core/insights'
import { addDaysToDate, useToday, weekStart, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import { Badge } from '../../ui/Display'

const TONE: Record<InsightPriority, 'warn' | 'accent' | 'neutral'> = { high: 'warn', medium: 'accent', low: 'neutral' }
const LABEL: Record<InsightPriority, string> = { high: 'alta', medium: 'média', low: 'baixa' }

/** Suggestions to show now (computed from the records; memoized per data/day). */
export function useInsights() {
  const { data, settings } = useStore()
  const today = useToday(zoneOf(settings))
  // Computed just after the screen shows (never blocks the first paint); dismiss/snooze still apply instantly.
  const [all, setAll] = useState<Insight[]>([])
  useEffect(() => {
    const timer = window.setTimeout(() => setAll(computeInsights(data, settings)), 0)
    return () => window.clearTimeout(timer)
  }, [data, settings, today])
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
      {why && <p className="mt-1.5 text-[13.5px] leading-relaxed text-soft">{insight.why}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
        {insight.action && (
          <button type="button" onClick={() => onAction(insight)} className="font-medium text-accent-hi hover:text-ink">
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
  if (!top.length) return null
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
          <span key={i.key} className="flex items-start gap-2 text-[13.5px] leading-snug text-soft">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${i.priority === 'high' ? 'bg-warn' : i.priority === 'medium' ? 'bg-accent-hi' : 'bg-faint'}`} />
            <span className="min-w-0 flex-1">{i.title}</span>
          </span>
        ))}
      </span>
    </button>
  )
}
