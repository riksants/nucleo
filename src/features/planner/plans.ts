import { emptyMealAnswers } from '../../../supabase/functions/_shared/planner/foodSafety.ts'
import { emptyRoutineAnswers } from '../../../supabase/functions/_shared/planner/schedule.ts'
import { useStore } from '../../data/store'
import type { MealPlan, PlannerMode, PlannerProfile, RoutinePlan } from '../../data/types'

/** One questionnaire, one saved plan and at most one draft per kind. */
export const PROFILE_ID = 'planner-profile'
export const ROUTINE_CURRENT = 'routine-current'
export const ROUTINE_DRAFT = 'routine-draft'
export const MEALS_CURRENT = 'meals-current'
export const MEALS_DRAFT = 'meals-draft'

export function defaultProfile(mode: PlannerMode = 'both'): Omit<PlannerProfile, 'createdAt' | 'updatedAt'> {
  return { id: PROFILE_ID, mode, routine: emptyRoutineAnswers(), meals: emptyMealAnswers() }
}

export function usePlans() {
  const { data } = useStore()
  const byId = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id) ?? null
  return {
    profile: byId(data.plannerProfiles, PROFILE_ID),
    routine: byId(data.routinePlans, ROUTINE_CURRENT) as RoutinePlan | null,
    routineDraft: byId(data.routinePlans, ROUTINE_DRAFT) as RoutinePlan | null,
    meals: byId(data.mealPlans, MEALS_CURRENT) as MealPlan | null,
    mealsDraft: byId(data.mealPlans, MEALS_DRAFT) as MealPlan | null,
  }
}
