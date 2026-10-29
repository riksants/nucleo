import { isTime } from '../../../supabase/functions/_shared/planner/time.ts'
import { nowIn, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import type { RecurrenceRule, RecurringItem } from '../../data/types'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, Select, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft } from '../../ui/formHooks'
import { ToggleRow } from '../planner/controls'
import { RuleEditor, ruleProblem } from '../daily/RuleEditor'

export function RecurringForm({ open, onClose, item }: { open: boolean; onClose(): void; item: RecurringItem | null }) {
  const { save, remove, settings } = useStore()
  const { toast, confirm } = useFeedback()
  const now = nowIn(zoneOf(settings))
  const [d, set] = useDraft(open, () => ({
    title: item?.title ?? '',
    rule: (item?.rule ?? { type: 'weekdays', days: [now.weekday] }) as RecurrenceRule,
    time: item?.time ?? '',
    notes: item?.notes ?? '',
    active: item?.active ?? true,
    bill: item?.bill ?? false,
    remindDays: item?.remindDays === undefined ? '' : String(item.remindDays),
  }))

  const submit = async () => {
    if (!d.title.trim()) return 'Escreva o que se repete'
    const problem = ruleProblem(d.rule)
    if (problem) return problem
    if (d.time && !isTime(d.time)) return 'Confira o horário'
    await save('recurring', {
      ...item,
      title: d.title.trim(),
      rule: d.rule,
      time: d.time,
      notes: d.notes.trim(),
      active: d.active,
      bill: d.bill || undefined,
      remindDays: d.remindDays === '' ? undefined : Number(d.remindDays),
      startDate: item?.startDate ?? now.date,
    })
    toast(item ? 'Item atualizado' : 'Item recorrente criado')
    onClose()
  }

  const del = async () => {
    if (!item) return
    const ok = await confirm({ title: 'Excluir item recorrente?', message: 'Para pausar, desative. As marcações já feitas ficam guardadas.', confirmLabel: 'Excluir', danger: true })
    if (!ok) return
    await remove('recurring', item.id)
    toast('Item excluído')
    onClose()
  }

  return (
    <FormSheet open={open} onClose={onClose} title={item ? 'Editar recorrente' : 'Novo recorrente'} submitLabel={item ? 'Salvar' : 'Criar'} onSubmit={submit} onDelete={item ? del : undefined}>
      <FormGrid>
        <Field label="O que fazer">
          <TextInput value={d.title} placeholder="Ex.: Pagar aluguel" onChange={(e) => set('title', e.target.value)} autoFocus={!item} />
        </Field>
        <RuleEditor value={d.rule} onChange={(r) => set('rule', r)} kinds={['daily', 'weekly', 'weekdays', 'monthly']} today={now.weekday} />
        <div className="half">
          <Field label="Horário" hint="opcional">
            <TextInput type="time" value={d.time} onChange={(e) => set('time', e.target.value)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Lembrar">
            <Select value={d.remindDays} onChange={(e) => set('remindDays', e.target.value)}>
              <option value="">{d.bill ? 'Padrão (2 dias antes e no dia)' : 'Padrão (no dia)'}</option>
              <option value="0">No dia</option>
              <option value="1">1 dia antes</option>
              <option value="2">2 dias antes</option>
              <option value="3">3 dias antes</option>
              <option value="7">1 semana antes</option>
            </Select>
          </Field>
        </div>
        <ToggleRow checked={d.bill} onChange={(v) => set('bill', v)} hint="Aluguel, internet, boleto… avisa com antecedência">
          É uma conta ou pagamento
        </ToggleRow>
        <Field label="Observações" hint="opcional">
          <TextArea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {item && (
          <ToggleRow checked={d.active} onChange={(v) => set('active', v)} hint="Desativado: deixa de aparecer, o histórico fica">
            Ativo
          </ToggleRow>
        )}
      </FormGrid>
    </FormSheet>
  )
}
