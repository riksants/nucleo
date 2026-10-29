import { Apple, Coffee, Moon, Salad, Soup, UtensilsCrossed, type LucideIcon } from 'lucide-react'

/** Each meal type reads differently at a glance: its own glyph and a quiet tint (custom types share one). */
const TYPE: Record<string, { icon: LucideIcon; tint: string }> = {
  breakfast: { icon: Coffee, tint: 'bg-warn/[0.14] text-warn' },
  morningSnack: { icon: Apple, tint: 'bg-income/[0.14] text-income' },
  lunch: { icon: UtensilsCrossed, tint: 'bg-accent/[0.14] text-accent-hi' },
  afternoonSnack: { icon: Apple, tint: 'bg-income/[0.14] text-income' },
  dinner: { icon: Soup, tint: 'bg-goal/[0.16] text-goal' },
  supper: { icon: Moon, tint: 'bg-tint/[0.08] text-soft' },
}

export function MealTypeIcon({ type, className = '' }: { type: string; className?: string }) {
  const t = TYPE[type] ?? { icon: Salad, tint: 'bg-tint/[0.08] text-soft' }
  return (
    <span aria-hidden className={`grid size-9 shrink-0 place-items-center rounded-xl ${t.tint} ${className}`}>
      <t.icon size={18} />
    </span>
  )
}

/** The type of an AI plan meal from its time ("12:30" → lunch), only to pick a glyph. */
export function typeFromTime(time: string): string {
  const h = Number(time.slice(0, 2))
  if (!Number.isFinite(h)) return ''
  return h < 10 ? 'breakfast' : h < 12 ? 'morningSnack' : h < 15 ? 'lunch' : h < 18 ? 'afternoonSnack' : h < 22 ? 'dinner' : 'supper'
}

const SHORT = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' })
const LONG = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

/** Seven days to pick from (inside its own row: never pushes the page sideways). */
export function DayStrip({ days, value, today, counts, onPick, label = 'Dias' }: { days: string[]; value: string; today?: string; counts?: Record<string, number>; onPick(d: string): void; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className="grid grid-cols-7 gap-1">
      {days.map((d) => {
        const on = d === value
        const n = counts?.[d] ?? 0
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={`${LONG.format(new Date(`${d}T12:00:00Z`))}${n ? `, ${n}` : ''}`}
            onClick={() => onPick(d)}
            className={`press flex min-w-0 flex-col items-center gap-1 rounded-2xl py-2 transition-colors ${on ? 'bg-accent text-on-accent' : d === today ? 'bg-accent/[0.1] text-accent-hi ring-1 ring-accent/30 ring-inset' : 'text-soft hover:bg-tint/[0.04]'}`}
          >
            <span className="text-[11px] font-semibold tracking-wide uppercase">{SHORT.format(new Date(`${d}T12:00:00Z`)).replace('.', '').slice(0, 3)}</span>
            <span className={`num text-[17px] leading-none font-semibold ${on ? '' : 'text-ink'}`}>{Number(d.slice(8))}</span>
            <span className="flex h-1.5 gap-0.5">
              {Array.from({ length: Math.min(n, 4) }, (_, i) => (
                <span key={i} className={`size-1.5 rounded-full ${on ? 'bg-on-accent' : 'bg-accent/60'}`} />
              ))}
            </span>
          </button>
        )
      })}
    </div>
  )
}
