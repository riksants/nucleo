import { Archive, CalendarClock, Compass, FolderHeart, FolderKanban, Inbox, ListTodo, NotebookPen, Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { isEnabled } from '../../app/modules'
import { PageHeader } from '../../app/Shell'
import { zoneOf, todayIn } from '../../core/period'
import { useStore } from '../../data/store'
import type { CollectionName, InboxItem } from '../../data/types'
import { formatDateTime } from '../../lib/dates'
import { Button } from '../../ui/Button'
import { EmptyState, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { useSheet } from '../../ui/formHooks'
import { Sheet } from '../../ui/Sheet'
import { EventForm } from '../agenda/EventForm'
import { NoteEditor } from '../notes/NotesPage'
import { ProjectForm } from '../projects/ProjectForm'
import { TaskForm } from '../tasks/TaskForm'
import { PlanForm } from '../life/Plans'
import { COLLECTION_LABELS } from '../account/MigrationOffer'
import { useOpenParam } from '../useOpenParam'
import { markOrganized, splitCapture, suggestedDate } from './inbox'
import { CaptureSheet } from './QuickCapture'

type Target = 'task' | 'event' | 'note' | 'project' | 'lifeProject' | 'objective'

function Choice({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint: string; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-15 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03]">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent-hi">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="block text-[13px] text-faint">{hint}</span>
      </span>
    </button>
  )
}

export function InboxPage() {
  const { data, settings, save, remove } = useStore()
  const { toast, confirm } = useFeedback()
  const organize = useSheet<InboxItem>()
  useOpenParam(data.inbox.filter((i) => i.status === 'open'), organize.show)
  const [target, setTarget] = useState<{ type: Target; item: InboxItem } | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const today = todayIn(zoneOf(settings))

  const open = data.inbox.filter((i) => i.status === 'open').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const done = data.inbox.filter((i) => i.status === 'done').sort((a, b) => ((a.processedAt ?? '') < (b.processedAt ?? '') ? 1 : -1))

  const start = (type: Target) => {
    if (!organize.item) return
    setTarget({ type, item: organize.item })
    organize.close()
  }

  /** The original item stays, marked as organized and linked to what it became. */
  const converted = (collection: CollectionName) => (saved: { id: string }) => {
    if (!target) return
    void save('inbox', markOrganized(target.item, { collection, id: saved.id }))
  }

  const archive = async () => {
    if (!organize.item) return
    await save('inbox', markOrganized(organize.item, null))
    organize.close()
    toast('Marcado como organizado')
  }

  const del = async () => {
    const item = organize.item
    if (!item) return
    const ok = await confirm({ title: 'Excluir da caixa de entrada?', message: item.text.slice(0, 120), confirmLabel: 'Excluir', danger: true })
    if (!ok) return
    await remove('inbox', item.id)
    organize.close()
    toast('Item excluído')
  }

  const convertedLabel = (to: { collection: CollectionName; id: string }) => {
    if (to.collection !== 'lifePlans') return COLLECTION_LABELS[to.collection].toLowerCase()
    const plan = data.lifePlans.find((p) => p.id === to.id)
    return plan?.kind === 'objective' ? 'objetivo' : 'projeto pessoal'
  }
  const split = target ? splitCapture(target.item.text) : { title: '', notes: '' }
  const date = target ? suggestedDate(target.item.text, today) : ''
  const close = () => setTarget(null)

  return (
    <>
      <PageHeader
        title="Caixa de entrada"
        subtitle={open.length ? `${open.length} para organizar` : 'Capture rápido, organize depois'}
        actions={
          <Button icon={<Plus size={18} />} onClick={() => setCapturing(true)}>
            Capturar
          </Button>
        }
      />

      {open.length === 0 ? (
        <EmptyState compact={done.length > 0} icon={<Inbox size={22} />} title="Nada para organizar" text="Use o botão + para guardar ideias, lembretes e tarefas sem pensar em onde colocar." />
      ) : (
        <div className="card p-1.5">
          {open.map((item) => (
            <button key={item.id} type="button" onClick={() => organize.show(item)} className="flex w-full items-start gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] leading-snug break-words whitespace-pre-wrap">{item.text}</span>
                <span className="mt-0.5 block text-[13px] text-faint">{formatDateTime(item.createdAt)}</span>
              </span>
              <span className="shrink-0 pt-0.5 text-sm font-medium text-accent-hi">Organizar</span>
            </button>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <section className="mt-7">
          <SectionTitle action={showDone ? 'Esconder' : 'Mostrar'} onAction={() => setShowDone(!showDone)}>
            Organizados · {done.length}
          </SectionTitle>
          {showDone && (
            <div className="card divide-y divide-line">
              {done.slice(0, 30).map((item) => (
                <div key={item.id} className="px-4 py-3">
                  <p className="truncate text-[15px] text-soft">{item.text}</p>
                  <p className="text-[13px] text-faint">{item.convertedTo ? `Virou ${convertedLabel(item.convertedTo)}` : 'Organizado'} · {item.processedAt ? formatDateTime(item.processedAt).toLowerCase() : ''}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <Sheet open={organize.open} onClose={organize.close} title="Organizar">
        {organize.item && <p className="pb-4 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-soft">{organize.item.text}</p>}
        <div className="card divide-y divide-line overflow-hidden">
          {isEnabled(settings, 'tasks') && <Choice icon={<ListTodo size={18} />} label="Tarefa" hint="Vai para Tarefas, com prazo se quiser" onClick={() => start('task')} />}
          <Choice icon={<CalendarClock size={18} />} label="Compromisso" hint="Com data e horário" onClick={() => start('event')} />
          {isEnabled(settings, 'notes') && <Choice icon={<NotebookPen size={18} />} label="Anotação" hint="Vai para Anotações" onClick={() => start('note')} />}
          {isEnabled(settings, 'projects') && <Choice icon={<FolderKanban size={18} />} label="Projeto de trabalho" hint="Abre o formulário de Projetos de trabalho" onClick={() => start('project')} />}
          {isEnabled(settings, 'life') && <Choice icon={<FolderHeart size={18} />} label="Projeto pessoal" hint="Viagem, mudança, reforma… com etapas" onClick={() => start('lifeProject')} />}
          {isEnabled(settings, 'life') && <Choice icon={<Compass size={18} />} label="Objetivo" hint="Algo maior, de médio ou longo prazo" onClick={() => start('objective')} />}
          <Choice icon={<Archive size={18} />} label="Já resolvi" hint="Marca como organizado, sem criar nada" onClick={archive} />
        </div>
        <button type="button" onClick={del} className="mt-4 flex items-center gap-2 px-1 text-[15px] text-expense hover:opacity-80">
          <Trash2 size={16} /> Excluir
        </button>
      </Sheet>

      <TaskForm open={target?.type === 'task'} onClose={close} task={null} initial={{ title: split.title, notes: split.notes, dueDate: date }} onSaved={converted('tasks')} />
      <EventForm open={target?.type === 'event'} onClose={close} event={null} initial={{ title: split.title, notes: split.notes, date }} onSaved={converted('events')} />
      <NoteEditor open={target?.type === 'note'} onClose={close} note={null} initial={{ title: split.notes ? split.title : '', body: split.notes || split.title }} onSaved={converted('notes')} />
      <ProjectForm open={target?.type === 'project'} onClose={close} project={null} initial={{ name: split.title, notes: split.notes }} onSaved={converted('projects')} />
      <PlanForm open={target?.type === 'lifeProject'} onClose={close} kind="project" plan={null} initial={{ title: split.title, notes: split.notes, fromInbox: target?.item.id }} onSaved={converted('lifePlans')} />
      <PlanForm open={target?.type === 'objective'} onClose={close} kind="objective" plan={null} initial={{ title: split.title, notes: split.notes, fromInbox: target?.item.id }} onSaved={converted('lifePlans')} />
      <CaptureSheet open={capturing} onClose={() => setCapturing(false)} />
    </>
  )
}
