import type { RecurrenceRule, Weekday } from '../../data/types'
import { Field } from '../../ui/Field'
import { Segmented } from '../../ui/Segmented'
import { DayPicker, NumberInput } from '../planner/controls'

type Kind = 'daily' | 'weekdays' | 'weekly' | 'monthly'

function kindOf(rule: RecurrenceRule): Kind {
  if (rule.type === 'weekdays') return rule.days.length === 1 ? 'weekly' : 'weekdays'
  return rule.type
}

const LABELS: Record<Kind, string> = { daily: 'Todo dia', weekly: 'Semanal', weekdays: 'Dias', monthly: 'Mensal' }

/** Repetition picker. Habits use daily/specific days; recurring items also weekly and monthly. */
export function RuleEditor({ value, onChange, kinds, today }: { value: RecurrenceRule; onChange(rule: RecurrenceRule): void; kinds: Kind[]; today: Weekday }) {
  const raw = kindOf(value)
  const kind = kinds.includes(raw) ? raw : 'weekdays'
  const pick = (k: Kind) => {
    if (k === 'daily') onChange({ type: 'daily' })
    else if (k === 'weekly') onChange({ type: 'weekdays', days: [value.type === 'weekdays' && value.days.length ? value.days[0] : today] })
    else if (k === 'weekdays') onChange({ type: 'weekdays', days: value.type === 'weekdays' && value.days.length > 1 ? value.days : [1, 2, 3, 4, 5] })
    else onChange({ type: 'monthly', dayOfMonth: value.type === 'monthly' ? value.dayOfMonth : 5 })
  }
  return (
    <div className="space-y-4">
      <Field label="Frequência">
        <Segmented block value={kind} onChange={pick} options={kinds.map((k) => ({ value: k, label: LABELS[k] }))} />
      </Field>
      {value.type === 'weekdays' && kind === 'weekly' && (
        <Field label="Dia da semana">
          <DayPicker value={value.days} onChange={(days) => onChange({ type: 'weekdays', days: days.filter((d) => !value.days.includes(d)).slice(-1) as Weekday[] })} />
        </Field>
      )}
      {value.type === 'weekdays' && kind === 'weekdays' && (
        <Field label="Quais dias">
          <DayPicker value={value.days} onChange={(days) => onChange({ type: 'weekdays', days })} />
        </Field>
      )}
      {value.type === 'monthly' && (
        <Field label="Dia do mês" hint="29–31 usam o último dia em meses curtos">
          <NumberInput label="Dia do mês" value={value.dayOfMonth} min={1} max={31} onChange={(n) => onChange({ type: 'monthly', dayOfMonth: n })} />
        </Field>
      )}
    </div>
  )
}

export function ruleProblem(rule: RecurrenceRule): string | null {
  if (rule.type === 'weekdays' && rule.days.length === 0) return 'Escolha pelo menos um dia da semana'
  if (rule.type === 'monthly' && (rule.dayOfMonth < 1 || rule.dayOfMonth > 31)) return 'Dia do mês inválido'
  return null
}
