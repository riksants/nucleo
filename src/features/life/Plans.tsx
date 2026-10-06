import { ArrowDown, ArrowUp, Compass, FolderHeart, ListTodo, MessageCircle, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import { useDailyActions } from '../../core/actions'
import { convertToProject, KIND_LABEL, moveStep, nextOrder, PLAN_STATUS_LABEL, PLAN_TEMPLATES, planProgress, stepDone, stepsOf, suggestSteps, taskMap, templateOf } from '../../core/plans'
import { nowIn, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import type { LifePlan, PlanKind, PlanStatus, PlanStep } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { Button, IconButton } from '../../ui/Button'
import { Badge, EmptyState, Progress } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, Select, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft, useSheet } from '../../ui/formHooks'
import { Chips } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { CheckButton } from '../daily/CheckButton'
import { useOpenParam } from '../useOpenParam'

const STATUS_TONE: Record<PlanStatus, 'neutral' | 'accent' | 'positive' | 'warn'> = { planning: 'neutral', active: 'accent', done: 'positive', paused: 'warn', archived: 'neutral' }
const STATUSES = Object.keys(PLAN_STATUS_LABEL) as PlanStatus[]

export interface PlanInitial {
  title?: string
  notes?: string
  fromInbox?: string
}

/** Create / edit a personal project or objective. */
export function PlanForm({ open, onClose, kind, plan, initial, onSaved }: { open: boolean; onClose(): void; kind: PlanKind; plan: LifePlan | null; initial?: PlanInitial; onSaved?(p: LifePlan): void }) {
  const { save, data, settings } = useStore()
  const { toast } = useFeedback()
  const today = nowIn(zoneOf(settings)).date
  const k = plan?.kind ?? kind
  const hasSteps = plan ? data.planSteps.some((s) => s.planId === plan.id) : false
  const [d, set] = useDraft(open, () => ({
    title: plan?.title ?? initial?.title ?? '',
    description: plan?.description ?? '',
    category: plan?.category ?? '',
    startDate: plan?.startDate ?? (k === 'objective' ? today : ''),
    deadline: plan?.deadline ?? '',
    priority: plan?.priority ?? '',
    status: plan?.status ?? ('planning' as PlanStatus),
    notes: plan?.notes ?? initial?.notes ?? '',
    manual: plan?.manualProgress != null ? String(plan.manualProgress) : '',
  }))

  const submit = async () => {
    if (!d.title.trim()) return k === 'objective' ? 'Dê um título ao objetivo' : 'Dê um nome ao projeto'
    if (d.startDate && d.deadline && d.deadline < d.startDate) return 'O prazo precisa ser depois do início'
    const manual = d.manual.trim() === '' ? null : Number(d.manual.replace(',', '.'))
    if (manual !== null && (!Number.isFinite(manual) || manual < 0 || manual > 100)) return 'Progresso manual vai de 0 a 100'
    const saved = await save('lifePlans', {
      ...plan,
      kind: k,
      title: d.title.trim(),
      description: d.description.trim(),
      category: d.category,
      startDate: d.startDate,
      deadline: d.deadline,
      ...(k === 'objective' && d.priority ? { priority: d.priority as LifePlan['priority'] } : {}),
      status: d.status,
      notes: d.notes.trim(),
      manualProgress: manual,
      ...(initial?.fromInbox && !plan ? { fromInbox: initial.fromInbox } : {}),
    })
    toast(plan ? 'Salvo' : k === 'objective' ? 'Objetivo criado' : 'Projeto pessoal criado')
    onSaved?.(saved)
    onClose()
  }

  const categories = PLAN_TEMPLATES.filter((t) => t.kinds.includes(k))
  return (
    <FormSheet open={open} onClose={onClose} title={plan ? `Editar ${KIND_LABEL[k].one.toLowerCase()}` : k === 'objective' ? 'Novo objetivo' : 'Novo projeto pessoal'} submitLabel={plan ? 'Salvar' : 'Criar'} onSubmit={submit}>
      <FormGrid>
        <Field label={k === 'objective' ? 'Objetivo' : 'Nome'}>
          <TextInput value={d.title} onChange={(e) => set('title', e.target.value)} placeholder={k === 'objective' ? 'Ex.: Aprender inglês' : 'Ex.: Viagem para Itália'} autoFocus={!plan} maxLength={120} />
        </Field>
        <Field label="Descrição" hint="opcional">
          <TextArea value={d.description} onChange={(e) => set('description', e.target.value)} rows={2} />
        </Field>
        <div className="half">
          <Field label="Categoria" hint="opcional">
            <Select value={d.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="half">
          <Field label="Status">
            <Select value={d.status} onChange={(e) => set('status', e.target.value as PlanStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PLAN_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="half">
          <Field label={k === 'objective' ? 'Data inicial' : 'Início'} hint={k === 'objective' ? undefined : 'opcional'}>
            <TextInput type="date" value={d.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Prazo" hint="opcional">
            <TextInput type="date" value={d.deadline} onChange={(e) => set('deadline', e.target.value)} />
          </Field>
        </div>
        {k === 'objective' && (
          <Field label="Prioridade" hint="opcional">
            <Select value={d.priority} onChange={(e) => set('priority', e.target.value)}>
              <option value="">Sem prioridade</option>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
            </Select>
          </Field>
        )}
        {!hasSteps && (
          <Field label="Progresso manual (%)" hint="opcional · só enquanto não houver etapas">
            <TextInput inputMode="numeric" className="num" placeholder="—" value={d.manual} onChange={(e) => set('manual', e.target.value)} />
          </Field>
        )}
        <Field label="Observações" hint="opcional">
          <TextArea value={d.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}

export function ProgressText({ plan }: { plan: LifePlan }) {
  const { data } = useStore()
  const p = planProgress(plan, data.planSteps, data.tasks)
  if (p.source === 'steps') return <>{`${p.done} de ${p.total} ${p.total === 1 ? 'etapa' : 'etapas'} · ${p.percent}%`}</>
  if (p.source === 'manual') return <>{`${p.percent}% · manual`}</>
  return <>Sem etapas ainda</>
}

function StepRow({ step, plan, index, count, done }: { step: PlanStep; plan: LifePlan; index: number; count: number; done: boolean }) {
  const { data, save, remove } = useStore()
  const { completeTask } = useDailyActions()
  const { toast, confirm } = useFeedback()
  const task = step.taskId ? data.tasks.find((t) => t.id === step.taskId) : undefined

  const toggle = async () => {
    // A linked task is the single source of truth for the step's completion.
    if (task) return completeTask(task, !done)
    await save('planSteps', { ...step, status: done ? 'todo' : 'done', doneAt: done ? null : new Date().toISOString() })
  }
  const move = async (dir: -1 | 1) => {
    for (const s of moveStep(data.planSteps, plan.id, step.id, dir)) await save('planSteps', s)
  }
  const toTask = async () => {
    const created = await save('tasks', { title: step.title, projectId: null, dueDate: step.deadline, priority: 'none', status: 'todo', completedAt: null, notes: `${KIND_LABEL[plan.kind].one}: ${plan.title}`, planId: plan.id, stepId: step.id })
    await save('planSteps', { ...step, taskId: created.id })
    toast('Tarefa criada em Tarefas')
  }
  const del = async () => {
    const ok = await confirm({ title: 'Excluir etapa?', message: task ? 'A tarefa vinculada continua em Tarefas.' : 'Essa ação não pode ser desfeita.', confirmLabel: 'Excluir', danger: true })
    if (ok) await remove('planSteps', step.id)
  }

  return (
    <div className="flex items-start gap-1 py-1">
      <CheckButton status={done ? 'done' : 'pending'} onClick={toggle} label={done ? `Reabrir etapa ${step.title}` : `Concluir etapa ${step.title}`} />
      <div className="min-w-0 flex-1 py-2">
        <p className={`text-[15px] leading-snug break-words ${done ? 'text-faint line-through' : ''}`}>{step.title}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-[13px] text-faint">
          {step.deadline && <span>até {formatDateValue(step.deadline).toLowerCase()}</span>}
          {task && (
            <button type="button" onClick={() => navigate('/tasks', { open: task.id })} className="text-accent-hi hover:text-ink">
              tarefa{task.status === 'done' ? ' concluída' : ''}
            </button>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        <IconButton label={`Subir ${step.title}`} size="sm" disabled={index === 0} onClick={() => move(-1)}>
          <ArrowUp size={16} />
        </IconButton>
        <IconButton label={`Descer ${step.title}`} size="sm" disabled={index === count - 1} onClick={() => move(1)}>
          <ArrowDown size={16} />
        </IconButton>
        {!task && !done && (
          <IconButton label={`Virar tarefa: ${step.title}`} size="sm" onClick={toTask}>
            <ListTodo size={16} />
          </IconButton>
        )}
        <IconButton label={`Excluir etapa ${step.title}`} size="sm" className="text-faint hover:text-expense" onClick={del}>
          <Trash2 size={15} />
        </IconButton>
      </div>
    </div>
  )
}

/** Detail of a plan: progress, steps (add, suggest, reorder, finish, to task), status, conversion. */
export function PlanDetail({ plan, open, onClose, onEdit }: { plan: LifePlan | null; open: boolean; onClose(): void; onEdit(p: LifePlan): void }) {
  const { data, save, remove } = useStore()
  const { toast, confirm } = useFeedback()
  const [title, setTitle] = useState('')
  const [deadline, setDeadline] = useState('')
  const [suggest, setSuggest] = useState<string[] | null>(null)
  const [converting, setConverting] = useState<string | null>(null)
  const tasks = useMemo(() => taskMap(data.tasks), [data.tasks])
  if (!plan) return null
  const steps = stepsOf(data.planSteps, plan.id)
  const progress = planProgress(plan, data.planSteps, tasks)

  const addStep = async (t: string, dl = '') => {
    if (!t.trim()) return
    await save('planSteps', { planId: plan.id, title: t.trim().slice(0, 160), deadline: dl, status: 'todo', doneAt: null, order: nextOrder(data.planSteps, plan.id), notes: '', taskId: null })
  }
  const submitStep = async () => {
    await addStep(title, deadline)
    setTitle('')
    setDeadline('')
  }
  const addSuggested = async (chosen: string[]) => {
    let order = nextOrder(data.planSteps, plan.id)
    for (const t of chosen) await save('planSteps', { planId: plan.id, title: t, deadline: '', status: 'todo', doneAt: null, order: order++, notes: '', taskId: null })
    setSuggest(null)
    if (chosen.length) toast(chosen.length === 1 ? 'Etapa adicionada' : `${chosen.length} etapas adicionadas`)
  }
  const del = async () => {
    const ok = await confirm({ title: `Excluir ${KIND_LABEL[plan.kind].one.toLowerCase()}?`, message: 'As etapas são excluídas junto. Tarefas criadas a partir delas continuam em Tarefas.', confirmLabel: 'Excluir', danger: true })
    if (!ok) return
    for (const s of steps) await remove('planSteps', s.id)
    await remove('lifePlans', plan.id)
    onClose()
    toast('Excluído')
  }
  const convert = async () => {
    await save('lifePlans', convertToProject(plan, converting ?? plan.title))
    setConverting(null)
    toast('Agora é um projeto pessoal — etapas e tarefas continuam ligadas')
  }
  const options = suggestSteps(plan, steps)

  return (
    <Sheet open={open} onClose={onClose} title={plan.title}>
      <div className="space-y-5 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[plan.status]}>{PLAN_STATUS_LABEL[plan.status]}</Badge>
          {plan.deadline && <span className="text-[13px] text-faint">prazo {formatDateValue(plan.deadline).toLowerCase()}</span>}
          {plan.category && templateOf(plan.category) && <span className="text-[13px] text-faint">· {templateOf(plan.category)!.label}</span>}
          {plan.convertedFrom === 'objective' && <span className="text-[13px] text-faint">· veio de um objetivo</span>}
        </div>
        {plan.description && <p className="text-[15px] leading-relaxed text-soft">{plan.description}</p>}

        <div>
          <div className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="text-soft">Progresso {progress.source === 'steps' ? '(pelas etapas)' : progress.source === 'manual' ? '(manual)' : ''}</span>
            <span className="num shrink-0 font-medium">
              <ProgressText plan={plan} />
            </span>
          </div>
          {progress.percent !== null && (
            <div className="mt-2">
              <Progress value={progress.percent} tone={progress.percent === 100 ? 'positive' : 'goal'} />
            </div>
          )}
        </div>

        <section>
          <p className="mb-1 text-[13px] font-semibold text-soft">Etapas</p>
          {steps.length ? (
            <div className="card divide-y divide-line px-1">
              {steps.map((s, i) => (
                <StepRow key={s.id} step={s} plan={plan} index={i} count={steps.length} done={stepDone(s, tasks)} />
              ))}
            </div>
          ) : (
            <p className="text-[14px] text-faint">Divida em etapas menores — o progresso passa a ser calculado por elas.</p>
          )}
          <div className="mt-3 flex gap-2">
            <TextInput aria-label="Nova etapa" placeholder="Nova etapa" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submitStep())} />
            <TextInput aria-label="Prazo da nova etapa" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-[9.5rem]! shrink-0" />
            <IconButton label="Adicionar etapa" onClick={submitStep}>
              <Plus size={18} />
            </IconButton>
          </div>
          {options.length > 0 && suggest === null && (
            <button type="button" onClick={() => setSuggest([])} className="mt-3 flex items-center gap-1.5 text-[14px] font-medium text-accent-hi hover:text-ink">
              <MessageCircle size={15} /> Sugerir etapas
            </button>
          )}
          {suggest !== null && (
            <div className="card mt-3 space-y-3 p-4">
              <p className="text-[13px] text-faint">Sugestões para {templateOf(plan.category)?.label.toLowerCase()}. Escolha as que fazem sentido.</p>
              <div className="flex flex-wrap gap-2">
                {options.map((o) => {
                  const on = suggest.includes(o)
                  return (
                    <button key={o} type="button" aria-pressed={on} onClick={() => setSuggest(on ? suggest.filter((x) => x !== o) : [...suggest, o])} className={`press h-9 rounded-full border px-3.5 text-[14px] ${on ? 'border-transparent bg-ink text-bg' : 'border-line bg-surface text-soft hover:text-ink'}`}>
                      {o}
                    </button>
                  )
                })}
              </div>
              <div className="flex gap-2">
                <Button onClick={() => addSuggested(suggest)} disabled={!suggest.length}>
                  Adicionar {suggest.length || ''}
                </Button>
                <Button variant="ghost" onClick={() => setSuggest(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </section>

        {plan.notes && <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-soft">{plan.notes}</p>}

        {plan.kind === 'objective' && (
          <div className="card p-4">
            {converting === null ? (
              <button type="button" onClick={() => setConverting(plan.title)} className="flex w-full items-center gap-2 text-left text-[14px] font-medium text-accent-hi hover:text-ink">
                <FolderHeart size={16} /> Transformar em projeto pessoal
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-[13px] leading-relaxed text-faint">O mesmo registro vira projeto pessoal: etapas, tarefas, datas e progresso continuam iguais.</p>
                <TextInput aria-label="Nome do projeto pessoal" value={converting} onChange={(e) => setConverting(e.target.value)} />
                <div className="flex gap-2">
                  <Button onClick={convert}>Transformar</Button>
                  <Button variant="ghost" onClick={() => setConverting(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onEdit(plan)}>
            Editar
          </Button>
          {plan.status !== 'done' && (
            <Button variant="secondary" onClick={() => save('lifePlans', { ...plan, status: 'done' })}>
              Concluir
            </Button>
          )}
          <Button variant="ghost" onClick={() => save('lifePlans', { ...plan, status: plan.status === 'archived' ? 'planning' : 'archived' })}>
            {plan.status === 'archived' ? 'Desarquivar' : 'Arquivar'}
          </Button>
          <Button variant="ghost" className="text-expense!" onClick={del}>
            Excluir
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

type Filter = 'open' | 'done' | 'archived'

/** List of personal projects or objectives. */
export function PlansView({ kind }: { kind: PlanKind }) {
  const { data, settings } = useStore()
  const [filter, setFilter] = useState<Filter>('open')
  const form = useSheet<LifePlan>()
  const detail = useSheet<string>()
  useOpenParam(
    data.lifePlans.filter((p) => p.kind === kind),
    (p) => detail.show(p.id),
  )
  const today = nowIn(zoneOf(settings)).date
  const all = data.lifePlans.filter((p) => p.kind === kind)
  const test = (p: LifePlan) => (filter === 'open' ? p.status !== 'done' && p.status !== 'archived' : p.status === filter)
  const list = all.filter(test).sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.title.localeCompare(b.title))
  const open = data.lifePlans.find((p) => p.id === detail.item) ?? null

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Chips<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Em aberto' },
            { value: 'done', label: 'Concluídos' },
            { value: 'archived', label: 'Arquivados' },
          ]}
        />
        <Button icon={<Plus size={18} />} onClick={() => form.show()}>
          {kind === 'objective' ? 'Novo objetivo' : 'Novo projeto'}
        </Button>
      </div>
      {list.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((p) => {
            const pr = planProgress(p, data.planSteps, data.tasks)
            const late = p.deadline && p.deadline < today && p.status !== 'done'
            return (
              <button key={p.id} type="button" onClick={() => detail.show(p.id)} className="card press block w-full p-4 text-left hover:border-line-strong">
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-[16px] leading-snug font-semibold break-words">{p.title}</span>
                  <Badge tone={STATUS_TONE[p.status]}>{PLAN_STATUS_LABEL[p.status]}</Badge>
                </span>
                <span className="mt-1 block text-[13px] text-faint">
                  <ProgressText plan={p} />
                  {p.deadline ? ` · ${late ? 'prazo era' : 'prazo'} ${formatDateValue(p.deadline).toLowerCase()}` : ''}
                </span>
                {pr.percent !== null && (
                  <span className="mt-2.5 block">
                    <Progress value={pr.percent} tone={pr.percent === 100 ? 'positive' : 'goal'} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <EmptyState
          icon={kind === 'objective' ? <Compass size={22} /> : <FolderHeart size={22} />}
          title={all.length ? 'Nada neste filtro' : kind === 'objective' ? 'Nenhum objetivo ainda' : 'Nenhum projeto pessoal ainda'}
          text={all.length ? 'Tente outro filtro.' : kind === 'objective' ? 'Coisas maiores, de médio ou longo prazo — como aprender inglês ou comprar a casa. Divida em etapas.' : 'Viagem, mudança, reforma, estudar para uma prova… com etapas e tarefas.'}
          action={all.length ? undefined : kind === 'objective' ? 'Criar objetivo' : 'Criar projeto'}
          onAction={all.length ? undefined : () => form.show()}
        />
      )}
      <PlanDetail
        plan={open}
        open={detail.open && open !== null}
        onClose={detail.close}
        onEdit={(p) => {
          detail.close()
          form.show(p)
        }}
      />
      <PlanForm open={form.open} onClose={form.close} kind={kind} plan={form.item} />
    </>
  )
}
