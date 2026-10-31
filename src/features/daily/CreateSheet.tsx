/**
 * "Criar": one sentence (written or spoken) or the manual buttons. The sentence opens the right form already
 * filled — that form is the confirmation, with the same checks as the manual way. Nothing is saved before it.
 */
import { useEffect, useState } from 'react'
import { isEnabled } from '../../app/modules'
import { navigate } from '../../app/router'
import { dayWords, type CaptureDraft, type CaptureKind } from '../../core/capture'
import { useToday, zoneOf } from '../../core/period'
import { describeRule } from '../../core/recurrence'
import { useStore } from '../../data/store'
import { Button } from '../../ui/Button'
import { Segmented } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { EventForm } from '../agenda/EventForm'
import { HabitForm } from '../habits/HabitForm'
import { RecurringForm } from '../recurring/RecurringForm'
import { TaskForm } from '../tasks/TaskForm'
import { SmartField } from './SmartCapture'

const KIND_LABEL: Record<CaptureKind, string> = { task: 'Tarefa', event: 'Compromisso', habit: 'Hábito', recurring: 'Recorrente' }

function Summary({ draft, today }: { draft: CaptureDraft; today: string }) {
  const bits = [
    draft.date && `${draft.deadline ? 'Até ' : ''}${dayWords(draft.date, today)}`,
    draft.time && (draft.end ? `${draft.time}–${draft.end}` : draft.time),
    draft.rule && describeRule(draft.rule),
    draft.minutes && `${draft.minutes} min`,
  ].filter(Boolean) as string[]
  return (
    <div className="card p-4">
      <p className="text-[17px] font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">{draft.title || 'Sem título'}</p>
      {bits.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {bits.map((b) => (
            <span key={b} className="rounded-full bg-tint/[0.06] px-2.5 py-1 text-[13px] font-medium text-soft first-letter:uppercase">
              {b}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-[13px] text-faint">Sem data ou horário: você completa no próximo passo, se quiser.</p>
      )}
    </div>
  )
}

type Opened = { kind: CaptureKind; draft: CaptureDraft | null } | null

/**
 * "Criar": one sentence (written or spoken) or the manual buttons. The sentence opens the right form already
 * filled — that form is the confirmation. `kinds` limits what is offered (sections that are off are hidden).
 */
export function CreateSheet({ open, onClose, title = 'Criar' }: { open: boolean; onClose(): void; title?: string }) {
  const { settings } = useStore()
  const today = useToday(zoneOf(settings))
  const [draft, setDraft] = useState<CaptureDraft | null>(null)
  const [kind, setKind] = useState<CaptureKind>('task')
  const [form, setForm] = useState<Opened>(null)
  const on = (id: Parameters<typeof isEnabled>[1]) => isEnabled(settings, id)
  const allowed: CaptureKind[] = (['task', 'event', 'habit', 'recurring'] as const).filter((k) => on(k === 'task' ? 'tasks' : k === 'event' ? 'agenda' : k === 'habit' ? 'habits' : 'recurring'))
  useEffect(() => {
    if (!open) setDraft(null)
  }, [open])

  const [last, setLast] = useState<CaptureKind | null>(null)
  const [lastDraft, setLastDraft] = useState<CaptureDraft | null>(null)
  const openForm = (k: CaptureKind, d: CaptureDraft | null) => {
    onClose()
    setLast(k)
    setLastDraft(d)
    setForm({ kind: k, draft: d })
  }
  const closeForm = () => setForm(null)
  // The same fields the manual way fills (kept while the form closes).
  const d = form?.draft ?? lastDraft

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={title}
        footer={
          draft ? (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
              <Button variant="secondary" size="lg" onClick={() => setDraft(null)}>
                Voltar
              </Button>
              <Button size="lg" onClick={() => openForm(kind, draft)}>
                Conferir e criar
              </Button>
            </div>
          ) : undefined
        }
      >
        {!draft ? (
          <div className="space-y-6">
            <div>
              <p className="mb-2 px-1 text-[13px] font-medium text-soft">Escreva ou fale do seu jeito</p>
              <SmartField
                autoFocus
                onDraft={(d) => {
                  setDraft(d)
                  setKind(allowed.includes(d.kind) ? d.kind : (allowed[0] ?? 'task'))
                }}
              />
            </div>
            <div>
              <p className="mb-2 px-1 text-[13px] font-medium text-soft">Ou preencha você mesmo</p>
              <div className="grid grid-cols-2 gap-2">
                {allowed.map((k) => (
                  <button key={k} type="button" onClick={() => openForm(k, null)} className="press flex h-12 items-center justify-center rounded-2xl border border-line bg-surface text-[15px] font-medium hover:border-line-strong">
                    {KIND_LABEL[k]}
                  </button>
                ))}
                {on('notes') && (
                  <button type="button" onClick={() => (onClose(), navigate('/notes', { novo: '1' }))} className="press flex h-12 items-center justify-center rounded-2xl border border-line bg-surface text-[15px] font-medium hover:border-line-strong">
                    Anotação
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Summary draft={draft} today={today} />
            {allowed.length > 1 && (
              <div>
                <p className="mb-2 px-1 text-[13px] font-medium text-soft">Criar como</p>
                <Segmented<CaptureKind> block size="sm" label="Criar como" value={kind} onChange={setKind} options={allowed.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
              </div>
            )}
            <p className="px-1 text-[13px] text-faint">No próximo passo você confere tudo antes de salvar.</p>
          </div>
        )}
      </Sheet>
      {/* Only the form in use is mounted (the last one stays for its closing animation). */}
      {last === 'task' && <TaskForm open={form?.kind === 'task'} onClose={closeForm} task={null} initial={d ? { title: d.title, dueDate: d.date ?? '', dueTime: d.time ?? '' } : undefined} />}
      {last === 'event' && <EventForm open={form?.kind === 'event'} onClose={closeForm} event={null} initial={d ? { title: d.title, date: d.date ?? '', start: d.time ?? '', end: d.end ?? '' } : undefined} />}
      {last === 'habit' && <HabitForm open={form?.kind === 'habit'} onClose={closeForm} habit={null} initial={d ? { name: d.title, rule: d.rule, time: d.time ?? '', minutes: d.minutes } : undefined} />}
      {last === 'recurring' && <RecurringForm open={form?.kind === 'recurring'} onClose={closeForm} item={null} initial={d ? { title: d.title, rule: d.rule, time: d.time ?? '', startDate: d.date } : undefined} />}
    </>
  )
}
