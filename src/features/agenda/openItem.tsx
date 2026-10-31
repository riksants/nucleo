import { navigate } from '../../app/router'
import type { AgendaItem } from '../../core/agenda'
import type { CalendarEvent, Habit, MealEntry, RecurringItem, Task } from '../../data/types'
import { MealForm } from '../meals/MealForm'
import { useSheet } from '../../ui/formHooks'
import { HabitForm } from '../habits/HabitForm'
import { RecurringForm } from '../recurring/RecurringForm'
import { TaskForm } from '../tasks/TaskForm'
import { EventForm } from './EventForm'
import { ItemSheet } from '../daily/ItemSheet'

/**
 * Tapping an item of the day: its details and quick actions first (ItemSheet); "Editar" there opens the
 * original record's form. `edit` skips the details.
 */
export function useOpenItem() {
  const details = useSheet<AgendaItem>()
  const task = useSheet<Task>()
  const event = useSheet<CalendarEvent>()
  const habit = useSheet<Habit>()
  const recurring = useSheet<RecurringItem>()
  const meal = useSheet<MealEntry>()
  const edit = (item: AgendaItem) => {
    const src = item.source
    if (src.kind === 'task') task.show(src.task)
    else if (src.kind === 'event') event.show(src.event)
    else if (src.kind === 'habit') habit.show(src.habit)
    else if (src.kind === 'recurring') recurring.show(src.item)
    else if (src.kind === 'mealEntry') meal.show(src.meal)
    else if (src.kind === 'routine') navigate('/routine')
    else navigate('/meals')
  }
  const open = (item: AgendaItem) => details.show(item)
  // Each sheet mounts the first time it is used (and stays, for its closing animation): screens open lighter.
  const sheets = (
    <>
      {details.item && <ItemSheet item={details.item} open={details.open} onClose={details.close} onEdit={edit} />}
      {task.item && <TaskForm open={task.open} onClose={task.close} task={task.item} />}
      {event.item && <EventForm open={event.open} onClose={event.close} event={event.item} />}
      {habit.item && <HabitForm open={habit.open} onClose={habit.close} habit={habit.item} />}
      {recurring.item && <RecurringForm open={recurring.open} onClose={recurring.close} item={recurring.item} />}
      {meal.item && <MealForm open={meal.open} onClose={meal.close} meal={meal.item} />}
    </>
  )
  return { open, edit, sheets }
}
