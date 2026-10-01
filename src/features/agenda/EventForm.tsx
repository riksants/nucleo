import { isTime, toMinutes } from '../../../supabase/functions/_shared/planner/time.ts'
import { useStore } from '../../data/store'
import type { CalendarEvent } from '../../data/types'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft } from '../../ui/formHooks'

const plusHour = (t: string) => {
  if (!isTime(t)) return ''
  const m = Math.min(toMinutes(t) + 60, 23 * 60 + 59)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Appointment with start and end. A time in the past does not mark it as having happened. */
export function EventForm({
  open,
  onClose,
  event,
  initial,
  onSaved,
}: {
  open: boolean
  onClose(): void
  event: CalendarEvent | null
  initial?: { title?: string; notes?: string; date?: string }
  onSaved?(event: CalendarEvent): void
}) {
  const { save } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const [d, set, setAll] = useDraft(open, () => ({
    title: event?.title ?? initial?.title ?? '',
    date: event?.date ?? initial?.date ?? '',
    start: event?.start ?? '',
    end: event?.end ?? '',
    notes: event?.notes ?? initial?.notes ?? '',
  }))

  const submit = async () => {
    if (!d.title.trim()) return 'Dê um nome ao compromisso'
    if (!d.date) return 'Escolha a data'
    if (!isTime(d.start)) return 'Informe o horário de início'
    const end = d.end || plusHour(d.start)
    if (!isTime(end) || toMinutes(end) <= toMinutes(d.start)) return 'O fim precisa ser depois do início'
    const saved = await save('events', { ...event, title: d.title.trim(), date: d.date, start: d.start, end, notes: d.notes.trim() })
    toast(event ? 'Compromisso atualizado' : 'Compromisso criado')
    onSaved?.(saved)
    onClose()
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={event ? 'Editar compromisso' : 'Novo compromisso'}
      submitLabel={event ? 'Salvar' : 'Criar compromisso'}
      onSubmit={submit}
      onDelete={event ? () => del('events', event.id, 'compromisso', { after: onClose }) : undefined}
    >
      <FormGrid>
        <Field label="Título">
          <TextInput value={d.title} onChange={(e) => set('title', e.target.value)} autoFocus={!event && !initial?.title} />
        </Field>
        <Field label="Data">
          <TextInput type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <div className="half">
          <Field label="Início">
            <TextInput type="time" value={d.start} onChange={(e) => setAll((x) => ({ ...x, start: e.target.value, end: x.end && toMinutes(x.end) > toMinutes(e.target.value || '00:00') ? x.end : plusHour(e.target.value) }))} />
          </Field>
        </div>
        <div className="half">
          <Field label="Fim">
            <TextInput type="time" value={d.end} onChange={(e) => set('end', e.target.value)} />
          </Field>
        </div>
        <Field label="Observações" hint="opcional">
          <TextArea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}
