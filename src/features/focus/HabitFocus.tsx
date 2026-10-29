import { Check, Pause, Play, Square, X } from 'lucide-react'
import { useState } from 'react'
import { navigate } from '../../app/router'
import { useDailyActions } from '../../core/actions'
import { statusOf, indexCompletions } from '../../core/completions'
import { sessionReachesGoal } from '../../core/habitProgress'
import { todayIn, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import type { Habit } from '../../data/types'
import { Button, IconButton } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { elapsed as elapsedOf, formatClock, pause, resume, start, useFocusTimer } from './timer'

/**
 * A habit session ("Estudar inglês · 30 min"). The timer is the evidence: reaching the habit's length marks the
 * day as done by itself; a shorter session is saved as time and the person decides (never assumed).
 */
export function HabitFocus({ habit }: { habit: Habit }) {
  const { data, save, settings } = useStore()
  const { setCompletion } = useDailyActions()
  const { toast, confirm } = useFeedback()
  const { timer, update, ms } = useFocusTimer()
  const [short, setShort] = useState<number | null>(null)
  const today = todayIn(zoneOf(settings))
  const own = timer && timer.habitId === habit.id ? timer : null
  const running = own != null && own.runningSince !== null
  const goalMs = (habit.minutes ?? 0) * 60_000
  const pct = goalMs ? Math.min(1, (own ? ms : 0) / goalMs) : 0
  const doneToday = statusOf(indexCompletions(data.completions), 'habit', habit.id, today) === 'done'

  const record = async (t: NonNullable<typeof timer>) => {
    const minutes = Math.round(elapsedOf(t) / 60000)
    if (minutes >= 1) await save('focusSessions', { taskId: t.taskId, habitId: t.habitId ?? null, startedAt: t.startedAt, endedAt: new Date().toISOString(), minutes })
    return minutes
  }

  const begin = async () => {
    // Another timer saved on this device: its time is recorded first, never dropped.
    if (timer && !own) await record(timer)
    update(start(null, Date.now(), habit.id))
  }

  const finish = async () => {
    if (!own) return
    const minutes = await record(own)
    update(null)
    if (sessionReachesGoal(habit, minutes)) {
      await setCompletion('habit', habit.id, today, 'done')
      toast(`Meta de ${habit.minutes} min atingida: ${habit.name} feito hoje`)
      navigate('/habits')
    } else {
      setShort(minutes)
      toast(minutes ? `Sessão de ${minutes} min registrada` : 'Cronômetro zerado')
    }
  }

  const exit = async () => {
    if (own && ms > 0) {
      const ok = await confirm({ title: 'Sair da sessão?', message: 'O cronômetro fica salvo neste aparelho e continua de onde parou quando você voltar.', confirmLabel: 'Sair' })
      if (!ok) return
      if (running) update(pause(own))
    }
    history.length > 1 ? history.back() : navigate('/habits')
  }

  const R = 92
  const C = 2 * Math.PI * R
  return (
    <div className="flex min-h-dvh flex-col px-6 pt-[calc(env(safe-area-inset-top)+20px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex h-11 items-center justify-between">
          <span className="text-[13px] font-semibold text-faint">Sessão de hábito</span>
          <IconButton label="Sair da sessão" onClick={exit}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.03em] break-words">{habit.name}</h1>
          <p className="mt-1.5 text-[15px] text-soft">{habit.minutes ? `Meta: ${habit.minutes} min${habit.goal ? ` · ${habit.goal}` : ''}` : habit.goal || 'Sem duração definida'}</p>
          <div className="relative mt-10 grid size-56 place-items-center">
            {goalMs > 0 && (
              <svg viewBox="0 0 200 200" className="absolute inset-0 -rotate-90" aria-hidden>
                <circle cx="100" cy="100" r={R} fill="none" stroke="var(--color-line)" strokeWidth="8" />
                <circle cx="100" cy="100" r={R} fill="none" stroke="var(--color-accent)" strokeWidth="8" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} className="transition-[stroke-dashoffset] duration-700 ease-linear" />
              </svg>
            )}
            <div>
              <p className={`num text-[48px] leading-none font-semibold tracking-[-0.04em] ${own ? '' : 'text-faint'}`}>{formatClock(own ? ms : 0)}</p>
              {goalMs > 0 && own && <p className="mt-2 text-[13px] text-soft">{pct >= 1 ? 'Meta atingida' : `faltam ${Math.ceil((goalMs - ms) / 60000)} min`}</p>}
            </div>
          </div>
          <div className="mt-8 flex justify-center gap-3">
            {!own && (
              <Button size="lg" icon={<Play size={18} />} onClick={begin}>
                Iniciar
              </Button>
            )}
            {own && running && (
              <Button variant="secondary" size="lg" icon={<Pause size={18} />} onClick={() => update(pause(own))}>
                Pausar
              </Button>
            )}
            {own && !running && (
              <Button variant="secondary" size="lg" icon={<Play size={18} />} onClick={() => update(resume(own))}>
                Continuar
              </Button>
            )}
            {own && (
              <Button variant={pct >= 1 ? 'primary' : 'ghost'} size="lg" icon={<Square size={16} />} onClick={finish}>
                Finalizar
              </Button>
            )}
          </div>
          {habit.minutes ? (
            <p className="mt-5 max-w-72 text-[13px] leading-relaxed text-faint">Ao finalizar com {habit.minutes} min ou mais, o Núcleo marca o hábito de hoje como feito.</p>
          ) : (
            <p className="mt-5 max-w-72 text-[13px] leading-relaxed text-faint">Defina uma duração no hábito para o Núcleo marcar o dia sozinho ao atingir.</p>
          )}
          {timer && !own && <p className="mt-3 text-[13px] text-faint">Há outro cronômetro salvo. Ao iniciar aqui, aquele tempo é registrado como sessão.</p>}
        </div>
        {short !== null && !doneToday && (
          <div className="card mb-3 p-4 text-left">
            <p className="text-[15px] font-medium">{short ? `Você fez ${short} min${habit.minutes ? ` de ${habit.minutes}` : ''}.` : 'Sessão sem tempo registrado.'} Conta como feito hoje?</p>
            <div className="mt-3 flex gap-2">
              <Button
                onClick={async () => {
                  await setCompletion('habit', habit.id, today, 'done')
                  toast(`${habit.name}: feito hoje`)
                  navigate('/habits')
                }}
              >
                Sim, marcar
              </Button>
              <Button variant="ghost" onClick={() => setShort(null)}>
                Não
              </Button>
            </div>
          </div>
        )}
        <Button
          size="lg"
          block
          variant={doneToday ? 'secondary' : 'primary'}
          icon={<Check size={20} />}
          disabled={doneToday}
          onClick={async () => {
            await setCompletion('habit', habit.id, today, 'done')
            if (own) {
              await record(own)
              update(null)
            }
            toast(`${habit.name}: feito hoje`)
            navigate('/habits')
          }}
        >
          {doneToday ? 'Feito hoje' : 'Marcar como feito'}
        </Button>
      </div>
    </div>
  )
}
