/**
 * Shared pieces of the day (Hoje, Agenda, Rotina): the state chip, the quick
 * confirmation of what already ended, and the day's timeline with a "now" line. Everything reads the original
 * records through AgendaItem; marking here marks the task / habit / routine block itself.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Clock, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { isTime, toMinutes } from '../../../supabase/functions/_shared/planner/time.ts'
import { itemLabel, type AgendaItem } from '../../core/agenda'
import { useDailyActions } from '../../core/actions'
import { addDaysToDate } from '../../core/period'
import { awaitingConfirmation, confirmQuestion, inWords, isMarkable, minutesUntil, nextUp, timeState, TIME_STATE_LABEL, type TimeState } from '../../core/timeState'
import { usePrefersReducedMotion } from '../../lib/hooks'
import { EASE_OUT_SOFT } from '../../lib/motion'
import { usePref } from '../../lib/prefs'
import { dotOf, useToggleItem } from '../agenda/AgendaRow'
import { CheckButton } from './CheckButton'

const CHIP: Record<TimeState, string> = {
  scheduled: 'bg-tint/[0.06] text-soft',
  now: 'bg-accent text-on-accent',
  awaiting: 'bg-warn/[0.14] text-warn',
  done: 'bg-income/[0.14] text-income',
  missed: 'bg-tint/[0.06] text-faint',
  ended: 'bg-tint/[0.06] text-faint',
  anytime: 'bg-tint/[0.06] text-soft',
}

export function StateChip({ state }: { state: TimeState }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold whitespace-nowrap ${CHIP[state]}`}>
      {state === 'now' && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />}
      {state === 'awaiting' ? 'Confirmar' : TIME_STATE_LABEL[state]}
    </span>
  )
}

/** Snoozed confirmations ("Depois"): per device, for an hour. */
function useSnooze() {
  const [map, setMap] = usePref<Record<string, number>>('day.snooze', {})
  const now = Date.now()
  return {
    snoozed: (key: string) => (map[key] ?? 0) > now,
    snooze: (key: string) => setMap(Object.fromEntries([...Object.entries(map).filter(([, until]) => until > now), [key, now + 60 * 60_000]])),
  }
}

/**
 * "Aguardando confirmação": what ended and wasn't marked. One tap each — Concluí / Não fiz / Depois (an hour).
 * Tasks get "Amanhã" instead of "Não fiz" (a task isn't missed, it moves).
 */
