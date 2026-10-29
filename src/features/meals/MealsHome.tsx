import { Salad } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useRoute } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { mealsOfWeek } from '../../core/meals'
import { useToday, weekStart, zoneOf } from '../../core/period'
import { buildList } from '../../core/shopping'
import { useStore } from '../../data/store'
import type { MealEntry, WeekId } from '../../data/types'
import { useSheet } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { AiPlanView } from '../planner/MealsPage'
import { MEALS_CURRENT, MEALS_DRAFT } from '../planner/plans'
import { useOpenParam } from '../useOpenParam'
import { MealForm } from './MealForm'
import { ShoppingList } from './ShoppingList'
import { WeekPlanner } from './WeekPlanner'

type View = 'week' | 'shopping' | 'plan'
const VIEWS: { value: View; label: string }[] = [
  { value: 'week', label: 'Semana' },
  { value: 'shopping', label: 'Lista de compras' },
  { value: 'plan', label: 'Plano com IA' },
]

/** "Alimentação": Semana · Lista de compras · Plano com IA. Organisation only. */
export function MealsPage() {
  const { data, settings } = useStore()
  const { params } = useRoute()
  const today = useToday(zoneOf(settings))
  const requested = params.get('view') as View | null
  // A pending AI proposal opens where it can be reviewed and approved.
  const hasDraft = data.mealPlans.some((p) => p.id === MEALS_DRAFT)
  const [view, setView] = useState<View>(requested && VIEWS.some((v) => v.value === requested) ? requested : hasDraft ? 'plan' : 'week')
  const [week, setWeek] = useState<WeekId>(weekStart(today))
  const meal = useSheet<MealEntry>()
  useEffect(() => {
    if (requested && VIEWS.some((v) => v.value === requested)) setView(requested)
  }, [requested])
  const weekMeals = useMemo(() => mealsOfWeek(data.meals, week), [data.meals, week])
  const todays = weekMeals.filter((m) => m.date === today)
  const toBuy = useMemo(() => buildList(weekMeals, data.shoppingItems, week).filter((r) => !r.checked).length, [weekMeals, data.shoppingItems, week])
  // Links from Search / Agenda: open the meal in its own week.
  useOpenParam(data.meals, (m) => {
    setView('week')
    setWeek(weekStart(m.date))
    meal.show(m)
  })

  return (
    <>
      <PageHeader
        rich
        icon={Salad}
        eyebrow={hasDraft ? 'Rascunho do plano para revisar' : data.mealPlans.some((p) => p.id === MEALS_CURRENT) ? 'Plano aprovado' : 'Organização das refeições'}
        title="Alimentação"
        stats={[
          { label: 'Hoje', value: todays.length ? `${todays.filter((m) => m.done).length}/${todays.length}` : '—' },
          { label: 'Na semana', value: weekMeals.length },
          { label: 'Para comprar', value: toBuy },
        ]}
      />
      <div className="no-scrollbar -mx-5 -mt-1.5 mb-3.5 overflow-x-auto px-5 py-1.5 lg:mx-0 lg:px-0">
        <Segmented<View> variant="underline" size="sm" label="Alimentação" value={view} onChange={setView} options={VIEWS} />
      </div>
      {view === 'week' && <WeekPlanner week={week} onWeek={setWeek} />}
      {view === 'shopping' && <ShoppingList week={week} onWeek={setWeek} />}
      {view === 'plan' && <AiPlanView />}
      <MealForm open={meal.open} onClose={meal.close} meal={meal.item} />
      {view !== 'plan' && <p className="mt-8 px-1 text-[12px] leading-relaxed text-faint">O Núcleo organiza refeições e compras; não substitui orientação de nutricionista nem de médico.</p>}
    </>
  )
}
