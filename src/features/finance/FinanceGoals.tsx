import { Flag, Plus } from 'lucide-react'
import { useState } from 'react'
import { goalPlan, startHistory, withSaved } from '../../core/financeGoals'
import { nowIn, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import type { FinanceGoal } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { amountToInput, formatMoney, parseAmount } from '../../lib/money'
import { Button } from '../../ui/Button'
import { Celebrate } from '../../ui/Celebrate'
import { Badge, Progress, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, MoneyInput, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft, useSheet } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { GoalStrategies } from './GoalStrategies'

/** Neutral sentence about what would be needed (never "you are late"). */
export function planSentence(goal: FinanceGoal, today: string): string {
  const p = goalPlan(goal, today)
  const money = (c: number) => formatMoney(c, goal.currency)
  if (p.reached) return 'Meta alcançada.'
  if (p.due) return `O prazo chegou e faltam ${money(p.missing)}. Se quiser, ajuste a data.`
  if (p.perMonth !== null) return `Para chegar à meta no prazo, seriam necessários aproximadamente ${money(p.perMonth)} por mês (${money(p.perWeek!)} por semana).`
  return `Para chegar à meta no prazo, seriam necessários aproximadamente ${money(p.perWeek!)} por semana.`
}

function FinanceGoalForm({ open, onClose, goal }: { open: boolean; onClose(): void; goal: FinanceGoal | null }) {
  const { save, settings } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const today = nowIn(zoneOf(settings)).date
  const [d, set] = useDraft(open, () => ({
    name: goal?.name ?? '',
    target: goal ? amountToInput(goal.target) : '',
    saved: goal ? amountToInput(goal.saved) : '',
    deadline: goal?.deadline ?? '',
    currency: goal?.currency ?? settings.baseCurrency,
    note: goal?.note ?? '',
  }))

  const submit = async () => {
    const target = parseAmount(d.target)
    const saved = d.saved.trim() ? parseAmount(d.saved) : 0
    if (!d.name.trim()) return 'Dê um nome para a meta'
    if (!target || target <= 0) return 'Informe o valor objetivo'
    if (saved === null || saved < 0) return 'Confira o valor já guardado'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.deadline)) return 'Escolha a data limite'
    if (!goal && d.deadline <= today) return 'A data limite precisa ser depois de hoje'
    await save('financeGoals', {
      ...goal,
      name: d.name.trim(),
      target,
      saved,
      deadline: d.deadline,
      currency: d.currency,
      note: d.note.trim(),
      status: goal?.status ?? 'active',
      // The first point is the starting value; later changes are what was saved over time.
      history: !goal ? startHistory(saved, today) : goal.saved === saved ? goal.history : withSaved(goal, saved, today),
    })
    toast(goal ? 'Meta atualizada' : 'Meta criada')
    onClose()
  }

  return (
    <FormSheet open={open} onClose={onClose} title={goal ? 'Editar meta financeira' : 'Nova meta financeira'} submitLabel={goal ? 'Salvar' : 'Criar meta'} onSubmit={submit} onDelete={goal ? () => del('financeGoals', goal.id, 'meta', { feminine: true, after: onClose }) : undefined}>
      <FormGrid>
        <Field label="Nome">
          <TextInput value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Reserva de emergência" autoFocus={!goal} />
        </Field>
        <Field label="Valor objetivo">
          <MoneyInput value={d.target} onChange={(v) => set('target', v)} currency={d.currency} onCurrency={(c) => set('currency', c)} />
        </Field>
        <div className="half">
          <Field label="Já guardado" hint="você atualiza">
            <TextInput inputMode="decimal" className="num" placeholder="0,00" value={d.saved} onChange={(e) => set('saved', e.target.value)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Data limite">
            <TextInput type="date" min={goal ? undefined : today} value={d.deadline} onChange={(e) => set('deadline', e.target.value)} />
          </Field>
        </div>
        {d.currency !== settings.baseCurrency && <p className="text-[13px] leading-relaxed text-faint">Metas em {d.currency} ficam na própria moeda e não entram na meta semanal “Guardar”, que usa {settings.baseCurrency}.</p>}
        <Field label="Observação" hint="opcional">
          <TextArea value={d.note} onChange={(e) => set('note', e.target.value)} rows={2} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}

/** "Atualizar valor guardado": add/withdraw an amount or set the new total. */
function SavedSheet({ goal, open, onClose, onEdit }: { goal: FinanceGoal | null; open: boolean; onClose(): void; onEdit(g: FinanceGoal): void }) {
  const { save, settings } = useStore()
  const { toast } = useFeedback()
  const [mode, setMode] = useState<'add' | 'remove' | 'total'>('add')
  const [value, setValue] = useState('')
  // Each time the sheet opens it starts on "Atualizar" (its main job); "Como alcançar" is one tap away.
  const [view, setView] = useState<'update' | 'strategies'>('update')
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) setView('update')
  }
  const today = nowIn(zoneOf(settings)).date
  if (!goal) return null
  const p = goalPlan(goal, today)
  // Scenarios only while there is something to plan (not reached, deadline not come).
  const planning = !p.reached && !p.due
  const tab = planning ? view : 'update'
  const cents = parseAmount(value)
  const next = cents === null ? null : mode === 'add' ? goal.saved + cents : mode === 'remove' ? Math.max(0, goal.saved - cents) : cents

  const apply = async () => {
    if (next === null || (mode !== 'total' && !cents)) return toast('Digite um valor', 'error')
    await save('financeGoals', { ...goal, saved: next, history: withSaved(goal, next, today) })
    toast('Valor guardado atualizado')
    setValue('')
    onClose()
  }
  const archive = async () => {
    await save('financeGoals', { ...goal, status: goal.status === 'archived' ? 'active' : 'archived' })
    toast(goal.status === 'archived' ? 'Meta reativada' : 'Meta arquivada')
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={goal.name} footer={tab === 'strategies' ? undefined : <Button size="lg" block onClick={apply}>{next !== null && cents ? `Salvar · ${formatMoney(next, goal.currency)} guardados` : 'Salvar'}</Button>}>
      <div className="space-y-5 pt-1">
        <div>
          <p className="num text-[26px] font-semibold">
            {formatMoney(goal.saved, goal.currency)} <span className="text-[15px] font-normal text-soft">de {formatMoney(goal.target, goal.currency)}</span>
          </p>
          <div className="mt-2">
            <Progress value={p.percent} tone={p.reached ? 'positive' : 'goal'} />
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-soft">{planSentence(goal, today)}</p>
        </div>
        {planning && (
          <Segmented<'update' | 'strategies'> variant="underline" label="Ver" value={tab} onChange={setView} options={[{ value: 'update', label: 'Atualizar' }, { value: 'strategies', label: 'Como alcançar' }]} />
        )}
        {tab === 'strategies' ? (
          <GoalStrategies goal={goal} today={today} />
        ) : (
          <>
            <Segmented<'add' | 'remove' | 'total'> block size="sm" label="Como atualizar" value={mode} onChange={setMode} options={[{ value: 'add', label: 'Guardei' }, { value: 'remove', label: 'Retirei' }, { value: 'total', label: 'Novo total' }]} />
            <Field label={mode === 'total' ? 'Total guardado agora' : mode === 'add' ? 'Quanto guardou' : 'Quanto retirou'}>
              <TextInput inputMode="decimal" className="num" placeholder="0,00" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => onEdit(goal)}>
                Editar meta
              </Button>
              <Button variant="ghost" onClick={archive}>
                {goal.status === 'archived' ? 'Reativar' : 'Arquivar'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

export function FinanceGoalCard({ goal, today, onOpen }: { goal: FinanceGoal; today: string; onOpen(g: FinanceGoal): void }) {
  const p = goalPlan(goal, today)
  return (
    <button type="button" onClick={() => onOpen(goal)} className="block w-full px-4 py-3.5 text-left hover:bg-tint/[0.03] tap">
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{goal.name}</span>
        <Celebrate active={p.reached}>{p.reached ? <Badge tone="positive">alcançada</Badge> : p.onPace ? <Badge tone="accent">no ritmo</Badge> : null}</Celebrate>
      </span>
      <span className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] text-faint">
        <span className="num">
          <span className="text-[15px] font-semibold text-ink">{formatMoney(goal.saved, goal.currency)}</span> de {formatMoney(goal.target, goal.currency)}
        </span>
        <span>até {formatDateValue(goal.deadline).toLowerCase()}</span>
      </span>
      <span className="mt-2 block">
        <Progress value={p.percent} tone={p.reached ? 'positive' : 'goal'} />
      </span>
      <span className="mt-1.5 block text-[13px] leading-snug text-soft">
        {p.reached ? 'Meta alcançada.' : `${p.percent}% · faltam ${formatMoney(p.missing, goal.currency)}. `}
        {!p.reached && planSentence(goal, today)}
      </span>
    </button>
  )
}

/** "Metas com prazo" inside Financeiro. */
export function FinanceGoalsSection() {
  const { data, settings } = useStore()
  const form = useSheet<FinanceGoal>()
  const detail = useSheet<string>()
  const [showArchived, setShowArchived] = useState(false)
  const today = nowIn(zoneOf(settings)).date
  const goals = [...data.financeGoals].sort((a, b) => (a.deadline < b.deadline ? -1 : 1))
  const active = goals.filter((g) => g.status !== 'archived')
  const archived = goals.filter((g) => g.status === 'archived')
  const open = data.financeGoals.find((g) => g.id === detail.item) ?? null

  return (
    <section>
      <SectionTitle action="Nova meta" onAction={() => form.show()}>
        Metas com prazo
      </SectionTitle>
      {active.length ? (
        <div className="card divide-y divide-line">
          {active.map((g) => (
            <FinanceGoalCard key={g.id} goal={g} today={today} onOpen={(x) => detail.show(x.id)} />
          ))}
        </div>
      ) : (
        <div className="card flex items-center justify-between gap-3 px-5 py-4">
          <span className="flex min-w-0 items-center gap-2 text-[15px] text-faint">
            <Flag size={18} className="shrink-0" /> Ex.: juntar R$ 5.000 até dezembro
          </span>
          <Button variant="secondary" icon={<Plus size={16} />} onClick={() => form.show()}>
            Criar
          </Button>
        </div>
      )}
      {archived.length > 0 && (
        <button type="button" onClick={() => setShowArchived(!showArchived)} className="mt-2 px-1 text-[13px] text-faint hover:text-soft">
          {showArchived ? 'Esconder arquivadas' : `Arquivadas · ${archived.length}`}
        </button>
      )}
      {showArchived && archived.length > 0 && (
        <div className="card mt-2 divide-y divide-line opacity-80">
          {archived.map((g) => (
            <FinanceGoalCard key={g.id} goal={g} today={today} onOpen={(x) => detail.show(x.id)} />
          ))}
        </div>
      )}
      <SavedSheet
        goal={open}
        open={detail.open && open !== null}
        onClose={detail.close}
        onEdit={(g) => {
          detail.close()
          form.show(g)
        }}
      />
      <FinanceGoalForm open={form.open} onClose={form.close} goal={form.item} />
    </section>
  )
}