export function ConfirmList({ items, today, nowTime }: { items: AgendaItem[]; today: string; nowTime: string }) {
  const toggle = useToggleItem()
  const { moveTask } = useDailyActions()
  const { snoozed, snooze } = useSnooze()
  const reduce = usePrefersReducedMotion()
  const list = awaitingConfirmation(items, today, nowTime).filter((i) => !snoozed(i.key))
  if (!list.length) return null
  return (
    <section aria-label="Aguardando confirmação">
      <h2 className="mb-2 flex items-center gap-2 px-1 text-[15px] font-semibold tracking-[-0.01em]">
        <span aria-hidden className="size-2 rounded-full bg-warn" />
        Aguardando confirmação
        <span className="text-faint">{list.length}</span>
      </h2>
      <div className="card divide-y divide-line">
        <AnimatePresence initial={false}>
          {list.slice(0, 4).map((item) => (
            <motion.div
              key={item.key}
              layout={!reduce}
              initial={false}
              exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0, transition: { duration: 0.2, ease: EASE_OUT_SOFT } }}
              className="overflow-hidden"
            >
              <div className="px-4 py-3.5">
                <p className="flex items-center gap-2 text-[15px] font-semibold">
                  <span className={`size-2 shrink-0 rounded-full ${dotOf(item)}`} />
                  <span className="min-w-0 truncate">{item.title}</span>
                </p>
                <p className="mt-0.5 text-[13px] text-soft">{confirmQuestion(item)}</p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button type="button" onClick={() => toggle(item, 'done')} className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[14px] font-semibold text-on-accent hover:bg-accent-soft">
                    <Check size={16} strokeWidth={2.6} /> Concluí
                  </button>
                  {item.source.kind === 'task' ? (
                    <button type="button" onClick={() => item.source.kind === 'task' && moveTask(item.source.task, addDaysToDate(today, 1))} className="press inline-flex h-9 items-center rounded-full px-3.5 text-[14px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
                      Amanhã
                    </button>
                  ) : (
                    <button type="button" onClick={() => toggle(item, 'skipped')} className="press inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
                      <X size={16} /> Não fiz
                    </button>
                  )}
                  <button type="button" onClick={() => snooze(item.key)} className="press inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-soft hover:text-ink">
                    <Clock size={16} /> Depois
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  )
}

/** The state words of a row: a task past its time is "Atrasada" (it moves); "Não realizado" only when the person says so. */
export function stateWords(item: AgendaItem, state: TimeState): string {
  if (state === 'awaiting' && item.kind === 'task') return 'Atrasada'
  return TIME_STATE_LABEL[state]
}

/** Linked habits riding on a line ("· Estudar ✓"). */
function HabitTags({ item }: { item: AgendaItem }) {
  if (!item.habits?.length) return null
  return (
    <>
      {item.habits.map(({ habit, status }) => (
        <span key={habit.id} className={`inline-flex items-center gap-1 ${status === 'done' ? 'text-income' : ''}`}>
          · {habit.name}
          {status === 'done' && <Check size={14} strokeWidth={2.6} aria-label="hábito feito" />}
        </span>
      ))}
    </>
  )
}

/**
 * One line of the day. The next thing reads "A seguir · em 25 min"; what ended without an answer gets its quick
 * answers right on the line (Concluí · Não fiz / Amanhã), so nothing shows twice on the screen.
 */
function TimelineRow({ item, state, onOpen, last, next, nowTime }: { item: AgendaItem; state: TimeState; onOpen(item: AgendaItem): void; last: boolean; next?: boolean; nowTime: string }) {
  const toggle = useToggleItem()
  const { moveTask } = useDailyActions()
  const muted = state === 'done' || state === 'missed' || state === 'ended'
  const late = state === 'awaiting'
  const until = next && state === 'scheduled' ? minutesUntil(item, nowTime) : null
  return (
    <li className="relative flex gap-3">
      {/* time column + rail */}
      <div className="flex w-12 shrink-0 flex-col items-end pt-3">
        <span className={`num text-[13px] font-medium ${state === 'now' ? 'text-accent-hi' : late ? 'text-warn' : muted ? 'text-faint' : 'text-soft'}`}>{item.start}</span>
      </div>
      <div className="relative flex w-3 shrink-0 justify-center">
        {!last && <span aria-hidden className="absolute top-5 -bottom-1 w-px bg-line" />}
        <span aria-hidden className={`relative mt-[18px] size-2.5 rounded-full ring-4 ring-bg ${state === 'now' ? 'bg-accent' : dotOf(item)} ${muted ? 'opacity-50' : ''}`} />
      </div>
      <div className={`mb-1.5 flex min-w-0 flex-1 flex-wrap items-center gap-x-1 rounded-2xl ${state === 'now' ? 'bg-accent/[0.08] ring-1 ring-accent/25 ring-inset' : next ? 'ring-1 ring-accent/20 ring-inset' : late ? 'bg-warn/[0.05]' : 'hover:bg-tint/[0.03]'}`}>
        <button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 py-2.5 pl-3 text-left">
          <span className={`block truncate text-[15px] ${state === 'now' ? 'font-semibold' : ''} ${muted ? 'text-faint' : ''} ${state === 'done' ? 'line-through' : ''}`}>{item.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-faint">
            {itemLabel(item)}
            {item.end && <span className="num">· até {item.end}</span>}
            {item.source.kind === 'routine' && item.source.block.fixed && <span>· fixo</span>}
            <HabitTags item={item} />
            {until !== null && <span className="font-semibold text-accent-hi">· A seguir, {inWords(until)}</span>}
            {state !== 'scheduled' && state !== 'anytime' && <span className={state === 'now' ? 'font-semibold text-accent-hi' : late ? 'font-semibold text-warn' : ''}>· {stateWords(item, state)}</span>}
          </span>
        </button>
        {isMarkable(item) && <CheckButton status={item.status === 'ended' ? 'pending' : item.status} onClick={() => toggle(item)} label={item.status === 'done' ? `Desmarcar ${item.title}` : `Concluir ${item.title}`} />}
        {late && (
          <div className="flex w-full flex-wrap gap-1.5 px-3 pb-2.5">
            <button type="button" onClick={() => toggle(item, 'done')} className="press inline-flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-[13px] font-semibold text-on-accent hover:bg-accent-soft">
              <Check size={14} strokeWidth={2.6} /> Concluí
            </button>
            {item.source.kind === 'task' ? (
              <button type="button" onClick={() => item.source.kind === 'task' && moveTask(item.source.task, addDaysToDate(item.date, 1))} className="press inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
                Amanhã
              </button>
            ) : (
              <button type="button" onClick={() => toggle(item, 'skipped')} className="press inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
                <X size={14} /> Não fiz
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

type PartId = 'morning' | 'afternoon' | 'night'
const PARTS: { id: PartId; label: string; from: number; to: number }[] = [
  { id: 'morning', label: 'Manhã', from: 0, to: 12 * 60 },
  { id: 'afternoon', label: 'Tarde', from: 12 * 60, to: 18 * 60 },
  { id: 'night', label: 'Noite', from: 18 * 60, to: 24 * 60 },
]

/** Manhã (até 12h) · Tarde (12h–18h) · Noite (18h em diante), by the start time. */
export function partOf(start: string): PartId {
  const m = toMinutes(start)
  return m < 12 * 60 ? 'morning' : m < 18 * 60 ? 'afternoon' : 'night'
}

/**
 * The day as a line: items with a time on a rail, with an "Agora" marker at the current time (today only);
 * with `periods`, split into Manhã · Tarde · Noite (a part of the day already over folds into one line);
 * things without a time under "A qualquer hora"; what is finished folds into "Concluídos".
 */
export function DayTimeline({ items, today, nowTime, onOpen, emptyText = 'Nada com horário neste dia.', periods = false }: { items: AgendaItem[]; today: string; nowTime: string; onOpen(item: AgendaItem): void; emptyText?: string; periods?: boolean }) {
  const nextKey = nextUp(items, today, nowTime)?.key
  const [showDone, setShowDone] = useState(false)
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const date = items[0]?.date
  const states = new Map(items.map((i) => [i.key, timeState(i, today, nowTime)]))
  const finished = (i: AgendaItem) => {
    const s = states.get(i.key)
    return s === 'done' || s === 'missed'
  }
  const timed = items.filter((i) => i.start && !finished(i))
  const untimed = items.filter((i) => !i.start && !finished(i))
  const done = items.filter(finished)
  const nowMin = isTime(nowTime) ? toMinutes(nowTime) : -1
  const isToday = date === today

  const nowLine = (
    <li key="now-line" aria-label={`Agora, ${nowTime}`} className="relative my-1 flex items-center gap-3">
      <span className="num w-12 shrink-0 text-right text-[12px] font-semibold text-accent-hi">{nowTime}</span>
      <span aria-hidden className="relative flex w-3 shrink-0 justify-center">
        <span className="size-2 rounded-full bg-accent" />
      </span>
      <span aria-hidden className="h-px flex-1 bg-accent/60" />
    </li>
  )

  /** One rail; the "Agora" line goes before the first item that starts after now (when `withNow`). */
  const rail = (list: AgendaItem[], withNow: boolean) => {
    const nowIndex = withNow ? list.findIndex((i) => toMinutes(i.start) > nowMin) : -2
    return (
      <ol className="card px-2 pt-2 pb-1">
        {list.map((item, i) => [i === nowIndex && nowLine, <TimelineRow key={item.key} item={item} state={states.get(item.key)!} onOpen={onOpen} last={i === list.length - 1} next={item.key === nextKey} nowTime={nowTime} />])}
        {withNow && nowIndex === -1 && nowLine}
      </ol>
    )
  }

  let timedBlock: ReactNode = null
  if (timed.length && !periods) timedBlock = rail(timed, isToday)
  else if (timed.length) {
    timedBlock = (
      <div className="space-y-4">
        {PARTS.map((p) => {
          const list = timed.filter((i) => partOf(i.start) === p.id)
          const all = items.filter((i) => i.start && partOf(i.start) === p.id)
          if (!all.length) return null
          const over = (date ?? '') < today || (isToday && nowMin >= p.to)
          const current = isToday && nowMin >= p.from && nowMin < p.to
          // A part of the day already over, with nothing waiting for a yes/no, folds into its header.
          const needs = list.some((i) => states.get(i.key) === 'awaiting' || states.get(i.key) === 'now')
          const foldable = over && !needs
          const folded = foldable && !opened[p.id]
          const doneCount = all.filter(finished).length
          return (
            <section key={p.id} aria-label={p.label}>
              <h3 className="mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold">
                <span className={current ? 'text-accent-hi' : 'text-soft'}>{p.label}</span>
                {current && <span className="rounded-full bg-accent/[0.12] px-2 py-0.5 text-[11px] font-semibold text-accent-hi">agora</span>}
                <span className="num font-medium text-faint">
                  {doneCount}/{all.length}
                </span>
                {foldable && (
                  <button type="button" aria-expanded={!folded} onClick={() => setOpened((o) => ({ ...o, [p.id]: !o[p.id] }))} className="hit relative ml-auto flex items-center gap-1 font-medium text-soft hover:text-ink">
                    {folded ? 'Ver' : 'Recolher'}
                    <ChevronDown size={14} className={`transition-transform duration-200 ${folded ? '' : 'rotate-180'}`} />
                  </button>
                )}
              </h3>
              {folded ? null : list.length ? rail(list, current) : <p className="card px-4 py-3 text-[14px] text-faint">Tudo resolvido nesta parte do dia.</p>}
            </section>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {timedBlock ?? (!untimed.length && !done.length && <p className="card px-5 py-4 text-[15px] text-faint">{emptyText}</p>)}

      {untimed.length > 0 && (
        <section aria-label="A qualquer hora">
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-soft">A qualquer hora</h3>
          <ul className="card p-1.5">
            {untimed.map((item) => (
              <UntimedRow key={item.key} item={item} onOpen={onOpen} state={states.get(item.key)!} />
            ))}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <section aria-label="Concluídos">
          <button type="button" aria-expanded={showDone} onClick={() => setShowDone(!showDone)} className="flex w-full items-center gap-2 px-1 text-[13px] font-semibold text-soft hover:text-ink">
            Concluídos e não realizados · {done.length}
            <ChevronDown size={16} className={`transition-transform duration-200 ${showDone ? 'rotate-180' : ''}`} />
          </button>
          {showDone && (
            <ul className="card mt-2 p-1.5">
              {done.map((item) => (
                <UntimedRow key={item.key} item={item} onOpen={onOpen} state={states.get(item.key)!} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function UntimedRow({ item, state, onOpen }: { item: AgendaItem; state: TimeState; onOpen(item: AgendaItem): void }) {
  const toggle = useToggleItem()
  const muted = state === 'done' || state === 'missed'
  return (
    <li className="flex items-center gap-1 rounded-2xl px-1 hover:bg-tint/[0.03] tap">
      {isMarkable(item) ? (
        <CheckButton status={item.status === 'ended' ? 'pending' : item.status} onClick={() => toggle(item)} label={item.status === 'done' ? `Desmarcar ${item.title}` : `Concluir ${item.title}`} />
      ) : (
        <span className="grid size-12 shrink-0 place-items-center">
          <span className={`size-2.5 rounded-full ${dotOf(item)}`} />
        </span>
      )}
      <button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 py-2.5 pr-2 text-left">
        <span className={`block truncate text-[15px] ${muted ? 'text-faint' : ''} ${state === 'done' ? 'line-through' : ''}`}>{item.title}</span>
        <span className="flex items-center gap-1.5 text-[12px] text-faint">
          {item.start && <span className="num">{item.start} ·</span>}
          {itemLabel(item)}
          <HabitTags item={item} />
          {state === 'missed' && ' · não realizado'}
          {state === 'awaiting' && item.kind === 'task' && <span className="font-semibold text-warn">· atrasada</span>}
        </span>
      </button>
    </li>
  )
}
