import { AlertTriangle, CalendarClock, Check, Plus, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDailyActions } from '../../core/actions'
import { indexCompletions, routineStatus } from '../../core/completions'
import { todayIn, weekDates, zoneOf } from '../../core/period'
import { DAY_LONG, DAY_SHORT, emptyRoutineAnswers, findConflicts, KIND_LABEL, sortBlocks, WEEKDAYS } from '../../../supabase/functions/_shared/planner/schedule.ts'
import { isTime, toMinutes } from '../../../supabase/functions/_shared/planner/time.ts'
import { navigate } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { newId, useStore } from '../../data/store'
import type { BlockKind, RoutineAnswers, RoutineBlock, RoutinePlan, Weekday } from '../../data/types'
import { toDateInput } from '../../lib/dates'
import { Button, IconButton } from '../../ui/Button'
import { Badge, EmptyState } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, Select, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft, useSheet } from '../../ui/formHooks'
import { Chips } from '../../ui/Segmented'
import { usePlans, ROUTINE_CURRENT, ROUTINE_DRAFT } from './plans'

export const KIND_DOT: Record<BlockKind, string> = {
  work: 'bg-accent',
  study: 'bg-goal',
  commute: 'bg-soft',
  meal: 'bg-warn',
  training: 'bg-income',
  activity: 'bg-accent-hi',
  rest: 'bg-white/30',
  other: 'bg-faint',
}

/** Date ("YYYY-MM-DD") of a weekday in the current week (Monday–Sunday). */
export function dateOfWeekday(day: Weekday, today = new Date()): string {
  const mondayOffset = (today.getDay() + 6) % 7
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset)
  const offset = (day + 6) % 7
  return toDateInput(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset))
}

