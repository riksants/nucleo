import { useMemo } from 'react'
import { isEnabled } from '../../app/modules'
import { addDaysToDate, weekStart } from '../../core/period'
import { metricOptions } from '../../core/weekGoals'
import { newId, useStore } from '../../data/store'
import type { HabitCategory, WeekId, WeeklyGoal, WeeklyGoalKind } from '../../data/types'
import { amountToInput, currencyInfo, formatMoney } from '../../lib/money'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, Select, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { NumberInput } from '../planner/controls'
import { parseMoney } from '../../lib/calc'
import { AmountField } from '../../ui/AmountField'

const KINDS: { value: WeeklyGoalKind; label: string }[] = [
  { value: 'quantity', label: 'Quantidade' },
  { value: 'frequency', label: 'Frequência' },
  { value: 'percent', label: '%' },
  { value: 'money', label: 'Valor' },
  { value: 'manual', label: 'Manual' },
]

const WEEK_LABEL = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
export const weekLabel = (week: WeekId) => `${WEEK_LABEL.format(new Date(`${week}T12:00:00Z`))} – ${WEEK_LABEL.format(new Date(`${addDaysToDate(week, 6)}T12:00:00Z`))}`.replace(/\./g, '')

export function GoalForm({ open, onClose, goal, defaultWeek, currentWeek }: { open: boolean; onClose(): void; goal: WeeklyGoal | null; defaultWeek: WeekId; currentWeek: WeekId }) {
  const { data, save, settings } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const categories = useMemo(() => [...new Set(data.habits.map((h) => h.category).filter(Boolean))] as HabitCategory[], [data.habits])
  const options = useMemo(() => metricOptions(data.habits, data.recurring, categories, { life: isEnabled(settings, 'life') }), [data.habits, data.recurring, categories, settings])
  const [d, set, setAll] = useDraft(open, () => ({
    title: goal?.title ?? '',
    kind: (goal?.kind ?? 'quantity') as WeeklyGoalKind,
    metric: goal?.metric ?? 'training.days',
    target: goal ? (goal.kind === 'money' ? amountToInput(goal.target) : String(goal.target)) : '4',
    week: goal?.week ?? defaultWeek,
  }))
  const available = options.filter((o) => o.kind === d.kind)
  const metric = available.some((o) => o.key === d.metric) ? d.metric : (available[0]?.key ?? null)
  const chosen = options.find((o) => o.key === metric)

  const submit = async () => {
    const target = d.kind === 'money' ? parseMoney(d.target) : Number(d.target.replace(',', '.'))
    if (target === null || !Number.isFinite(target) || target <= 0) return 'Defina um alvo maior que zero'
    if (d.kind === 'percent' && target > 100) return 'Porcentagem vai até 100'
    const title =
      d.title.trim() ||
      (metric === 'finance.saved' ? `Guardar ${formatMoney(target, settings.baseCurrency)}` : chosen ? `${chosen.label}: ${d.kind === 'percent' ? `${target}%` : d.kind === 'money' ? formatMoney(target, settings.baseCurrency) : target}` : '')
    if (!title) return 'Dê um nome à meta'
    await save('weeklyGoals', {
      ...goal,
      title,
      kind: d.kind,
      metric: d.kind === 'manual' ? null : metric,
      target,
      manualValue: goal?.manualValue ?? 0,
      status: goal?.status ?? 'active',
      repeatKey: goal?.repeatKey ?? newId(),
      week: weekStart(d.week),
    })
    toast(goal ? 'Meta atualizada' : 'Meta criada')
    onClose()
  }

  const weeks = [currentWeek, addDaysToDate(currentWeek, 7)]
  return (
    <FormSheet open={open} onClose={onClose} title={goal ? 'Editar meta da semana' : 'Nova meta da semana'} onSubmit={submit} onDelete={goal ? () => del('weeklyGoals', goal.id, 'meta', { feminine: true, after: onClose }) : undefined}>
      <FormGrid>
        <Field label="Tipo">
          <Segmented block size="sm" value={d.kind} onChange={(k) => setAll((x) => ({ ...x, kind: k, target: k === 'percent' ? '80' : k === 'money' ? '200' : x.target }))} options={KINDS} />
        </Field>
        {d.kind !== 'manual' && (
          <Field label="Medir por" hint="atualiza sozinho">
            <Select value={metric ?? ''} onChange={(e) => set('metric', e.target.value)}>
              {available.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {d.kind === 'frequency' && !available.length && <p className="text-[13px] text-faint">Crie um hábito ou recorrente (ou dê uma categoria a um hábito) para medir frequência.</p>}
        <Field label={d.kind === 'money' ? `Alvo (${settings.baseCurrency} ${currencyInfo(settings.baseCurrency).symbol})` : d.kind === 'percent' ? 'Alvo (%)' : 'Alvo'} hint={d.kind === 'money' ? (metric === 'finance.saved' ? 'conta o que você registrar como guardado nas metas com prazo' : 'saldo da semana: entradas − saídas') : chosen?.unit}>
          {d.kind === 'money' ? (
            <AmountField currency={settings.baseCurrency} value={d.target} onChange={(v) => set('target', v)} />
          ) : (
            <NumberInput label="Alvo" value={Number(d.target) || 0} min={0} max={d.kind === 'percent' ? 100 : 100000} onChange={(v) => set('target', String(v))} suffix={d.kind === 'percent' ? '%' : undefined} />
          )}
        </Field>
        <Field label="Nome" hint="opcional">
          <TextInput value={d.title} placeholder={chosen ? `Ex.: ${chosen.label}` : 'Ex.: Ler 3 livros infantis'} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Semana">
          <Select value={weekStart(d.week)} onChange={(e) => set('week', e.target.value)}>
            {[...new Set([...weeks, weekStart(d.week)])].map((w) => (
              <option key={w} value={w}>
                {w === currentWeek ? 'Esta semana' : w === weeks[1] ? 'Próxima semana' : 'Semana'} · {weekLabel(w)}
              </option>
            ))}
          </Select>
        </Field>
        {categories.length === 0 && d.kind !== 'manual' && <p className="text-[13px] leading-relaxed text-faint">Dica: dê uma categoria aos hábitos (treino, estudo, leitura…) para usá-los nas metas.</p>}
      </FormGrid>
    </FormSheet>
  )
}
