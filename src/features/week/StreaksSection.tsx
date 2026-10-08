import { Flame } from 'lucide-react'
import { useMemo } from 'react'
import type { CompletionIndex } from '../../core/completions'
import { occurrenceStreak } from '../../core/streaks'
import { useStore } from '../../data/store'
import { SectionTitle } from '../../ui/Display'

/** Current streaks of habits and recurring items, derived from per-day completions. */
export function StreaksSection({ today, index }: { today: string; index: CompletionIndex }) {
  const { data } = useStore()
  const list = useMemo(() => {
    const habits = data.habits.filter((h) => h.active).map((h) => ({ key: `h${h.id}`, name: h.name, ...occurrenceStreak('habit', h.id, h.rule, h.startDate, index, today) }))
    const rec = data.recurring.filter((r) => r.active).map((r) => ({ key: `r${r.id}`, name: r.title, ...occurrenceStreak('recurring', r.id, r.rule, r.startDate, index, today) }))
    return [...habits, ...rec].filter((s) => s.current >= 2).sort((a, b) => b.current - a.current).slice(0, 6)
  }, [data.habits, data.recurring, index, today])

  if (!list.length) return null
  return (
    <section>
      <SectionTitle>Sequências</SectionTitle>
      <div className="card divide-y divide-line">
        {list.map((s) => (
          <div key={s.key} className="flex items-center gap-3 px-4 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-warn/12 text-warn">
              <Flame size={18} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[15px]">{s.name}</span>
            <span className="num shrink-0 text-[15px] font-semibold">
              {s.current} <span className="text-[13px] font-normal text-faint">seguidas</span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-[13px] text-faint">Contam só os dias em que o hábito estava programado. Dias pulados são pausa.</p>
    </section>
  )
}