function BlockSheet({ open, onClose, block, plan, answers }: { open: boolean; onClose(): void; block: RoutineBlock | null; plan: RoutinePlan; answers: RoutineAnswers }) {
  const { save } = useStore()
  const { toast } = useFeedback()
  const [d, set] = useDraft(open, () => ({
    day: String(block?.day ?? 1),
    start: block?.start ?? '19:00',
    end: block?.end ?? '19:30',
    title: block?.title ?? '',
    kind: (block?.kind ?? 'activity') as BlockKind,
  }))

  const submit = async () => {
    if (!d.title.trim()) return 'Dê um nome'
    if (!isTime(d.start) || !isTime(d.end) || toMinutes(d.end) <= toMinutes(d.start)) return 'Confira os horários'
    const next: RoutineBlock = { id: block?.id ?? newId(), day: Number(d.day) as Weekday, start: d.start, end: d.end, title: d.title.trim(), kind: d.kind, fixed: block?.fixed ?? false }
    const blocks = sortBlocks([...plan.blocks.filter((b) => b.id !== next.id), next])
    const clash = findConflicts(blocks, answers).find((c) => c.ids.includes(next.id))
    if (clash) return clash.message
    await save('routinePlans', { ...plan, blocks })
    toast(block ? 'Horário atualizado' : 'Adicionado à rotina')
    onClose()
  }

  const remove = async () => {
    if (!block) return
    await save('routinePlans', { ...plan, blocks: plan.blocks.filter((b) => b.id !== block.id) })
    toast('Removido da rotina')
    onClose()
  }

  return (
    <FormSheet open={open} onClose={onClose} title={block ? 'Editar horário' : 'Novo horário'} onSubmit={submit} onDelete={block ? remove : undefined}>
      <FormGrid>
        <Field label="O quê">
          <TextInput value={d.title} onChange={(e) => set('title', e.target.value)} autoFocus={!block} />
        </Field>
        <div className="half">
          <Field label="Dia">
            <Select value={d.day} onChange={(e) => set('day', e.target.value)}>
              {WEEKDAYS.map((w) => (
                <option key={w} value={w}>
                  {DAY_LONG[w]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="half">
          <Field label="Tipo">
            <Select value={d.kind} onChange={(e) => set('kind', e.target.value as BlockKind)}>
              {(Object.keys(KIND_LABEL) as BlockKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="half">
          <Field label="Início">
            <TextInput type="time" value={d.start} onChange={(e) => set('start', e.target.value)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Fim">
            <TextInput type="time" value={d.end} onChange={(e) => set('end', e.target.value)} />
          </Field>
        </div>
        {block?.fixed && <p className="text-[13px] text-faint">Este horário veio de um compromisso fixo do questionário.</p>}
      </FormGrid>
    </FormSheet>
  )
}

export function DayAgenda({ plan, day, editable, onEdit, answers }: { plan: RoutinePlan; day: Weekday; editable: boolean; onEdit(b: RoutineBlock): void; answers: RoutineAnswers }) {
  const { data, settings } = useStore()
  const { setRoutine } = useDailyActions()
  // "Today" and this week in the person's time zone.
  const today = todayIn(zoneOf(settings))
  const date = weekDates(today)[(day + 6) % 7]
  const blocks = plan.blocks.filter((b) => b.day === day)
  const index = useMemo(() => indexCompletions(data.completions), [data.completions])
  // One record per block per day; marks made before (inside the plan) are still read.
  const isDoneId = (id: string) => routineStatus(index, plan, id, date) === 'done'
  const conflictIds = new Set(findConflicts(plan.blocks, answers).flatMap((c) => c.ids))

  const toggle = (b: RoutineBlock) => setRoutine(plan, b.id, date, !isDoneId(b.id))

  if (!blocks.length) return <p className="card px-4 py-4 text-[15px] text-faint">Nada planejado.</p>
  return (
    <div className="card p-1.5">
      {blocks.map((b) => {
        const isDone = isDoneId(b.id)
        return (
          <div key={b.id} className="flex items-center gap-1 rounded-2xl px-1 hover:bg-white/[0.03] tap">
            {!editable && date <= today ? (
              <button type="button" onClick={() => toggle(b)} aria-label={isDone ? 'Desmarcar' : 'Marcar como feito'} className="grid size-11 shrink-0 place-items-center">
                <span className={`grid size-6 place-items-center rounded-full border-2 ${isDone ? 'border-accent bg-accent text-white' : 'border-white/20'}`}>{isDone && <Check size={14} strokeWidth={3} />}</span>
              </button>
            ) : (
              <span className="grid size-11 shrink-0 place-items-center">
                <span className={`size-2.5 rounded-full ${KIND_DOT[b.kind]}`} />
              </span>
            )}
            <button type="button" onClick={() => onEdit(b)} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 text-left">
              <span className="num w-[92px] shrink-0 text-[14px] text-soft">
                {b.start}–{b.end}
              </span>
              <span className={`min-w-0 flex-1 truncate text-[15px] ${isDone ? 'text-faint line-through' : ''}`}>{b.title}</span>
              {conflictIds.has(b.id) && <AlertTriangle size={16} className="shrink-0 text-expense" />}
              {b.fixed && <span className="shrink-0 text-[11.5px] text-faint">fixo</span>}
            </button>
          </div>
        )
      })}
    </div>
  )
}

function WeekView({ plan, editable, answers, onEdit }: { plan: RoutinePlan; editable: boolean; answers: RoutineAnswers; onEdit(b: RoutineBlock | null): void }) {
  const [day, setDay] = useState<Weekday>(() => new Date().getDay() as Weekday)
  return (
    <>
      <div className="lg:hidden">
        <div className="mb-3">
          <Chips value={String(day)} onChange={(v) => setDay(Number(v) as Weekday)} options={WEEKDAYS.map((d) => ({ value: String(d), label: DAY_SHORT[d] }))} />
        </div>
        <DayAgenda plan={plan} day={day} editable={editable} answers={answers} onEdit={onEdit} />
      </div>
      <div className="hidden gap-3 lg:grid lg:grid-cols-2 xl:grid-cols-3">
        {WEEKDAYS.map((d) => (
          <section key={d}>
            <h3 className="mb-2 px-1 text-[13px] font-medium tracking-wide text-soft uppercase">{DAY_LONG[d]}</h3>
            <DayAgenda plan={plan} day={d} editable={editable} answers={answers} onEdit={onEdit} />
          </section>
        ))}
      </div>
    </>
  )
}

export function RoutinePage() {
  const { save, remove } = useStore()
  const { confirm, toast } = useFeedback()
  const { routine, routineDraft, profile } = usePlans()
  const blockSheet = useSheet<{ block: RoutineBlock | null; plan: RoutinePlan }>()
  const answers = profile?.routine ?? { ...emptyRoutineAnswers(), wakeWeekday: '00:00', sleepWeekday: '00:00', wakeWeekend: '00:00', sleepWeekend: '00:00' }
  const draftConflicts = routineDraft ? findConflicts(routineDraft.blocks, answers) : []

  const approve = async () => {
    if (!routineDraft) return
    if (draftConflicts.length) return toast('Resolva os conflitos antes de aprovar', 'error')
    if (routine) {
      const ok = await confirm({ title: 'Substituir a rotina salva?', message: 'A rotina atual será trocada por esta proposta. As marcações de feito desta semana continuam nos horários que existirem nas duas.', confirmLabel: 'Substituir' })
      if (!ok) return
    }
    await save('routinePlans', { ...routineDraft, id: ROUTINE_CURRENT, status: 'approved', done: routine?.done ?? {}, createdAt: routine?.createdAt ?? routineDraft.createdAt })
    await remove('routinePlans', ROUTINE_DRAFT)
    toast('Rotina salva')
  }

  const discard = async () => {
    const ok = await confirm({ title: 'Descartar a proposta?', message: routine ? 'Sua rotina salva continua igual.' : undefined, confirmLabel: 'Descartar', danger: true })
    if (ok) await remove('routinePlans', ROUTINE_DRAFT)
  }

  return (
    <>
      <PageHeader
        title="Rotina"
        subtitle={routine ? 'Sua semana' : undefined}
        actions={
          <Button variant="secondary" icon={<Sparkles size={17} />} onClick={() => navigate('/planner')}>
            {profile ? 'Refazer' : 'Montar'}
          </Button>
        }
      />

      {routineDraft && (
        <section className="mb-8">
          <div className="card mb-3 space-y-3 border-accent/30 p-4">
            <div className="flex items-center gap-2">
              <Badge tone="accent">{routineDraft.source === 'ai' ? 'Proposta da IA' : 'Rascunho'}</Badge>
              <span className="text-[14px] text-soft">Revise, edite e aprove</span>
            </div>
            {routineDraft.notes && <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-soft">{routineDraft.notes}</p>}
            {draftConflicts.length > 0 && (
              <div className="space-y-1 rounded-2xl bg-expense/10 p-3 text-[14px] text-expense">
                {draftConflicts.map((c, i) => (
                  <p key={i}>{c.message}</p>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={approve} disabled={draftConflicts.length > 0}>
                Aprovar e salvar
              </Button>
              <Button variant="secondary" icon={<Plus size={17} />} onClick={() => blockSheet.show({ block: null, plan: routineDraft })}>
                Horário
              </Button>
              <Button variant="ghost" onClick={discard}>
                Descartar
              </Button>
            </div>
          </div>
          <WeekView plan={routineDraft} editable answers={answers} onEdit={(b) => blockSheet.show({ block: b, plan: routineDraft })} />
        </section>
      )}

      {routine ? (
        <section>
          {routineDraft && <h2 className="mb-3 px-1 text-[13px] font-medium tracking-wide text-soft uppercase">Rotina salva</h2>}
          <div className="mb-3 flex items-center justify-between gap-2 px-1">
            <p className="text-[13px] text-faint">Toque no círculo para marcar como feito</p>
            <IconButton label="Adicionar horário" size="sm" onClick={() => blockSheet.show({ block: null, plan: routine })}>
              <Plus size={18} />
            </IconButton>
          </div>
          <WeekView plan={routine} editable={false} answers={answers} onEdit={(b) => blockSheet.show({ block: b, plan: routine })} />
        </section>
      ) : (
        !routineDraft && (
          <EmptyState
            icon={<CalendarClock size={22} />}
            title="Nenhuma rotina ainda"
            text="Responda algumas perguntas e receba uma agenda semanal que respeita seus horários. Também dá para montar à mão."
            action="Começar"
            onAction={() => navigate('/planner')}
          />
        )
      )}
      {blockSheet.item && <BlockSheet open={blockSheet.open} onClose={blockSheet.close} block={blockSheet.item.block} plan={blockSheet.item.plan.id === ROUTINE_DRAFT ? (routineDraft ?? blockSheet.item.plan) : (routine ?? blockSheet.item.plan)} answers={answers} />}
    </>
  )
}
