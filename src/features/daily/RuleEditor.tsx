import { useState } from 'react'
import type { RecurrenceRule, Weekday } from '../../data/types'
import { Field } from '../../ui/Field'
import { Segmented } from '../../ui/Segmented'
import { DayPicker, NumberInput } from '../planner/controls'

export type RuleKind = 'daily' | 'weekly' | 'monthly' | 'interval'

function kindOf(rule: RecurrenceRule): RuleKind {
  if (rule.type === 'weekdays') return rule.days.length === 7 ? 'daily' : 'weekly'
  return rule.type
}

const LABELS: Record<RuleKind, string> = { daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal', interval: 'A cada…' }

/**
 * Repetition picker: Diária · Semanal (one or more weekdays) · Mensal · A cada N dias/semanas.
 * Habits usually need fewer kinds; recurring items use all of them.
 */
export function RuleEditor({ value, onChange, kinds, today, fresh = false }: { value: RecurrenceRule; onChange(rule: RecurrenceRule): void; kinds: RuleKind[]; today: Weekday; fresh?: boolean }) {
  const raw = kindOf(value)
  const kind = kinds.includes(raw) ? raw : 'weekly'
  // The day suggested on its own (today) is replaced by the first day tapped; after that, taps add or remove.
  const [suggested, setSuggested] = useState(fresh && value.type === 'weekdays' && value.days.length === 1 && value.days[0] === today)
  const pickDays = (days: Weekday[]) => {
    if (suggested && value.type === 'weekdays' && days.length === 2) {
      setSuggested(false)
      return onChange({ type: 'weekdays', days: days.filter((d) => d !== today) })
    }
    setSuggested(false)
    onChange({ type: 'weekdays', days })
  }
  const pick = (k: RuleKind) => {
    if (k === 'daily') onChange({ type: 'daily' })
    else if (k === 'weekly') {
      const keep = value.type === 'weekdays' && value.days.length > 0 && value.days.length < 7
      if (!keep) setSuggested(fresh)
      onChange({ type: 'weekdays', days: keep ? value.days : [today] })
    }
    else if (k === 'monthly') onChange({ type: 'monthly', dayOfMonth: value.type === 'monthly' ? value.dayOfMonth : 5 })
    else onChange({ type: 'interval', every: value.type === 'interval' ? value.every : 2, unit: value.type === 'interval' ? value.unit : 'week' })
  }
  return (
    <div className="space-y-4">
      <Field label="Frequência">
        <Segmented block value={kind} onChange={pick} options={kinds.map((k) => ({ value: k, label: LABELS[k] }))} />
      </Field>
      {value.type === 'weekdays' && kind === 'weekly' && (
        <Field label="Em quais dias">
          <DayPicker value={value.days} onChange={pickDays} />
        </Field>
      )}
      {value.type === 'monthly' && (
        <Field label="Dia do mês" hint="29–31 usam o último dia em meses curtos">
          <NumberInput label="Dia do mês" value={value.dayOfMonth} min={1} max={31} onChange={(n) => onChange({ type: 'monthly', dayOfMonth: n })} />
        </Field>
      )}
      {value.type === 'interval' && (
        <Field label="Repetir a cada" hint="contando a partir da data de início">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
            <NumberInput label="Quantidade" value={value.every} min={1} max={52} onChange={(n) => onChange({ ...value, every: n })} />
            <Segmented
              block
              value={value.unit}
              onChange={(unit) => onChange({ ...value, unit })}
              options={[
                { value: 'day', label: 'dias' },
                { value: 'week', label: 'semanas' },
              ]}
            />
          </div>
        </Field>
      )}
    </div>
  )
}

export function ruleProblem(rule: RecurrenceRule): string | null {
  if (rule.type === 'weekdays' && rule.days.length === 0) return 'Escolha pelo menos um dia da semana'
  if (rule.type === 'monthly' && (rule.dayOfMonth < 1 || rule.dayOfMonth > 31)) return 'Dia do mês inválido'
  if (rule.type === 'interval' && (!Number.isFinite(rule.every) || rule.every < 1 || rule.every > 52)) return 'Repetição entre 1 e 52'
  return null
}
