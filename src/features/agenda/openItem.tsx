import { navigate } from '../../app/router'
import type { AgendaItem } from '../../core/agenda'
import type { CalendarEvent, Habit, RecurringItem, Task } from '../../data/types'
import { useSheet } from '../../ui/formHooks'
import { HabitForm } from '../habits/HabitForm'
import { RecurringForm } from '../recurring/RecurringForm'
import { TaskForm } from '../tasks/TaskForm'
import { EventForm } from './EventForm'

/** Opens the original record behind an agenda item. */
export function useOpenItem() {
  const task = useSheet<Task>()
  const event = useSheet<CalendarEvent>()
  const habit = useSheet<Habit>()
  const recurring = useSheet<RecurringItem>()
  const open = (item: AgendaItem) => {
    const src = item.source
    if (src.kind === 'task') task.show(src.task)
    else if (src.kind === 'event') event.show(src.event)
    else if (src.kind === 'habit') habit.show(src.habit)
    else if (src.kind === 'recurring') recurring.show(src.item)
    else if (src.kind === 'routine') navigate('/routine')
    else navigate('/meals')
  }
  const sheets = (
    <>
      <TaskForm open={task.open} onClose={task.close} task={task.item} />
      <EventForm open={event.open} onClose={event.close} event={event.item} />
      <HabitForm open={habit.open} onClose={habit.close} habit={habit.item} />
      <RecurringForm open={recurring.open} onClose={recurring.close} item={recurring.item} />
    </>
  )
  return { open, sheets }
}
