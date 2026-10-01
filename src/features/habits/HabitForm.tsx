import { isTime } from '../../../supabase/functions/_shared/planner/time.ts'
import { nowIn, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import { CATEGORY_LABEL } from '../../core/weekGoals'
import type { Habit, HabitCategory, RecurrenceRule } from '../../data/types'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, Select, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft } from '../../ui/formHooks'
import { ToggleRow } from '../planner/controls'
import { RuleEditor, ruleProblem } from '../daily/RuleEditor'

/** Presets also set the category, which links the habit to weekly metrics. */
const PRESETS: { name: string; category: HabitCategory }[] = [
  { name: 'Beber água', category: 'water' },
  { name: 'Treinar', category: 'training' },
  { name: 'Estudar', category: 'study' },
  { name: 'Ler', category: 'reading' },
  { name: 'Dormir cedo', category: 'sleep' },
  { name: 'Meditar', category: 'meditation' },
  { name: 'Comer bem', category: 'food' },
]

export function HabitForm({ open, onClose, habit }: { open: boolean; onClose(): void; habit: Habit | null }) {
  const { save, remove, settings } = useStore()
  const { toast, confirm } = useFeedback()
  const now = nowIn(zoneOf(settings))
  const [d, set, setAll] = useDraft(open, () => ({
    name: habit?.name ?? '',
    rule: (habit?.rule ?? { type: 'daily' }) as RecurrenceRule,
    time: habit?.time ?? '',
    goal: habit?.goal ?? '',
    active: habit?.active ?? true,
    category: (habit?.category ?? '') as HabitCategory | '',
  }))

  const submit = async () => {
    if (!d.name.trim()) return 'Dê um nome ao hábito'
    const problem = ruleProblem(d.rule)
    if (problem) return problem
    if (d.time && !isTime(d.time)) return 'Confira o horário'
    await save('habits', { ...habit, name: d.name.trim(), rule: d.rule, time: d.time, goal: d.goal.trim(), active: d.active, category: d.category || undefined, startDate: habit?.startDate ?? now.date })
    toast(habit ? 'Hábito atualizado' : 'Hábito criado')
    onClose()
  }

  const del = async () => {
    if (!habit) return
    const ok = await confirm({
      title: 'Excluir hábito?',
      message: 'Para pausar sem perder nada, desative em vez de excluir. O histórico de dias marcados fica guardado.',
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (!ok) return
    await remove('habits', habit.id)
    toast('Hábito excluído')
    onClose()
  }

  return (
    <FormSheet open={open} onClose={onClose} title={habit ? 'Editar hábito' : 'Novo hábito'} submitLabel={habit ? 'Salvar' : 'Criar hábito'} onSubmit={submit} onDelete={habit ? del : undefined}>
      <FormGrid>
        <Field label="Hábito">
          <TextInput value={d.name} placeholder="Ex.: Beber água" onChange={(e) => set('name', e.target.value)} autoFocus={!habit} />
        </Field>
        {!habit && !d.name && (
          <div className="-mt-2 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.name} type="button" onClick={() => setAll((x) => ({ ...x, name: p.name, category: p.category }))} className="press h-9 rounded-full border border-line bg-surface px-3.5 text-[14px] font-medium text-soft hover:text-ink">
                {p.name}
              </button>
            ))}
          </div>
        )}
        <Field label="Categoria" hint="opcional · liga às metas e ao Score">
          <Select value={d.category} onChange={(e) => set('category', e.target.value as HabitCategory | '')}>
            <option value="">Sem categoria</option>
            {(Object.keys(CATEGORY_LABEL) as HabitCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <RuleEditor value={d.rule} onChange={(r) => set('rule', r)} kinds={['daily', 'weekdays']} today={now.weekday} />
        <div className="half">
          <Field label="Horário" hint="opcional">
            <TextInput type="time" value={d.time} onChange={(e) => set('time', e.target.value)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Meta" hint="opcional">
            <TextInput value={d.goal} placeholder="Ex.: 2 litros" onChange={(e) => set('goal', e.target.value)} />
          </Field>
        </div>
        {habit && (
          <ToggleRow checked={d.active} onChange={(v) => set('active', v)} hint="Desativado: some do dia, o histórico fica">
            Ativo
          </ToggleRow>
        )}
      </FormGrid>
    </FormSheet>
  )
}
