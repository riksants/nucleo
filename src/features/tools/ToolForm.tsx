import { TOOL_BILLING, TOOL_STATUS } from '../../data/labels'
import { useStore } from '../../data/store'
import type { Tool, ToolBilling, ToolStatus } from '../../data/types'
import { amountToInput } from '../../lib/money'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, MoneyInput, Select, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft } from '../../ui/formHooks'
import { parseMoney } from '../../lib/calc'

export function ToolForm({ open, onClose, tool }: { open: boolean; onClose(): void; tool: Tool | null }) {
  const { save, displayCurrency } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const [d, set] = useDraft(open, () => ({
    name: tool?.name ?? '',
    link: tool?.link ?? '',
    plan: tool?.plan ?? '',
    price: tool ? amountToInput(tool.price) : '',
    currency: tool?.currency ?? displayCurrency,
    billing: tool?.billing ?? ('monthly' as ToolBilling),
    nextCharge: tool?.nextCharge ?? '',
    notes: tool?.notes ?? '',
    status: tool?.status ?? ('active' as ToolStatus),
  }))

  const free = d.billing === 'free'
  const recurring = d.billing === 'monthly' || d.billing === 'yearly'

  const submit = async () => {
    if (!d.name.trim()) return 'Informe o nome da assinatura'
    const price = free || !d.price.trim() ? 0 : parseMoney(d.price)
    if (price === null) return 'Confira o preço'
    await save('tools', {
      ...tool,
      ...d,
      name: d.name.trim(),
      link: d.link.trim(),
      plan: d.plan.trim(),
      notes: d.notes.trim(),
      price,
      nextCharge: recurring ? d.nextCharge : '',
      status: free && d.status === 'active' ? 'free' : d.status,
    })
    toast(tool ? 'Assinatura atualizada' : 'Assinatura adicionada')
    onClose()
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={tool ? 'Editar assinatura' : 'Nova assinatura'}
      submitLabel={tool ? 'Salvar' : 'Adicionar'}
      onSubmit={submit}
      size="lg"
      onDelete={tool ? () => del('tools', tool.id, 'assinatura', { feminine: true, after: onClose }) : undefined}
    >
      <FormGrid>
        <div className="half">
          <Field label="Nome">
            <TextInput value={d.name} onChange={(e) => set('name', e.target.value)} autoFocus={!tool} />
          </Field>
        </div>
        <div className="half">
          <Field label="Plano" hint="opcional">
            <TextInput value={d.plan} onChange={(e) => set('plan', e.target.value)} placeholder="Ex.: Pro" />
          </Field>
        </div>
        <Field label="Site / link" hint="opcional">
          <TextInput type="url" inputMode="url" autoCapitalize="none" value={d.link} onChange={(e) => set('link', e.target.value)} placeholder="site.com" />
        </Field>
        <div className="half">
          <Field label="Recorrência">
            <Select value={d.billing} onChange={(e) => set('billing', e.target.value as ToolBilling)}>
              {TOOL_BILLING.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="half">
          <Field label="Status">
            <Select value={d.status} onChange={(e) => set('status', e.target.value as ToolStatus)}>
              {TOOL_STATUS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {!free && (
          <Field label="Preço">
            <MoneyInput value={d.price} onChange={(v) => set('price', v)} currency={d.currency} onCurrency={(c) => set('currency', c)} />
          </Field>
        )}
        {recurring && (
          <Field label="Próxima cobrança" hint="opcional">
            <TextInput type="date" value={d.nextCharge} onChange={(e) => set('nextCharge', e.target.value)} />
          </Field>
        )}
        <Field label="Observação" hint="opcional">
          <TextArea rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}
