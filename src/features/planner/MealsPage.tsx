import { Check, MessageCircle, Plus, Salad, ShieldAlert, Stethoscope, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { activeRules, emptyMealAnswers, violations } from '../../../supabase/functions/_shared/planner/foodSafety.ts'
import { DAY_LONG, WEEKDAYS } from '../../../supabase/functions/_shared/planner/schedule.ts'
import { isTime, toMinutes } from '../../../supabase/functions/_shared/planner/time.ts'
import { navigate } from '../../app/router'
import { newId, useStore } from '../../data/store'
import type { MealAnswers, MealPlan, PlannedMeal, Weekday } from '../../data/types'
import { Button, IconButton } from '../../ui/Button'
import { Badge, EmptyState, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, Select, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft, useSheet } from '../../ui/formHooks'
import { MEALS_CURRENT, MEALS_DRAFT, usePlans } from './plans'
import { mealsOfWeek, weekDays } from '../../core/meals'
import { DayStrip, MealTypeIcon, typeFromTime } from '../meals/MealParts'
import { todayIn, weekStart, zoneOf } from '../../core/period'
import { buildList, guessCategory, keysOnList, normalizeName } from '../../core/shopping'

const lines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

/** Manual edits go through the same allergy/restriction check as the AI output. */
function blockedLines(texts: string[], answers: MealAnswers): string | null {
  const rules = activeRules(answers)
  for (const t of texts) {
    const v = violations(t, rules)
    if (v.length) return `“${t}” não combina com: ${v.map((r) => r.label).join(', ')}`
  }
  return null
}

function MealSheet({ open, onClose, meal, plan, answers }: { open: boolean; onClose(): void; meal: PlannedMeal | null; plan: MealPlan; answers: MealAnswers }) {
  const { save } = useStore()
  const { toast } = useFeedback()
  const [d, set] = useDraft(open, () => ({
    day: String(meal?.day ?? new Date().getDay()),
    time: meal?.time ?? '12:30',
    label: meal?.label ?? '',
    items: (meal?.items ?? []).join('\n'),
    substitutions: (meal?.substitutions ?? []).join('\n'),
  }))

  const submit = async () => {
    if (!d.label.trim()) return 'Dê um nome à refeição'
    if (!isTime(d.time)) return 'Confira o horário'
    const items = lines(d.items)
    const substitutions = lines(d.substitutions)
    const problem = blockedLines([...items, ...substitutions], answers)
    if (problem) return problem
    const next: PlannedMeal = { id: meal?.id ?? newId(), day: Number(d.day) as Weekday, time: d.time, label: d.label.trim(), items, substitutions }
    await save('mealPlans', { ...plan, meals: [...plan.meals.filter((m) => m.id !== next.id), next] })
    toast('Refeição salva')
    onClose()
  }

  const remove = async () => {
    if (!meal) return
    await save('mealPlans', { ...plan, meals: plan.meals.filter((m) => m.id !== meal.id) })
    onClose()
  }

  return (
    <FormSheet open={open} onClose={onClose} title={meal ? 'Editar refeição' : 'Nova refeição'} onSubmit={submit} onDelete={meal ? remove : undefined}>
      <FormGrid>
        <Field label="Refeição">
          <TextInput value={d.label} placeholder="Ex.: Almoço" onChange={(e) => set('label', e.target.value)} />
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
          <Field label="Horário">
            <TextInput type="time" value={d.time} onChange={(e) => set('time', e.target.value)} />
          </Field>
        </div>
        <Field label="Itens" hint="um por linha">
          <TextArea rows={4} value={d.items} onChange={(e) => set('items', e.target.value)} />
        </Field>
        <Field label="Substituições" hint="um por linha">
          <TextArea rows={3} value={d.substitutions} onChange={(e) => set('substitutions', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}

function MealDay({ plan, day, onEdit }: { plan: MealPlan; day: Weekday; onEdit(m: PlannedMeal): void }) {
  const meals = plan.meals.filter((m) => m.day === day).sort((a, b) => toMinutes(a.time) - toMinutes(b.time))
  if (!meals.length) return <p className="card px-4 py-4 text-[15px] text-faint">Sem refeições neste dia.</p>
  return (
    <div className="card divide-y divide-line">
      {meals.map((m) => (
        <button key={m.id} type="button" onClick={() => onEdit(m)} className="flex w-full gap-3 px-3.5 py-3 text-left hover:bg-tint/[0.03]">
          <MealTypeIcon type={typeFromTime(m.time)} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 text-[15px] font-semibold tracking-tight [overflow-wrap:anywhere]">{m.label}</span>
              <span className="num shrink-0 text-[12px] text-faint">{m.time}</span>
            </span>
            {m.items.length ? (
              <span className="mt-0.5 block text-[14px] leading-relaxed text-soft [overflow-wrap:anywhere]">{m.items.join(' · ')}</span>
            ) : (
              <span className="mt-0.5 block text-[13px] text-faint">Toque para preencher</span>
            )}
            {m.substitutions.length > 0 && <span className="mt-1 block text-[12px] leading-relaxed text-faint [overflow-wrap:anywhere]">Trocas: {m.substitutions.join(' · ')}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

function Shopping({ plan, answers }: { plan: MealPlan; answers: MealAnswers }) {
  const { save, data, settings } = useStore()
  const { toast, confirm } = useFeedback()
  /** Copies the plan's list into this week's shopping list as manual items, skipping names already there. */
  const copy = async () => {
    const week = weekStart(todayIn(zoneOf(settings)))
    const have = keysOnList(buildList(mealsOfWeek(data.meals, week), data.shoppingItems, week))
    const fresh = plan.shopping.filter((s) => s.item.trim() && !have.has(normalizeName(s.item)))
    const unique = [...new Map(fresh.map((s) => [normalizeName(s.item), s])).values()]
    if (!unique.length) return toast('Esses itens já estão na Lista de compras desta semana')
    const ok = await confirm({ title: 'Copiar para Lista de compras?', message: `${unique.length} ${unique.length === 1 ? 'item vai' : 'itens vão'} para a lista desta semana como itens seus. ${plan.shopping.length - unique.length ? `${plan.shopping.length - unique.length} já estavam lá. ` : ''}A lista do plano continua igual.`, confirmLabel: 'Copiar' })
    if (!ok) return
    for (const s of unique) await save('shoppingItems', { week, kind: 'manual', name: s.item.trim().slice(0, 120), qty: s.qty ?? '', unit: '', category: guessCategory(normalizeName(s.item)), checked: false, note: '', origin: 'plan' })
    toast('Copiado para a Lista de compras')
  }
  const [text, setText] = useState('')
  const add = async () => {
    const item = text.trim()
    if (!item) return
    const problem = blockedLines([item], answers)
    if (problem) return toast(problem, 'error')
    await save('mealPlans', { ...plan, shopping: [...plan.shopping, { item, qty: '', checked: false }] })
    setText('')
  }
  return (
    <section>
      <SectionTitle action={plan.status === 'approved' && plan.shopping.length ? 'Copiar para Lista de compras' : undefined} onAction={copy}>
        Lista sugerida pelo plano
      </SectionTitle>
      <div className="card p-1.5">
        {plan.shopping.map((s, i) => (
          <div key={i} className="flex items-center gap-1 rounded-2xl px-1">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-2 py-2.5">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-[var(--color-accent)]"
                checked={s.checked}
                onChange={(e) => save('mealPlans', { ...plan, shopping: plan.shopping.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)) })}
              />
              <span className={`min-w-0 flex-1 text-[15px] ${s.checked ? 'text-faint line-through' : ''}`}>{s.item}</span>
              {s.qty && <span className="shrink-0 text-[13px] text-faint">{s.qty}</span>}
            </label>
            <IconButton label="Remover item" size="sm" onClick={() => save('mealPlans', { ...plan, shopping: plan.shopping.filter((_, j) => j !== i) })}>
              <Trash2 size={16} />
            </IconButton>
          </div>
        ))}
        <div className="flex gap-2 p-1.5">
          <TextInput value={text} placeholder="Adicionar item" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <IconButton label="Adicionar" tone="accent" className="size-12!" onClick={add}>
            <Plus size={18} />
          </IconButton>
        </div>
      </div>
    </section>
  )
}

function PlanView({ plan, answers, onEdit }: { plan: MealPlan; answers: MealAnswers; onEdit(m: PlannedMeal | null): void }) {
  const { settings } = useStore()
  const today = todayIn(zoneOf(settings))
  const dates = weekDays(weekStart(today))
  const [date, setDate] = useState(today)
  const day = new Date(`${date}T12:00:00Z`).getUTCDay() as Weekday
  const counts = Object.fromEntries(dates.map((d) => [d, plan.meals.filter((m) => m.day === new Date(`${d}T12:00:00Z`).getUTCDay()).length]))
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
      <section className="space-y-3">
        <DayStrip days={dates} value={date} today={today} counts={counts} onPick={setDate} label="Dias do plano" />
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="text-[15px] font-semibold">{DAY_LONG[day]}</h3>
          <button type="button" onClick={() => onEdit(null)} className="press inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold text-accent-hi hover:bg-accent/[0.08]">
            <Plus size={16} /> Refeição
          </button>
        </div>
        <MealDay plan={plan} day={day} onEdit={onEdit} />
      </section>
      <Shopping plan={plan} answers={answers} />
    </div>
  )
}

export function AiPlanView() {
  const { save, remove, data, settings } = useStore()
  const { confirm, toast } = useFeedback()
  const { meals, mealsDraft, profile } = usePlans()
  const sheet = useSheet<{ meal: PlannedMeal | null; planId: string }>()
  const answers = profile?.meals ?? emptyMealAnswers()

  const approve = async () => {
    if (!mealsDraft) return
    if (meals) {
      const ok = await confirm({ title: 'Substituir o planejamento salvo?', message: 'As refeições e a lista de compras atuais serão trocadas por esta proposta.', confirmLabel: 'Substituir' })
      if (!ok) return
    }
    const approved = { ...mealsDraft, id: MEALS_CURRENT, status: 'approved' as const, createdAt: meals?.createdAt ?? mealsDraft.createdAt }
    await save('mealPlans', approved)
    await remove('mealPlans', MEALS_DRAFT)
    toast('Plano aprovado')
    // Approved: offer the shopping list of this week (only items not there yet; manual items untouched).
    if (approved.shopping.length) await copyShopping(approved)
  }

  const copyShopping = async (plan: MealPlan) => {
    const week = weekStart(todayIn(zoneOf(settings)))
    const have = keysOnList(buildList(mealsOfWeek(data.meals, week), data.shoppingItems, week))
    const fresh = [...new Map(plan.shopping.filter((s) => s.item.trim() && !have.has(normalizeName(s.item))).map((s) => [normalizeName(s.item), s])).values()]
    if (!fresh.length) return
    const ok = await confirm({ title: 'Gerar a lista de compras?', message: `${fresh.length} ${fresh.length === 1 ? 'item do plano vai' : 'itens do plano vão'} para a Lista de compras desta semana, agrupados por categoria. O que já está lá não se repete.`, confirmLabel: 'Gerar lista' })
    if (!ok) return
    for (const s of fresh) await save('shoppingItems', { week, kind: 'manual', name: s.item.trim().slice(0, 120), qty: s.qty ?? '', unit: '', category: guessCategory(normalizeName(s.item)), checked: false, note: '', origin: 'plan' })
    toast('Lista de compras gerada')
  }

  const discard = async () => {
    const ok = await confirm({ title: 'Descartar a proposta?', message: meals ? 'O planejamento salvo continua igual.' : undefined, confirmLabel: 'Descartar', danger: true })
    if (ok) await remove('mealPlans', MEALS_DRAFT)
  }

  const sheetPlan = sheet.item?.planId === MEALS_DRAFT ? mealsDraft : meals

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-soft">Modelo semanal montado com IA — não é prescrição.</p>
        <Button variant="secondary" icon={<MessageCircle size={18} />} onClick={() => navigate('/planner')}>
          {profile ? 'Refazer' : 'Montar'}
        </Button>
      </div>

      {profile?.meals.clinical && (
        <div className="card mb-5 flex gap-3 border-warn/25 p-4 text-[14px] leading-relaxed">
          <Stethoscope size={20} className="mt-0.5 shrink-0 text-warn" />
          <p className="text-soft">Você informou uma condição de saúde. Siga o plano de um nutricionista; aqui você pode registrá-lo à mão e usar a lista de compras.</p>
        </div>
      )}

      {mealsDraft && (
        <section className="mb-8">
          <div className="card relative mb-4 space-y-3 overflow-hidden border-warn/30 p-4 pl-5">
            <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-warn" />
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warn">Rascunho · não aprovado</Badge>
              <span className="text-[13px] text-faint">{mealsDraft.source === 'ai' ? 'Proposta da IA' : 'Feito à mão'}</span>
            </div>
            <p className="text-[15px] leading-snug">Revise e edite as refeições abaixo. Nada entra na sua semana nem na lista de compras até você aprovar.</p>
            {mealsDraft.removed.length > 0 && (
              <details className="rounded-2xl bg-warn/8 p-3 text-[14px]">
                <summary className="flex cursor-pointer items-center gap-2 font-medium text-warn">
                  <ShieldAlert size={16} /> {mealsDraft.removed.length} sugestão(ões) bloqueada(s) pela verificação de restrições
                </summary>
                <ul className="mt-2 space-y-1 text-soft">
                  {mealsDraft.removed.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </details>
            )}
            {mealsDraft.notes && <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-soft">{mealsDraft.notes}</p>}
            <div className="flex flex-wrap gap-2">
              <Button icon={<Check size={18} />} onClick={approve}>
                Aprovar plano
              </Button>
              <Button variant="ghost" onClick={discard}>
                Descartar rascunho
              </Button>
            </div>
          </div>
          <PlanView plan={mealsDraft} answers={answers} onEdit={(m) => sheet.show({ meal: m, planId: MEALS_DRAFT })} />
        </section>
      )}

      {meals ? (
        <section>
          <div className="mb-4 flex flex-wrap items-center gap-2 px-1">
            <Badge tone="positive">Plano aprovado</Badge>
            <span className="text-[13px] text-faint">{mealsDraft ? 'É o que vale até você aprovar o rascunho acima.' : 'Use na Semana com “Usar plano aprovado”.'}</span>
          </div>
          <PlanView plan={meals} answers={answers} onEdit={(m) => sheet.show({ meal: m, planId: MEALS_CURRENT })} />
        </section>
      ) : (
        !mealsDraft && (
          <EmptyState icon={<Salad size={20} />} title="Nenhum planejamento ainda" text="Responda um questionário curto e receba refeições da semana e lista de compras, respeitando alergias e restrições." action="Começar" onAction={() => navigate('/planner')} />
        )
      )}

      <p className="mt-8 px-1 text-[13px] leading-relaxed text-faint">
        Sugestões de organização, não diagnóstico nem prescrição. A verificação de alergias e restrições é automática por palavras e pode falhar: confira rótulos e ingredientes. Para necessidades clínicas ou estratégias de desempenho, procure um nutricionista.
      </p>
      {sheetPlan && <MealSheet open={sheet.open} onClose={sheet.close} meal={sheet.item?.meal ?? null} plan={sheetPlan} answers={answers} />}
    </>
  )
}
