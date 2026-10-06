import { emptyMealAnswers } from '../../../supabase/functions/_shared/planner/foodSafety.ts'
import { isTime } from '../../../supabase/functions/_shared/planner/time.ts'
import { useState } from 'react'
import { duplicateTo, foodSafetyProblem, mealTypes, weekDays } from '../../core/meals'
import { weekStart } from '../../core/period'
import { useStore } from '../../data/store'
import type { MealEntry } from '../../data/types'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft } from '../../ui/formHooks'
import { PROFILE_ID } from '../planner/plans'

const DAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const dayChip = (date: string) => `${DAY[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${date.slice(8, 10)}`
const lines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

export interface MealInitial {
  date?: string
  name?: string
  type?: string
}

/**
 * Quick meal form: type → name → time → ingredients. Description, notes and
 * "repeat on other days" stay folded. Same allergy check as the AI plan.
 */
export function MealForm({ open, onClose, meal, initial, onSaved }: { open: boolean; onClose(): void; meal: MealEntry | null; initial?: MealInitial; onSaved?(m: MealEntry): void }) {
  const { data, settings, save, remove } = useStore()
  const { toast, confirm } = useFeedback()
  const types = mealTypes(settings).filter((t) => t.active || t.id === meal?.type)
  const answers = data.plannerProfiles.find((p) => p.id === PROFILE_ID)?.meals ?? emptyMealAnswers()
  const [more, setMore] = useState(false)
  const [d, set, setAll] = useDraft(open, () => ({
    date: meal?.date ?? initial?.date ?? '',
    type: meal?.type ?? initial?.type ?? '',
    name: meal?.name ?? initial?.name ?? '',
    time: meal?.time ?? '',
    ingredients: (meal?.ingredients ?? []).join('\n'),
    description: meal?.description ?? '',
    notes: meal?.notes ?? '',
    copies: [] as string[],
  }))
  const week = d.date ? weekStart(d.date) : ''

  const submit = async () => {
    if (!d.name.trim() && !d.type) return 'Escolha o tipo ou dê um nome'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return 'Escolha o dia'
    if (d.time && !isTime(d.time)) return 'Confira o horário'
    const ingredients = lines(d.ingredients)
    const problem = foodSafetyProblem([d.name, ...ingredients], answers)
    if (problem) return problem
    const saved = await save('meals', { ...meal, date: d.date, type: d.type, name: d.name.trim(), time: d.time, description: d.description.trim(), ingredients, notes: d.notes.trim(), done: meal?.done ?? false, doneAt: meal?.doneAt ?? null })
    for (const copy of duplicateTo(saved, d.copies)) await save('meals', copy)
    toast(d.copies.length ? `Refeição salva em ${d.copies.length + 1} dias` : meal ? 'Refeição atualizada' : 'Refeição adicionada')
    onSaved?.(saved)
    onClose()
  }

  const del = async () => {
    if (!meal) return
    const ok = await confirm({ title: 'Excluir refeição?', confirmLabel: 'Excluir', danger: true })
    if (!ok) return
    await remove('meals', meal.id)
    toast('Refeição excluída')
    onClose()
  }

  return (
    <FormSheet open={open} onClose={onClose} title={meal ? 'Editar refeição' : 'Nova refeição'} submitLabel={meal ? 'Salvar' : 'Adicionar'} onSubmit={submit} onDelete={meal ? del : undefined}>
      <FormGrid>
        <div role="radiogroup" aria-label="Tipo de refeição" className="flex flex-wrap gap-2">
          {types.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={d.type === t.id} onClick={() => set('type', d.type === t.id ? '' : t.id)} className={`press h-10 rounded-full border px-3.5 text-[14px] font-medium ${d.type === t.id ? 'border-transparent bg-ink text-bg' : 'border-line bg-surface text-soft hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <Field label="Nome" hint="opcional">
          <TextInput value={d.name} maxLength={120} placeholder="Ex.: Ovos + pão + fruta" onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="half">
          <Field label="Dia">
            <TextInput type="date" value={d.date} onChange={(e) => setAll((x) => ({ ...x, date: e.target.value, copies: [] }))} />
          </Field>
        </div>
        <div className="half">
          <Field label="Horário" hint="opcional">
            <TextInput type="time" value={d.time} onChange={(e) => set('time', e.target.value)} />
          </Field>
        </div>
        <Field label="Ingredientes" hint="opcional · um por linha">
          <TextArea rows={3} value={d.ingredients} placeholder={'200 g de frango\nArroz\n1 banana'} onChange={(e) => set('ingredients', e.target.value)} />
        </Field>
        {!more ? (
          <button type="button" onClick={() => setMore(true)} className="-mt-1 justify-self-start text-[14px] font-medium text-accent-hi hover:text-ink">
            Mais opções
          </button>
        ) : (
          <>
            <Field label="Descrição" hint="opcional">
              <TextArea rows={2} value={d.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <Field label="Observação" hint="opcional">
              <TextArea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
            {week && (
              <div>
                <p className="mb-2 text-[13px] font-semibold text-soft">Repetir também em</p>
                <div className="flex flex-wrap gap-2">
                  {weekDays(week)
                    .filter((x) => x !== d.date)
                    .map((x) => {
                      const on = d.copies.includes(x)
                      return (
                        <button key={x} type="button" aria-pressed={on} onClick={() => set('copies', on ? d.copies.filter((c) => c !== x) : [...d.copies, x])} className={`press h-10 rounded-full border px-3.5 text-[14px] ${on ? 'border-transparent bg-ink text-bg' : 'border-line bg-surface text-soft hover:text-ink'}`}>
                          {dayChip(x)}
                        </button>
                      )
                    })}
                </div>
                <p className="mt-2 text-[13px] text-faint">Cria uma cópia em cada dia escolhido (sem marcar como realizada).</p>
              </div>
            )}
          </>
        )}
      </FormGrid>
    </FormSheet>
  )
}
