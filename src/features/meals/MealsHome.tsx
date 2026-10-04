import { useEffect, useState } from 'react'
import { useRoute } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { useToday, weekStart, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import type { MealEntry, WeekId } from '../../data/types'
import { useSheet } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { AiPlanView } from '../planner/MealsPage'
import { MEALS_DRAFT } from '../planner/plans'
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
  // Links from Search / Agenda: open the meal in its own week.
  useOpenParam(data.meals, (m) => {
    setView('week')
    setWeek(weekStart(m.date))
    meal.show(m)
  })

  return (
    <>
      <PageHeader title="Alimentação" subtitle="Organização das refeições — não é orientação nutricional" />
      <div className="no-scrollbar -mx-5 -mt-1.5 mb-3.5 overflow-x-auto px-5 py-1.5 lg:mx-0 lg:px-0">
        <Segmented<View> size="sm" label="Alimentação" value={view} onChange={setView} options={VIEWS} />
      </div>
      {view === 'week' && <WeekPlanner week={week} onWeek={setWeek} />}
      {view === 'shopping' && <ShoppingList week={week} onWeek={setWeek} />}
      {view === 'plan' && <AiPlanView />}
      <MealForm open={meal.open} onClose={meal.close} meal={meal.item} />
    </>
  )
}
