import { PROJECT_KIND, PROJECT_STATUS } from '../../data/labels'
import { useStore } from '../../data/store'
import type { Project, ProjectKind, ProjectStatus } from '../../data/types'
import { toDateInput } from '../../lib/dates'
import { amountToInput, parseAmount } from '../../lib/money'
import { useFeedback } from '../../ui/Feedback'
import { CurrencyPicker, Field, FormGrid, Select, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { ClientSelect } from '../shared/RelationSelect'

export function ProjectForm({
  open,
  onClose,
  project,
  onDeleted,
  initial,
  onSaved,
}: {
  open: boolean
  onClose(): void
  project: Project | null
  onDeleted?(): void
  /** Prefill for a new project (e.g. converting an inbox item). */
  initial?: { name?: string; notes?: string }
  onSaved?(project: Project): void
}) {
  const { save, displayCurrency } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const [d, set] = useDraft(open, () => ({
    name: project?.name ?? initial?.name ?? '',
    clientId: project?.clientId ?? null,
    kind: project?.kind ?? ('site' as ProjectKind),
    status: project?.status ?? ('notStarted' as ProjectStatus),
    startDate: project?.startDate ?? toDateInput(),
    dueDate: project?.dueDate ?? '',
    endDate: project?.endDate ?? '',
    charged: project ? amountToInput(project.charged) : '',
    received: project ? amountToInput(project.received) : '',
    currency: project?.currency ?? displayCurrency,
    link: project?.link ?? '',
    notes: project?.notes ?? initial?.notes ?? '',
  }))

  const submit = async () => {
    if (!d.name.trim()) return 'Dê um nome ao projeto'
    const charged = d.charged.trim() ? parseAmount(d.charged) : 0
    const received = d.received.trim() ? parseAmount(d.received) : 0
    if (charged === null || received === null) return 'Confira os valores'
    const endDate = d.status === 'done' && !d.endDate ? toDateInput() : d.endDate
    const saved = await save('projects', { ...project, ...d, name: d.name.trim(), link: d.link.trim(), notes: d.notes.trim(), charged, received, endDate })
    toast(project ? 'Projeto atualizado' : 'Projeto criado')
    onSaved?.(saved)
    onClose()
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={project ? 'Editar projeto' : 'Novo projeto'}
      submitLabel={project ? 'Salvar' : 'Criar projeto'}
      onSubmit={submit}
      size="lg"
      onDelete={project ? () => del('projects', project.id, 'projeto', {
                after: () => {
                  onClose()
                  onDeleted?.()
                },
              }) : undefined}
    >
      <FormGrid>
        <Field label="Nome do projeto">
          <TextInput value={d.name} onChange={(e) => set('name', e.target.value)} autoFocus={!project} />
        </Field>
        <div className="half">
          <Field label="Tipo">
            <Segmented block value={d.kind} onChange={(v) => set('kind', v)} options={PROJECT_KIND} />
          </Field>
        </div>
        <div className="half">
          <Field label="Cliente" hint="opcional">
            <ClientSelect value={d.clientId} onChange={(v) => set('clientId', v)} />
          </Field>
        </div>
        <Field label="Status">
          <Select value={d.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
            {PROJECT_STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="half">
          <Field label="Início">
            <TextInput type="date" value={d.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Prazo" hint="opcional">
            <TextInput type="date" value={d.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Terminou em">
            <TextInput type="date" value={d.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </Field>
        </div>
        <Field label="Moeda">
          <CurrencyPicker value={d.currency} onChange={(c) => set('currency', c)} />
        </Field>
        <div className="half">
          <Field label="Valor cobrado">
            <TextInput className="num" inputMode="decimal" placeholder="0,00" value={d.charged} onChange={(e) => set('charged', e.target.value)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Valor recebido">
            <TextInput className="num" inputMode="decimal" placeholder="0,00" value={d.received} onChange={(e) => set('received', e.target.value)} />
          </Field>
        </div>
        <Field label="Link" hint="opcional">
          <TextInput type="url" inputMode="url" autoCapitalize="none" placeholder="site.com" value={d.link} onChange={(e) => set('link', e.target.value)} />
        </Field>
        <Field label="Observações" hint="opcional">
          <TextArea value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}
