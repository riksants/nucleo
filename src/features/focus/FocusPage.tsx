import { Check, Pause, Play, Square, X } from 'lucide-react'
import { useState } from 'react'
import { navigate, useRoute } from '../../app/router'
import { useDailyActions } from '../../core/actions'
import { sortOpenTasks } from '../../data/selectors'
import { useStore } from '../../data/store'
import { formatDateValue, relativeDays } from '../../lib/dates'
import { Button, IconButton } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { elapsed as elapsedOf, formatClock, pause, resume, start, useFocusTimer } from './timer'

/**
 * One task, nothing else: no tab bar, no lists. The timer is optional and
 * survives leaving the screen; finishing it saves a focus session.
 */
export function FocusPage() {
  const { data, save } = useStore()
  const { params } = useRoute()
  const { completeTask } = useDailyActions()
  const { toast, confirm } = useFeedback()
  const { timer, update, ms } = useFocusTimer()
  const [busy, setBusy] = useState(false)
  const taskId = params.get('task') ?? timer?.taskId ?? null
  const task = data.tasks.find((t) => t.id === taskId) ?? null
  const ownTimer = timer && timer.taskId === (task?.id ?? null) ? timer : null
  const running = ownTimer != null && ownTimer.runningSince !== null

  const finishSession = async () => {
    if (!ownTimer) return
    const minutes = Math.round(ms / 60000)
    if (minutes >= 1) await save('focusSessions', { taskId: ownTimer.taskId, startedAt: ownTimer.startedAt, endedAt: new Date().toISOString(), minutes })
    update(null)
    return minutes
  }

  /** Starting here while another task's timer is saved: that time is recorded first, never dropped. */
  const begin = async () => {
    if (!task) return
    if (timer && timer.taskId !== task.id) {
      const minutes = Math.round(elapsedOf(timer) / 60000)
      if (minutes >= 1) await save('focusSessions', { taskId: timer.taskId, startedAt: timer.startedAt, endedAt: new Date().toISOString(), minutes })
    }
    update(start(task.id))
  }

  const finish = async () => {
    const minutes = await finishSession()
    toast(minutes ? `Sessão de ${minutes} min registrada` : 'Cronômetro zerado')
  }

  const done = async () => {
    if (!task || busy) return
    setBusy(true)
    try {
      await completeTask(task, true)
      await finishSession()
      toast('Tarefa concluída')
      navigate('/today')
    } finally {
      setBusy(false)
    }
  }

  const exit = async () => {
    if (ownTimer && ms > 0) {
      const keep = await confirm({ title: 'Sair do modo foco?', message: 'O cronômetro fica salvo neste aparelho. Ao voltar, ele continua de onde parou.', confirmLabel: 'Sair' })
      if (!keep) return
      if (running) update(pause(ownTimer))
    }
    history.length > 1 ? history.back() : navigate('/')
  }

  if (!task) {
    const open = sortOpenTasks(data.tasks.filter((t) => t.status !== 'done')).slice(0, 12)
    return (
      <div className="flex min-h-dvh flex-col px-6 pt-[calc(env(safe-area-inset-top)+20px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <div className="mx-auto w-full max-w-md">
          <div className="flex h-11 items-center justify-between">
            <h1 className="text-[24px] font-semibold tracking-tight">Modo foco</h1>
            <IconButton label="Sair do modo foco" onClick={() => navigate('/')}>
              <X size={22} />
            </IconButton>
          </div>
          <p className="mt-2 mb-6 text-[15px] text-soft">Escolha uma tarefa para focar.</p>
          {open.length ? (
            <div className="card divide-y divide-line">
              {open.map((t) => (
                <button key={t.id} type="button" onClick={() => navigate('/focus', { task: t.id })} className="block w-full px-4 py-3.5 text-left text-[15.5px] hover:bg-white/[0.03]">
                  {t.title}
                </button>
              ))}
            </div>
          ) : (
            <p className="card px-5 py-4 text-[15px] text-faint">Nenhuma tarefa pendente.</p>
          )}
        </div>
      </div>
    )
  }

  const rel = task.dueDate ? relativeDays(task.dueDate) : null
  return (
    <div className="flex min-h-dvh flex-col px-6 pt-[calc(env(safe-area-inset-top)+20px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex h-11 items-center justify-between">
          <span className="text-[13px] font-medium tracking-[0.08em] text-faint uppercase">Modo foco</span>
          <IconButton label="Sair do modo foco" onClick={exit}>
            <X size={22} />
          </IconButton>
        </div>

        <div className="flex flex-1 flex-col justify-center py-10">
          <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.03em] break-words">{task.title}</h1>
          {(task.dueDate || task.dueTime) && (
            <p className={`mt-2 text-[15px] ${rel && rel.days < 0 ? 'text-expense' : 'text-soft'}`}>
              {task.dueDate ? `Prazo: ${formatDateValue(task.dueDate).toLowerCase()}` : ''}
              {task.dueTime ? ` às ${task.dueTime}` : ''}
              {rel && Math.abs(rel.days) > 1 ? ` · ${rel.label}` : ''}
            </p>
          )}
          {task.notes && <p className="mt-5 text-[16px] leading-relaxed whitespace-pre-wrap text-soft">{task.notes}</p>}

          <div className="mt-12 text-center">
            <p className={`num text-[56px] leading-none font-semibold tracking-[-0.04em] ${ownTimer ? '' : 'text-faint'}`} aria-live="off">
              {formatClock(ownTimer ? ms : 0)}
            </p>
            <div className="mt-6 flex justify-center gap-3">
              {!ownTimer && (
                <Button variant="secondary" size="lg" icon={<Play size={18} />} onClick={begin}>
                  Iniciar
                </Button>
              )}
              {ownTimer && running && (
                <Button variant="secondary" size="lg" icon={<Pause size={18} />} onClick={() => update(pause(ownTimer))}>
                  Pausar
                </Button>
              )}
              {ownTimer && !running && (
                <Button variant="secondary" size="lg" icon={<Play size={18} />} onClick={() => update(resume(ownTimer))}>
                  Continuar
                </Button>
              )}
              {ownTimer && (
                <Button variant="ghost" size="lg" icon={<Square size={16} />} onClick={finish}>
                  Finalizar
                </Button>
              )}
            </div>
            {timer && !ownTimer && <p className="mt-4 text-[13px] text-faint">Há um cronômetro de outra tarefa salvo. Ao iniciar aqui, aquele tempo é registrado como sessão.</p>}
          </div>
        </div>

        <Button size="lg" block icon={<Check size={20} />} onClick={done} disabled={busy || task.status === 'done'}>
          {task.status === 'done' ? 'Tarefa concluída' : 'Concluir tarefa'}
        </Button>
      </div>
    </div>
  )
}
