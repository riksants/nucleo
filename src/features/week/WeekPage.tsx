import { CalendarRange, ChevronLeft, ChevronRight, MessageCircleHeart, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { navigate, useRoute } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { addDaysToDate, nowIn, weekStart, zoneOf } from '../../core/period'
import { compareWeeks, headline, summarySentences } from '../../core/weekSummary'
import { goalProgress } from '../../core/weekGoals'
import { useStore } from '../../data/store'
import { formatDateTime } from '../../lib/dates'
import { Button, IconButton } from '../../ui/Button'
import { Badge, Progress, SectionTitle } from '../../ui/Display'
import { CheckinSheet } from './CheckinSheet'
import { ChallengesSection } from './ChallengesSection'
import { weekLabel } from './GoalForm'
import { GoalsSection } from './GoalsSection'
import { PlanWeek } from './PlanWeek'
import { ScoreCard } from './ScoreCard'
import { StreaksSection } from './StreaksSection'
import { useWeek } from './useWeek'

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="num text-[20px] leading-tight font-semibold">{value}</p>
      <p className="truncate text-[12.5px] text-faint">{label}</p>
      {sub && <p className="text-[12px] text-faint">{sub}</p>}
    </div>
  )
}

/**
 * "Semana": the most relevant first (how the week is going), then goals,
 * streaks, challenges, score, planning and check-in. Live numbers come from the
 * records; a closed week shows its snapshot.
 */
