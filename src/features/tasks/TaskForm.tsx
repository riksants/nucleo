import { Crosshair } from 'lucide-react'
import { navigate } from '../../app/router'
import { TASK_PRIORITY, TASK_STATUS } from '../../data/labels'
import { Button } from '../../ui/Button'
import { useStore } from '../../data/store'
import type { Task, TaskPriority, TaskStatus } from '../../data/types'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { ProjectSelect } from '../shared/RelationSelect'

export function TaskForm({
  open,
  onClose,
  task,
  defaultProjectId,
  initial,
  onSaved,
}: {
  open: boolean
  onClose(): void
  task: Task | null
  defaultProjectId?: string | null
  /** Prefill for a new task (e.g. converting an inbox item). */
  initial?: { title?: string; notes?: string; dueDate?: string }
  onSaved?(task: Task): void
}) {
  const { save } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const [d, set] = useDraft(open, () => ({
    title: task?.title ?? initial?.title ?? '',
    projectId: task?.projectId ?? defaultProjectId ?? null,
    dueDate: task?.dueDate ?? initial?.dueDate ?? '',
    dueTime: task?.dueTime ?? '',
    priority: task?.priority ?? ('none' as TaskPriority),
    status: task?.status ?? ('todo' as TaskStatus),
    notes: task?.notes ?? initial?.notes ?? '',
  }))

  const submit = async () => {
    if (!d.title.trim()) return 'Escreva o título da tarefa'
    const completedAt = d.status === 'done' ? (task?.completedAt ?? new Date().toISOString()) : null
    const saved = await save('tasks', { ...task, ...d, dueTime: d.dueDate ? d.dueTime : '', title: d.title.trim(), notes: d.notes.trim(), completedAt })
    toast(task ? 'Tarefa atualizada' : 'Tarefa criada')
    onSaved?.(saved)
    onClose()
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={task ? 'Editar tarefa' : 'Nova tarefa'}
      submitLabel={task ? 'Salvar' : 'Criar tarefa'}
      onSubmit={submit}
      onDelete={task ? () => del('tasks', task.id, 'tarefa', { feminine: true, after: onClose }) : undefined}
    >
      <FormGrid>
        {task && task.status !== 'done' && (
          <Button
            variant="secondary"
            icon={<Crosshair size={18} />}
            onClick={() => {
              onClose()
              navigate('/focus', { task: task.id })
            }}
          >
            Focar nesta tarefa
          </Button>
        )}
        <Field label="Título">
          <TextInput value={d.title} onChange={(e) => set('title', e.target.value)} autoFocus={!task} />
        </Field>
        <Field label="Status">
          <Segmented block value={d.status} onChange={(v) => set('status', v)} options={TASK_STATUS} />
        </Field>
        <Field label="Projeto" hint="opcional">
          <ProjectSelect value={d.projectId} onChange={(v) => set('projectId', v)} />
        </Field>
        <div className="half">
          <Field label="Prazo" hint="opcional">
            <TextInput type="date" value={d.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </Field>
        </div>
        {d.dueDate && (
          <div className="half">
            <Field label="Horário" hint="opcional · vira compromisso">
              <TextInput type="time" value={d.dueTime} onChange={(e) => set('dueTime', e.target.value)} />
            </Field>
          </div>
        )}
        <div className="half">
          <Field label="Prioridade">
            <Segmented block size="sm" value={d.priority} onChange={(v) => set('priority', v)} options={TASK_PRIORITY.map((p) => ({ ...p, label: p.value === 'none' ? '—' : p.label }))} />
          </Field>
        </div>
        <Field label="Observações" hint="opcional">
          <TextArea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}
