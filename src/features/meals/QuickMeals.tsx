/**
 * Faster ways to fill a day: repeat a meal already used, or paste several at once ("07:00 Café: pão, ovos").
 * Repeat opens the usual form filled in (checked there); pasted lines are shown first and created only when
 * the person confirms, with the same allergy check as the form.
 */
import { emptyMealAnswers } from '../../../supabase/functions/_shared/planner/foodSafety.ts'
import { useMemo, useState } from 'react'
import { foodSafetyProblem, mealTitle, mealTypes, typeLabel } from '../../core/meals'
import { parseMealText, type MealDraft } from '../../core/mealText'
import { weekStart } from '../../core/period'
import { matches } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { MealEntry } from '../../data/types'
import { Button } from '../../ui/Button'
import { SearchField } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { TextArea } from '../../ui/Field'
import { Sheet } from '../../ui/Sheet'
import { PROFILE_ID } from '../planner/plans'
import { MealTypeIcon } from './MealParts'

/** Meals already registered, one per name + ingredients, most recent first. */
export function pastMeals(meals: MealEntry[], settingsTypes: Parameters<typeof mealTitle>[0], before = '9999-12-31'): MealEntry[] {
  const seen = new Set<string>()
  const out: MealEntry[] = []
  for (const m of [...meals].filter((x) => x.date <= before).sort((a, b) => (a.date < b.date ? 1 : -1))) {
    const key = `${mealTitle(settingsTypes, m).toLowerCase()}|${m.ingredients.join('|').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
    if (out.length >= 60) break
  }
  return out
}

export function RepeatSheet({ open, onClose, onPick }: { open: boolean; onClose(): void; onPick(m: MealEntry): void }) {
  const { data, settings } = useStore()
  const [query, setQuery] = useState('')
  const list = useMemo(() => pastMeals(data.meals, settings), [data.meals, settings]).filter((m) => matches(query, `${mealTitle(settings, m)} ${m.ingredients.join(' ')}`))
  return (
    <Sheet open={open} onClose={onClose} title="Repetir uma refeição">
      <div className="space-y-3">
        <SearchField value={query} onChange={setQuery} placeholder="Buscar pelo nome ou alimento" />
        {list.length ? (
          <ul className="card divide-y divide-line">
            {list.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => onPick(m)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-tint/[0.03] tap">
                  <MealTypeIcon type={m.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{mealTitle(settings, m)}</span>
                    <span className="block truncate text-[13px] text-faint">{m.ingredients.length ? m.ingredients.join(', ') : typeLabel(settings, m.type) || 'Sem alimentos'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card px-4 py-4 text-[15px] text-faint">{query ? 'Nada encontrado.' : 'Ainda não há refeições para repetir.'}</p>
        )}
      </div>
    </Sheet>
  )
}

export function PasteSheet({ open, onClose, date }: { open: boolean; onClose(): void; date: string }) {
  const { data, settings, save } = useStore()
  const { toast } = useFeedback()
  const [text, setText] = useState('')
  const [drafts, setDrafts] = useState<(MealDraft & { on: boolean; problem: string | null })[] | null>(null)
  const answers = data.plannerProfiles.find((p) => p.id === PROFILE_ID)?.meals ?? emptyMealAnswers()

  const read = () => {
    const list = parseMealText(text, { date, week: weekStart(date), types: mealTypes(settings) })
    setDrafts(list.map((d) => {
      const problem = foodSafetyProblem([d.name, ...d.ingredients], answers)
      return { ...d, on: !problem, problem }
    }))
  }
  const close = () => {
    setText('')
    setDrafts(null)
    onClose()
  }
  const chosen = drafts?.filter((d) => d.on) ?? []
  const create = async () => {
    for (const d of chosen) await save('meals', { date: d.date, type: d.type, name: d.name, time: d.time, description: '', ingredients: d.ingredients, notes: '', done: false, doneAt: null })
    toast(chosen.length === 1 ? 'Refeição adicionada' : `${chosen.length} refeições adicionadas`)
    close()
  }
  const DAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Colar refeições"
      footer={
        drafts ? (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
            <Button variant="secondary" size="lg" onClick={() => setDrafts(null)}>
              Voltar
            </Button>
            <Button size="lg" disabled={!chosen.length} onClick={create}>
              {chosen.length === 1 ? 'Adicionar 1 refeição' : `Adicionar ${chosen.length} refeições`}
            </Button>
          </div>
        ) : (
          <Button size="lg" block disabled={!text.trim()} onClick={read}>
            Conferir
          </Button>
        )
      }
    >
      {!drafts ? (
        <div className="space-y-2">
          <TextArea aria-label="Refeições, uma por linha" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'07:00 Café da manhã: pão, 2 ovos, café\n12:30 Almoço: arroz, feijão, frango\nJantar: sopa de legumes'} />
          <p className="px-1 text-[13px] text-faint">Uma refeição por linha. Escreva "Segunda", "Terça"… numa linha para mudar de dia. Nada é salvo antes de você conferir.</p>
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {drafts.map((d, i) => (
            <li key={i}>
              <label className="flex items-start gap-3 px-3 py-2.5">
                <input type="checkbox" className="mt-2 size-5 shrink-0 accent-[var(--color-accent)]" checked={d.on} disabled={!!d.problem} onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                <MealTypeIcon type={d.type} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{d.name || typeLabel(settings, d.type) || 'Refeição'}</span>
                  <span className="block text-[13px] text-faint">
                    <span className="num">{[DAY.format(new Date(`${d.date}T12:00:00Z`)).replace('.', ''), d.time].filter(Boolean).join(' · ')}</span>
                    {d.ingredients.length ? ` · ${d.ingredients.join(', ')}` : ''}
                  </span>
                  {d.problem && <span className="mt-0.5 block text-[13px] text-expense">{d.problem}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