export function WeekPage() {
  const { data, settings } = useStore()
  const { params } = useRoute()
  const [anchor, setAnchor] = useState<string | null>(null)
  const [checkin, setCheckin] = useState(false)
  const now = nowIn(zoneOf(settings))
  const w = useWeek(anchor ?? weekStart(now.date))
  const view = params.get('view') === 'plan' ? 'plan' : 'summary'
  const nextWeek = addDaysToDate(w.current, 7)
  const h = headline(w.flat)
  const goals = w.goals.map((g) => goalProgress(g, w.metrics))
  const goalsDone = goals.filter((g) => g.achieved).length
  const sentences = summarySentences(w.flat, { current: w.isCurrent, currency: settings.baseCurrency })
  const comparison = compareWeeks(w.flat, w.prevFlat)
  const checkinDone = data.weekCheckins.some((c) => c.id === w.week)
  // Sunday: a gentle, optional suggestion (no notification).
  const suggestPlan = now.weekday === 0 && w.isCurrent

  if (view === 'plan') {
    return (
      <>
        <PageHeader title="Planejar semana" subtitle={weekLabel(nextWeek)} actions={<Button variant="secondary" onClick={() => navigate('/week')}>Voltar</Button>} />
        <PlanWeek week={nextWeek} currentWeek={w.current} today={w.today} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Semana"
        subtitle={weekLabel(w.week)}
        actions={
          <div className="flex items-center gap-1">
            <IconButton label="Semana anterior" size="sm" onClick={() => setAnchor(addDaysToDate(w.week, -7))}>
              <ChevronLeft size={18} />
            </IconButton>
            <IconButton label="Próxima semana" size="sm" disabled={w.isCurrent} onClick={() => setAnchor(addDaysToDate(w.week, 7) === w.current ? null : addDaysToDate(w.week, 7))}>
              <ChevronRight size={18} />
            </IconButton>
          </div>
        }
      />

      {suggestPlan && (
        <button type="button" onClick={() => navigate('/week', { view: 'plan' })} className="card mb-5 flex w-full items-center gap-3 border-accent/30 p-4 text-left hover:border-accent/50">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent-hi">
            <Sparkles size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">Quer preparar sua próxima semana?</span>
            <span className="text-[13px] text-faint">Tarefas, compromissos, metas e prioridades — leva poucos minutos.</span>
          </span>
          <ChevronRight size={18} className="text-faint" />
        </button>
      )}

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-7">
          <section className="card relative overflow-hidden p-5">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_80%_at_0%_0%,rgb(91_108_255/0.16),transparent_60%)]" aria-hidden />
            <div className="relative">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-medium tracking-wide text-soft uppercase">Sua semana</p>
                {w.snapshot ? <Badge>fechada {formatDateTime(w.snapshot.closedAt).toLowerCase()}</Badge> : !w.isCurrent && !w.closed ? <Badge tone="warn">fecha na terça</Badge> : null}
              </div>
              {h.itemsPercent !== null ? (
                <>
                  <p className="num mt-2 text-[40px] leading-none font-semibold tracking-tight">
                    {h.itemsPercent}%<span className="ml-2 text-[15px] font-normal text-soft">{w.isCurrent ? 'concluída até agora' : 'concluída'}</span>
                  </p>
                  <div className="mt-3">
                    <Progress value={h.itemsPercent} tone="accent" />
                  </div>
                </>
              ) : (
                <p className="mt-2 text-[17px] font-semibold">Ainda sem itens para medir nesta semana</p>
              )}
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {h.habitsTotal > 0 && <Stat label="hábitos" value={`${h.habitsDone}/${h.habitsTotal}`} />}
                {h.tasksTotal > 0 && <Stat label="tarefas com prazo" value={`${h.tasksDone}/${h.tasksTotal}`} />}
                {(h.trainingDone > 0 || h.trainingPlanned > 0) && <Stat label="treinos" value={h.trainingPlanned ? `${h.trainingDone}/${h.trainingPlanned}` : String(h.trainingDone)} />}
                {goals.length > 0 && <Stat label="metas cumpridas" value={`${goalsDone}/${goals.length}`} />}
              </div>
            </div>
          </section>

          <section>
            <SectionTitle>Resumo</SectionTitle>
            {sentences.length ? (
              <div className="card space-y-2 p-5 text-[15px] leading-relaxed">
                {sentences.map((s) => (
                  <p key={s}>{s}</p>
                ))}
                {comparison && <p className="pt-1 text-[14px] text-faint">{comparison}</p>}
              </div>
            ) : (
              <p className="card px-5 py-4 text-[15px] text-faint">Quando você marcar tarefas, hábitos ou rotina, o resumo aparece aqui.</p>
            )}
          </section>

          <GoalsSection week={w.week} currentWeek={w.current} metrics={w.metrics} editable={!w.closed} />
        </div>

        <div className="space-y-7">
          {!settings.hideScore && <ScoreCard overall={w.score.overall} areas={w.score.areas} previous={w.prevOverall} version={w.score.version} details={w.score.live ? Object.fromEntries(Object.entries(w.score.live.areas).map(([k, v]) => [k, v.detail])) : undefined} />}

          {w.isCurrent && <StreaksSection today={w.today} index={w.index} />}
          {w.isCurrent && <ChallengesSection today={w.today} index={w.index} />}

          <section>
            <SectionTitle>Check-in</SectionTitle>
            <button type="button" onClick={() => setCheckin(true)} className="card flex w-full items-center gap-3 p-4 text-left hover:border-line-strong">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-goal/14 text-goal">
                <MessageCircleHeart size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{checkinDone ? 'Check-in feito' : 'Como foi sua semana?'}</span>
                <span className="text-[13px] text-faint">{checkinDone ? 'Toque para rever ou ajustar' : 'Energia, sono, humor… 1 minuto, opcional'}</span>
              </span>
              <ChevronRight size={18} className="text-faint" />
            </button>
          </section>

          {w.isCurrent && (
            <button type="button" onClick={() => navigate('/week', { view: 'plan' })} className="card flex w-full items-center gap-3 p-4 text-left hover:border-line-strong">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent-hi">
                <CalendarRange size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">Planejar a próxima semana</span>
                <span className="text-[13px] text-faint">{weekLabel(nextWeek)}</span>
              </span>
              <ChevronRight size={18} className="text-faint" />
            </button>
          )}
        </div>
      </div>
      <CheckinSheet open={checkin} onClose={() => setCheckin(false)} week={w.week} />
    </>
  )
}
