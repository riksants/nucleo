import type { InputHTMLAttributes } from 'react'
import { CLIENT_STATUS } from '../../data/labels'
import { useStore } from '../../data/store'
import type { Client, ClientStatus } from '../../data/types'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, Select, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft } from '../../ui/formHooks'

export function ClientForm({ open, onClose, client }: { open: boolean; onClose(): void; client: Client | null }) {
  const { save } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const [d, set] = useDraft(open, () => ({
    name: client?.name ?? '',
    company: client?.company ?? '',
    phone: client?.phone ?? '',
    whatsapp: client?.whatsapp ?? '',
    email: client?.email ?? '',
    location: client?.location ?? '',
    notes: client?.notes ?? '',
    status: client?.status ?? ('active' as ClientStatus),
  }))

  const submit = async () => {
    if (!d.name.trim()) return 'Informe o nome do cliente'
    const trimmed = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])) as typeof d
    await save('clients', { ...client, ...trimmed })
    toast(client ? 'Cliente atualizado' : 'Cliente adicionado')
    onClose()
  }

  const text = (key: keyof typeof d, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}, half = false) => (
    <div className={half ? 'half' : ''}>
      <Field label={label}>
        <TextInput value={d[key]} onChange={(e) => set(key, e.target.value as never)} {...props} />
      </Field>
    </div>
  )

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={client ? 'Editar cliente' : 'Novo cliente'}
      submitLabel={client ? 'Salvar' : 'Adicionar cliente'}
      onSubmit={submit}
      size="lg"
      onDelete={client ? () => del('clients', client.id, 'cliente', { after: onClose }) : undefined}
    >
      <FormGrid>
        {text('name', 'Nome', { autoFocus: !client, autoComplete: 'off' }, true)}
        {text('company', 'Empresa', {}, true)}
        <Field label="Status">
          <Select value={d.status} onChange={(e) => set('status', e.target.value as ClientStatus)}>
            {CLIENT_STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        {text('phone', 'Telefone', { type: 'tel', inputMode: 'tel' }, true)}
        {text('whatsapp', 'WhatsApp', { type: 'tel', inputMode: 'tel', placeholder: '+55 11 90000-0000' }, true)}
        {text('email', 'E-mail', { type: 'email', inputMode: 'email', autoCapitalize: 'none' }, true)}
        {text('location', 'Cidade / país', {}, true)}
        <Field label="Observações">
          <TextArea value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}
