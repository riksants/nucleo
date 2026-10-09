import { useStore } from '../../data/store'
import type { Goal } from '../../data/types'
import { amountToInput } from '../../lib/money'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, MoneyInput, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft } from '../../ui/formHooks'
import { parseMoney } from '../../lib/calc'

export function GoalForm({ open, onClose, goal }: { open: boolean; onClose(): void; goal: Goal | null }) {
  const { save, displayCurrency } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const [draft, set] = useDraft(open, () => ({
    name: goal?.name ?? '',
    price: goal ? amountToInput(goal.price) : '',
    currency: goal?.currency ?? displayCurrency,
    note: goal?.note ?? '',
  }))

  const submit = async () => {
    const price = parseMoney(draft.price)
    if (!draft.name.trim()) return 'Dê um nome para a meta'
    if (!price) return 'Informe o valor'
    await save('goals', {
      ...goal,
      name: draft.name.trim(),
      price,
      currency: draft.currency,
      note: draft.note.trim(),
      purchasedAt: goal?.purchasedAt ?? null,
    })
    toast(goal ? 'Meta atualizada' : 'Meta criada')
    onClose()
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={goal ? 'Editar meta' : 'Nova meta'}
      submitLabel={goal ? 'Salvar' : 'Criar meta'}
      onSubmit={submit}
      onDelete={goal ? () => del('goals', goal.id, 'meta', { feminine: true, after: onClose }) : undefined}
    >
      <FormGrid>
        <Field label="Nome">
          <TextInput value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="O que você quer comprar?" autoFocus={!goal} />
        </Field>
        <Field label="Valor">
          <MoneyInput value={draft.price} onChange={(v) => set('price', v)} currency={draft.currency} onCurrency={(c) => set('currency', c)} />
        </Field>
        <Field label="Observação" hint="opcional">
          <TextArea value={draft.note} onChange={(e) => set('note', e.target.value)} rows={3} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}
