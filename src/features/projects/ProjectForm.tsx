import { PROJECT_KIND, PROJECT_STATUS } from '../../data/labels'
import { belongsToProject, projectChargedProblem } from '../../data/receipts'
import { useStore } from '../../data/store'
import { useReceipts } from '../../data/useReceipts'
import type { Project, ProjectKind, ProjectStatus } from '../../data/types'
import { toDateInput } from '../../lib/dates'
import { amountToInput, currencyInfo } from '../../lib/money'
import { useFeedback } from '../../ui/Feedback'
import { CurrencyPicker, Field, FormGrid, Select, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { ClientSelect } from '../shared/RelationSelect'
import { parseMoney } from '../../lib/calc'
import { AmountField } from '../../ui/AmountField'

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
  const { toast, confirm } = useFeedback()
  const del = useDelete()
  const { saveProject, removeProject, linkedCount } = useReceipts()
  // Payments are in this currency (and in Financeiro): it can't change anymore.
  const currencyLocked = (project?.payments?.length ?? 0) > 0
  const [d, set] = useDraft(open, () => ({
    name: project?.name ?? initial?.name ?? '',
    clientId: project?.clientId ?? null,
    kind: project?.kind ?? ('site' as ProjectKind),
    status: project?.status ?? ('notStarted' as ProjectStatus),
    startDate: project?.startDate ?? toDateInput(),
    dueDate: project?.dueDate ?? '',
    endDate: project?.endDate ?? '',
    charged: project ? amountToInput(project.charged) : '',
    currency: project?.currency ?? displayCurrency,
    link: project?.link ?? '',
    notes: project?.notes ?? initial?.notes ?? '',
  }))

  const submit = async () => {
    if (!d.name.trim()) return 'Dê um nome ao projeto'
    const charged = d.charged.trim() ? parseMoney(d.charged) : 0
    if (charged === null) return 'Confira o valor'
    // Money received is registered with "Registrar pagamento", never typed here.
    const chargedProblem = project ? projectChargedProblem(project, charged, project.currency) : null
    if (chargedProblem) return chargedProblem
    const endDate = d.status === 'done' && !d.endDate ? toDateInput() : d.endDate
    const fields = { ...d, name: d.name.trim(), link: d.link.trim(), notes: d.notes.trim(), charged, endDate, currency: currencyLocked ? project!.currency : d.currency }
    // An existing project goes through the receipts layer: a new name reaches its incomes in Financeiro.
    const saved = project ? await saveProject({ ...project, ...fields }) : await save('projects', { ...fields, received: 0 })
    toast(project ? 'Projeto atualizado' : 'Projeto criado')
    onSaved?.(saved)
    onClose()
  }

  const deleteProject = async (p: Project) => {
    const linked = linkedCount(belongsToProject(p.id))
    if (!linked) return del('projects', p.id, 'projeto', { after: () => (onClose(), onDeleted?.()) })
    const ok = await confirm({
      title: 'Excluir projeto?',
      message: `${linked === 1 ? 'A entrada deste pagamento continua' : `As ${linked} entradas dos pagamentos continuam`} no Financeiro (o dinheiro foi recebido), mas ${linked === 1 ? 'fica' : 'ficam'} sem vínculo com o projeto.`,
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (!ok) return
    await removeProject(p)
    onClose()
    onDeleted?.()
    toast('Projeto excluído')
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={project ? 'Editar projeto' : 'Novo projeto'}
      submitLabel={project ? 'Salvar' : 'Criar projeto'}
      onSubmit={submit}
      size="lg"
      onDelete={project ? () => deleteProject(project) : undefined}
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
          {currencyLocked ? (
            <p className="text-[15px] text-soft">
              {currencyInfo(project!.currency).symbol} {project!.currency} <span className="text-faint">· não muda depois de registrar pagamentos</span>
            </p>
          ) : (
            <CurrencyPicker value={d.currency} onChange={(c) => set('currency', c)} />
          )}
        </Field>
        <Field label="Valor do projeto" hint="o combinado; o que entra no saldo são os pagamentos">
          <AmountField currency={d.currency} value={d.charged} onChange={(v) => set('charged', v)} />
        </Field>
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
