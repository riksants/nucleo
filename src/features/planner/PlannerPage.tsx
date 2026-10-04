import { AlertTriangle, ArrowLeft, CalendarClock, Plus, Salad, ShieldCheck, Sparkles, Stethoscope, Trash2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { ALLERGENS, INTOLERANCES, RESTRICTIONS, sanitizeMealPlan } from '../../../supabase/functions/_shared/planner/foodSafety.ts'
import { feasibility, fixedBlocks, mergeProposal, newActivity, newCommitment, newTraining } from '../../../supabase/functions/_shared/planner/schedule.ts'
import { isTime } from '../../../supabase/functions/_shared/planner/time.ts'
import { navigate } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { useStore } from '../../data/store'
import type { Commitment, MealAnswers, PlannedMeal, PlannerMode, PlannerProfile, RoutineAnswers, Training, WishActivity } from '../../data/types'
import { Button, IconButton } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { Field, Select, TextArea, TextInput } from '../../ui/Field'
import { Segmented } from '../../ui/Segmented'
import { useSession } from '../account/session'
import { newRequestId, PlannerError, requestPlan } from './api'
import { ChipSelect, DayPicker, NumberInput, TimeInput, ToggleRow } from './controls'
import { defaultProfile, MEALS_DRAFT, PROFILE_ID, ROUTINE_DRAFT, usePlans } from './plans'

type Step = 'sleep' | 'commitments' | 'trainings' | 'activities' | 'rest' | 'goal' | 'allergies' | 'prefs' | 'kitchen' | 'times' | 'health' | 'review'

const ROUTINE_STEPS: Step[] = ['sleep', 'commitments', 'trainings', 'activities', 'rest']
const MEAL_STEPS: Step[] = ['goal', 'allergies', 'prefs', 'kitchen', 'times', 'health']

const STEP_TITLE: Record<Step, string> = {
  sleep: 'Quando você acorda e dorme?',
  commitments: 'Trabalho, estudo e compromissos fixos',
  trainings: 'Treinos e esportes',
  activities: 'O que você quer encaixar na semana?',
  rest: 'Descanso, intervalos e objetivos',
  goal: 'Seu objetivo com a alimentação',
  allergies: 'Alergias, intolerâncias e restrições',
  prefs: 'Gostos e o que você não come',
  kitchen: 'Orçamento e cozinha',
  times: 'Horários das refeições',
  health: 'Uma pergunta de saúde',
  review: 'Revisar e gerar',
}

export function stepsFor(mode: PlannerMode): Step[] {
  if (mode === 'routine') return [...ROUTINE_STEPS, 'review']
  if (mode === 'meals') return [...MEAL_STEPS, 'review']
  return [...ROUTINE_STEPS, ...MEAL_STEPS, 'review']
}

/** In the combined mode, meal times come from the routine (wake, lunch break, arrival, bedtime). */
export function suggestMealTimes(r: RoutineAnswers, count: number): string[] {
  const lunch = r.commitments.find((c) => isTime(c.breakStart))?.breakStart ?? '12:30'
  const arrive = r.commitments.find((c) => isTime(c.arriveAt))?.arriveAt
  const wake = isTime(r.wakeWeekday) ? r.wakeWeekday : '07:00'
  const plus = (t: string, min: number) => {
    const [h, m] = t.split(':').map(Number)
    const v = Math.min(23 * 60 + 30, h * 60 + m + min)
    return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
  }
  const dinner = arrive ? plus(arrive, 60) : '20:00'
  const base = [plus(wake, 30), lunch, arrive ?? '16:00', dinner]
  if (count <= 2) return [lunch, dinner]
  if (count === 3) return [plus(wake, 30), lunch, dinner]
  if (count === 5) return [plus(wake, 30), plus(wake, 180), lunch, arrive ?? '16:00', dinner]
  if (count >= 6) return [plus(wake, 30), plus(wake, 180), lunch, arrive ?? '16:00', dinner, plus(dinner, 120)]
  return base
}

function Card({ title, onRemove, children }: { title: string; onRemove(): void; children: ReactNode }) {
  return (
    <div className="card space-y-4 p-4">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</p>
        <IconButton label="Remover" size="sm" onClick={onRemove}>
          <Trash2 size={16} />
        </IconButton>
      </div>
      {children}
    </div>
  )
}

function CommitmentEditor({ c, onChange, onRemove }: { c: Commitment; onChange(c: Commitment): void; onRemove(): void }) {
  const set = <K extends keyof Commitment>(k: K, v: Commitment[K]) => onChange({ ...c, [k]: v })
  return (
    <Card title={c.title || 'Compromisso'} onRemove={onRemove}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome">
          <TextInput value={c.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Tipo">
          <Select value={c.kind} onChange={(e) => set('kind', e.target.value as Commitment['kind'])}>
            <option value="work">Trabalho</option>
            <option value="study">Estudo</option>
            <option value="other">Outro</option>
          </Select>
        </Field>
      </div>
      <Field label="Dias">
        <DayPicker value={c.days} onChange={(v) => set('days', v)} />
      </Field>
      <ToggleRow checked={c.away} onChange={(v) => set('away', v)} hint="Inclui o deslocamento de ida e volta">
        Fora de casa
      </ToggleRow>
      {c.away && (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Sai de casa">
            <TimeInput label="Sai de casa" value={c.leaveAt} onChange={(v) => set('leaveAt', v)} />
          </Field>
          <Field label="Chega em casa">
            <TimeInput label="Chega em casa" value={c.arriveAt} onChange={(v) => set('arriveAt', v)} />
          </Field>
          <Field label="Trajeto">
            <NumberInput label="Minutos de trajeto" value={c.commuteMin} onChange={(v) => set('commuteMin', v)} max={300} suffix="min" />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Começa" hint={c.away ? 'opcional' : undefined}>
          <TimeInput label="Começa" value={c.start} onChange={(v) => set('start', v)} />
        </Field>
        <Field label="Termina" hint={c.away ? 'opcional' : undefined}>
          <TimeInput label="Termina" value={c.end} onChange={(v) => set('end', v)} />
        </Field>
        <Field label="Almoço/pausa de">
          <TimeInput label="Pausa começa" value={c.breakStart} onChange={(v) => set('breakStart', v)} />
        </Field>
        <Field label="até">
          <TimeInput label="Pausa termina" value={c.breakEnd} onChange={(v) => set('breakEnd', v)} />
        </Field>
      </div>
      <ToggleRow checked={c.fixed} onChange={(v) => set('fixed', v)} hint="Desligue se o horário pode mudar">
        Horário fixo
      </ToggleRow>
    </Card>
  )
}

function TrainingEditor({ t, onChange, onRemove }: { t: Training; onChange(t: Training): void; onRemove(): void }) {
  const set = <K extends keyof Training>(k: K, v: Training[K]) => onChange({ ...t, [k]: v })
  return (
    <Card title={t.modality || 'Treino'} onRemove={onRemove}>
      <Field label="Modalidade">
        <TextInput value={t.modality} placeholder="Ex.: Musculação, jiu-jitsu, corrida" onChange={(e) => set('modality', e.target.value)} />
      </Field>
      <Field label="Dias">
        <DayPicker value={t.days} onChange={(v) => set('days', v)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Horário">
          <TimeInput label="Horário do treino" value={t.start} onChange={(v) => set('start', v)} />
        </Field>
        <Field label="Duração">
          <NumberInput label="Duração do treino" value={t.durationMin} onChange={(v) => set('durationMin', v)} max={600} suffix="min" />
        </Field>
      </div>
      <ToggleRow checked={t.away} onChange={(v) => set('away', v)}>
        Fora de casa
      </ToggleRow>
      {t.away && (
        <Field label="Trajeto (cada sentido)">
          <NumberInput label="Trajeto do treino" value={t.commuteMin} onChange={(v) => set('commuteMin', v)} max={300} suffix="min" />
        </Field>
      )}
      <ToggleRow checked={t.fixed} onChange={(v) => set('fixed', v)}>
        Horário fixo
      </ToggleRow>
    </Card>
  )
}

function ActivityEditor({ a, onChange, onRemove }: { a: WishActivity; onChange(a: WishActivity): void; onRemove(): void }) {
  const set = <K extends keyof WishActivity>(k: K, v: WishActivity[K]) => onChange({ ...a, [k]: v })
  return (
    <Card title={a.name || 'Atividade'} onRemove={onRemove}>
      <Field label="Atividade">
        <TextInput value={a.name} placeholder="Ex.: Leitura, inglês, caminhada" onChange={(e) => set('name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vezes por semana">
          <NumberInput label="Vezes por semana" value={a.timesPerWeek} onChange={(v) => set('timesPerWeek', v)} min={1} max={14} suffix="×" />
        </Field>
        <Field label="Duração">
          <NumberInput label="Duração" value={a.durationMin} onChange={(v) => set('durationMin', v)} min={5} max={600} suffix="min" />
        </Field>
      </div>
      <Field label="Período preferido">
        <Segmented block size="sm" value={a.period} onChange={(v) => set('period', v)} options={[{ value: 'any', label: 'Tanto faz' }, { value: 'morning', label: 'Manhã' }, { value: 'afternoon', label: 'Tarde' }, { value: 'evening', label: 'Noite' }]} />
      </Field>
      <Field label="Prioridade">
        <Segmented block size="sm" value={a.priority} onChange={(v) => set('priority', v)} options={[{ value: 'high', label: 'Alta' }, { value: 'medium', label: 'Média' }, { value: 'low', label: 'Baixa' }]} />
      </Field>
    </Card>
  )
}

function ModeChoice({ onPick }: { onPick(mode: PlannerMode): void }) {
  const options: { mode: PlannerMode; title: string; text: string; icon: ReactNode }[] = [
    { mode: 'routine', title: 'Só rotina', text: 'Agenda semanal com seus horários e atividades', icon: <CalendarClock size={22} /> },
    { mode: 'meals', title: 'Só alimentação', text: 'Refeições da semana e lista de compras', icon: <Salad size={22} /> },
    { mode: 'both', title: 'Rotina + alimentação', text: 'As refeições se encaixam na sua rotina', icon: <Sparkles size={22} /> },
  ]
  return (
    <div className="space-y-3">
      {options.map((o) => (
        <button key={o.mode} type="button" onClick={() => onPick(o.mode)} className="card press flex w-full items-center gap-4 p-5 text-left hover:border-line-strong">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent-hi">{o.icon}</span>
          <span>
            <span className="block text-[17px] font-semibold tracking-tight">{o.title}</span>
            <span className="text-[14px] text-soft">{o.text}</span>
          </span>
        </button>
      ))}
      <p className="px-1 text-[13px] leading-relaxed text-faint">Você responde perguntas simples, sem precisar escrever pedidos para a IA. Dá para mudar a escolha depois.</p>
    </div>
  )
}

export function PlannerPage() {
  const { save, settings, updateSettings, data } = useStore()
  const { userId } = useSession()
  const { toast } = useFeedback()
  const plans = usePlans()
  const stored = plans.profile
  const [profile, setProfile] = useState<Omit<PlannerProfile, 'createdAt' | 'updatedAt'> | null>(stored)
  const [choosing, setChoosing] = useState(!stored)
  const [step, setStep] = useState<Step>(stored ? stepsFor(stored.mode)[0] : 'sleep')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef<string | null>(null)

  if (choosing || !profile) {
    return (
      <>
        <PageHeader title="Planejamento" subtitle="O que você quer montar?" />
        <ModeChoice
          onPick={async (mode) => {
            const next = { ...(profile ?? defaultProfile(mode)), mode }
            setProfile(next)
            setChoosing(false)
            setStep(stepsFor(mode)[0])
            await save('plannerProfiles', next)
            // Turn on the sections for this choice; never turns anything off.
            const modules = { ...settings.modules }
            if (mode !== 'meals') modules.routine = true
            if (mode !== 'routine') modules.meals = true
            await updateSettings({ modules })
          }}
        />
      </>
    )
  }

  const steps = stepsFor(profile.mode)
  const index = steps.indexOf(step)
  const r = profile.routine
  const m = profile.meals
  const setR = (patch: Partial<RoutineAnswers>) => {
    requestId.current = null
    setProfile({ ...profile, routine: { ...r, ...patch } })
  }
  const setM = (patch: Partial<MealAnswers>) => {
    requestId.current = null
    setProfile({ ...profile, meals: { ...m, ...patch } })
  }
  const persist = () => save('plannerProfiles', { ...stored, ...profile, id: PROFILE_ID })
  const go = async (to: Step) => {
    await persist()
    setError(null)
    setStep(to)
    window.scrollTo(0, 0)
  }

  const usesRoutine = profile.mode !== 'meals'
  const usesMeals = profile.mode !== 'routine'
  const fit = usesRoutine ? feasibility(r) : { problems: [], fixedConflicts: [] }
  const clinical = usesMeals && m.clinical
  const blocked = fit.fixedConflicts.length > 0 || fit.problems.length > 0
  const sent: string[] = []
  if (usesRoutine) sent.push('horários de acordar e dormir', 'compromissos, deslocamentos e treinos informados', 'atividades desejadas, descanso e objetivos da rotina')
  if (usesMeals) sent.push('objetivo, esporte (se atleta)', 'alergias, intolerâncias, restrições e alimentos que não come', 'preferências, orçamento, tempo e equipamentos de cozinha, horários das refeições')

  const applyResult = async (res: Awaited<ReturnType<typeof requestPlan>> | null) => {
    if (usesRoutine) {
      // Same deterministic check as the server, again on the device.
      const merged = res?.routine ? mergeProposal(r, res.routine.blocks.filter((b) => !b.fixed)) : { blocks: fixedBlocks(r), rejected: [] }
      const notes = [
        res?.routine?.notes,
        ...(res?.routine?.unplaced ?? []).map((x) => `Não coube: ${x}`),
        ...[...(res?.routine?.rejected ?? []), ...merged.rejected].map((x) => `Descartado pela verificação: ${x}`),
        ...(res?.routine?.missing ?? []).map((x) => `Faltou: ${x}`),
      ]
        .filter(Boolean)
        .join('\n')
      await save('routinePlans', { id: ROUTINE_DRAFT, status: 'draft', source: res ? 'ai' : 'manual', blocks: merged.blocks, notes, done: {} })
    }
    // Clinical cases never get AI meals, but can still write a plan by hand (e.g. from a nutritionist).
    if (usesMeals && (!clinical || !res)) {
      const skeleton: PlannedMeal[] = [0, 1, 2, 3, 4, 5, 6].flatMap((day) =>
        m.mealTimes.filter(isTime).map((time, i) => ({ id: `meal-${day}-${i}`, day: day as PlannedMeal['day'], time, label: ['Café da manhã', 'Almoço', 'Lanche', 'Jantar', 'Ceia', 'Lanche'][i] ?? 'Refeição', items: [], substitutions: [] })),
      )
      const raw = res?.meals ? { meals: res.meals.meals, shopping: res.meals.shopping, notes: res.meals.notes } : { meals: skeleton, shopping: [], notes: '' }
      const safe = sanitizeMealPlan(raw, m)
      const removed = [...(res?.meals?.removed ?? []), ...safe.removed]
      const notes = [safe.notes, ...(res?.meals?.warnings ?? []).map((w) => `Atenção: ${w}`)].filter(Boolean).join('\n')
      await save('mealPlans', { id: MEALS_DRAFT, status: 'draft', source: res ? 'ai' : 'manual', meals: safe.meals, shopping: safe.shopping, notes, removed })
    }
    // A new meal proposal is reviewed in the "Plano com IA" tab.
    if (usesRoutine) navigate('/routine')
    else navigate('/meals', { view: 'plan' })
  }

  const generate = async () => {
    if (busy) return
    if (!consent) return setError('Confirme que concorda com o envio dos dados.')
    setBusy(true)
    setError(null)
    await persist()
    requestId.current ??= newRequestId()
    try {
      const res = await requestPlan({
        requestId: requestId.current,
        mode: clinical ? 'routine' : profile.mode,
        consent: true,
        routine: usesRoutine ? r : undefined,
        meals: usesMeals && !clinical ? m : undefined,
      })
      requestId.current = null
      await applyResult(res)
      toast('Proposta pronta para revisar')
    } catch (err) {
      setError(err instanceof PlannerError ? err.message : 'Não foi possível gerar agora. Você pode montar à mão.')
    } finally {
      setBusy(false)
    }
  }

  const manual = async () => {
    await persist()
    await applyResult(null)
  }

  const trainingSports = r.trainings.map((t) => t.modality).filter(Boolean)

  const body = (() => {
    switch (step) {
      case 'sleep':
        return (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Acorda (seg–sex)">
              <TimeInput label="Acorda em dias úteis" value={r.wakeWeekday} onChange={(v) => setR({ wakeWeekday: v })} />
            </Field>
            <Field label="Dorme (seg–sex)">
              <TimeInput label="Dorme em dias úteis" value={r.sleepWeekday} onChange={(v) => setR({ sleepWeekday: v })} />
            </Field>
            <Field label="Acorda (fim de semana)">
              <TimeInput label="Acorda no fim de semana" value={r.wakeWeekend} onChange={(v) => setR({ wakeWeekend: v })} />
            </Field>
            <Field label="Dorme (fim de semana)">
              <TimeInput label="Dorme no fim de semana" value={r.sleepWeekend} onChange={(v) => setR({ sleepWeekend: v })} />
            </Field>
          </div>
        )
      case 'commitments':
        return (
          <div className="space-y-3">
            <p className="text-[15px] leading-relaxed text-soft">Ex.: “Saio para trabalhar às 8h, almoço das 12h às 13h e chego em casa às 18h.” Informe saída, chegada, trajeto e pausa — o app calcula o resto.</p>
            {r.commitments.map((c, i) => (
              <CommitmentEditor key={c.id} c={c} onChange={(next) => setR({ commitments: r.commitments.map((x, j) => (j === i ? next : x)) })} onRemove={() => setR({ commitments: r.commitments.filter((_, j) => j !== i) })} />
            ))}
            <Button variant="secondary" block icon={<Plus size={17} />} onClick={() => setR({ commitments: [...r.commitments, newCommitment()] })}>
              Adicionar compromisso
            </Button>
          </div>
        )
      case 'trainings':
        return (
          <div className="space-y-3">
            {r.trainings.map((t, i) => (
              <TrainingEditor key={t.id} t={t} onChange={(next) => setR({ trainings: r.trainings.map((x, j) => (j === i ? next : x)) })} onRemove={() => setR({ trainings: r.trainings.filter((_, j) => j !== i) })} />
            ))}
            <Button variant="secondary" block icon={<Plus size={17} />} onClick={() => setR({ trainings: [...r.trainings, newTraining()] })}>
              Adicionar treino
            </Button>
            <Field label="Competições" hint="opcional">
              <TextArea rows={2} value={r.competitions} placeholder="Ex.: campeonato em 15/11" onChange={(e) => setR({ competitions: e.target.value })} />
            </Field>
            {r.trainings.length === 0 && <p className="text-[14px] text-faint">Não treina? Pode pular.</p>}
          </div>
        )
      case 'activities':
        return (
          <div className="space-y-3">
            {r.activities.map((a, i) => (
              <ActivityEditor key={a.id} a={a} onChange={(next) => setR({ activities: r.activities.map((x, j) => (j === i ? next : x)) })} onRemove={() => setR({ activities: r.activities.filter((_, j) => j !== i) })} />
            ))}
            <Button variant="secondary" block icon={<Plus size={17} />} onClick={() => setR({ activities: [...r.activities, newActivity()] })}>
              Adicionar atividade
            </Button>
          </div>
        )
      case 'rest':
        return (
          <div className="space-y-5">
            <Field label="Intervalo mínimo entre atividades">
              <NumberInput label="Intervalo mínimo" value={r.bufferMin} onChange={(v) => setR({ bufferMin: v })} max={120} suffix="min" />
            </Field>
            <Field label="Dias de descanso" hint="sem atividades extras">
              <DayPicker value={r.restDays} onChange={(v) => setR({ restDays: v })} />
            </Field>
            <Field label="Objetivos" hint="opcional">
              <TextArea rows={3} value={r.goals} placeholder="Ex.: ter as noites de sexta livres, estudar de manhã" onChange={(e) => setR({ goals: e.target.value })} />
            </Field>
          </div>
        )
      case 'goal':
        return (
          <div className="space-y-5">
            <Field label="Objetivo">
              <Select value={m.goal} onChange={(e) => setM({ goal: e.target.value as MealAnswers['goal'] })}>
                <option value="health">Comer melhor no dia a dia</option>
                <option value="practical">Praticidade</option>
                <option value="budget">Economizar</option>
                <option value="muscle">Apoiar ganho de massa (com treino)</option>
                <option value="fatloss">Perder peso com moderação</option>
                <option value="performance">Rendimento no esporte</option>
              </Select>
            </Field>
            <ToggleRow checked={m.athlete} onChange={(v) => setM({ athlete: v, modality: v && !m.modality ? trainingSports.join(', ') : m.modality })} hint={profile.mode === 'both' && trainingSports.length ? `Treinos da rotina: ${trainingSports.join(', ')}` : undefined}>
              Sou atleta / treino com regularidade
            </ToggleRow>
            {m.athlete && profile.mode !== 'both' && (
              <Field label="Modalidade e frequência">
                <TextInput value={m.modality} placeholder="Ex.: corrida, 4× por semana às 6h" onChange={(e) => setM({ modality: e.target.value })} />
              </Field>
            )}
            {m.athlete && (
              <ToggleRow checked={m.performanceStrategy} onChange={(v) => setM({ performanceStrategy: v })} hint="Ex.: corte de peso, preparação para competição, suplementação">
                Preciso de estratégia específica de desempenho
              </ToggleRow>
            )}
            {m.performanceStrategy && (
              <p className="flex gap-2 rounded-2xl bg-warn/10 p-4 text-[14px] leading-relaxed text-warn">
                <Stethoscope size={18} className="mt-0.5 shrink-0" />
                Estratégias específicas de desempenho precisam de um nutricionista esportivo. O app monta só um planejamento geral em volta dos seus treinos.
              </p>
            )}
            <p className="text-[13px] leading-relaxed text-faint">Não pedimos peso, altura nem idade: este planejamento organiza refeições e compras, sem calcular calorias ou metas clínicas.</p>
          </div>
        )
      case 'allergies':
        return (
          <div className="space-y-6">
            <Field label="Alergias alimentares">
              <ChipSelect options={ALLERGENS} value={m.allergies} onChange={(v) => setM({ allergies: v })} />
            </Field>
            <Field label="Intolerâncias">
              <ChipSelect options={INTOLERANCES} value={m.intolerances} onChange={(v) => setM({ intolerances: v })} />
            </Field>
            <Field label="Restrições">
              <ChipSelect options={RESTRICTIONS} value={m.restrictions} onChange={(v) => setM({ restrictions: v })} />
            </Field>
            <p className="text-[13px] leading-relaxed text-faint">Tudo o que você marcar aqui é proibido no plano, nas substituições e na lista de compras. Uma verificação automática remove o que for incompatível — confira sempre os rótulos.</p>
          </div>
        )
      case 'prefs':
        return (
          <div className="space-y-5">
            <Field label="Alimentos que você não come" hint="separe por vírgula">
              <TextArea rows={2} value={m.dislikes} placeholder="Ex.: fígado, jiló, coentro" onChange={(e) => setM({ dislikes: e.target.value })} />
            </Field>
            <Field label="O que você gosta" hint="opcional">
              <TextArea rows={2} value={m.likes} placeholder="Ex.: comida caseira, massas, frutas" onChange={(e) => setM({ likes: e.target.value })} />
            </Field>
          </div>
        )
      case 'kitchen':
        return (
          <div className="space-y-5">
            <Field label="Orçamento">
              <Segmented block value={m.budget} onChange={(v) => setM({ budget: v })} options={[{ value: 'low', label: 'Apertado' }, { value: 'medium', label: 'Médio' }, { value: 'high', label: 'Folgado' }]} />
            </Field>
            <Field label="Valor por semana" hint="opcional">
              <TextInput value={m.budgetNote} placeholder="Ex.: R$ 250 por semana" onChange={(e) => setM({ budgetNote: e.target.value })} />
            </Field>
            <Field label="Tempo para cozinhar por dia">
              <NumberInput label="Tempo para cozinhar" value={m.cookMinutes} onChange={(v) => setM({ cookMinutes: v })} max={240} suffix="min" />
            </Field>
            <Field label="Equipamentos">
              <ChipSelect options={['fogão', 'forno', 'micro-ondas', 'airfryer', 'geladeira', 'freezer', 'liquidificador', 'marmita no trabalho'].map((x) => ({ id: x, label: x }))} value={m.equipment} onChange={(v) => setM({ equipment: v })} />
            </Field>
          </div>
        )
      case 'times':
        return (
          <div className="space-y-5">
            <Field label="Refeições por dia">
              <NumberInput label="Refeições por dia" value={m.mealsPerDay} min={2} max={6} onChange={(v) => setM({ mealsPerDay: v, mealTimes: profile.mode === 'both' ? suggestMealTimes(r, v) : [...m.mealTimes, ...suggestMealTimes(r, v)].slice(0, v) })} />
            </Field>
            {profile.mode === 'both' && (
              <Button variant="secondary" onClick={() => setM({ mealTimes: suggestMealTimes(r, m.mealsPerDay) })}>
                Usar horários da minha rotina
              </Button>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: m.mealsPerDay }, (_, i) => (
                <Field key={i} label={`Refeição ${i + 1}`}>
                  <TimeInput label={`Horário da refeição ${i + 1}`} value={m.mealTimes[i] ?? ''} onChange={(v) => setM({ mealTimes: Array.from({ length: m.mealsPerDay }, (_, j) => (j === i ? v : (m.mealTimes[j] ?? ''))) })} />
                </Field>
              ))}
            </div>
          </div>
        )
      case 'health':
        return (
          <div className="space-y-5">
            <ToggleRow checked={m.clinical} onChange={(v) => setM({ clinical: v })} hint="Ex.: diabetes, doença renal ou celíaca, gestação, transtorno alimentar, cirurgia recente, orientação médica de dieta">
              Tenho uma condição de saúde que afeta minha alimentação
            </ToggleRow>
            {m.clinical && (
              <div className="card space-y-3 border-warn/25 p-4 text-[15px] leading-relaxed">
                <p className="flex items-center gap-2 font-medium">
                  <Stethoscope size={18} className="text-warn" /> Procure um nutricionista
                </p>
                <p className="text-soft">Nesses casos o plano precisa ser feito por um profissional. A IA não vai gerar refeições para você — mas você pode registrar aqui o plano que o profissional passar, à mão, e usar a lista de compras.</p>
              </div>
            )}
          </div>
        )
      case 'review':
        return (
          <div className="space-y-5">
            {fit.fixedConflicts.length > 0 && (
              <div className="card space-y-2 border-expense/30 p-4">
                <p className="flex items-center gap-2 text-[15px] font-medium text-expense">
                  <AlertTriangle size={18} /> Compromissos que se sobrepõem
                </p>
                {fit.fixedConflicts.map((c, i) => (
                  <p key={i} className="text-[14px] leading-relaxed text-soft">
                    {c.message}
                  </p>
                ))}
                <Button variant="secondary" onClick={() => go('commitments')}>
                  Corrigir horários
                </Button>
              </div>
            )}
            {fit.problems.length > 0 && (
              <div className="card space-y-3 border-warn/30 p-4">
                <p className="flex items-center gap-2 text-[15px] font-medium text-warn">
                  <AlertTriangle size={18} /> Não cabe tudo — escolha o que priorizar
                </p>
                {fit.problems.map((p, i) => {
                  const act = r.activities.find((a) => a.id === p.activityId)
                  return (
                    <div key={i} className="rounded-2xl bg-raised p-3">
                      <p className="text-[14px] leading-relaxed">{p.message}</p>
                      {act && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {act.timesPerWeek > 1 && (
                            <Button variant="secondary" onClick={() => setR({ activities: r.activities.map((a) => (a.id === act.id ? { ...a, timesPerWeek: a.timesPerWeek - 1 } : a)) })}>
                              {act.timesPerWeek - 1}× por semana
                            </Button>
                          )}
                          {act.durationMin > 15 && (
                            <Button variant="secondary" onClick={() => setR({ activities: r.activities.map((a) => (a.id === act.id ? { ...a, durationMin: Math.max(15, a.durationMin - 15) } : a)) })}>
                              {act.durationMin - 15} min
                            </Button>
                          )}
                          {act.period !== 'any' && (
                            <Button variant="secondary" onClick={() => setR({ activities: r.activities.map((a) => (a.id === act.id ? { ...a, period: 'any' } : a)) })}>
                              Qualquer período
                            </Button>
                          )}
                          <Button variant="ghost" className="text-expense!" onClick={() => setR({ activities: r.activities.filter((a) => a.id !== act.id) })}>
                            Tirar da semana
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
                {fit.problems.some((p) => !p.activityId) && (
                  <p className="text-[13px] text-faint">Reduza ou tire atividades de prioridade mais baixa até caber.</p>
                )}
              </div>
            )}

            <div className="card space-y-3 p-4">
              <p className="flex items-center gap-2 text-[15px] font-medium">
                <ShieldCheck size={18} className="text-accent-hi" /> O que será enviado para a IA
              </p>
              <ul className="space-y-1 text-[14px] leading-relaxed text-soft">
                {sent.map((s) => (
                  <li key={s}>• {s}</li>
                ))}
              </ul>
              <p className="text-[13px] leading-relaxed text-faint">
                Vai para o provedor de IA (Anthropic, modelo Claude) pelo servidor do Núcleo. Nada de outras seções é enviado: dinheiro, clientes, tarefas, anotações e senhas ficam de fora.
                {clinical ? ' A parte de alimentação não será gerada (condição de saúde informada).' : ''}
              </p>
              <label className="flex items-start gap-3 rounded-2xl bg-raised p-3.5 text-[15px]">
                <input type="checkbox" className="mt-0.5 size-5 accent-[var(--color-accent)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                Concordo com o envio desses dados para gerar a proposta.
              </label>
            </div>
            {!userId && <p className="rounded-2xl bg-white/[0.04] p-4 text-[14px] leading-relaxed text-soft">A IA funciona com uma conta conectada (a chave fica no servidor). Sem conta, monte o plano à mão.</p>}
            {error && (
              <p role="alert" className="rounded-2xl bg-expense/10 p-4 text-[15px] leading-relaxed text-expense">
                {error}
              </p>
            )}
            <div className="space-y-2.5">
              <Button size="lg" block icon={<Sparkles size={18} />} disabled={busy || blocked || !userId || (clinical && !usesRoutine)} onClick={generate}>
                {busy ? 'Gerando… pode levar um minuto' : 'Gerar proposta com IA'}
              </Button>
              <Button size="lg" variant="secondary" block disabled={busy || fit.fixedConflicts.length > 0} onClick={manual}>
                Montar à mão
              </Button>
              <p className="text-center text-[13px] text-faint">A proposta chega como rascunho. Nada substitui o que já está salvo sem você confirmar.</p>
            </div>
          </div>
        )
    }
  })()

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <IconButton label="Voltar" onClick={() => (index > 0 ? go(steps[index - 1]) : setChoosing(true))} className="-ml-2">
          <ArrowLeft size={22} />
        </IconButton>
        <div className="flex flex-1 gap-1" aria-hidden>
          {steps.map((s, i) => (
            <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-accent' : 'bg-white/10'}`} />
          ))}
        </div>
        <button type="button" onClick={() => setChoosing(true)} className="hit relative shrink-0 px-2 text-[13px] font-medium text-accent-hi hover:text-ink">
          {profile.mode === 'both' ? 'Rotina + alimentação' : profile.mode === 'routine' ? 'Só rotina' : 'Só alimentação'}
        </button>
      </div>
      <PageHeader title={STEP_TITLE[step]} subtitle={`Passo ${index + 1} de ${steps.length}`} />
      <div className="pb-6">{body}</div>
      {step !== 'review' && (
        <div className="flex gap-3">
          <Button size="lg" block onClick={() => go(steps[index + 1])}>
            Continuar
          </Button>
        </div>
      )}
      {data.plannerProfiles.length > 0 && step !== 'review' && <p className="mt-3 text-center text-[13px] text-faint">As respostas ficam salvas a cada passo.</p>}
    </>
  )
}
