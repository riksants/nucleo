import { isTime } from '../../../supabase/functions/_shared/planner/time.ts'
import { completionId } from '../../core/completions'
import { endRecurring, recurringOn, recurringState } from '../../core/habits'
import { nowIn, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import type { RecurrenceRule, RecurringItem } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, Select, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft } from '../../ui/formHooks'
import { ToggleRow } from '../planner/controls'
import { RuleEditor, ruleProblem } from '../daily/RuleEditor'
import { MoreOptions, SmartLine } from '../daily/SmartCapture'

/** Minutes before, for items with a time (the general "Notificações" setting applies when empty). */
const LEADS = [
  { value: '', label: 'Padrão das notificações' },
  { value: '0', label: 'Na hora' },
  { value: '5', label: '5 min antes' },
  { value: '15', label: '15 min antes' },
  { value: '30', label: '30 min antes' },
  { value: '60', label: '1 h antes' },
  { value: '1440', label: '1 dia antes' },
]

/** `initial`: values suggested elsewhere (Caixa de entrada, Anotações, frase); `onSaved` links the source to the new item. */
export function RecurringForm({
  open,
  onClose,
  item,
  initial,
  onSaved,
}: {
  open: boolean
  onClose(): void
  item: RecurringItem | null
  initial?: { title?: string; rule?: RecurrenceRule; bill?: boolean; time?: string; startDate?: string }
  onSaved?(saved: RecurringItem): void
}) {
  const { data, save, remove, settings } = useStore()
  const { toast, confirm } = useFeedback()
  const now = nowIn(zoneOf(settings))
  const [d, set, setAll] = useDraft(open, () => ({
    title: item?.title ?? initial?.title ?? '',
    rule: (item?.rule ?? initial?.rule ?? { type: 'weekdays', days: [now.weekday] }) as RecurrenceRule,
    time: item?.time ?? initial?.time ?? '',
    notes: item?.notes ?? '',
    active: item?.active ?? true,
    bill: item?.bill ?? initial?.bill ?? false,
    remindDays: item?.remindDays === undefined ? '' : String(item.remindDays),
    remindMin: item?.remindMin === undefined ? '' : String(item.remindMin),
    startDate: item?.startDate ?? initial?.startDate ?? now.date,
    endDate: item?.endDate ?? '',
  }))
  const state = item ? recurringState(item, now.date) : 'active'

  const submit = async () => {
    if (!d.title.trim()) return 'Escreva o que se repete'
    const problem = ruleProblem(d.rule)
    if (problem) return problem
    if (d.time && !isTime(d.time)) return 'Confira o horário'
    if (!d.startDate) return 'Escolha a data de início'
    if (d.endDate && d.endDate < d.startDate) return 'O término precisa ser depois do início'
    const saved = await save('recurring', {
      ...item,
      title: d.title.trim(),
      rule: d.rule,
      time: d.time,
      notes: d.notes.trim(),
      active: d.active,
      bill: d.bill || undefined,
      remindDays: d.remindDays === '' ? undefined : Number(d.remindDays),
      remindMin: d.remindMin === '' || !d.time ? undefined : Number(d.remindMin),
      startDate: d.startDate,
      endDate: d.endDate || undefined,
    })
    toast(item ? 'Item atualizado' : 'Item recorrente criado')
    onSaved?.(saved)
    onClose()
  }

  const del = async () => {
    if (!item) return
    const ok = await confirm({ title: 'Excluir item recorrente?', message: 'Para parar sem apagar, use Pausar ou Encerrar. As marcações já feitas ficam guardadas.', confirmLabel: 'Excluir', danger: true })
    if (!ok) return
    await remove('recurring', item.id)
    toast('Item excluído')
    onClose()
  }

  /** Pausar / Retomar: the rule stays; while paused nothing shows or reminds. */
  const togglePause = async () => {
    if (!item) return
    await save('recurring', { ...item, active: !item.active })
    toast(item.active ? `${item.title}: pausado` : `${item.title}: retomado`)
    onClose()
  }

  /** Encerrar: no more occurrences from now on; history and today's mark stay. */
  const finish = async () => {
    if (!item) return
    const ok = await confirm({ title: 'Encerrar esta recorrência?', message: 'Ela para de aparecer e de lembrar a partir de agora. O histórico fica guardado e você pode retomar depois.', confirmLabel: 'Encerrar' })
    if (!ok) return
    const marked = recurringOn(item, now.date) && data.completions.some((c) => c.id === completionId('recurring', item.id, now.date))
    await save('recurring', endRecurring(item, now.date, marked))
    toast(`${item.title}: encerrado`)
    onClose()
  }

  /** Back from "Encerrado": continues from today with the same rule. */
  const resume = async () => {
    if (!item) return
    await save('recurring', { ...item, active: true, endDate: undefined })
    toast(`${item.title}: retomado`)
    onClose()
  }

  return (
    <FormSheet open={open} onClose={onClose} title={item ? 'Editar recorrente' : 'Novo recorrente'} submitLabel={item ? 'Salvar' : 'Criar'} onSubmit={submit} onDelete={item ? del : undefined}>
      <FormGrid>
        {item && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${state === 'active' ? 'bg-income/[0.14] text-income' : state === 'paused' ? 'bg-warn/[0.14] text-warn' : 'bg-tint/[0.06] text-faint'}`}>
              {state === 'active' ? 'Ativo' : state === 'paused' ? 'Pausado' : `Encerrado em ${formatDateValue(item.endDate!)}`}
            </span>
            <span className="flex-1" />
            {state === 'ended' ? (
              <button type="button" onClick={resume} className="press h-9 rounded-full px-3.5 text-[14px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
                Retomar
              </button>
            ) : (
              <>
                <button type="button" onClick={togglePause} className="press h-9 rounded-full px-3.5 text-[14px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
                  {state === 'paused' ? 'Retomar' : 'Pausar'}
                </button>
                <button type="button" onClick={finish} className="press h-9 rounded-full px-3.5 text-[14px] font-medium text-soft hover:text-ink">
                  Encerrar
                </button>
              </>
            )}
          </div>
        )}
        {!item && (
          <SmartLine
            placeholder="Ex.: Estudar inglês toda segunda e quarta às 19h"
            onDraft={(x) => setAll((v) => ({ ...v, title: x.title || v.title, rule: x.rule ?? v.rule, time: x.time ?? v.time, startDate: x.date && x.date >= now.date ? x.date : v.startDate }))}
          />
        )}
        <Field label="O que fazer">
          <TextInput value={d.title} placeholder="Ex.: Pagar aluguel" onChange={(e) => set('title', e.target.value)} autoFocus={!item && !initial?.title} />
        </Field>
        <RuleEditor key={`${open}:${item?.id ?? 'new'}`} fresh={!item} value={d.rule} onChange={(r) => set('rule', r)} kinds={['daily', 'weekly', 'monthly', 'interval']} today={now.weekday} />
        <Field label="Horário" hint="opcional">
          <TextInput type="time" value={d.time} onChange={(e) => set('time', e.target.value)} />
        </Field>
        <ToggleRow checked={d.bill} onChange={(v) => set('bill', v)} hint="Aluguel, internet, boleto… avisa com antecedência">
          É uma conta ou pagamento
        </ToggleRow>
        <MoreOptions defaultOpen={Boolean(item?.endDate || (initial?.startDate && initial.startDate !== now.date))}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Começa em">
              <TextInput type="date" value={d.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
            <Field label="Termina em" hint="opcional">
              <TextInput type="date" value={d.endDate} min={d.startDate} onChange={(e) => set('endDate', e.target.value)} />
            </Field>
          </div>
          {d.time && (
            <Field label="Lembrar">
              <Select value={d.remindMin} onChange={(e) => set('remindMin', e.target.value)}>
                {LEADS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={d.time ? 'Avisar dias antes' : 'Lembrar'}>
            <Select value={d.remindDays} onChange={(e) => set('remindDays', e.target.value)}>
              <option value="">{d.bill ? 'Padrão (2 dias antes e no dia)' : 'Padrão (no dia)'}</option>
              <option value="0">{d.time ? 'Não' : 'No dia'}</option>
              <option value="1">1 dia antes</option>
              <option value="2">2 dias antes</option>
              <option value="3">3 dias antes</option>
              <option value="7">1 semana antes</option>
            </Select>
          </Field>
          <Field label="Observações" hint="opcional">
            <TextArea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </MoreOptions>
      </FormGrid>
    </FormSheet>
  )
}
