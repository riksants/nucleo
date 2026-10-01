import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { DAY_SHORT, WEEKDAYS } from '../../../supabase/functions/_shared/planner/schedule.ts'
import type { Weekday } from '../../data/types'
import { TextInput } from '../../ui/Field'
import { Switch } from '../settings/ModulePicker'

export function DayPicker({ value, onChange }: { value: Weekday[]; onChange(days: Weekday[]): void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias da semana">
      {WEEKDAYS.map((d) => {
        const on = value.includes(d)
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d])}
            className={`press h-10 min-w-11 rounded-xl border px-2 text-[14px] font-medium ${on ? 'border-transparent bg-accent text-white' : 'border-line bg-raised text-soft hover:text-ink'}`}
          >
            {DAY_SHORT[d]}
          </button>
        )
      })}
    </div>
  )
}

export function TimeInput({ value, onChange, label }: { value: string; onChange(v: string): void; label: string }) {
  return <TextInput type="time" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="num" />
}

export function NumberInput({ value, onChange, min = 0, max = 999, suffix, label }: { value: number; onChange(v: number): void; min?: number; max?: number; suffix?: string; label: string }) {
  return (
    <div className="relative">
      <TextInput
        inputMode="numeric"
        aria-label={label}
        className="num pr-14"
        value={Number.isFinite(value) ? String(value) : ''}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ''))
          onChange(Math.min(max, Math.max(min, Number.isFinite(n) ? n : min)))
        }}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[14px] text-faint">{suffix}</span>}
    </div>
  )
}

export function ToggleRow({ checked, onChange, children, hint }: { checked: boolean; onChange(v: boolean): void; children: ReactNode; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 rounded-2xl bg-raised px-4 py-3 text-left">
      <span className="min-w-0 flex-1 text-[15px]">
        {children}
        {hint && <span className="block text-[13px] text-faint">{hint}</span>}
      </span>
      <Switch checked={checked} />
    </button>
  )
}

/** Multi-select chips for known options, plus anything typed by the person. */
export function ChipSelect({ options, value, onChange }: { options: { id: string; label: string }[]; value: string[]; onChange(v: string[]): void }) {
  const known = new Set(options.map((o) => o.id))
  const custom = value.filter((v) => !known.has(v))
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.id)
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}
              className={`press inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-medium ${on ? 'border-transparent bg-ink text-bg' : 'border-line bg-surface text-soft hover:text-ink'}`}
            >
              {on && <Check size={14} strokeWidth={3} />}
              {o.label}
            </button>
          )
        })}
      </div>
      <TextInput
        placeholder="Outros (separe por vírgula)"
        value={custom.join(', ')}
        onChange={(e) =>
          onChange([
            ...value.filter((v) => known.has(v)),
            ...e.target.value
              .split(',')
              .map((x) => x.trimStart())
              .filter((x, i, all) => x || i === all.length - 1),
          ])
        }
        onBlur={(e) => onChange([...value.filter((v) => known.has(v)), ...e.target.value.split(',').map((x) => x.trim()).filter(Boolean)])}
      />
    </div>
  )
}
