import { ChevronRight, ExternalLink, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { navigate } from '../../app/router'
import { optionOf, PROJECT_KIND, PROJECT_STATUS, TASK_STATUS } from '../../data/labels'
import { projectReceived, receiptTxId } from '../../data/receipts'
import { projectOutstanding } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Project, ProjectPayment } from '../../data/types'
import { useReceipts } from '../../data/useReceipts'
import { formatDateValue } from '../../lib/dates'
import { displayUrl, normalizeUrl } from '../../lib/links'
import { formatMoney } from '../../lib/money'
import { Button } from '../../ui/Button'
import { Badge, InfoRow, SectionTitle } from '../../ui/Display'
import { Sheet } from '../../ui/Sheet'
import { useNames } from '../shared/useNames'
import { ProjectPaymentSheet } from './ProjectPaymentSheet'

export function ProjectDetail({ project, open, onClose, onEdit }: { project: Project | null; open: boolean; onClose(): void; onEdit(p: Project): void }) {
  const { data } = useStore()
  const names = useNames()
  const { saveProject, isPending } = useReceipts()
  /** Payment sheet: new (null), one payment, or the old "Recebido" to launch. */
  const [paying, setPaying] = useState<{ payment: ProjectPayment | null; legacy?: boolean } | null>(null)
  const current = project ? (data.projects.find((p) => p.id === project.id) ?? project) : null
  if (!current) return null

  const status = optionOf(PROJECT_STATUS, current.status)
  const tasks = data.tasks.filter((t) => t.projectId === current.id)
  const accounts = data.accounts.filter((a) => a.projectId === current.id)
  const outstanding = projectOutstanding(current)
  const received = projectReceived(current)
  const paid = current.charged > 0 && outstanding === 0
  const client = names.client(current.clientId)
  const payments = [...(current.payments ?? [])].reverse()

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={current.name}
      size="lg"
      footer={
        // Receiving money is its own action; "Editar projeto" is for the project's details.
        <div className="flex gap-2.5">
          {!paid && (
            <Button size="lg" className="min-w-0 flex-1 px-4! whitespace-nowrap" icon={<Plus size={18} />} onClick={() => setPaying({ payment: null })}>
              Registrar pagamento
            </Button>
          )}
          <Button size="lg" block={paid} className={paid ? '' : 'shrink-0 px-4!'} variant="secondary" icon={<Pencil size={18} />} onClick={() => onEdit(current)}>
            {paid ? 'Editar projeto' : 'Editar'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2 pb-4">
        <Badge tone={status.tone}>{status.label}</Badge>
        <Badge>{optionOf(PROJECT_KIND, current.kind).label}</Badge>
        {/* Paid and done are different things: a finished project can still have money to receive. */}
        {paid && <Badge tone="positive">Quitado</Badge>}
      </div>

      <div className="grid grid-cols-3 gap-2 pb-2">
        {[
          { label: 'Valor', value: current.charged, className: '' },
          { label: 'Recebido', value: received, className: 'text-income' },
          { label: 'Falta', value: outstanding, className: outstanding > 0 ? 'text-ink' : 'text-soft' },
        ].map((x) => (
          <div key={x.label} className="rounded-2xl bg-raised p-3">
            <p className="text-[13px] text-soft">{x.label}</p>
            <p className={`num mt-1 text-[16px] font-semibold ${x.className}`}>{formatMoney(x.value, current.currency)}</p>
          </div>
        ))}
      </div>

      <div className="mt-2">
        {client && (
          <InfoRow label="Cliente">
            <button type="button" className="text-accent-hi" onClick={() => navigate('/clients', { open: current.clientId! })}>
              {client}
            </button>
          </InfoRow>
        )}
        <InfoRow label="Início">{formatDateValue(current.startDate) || '—'}</InfoRow>
        <InfoRow label="Prazo">{formatDateValue(current.dueDate) || '—'}</InfoRow>
        <InfoRow label="Terminou">{formatDateValue(current.endDate) || '—'}</InfoRow>
        {current.link && (
          <InfoRow label="Link">
            <a href={normalizeUrl(current.link)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-accent-hi">
              {displayUrl(current.link)}
              <ExternalLink size={14} />
            </a>
          </InfoRow>
        )}
      </div>

      {current.notes && <p className="mt-4 rounded-2xl bg-raised p-4 text-[15px] leading-relaxed whitespace-pre-wrap text-soft">{current.notes}</p>}

      {(payments.length > 0 || current.received > 0) && (
        <section className="mt-6" aria-label="Pagamentos">
          <SectionTitle>Pagamentos</SectionTitle>
          <div className="card divide-y divide-line overflow-hidden">
            {payments.map((p) => (
              <button key={p.id} type="button" onClick={() => setPaying({ payment: p })} className="tap flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left">
                <span className="min-w-0 flex-1">
                  <span className="num block text-[15px] font-medium text-income">{formatMoney(p.amount, p.currency)}</span>
                  <span className="block truncate text-[13px] text-faint">
                    {formatDateValue(p.date)}
                    {p.note ? ` · ${p.note}` : ''}
                  </span>
                </span>
                {isPending(receiptTxId('project', p.id)) && <Badge tone="warn">aguardando cotação</Badge>}
                <ChevronRight size={18} className="shrink-0 text-faint" />
              </button>
            ))}
            {current.received > 0 && (
              <div className="px-4 py-3">
                <p className="text-[15px]">
                  <span className="num font-medium">{formatMoney(current.received, current.currency)}</span>{' '}
                  <span className="text-soft">registrados antes do histórico</span>
                </p>
                {current.legacyReceived === 'inFinance' ? (
                  <p className="mt-0.5 text-[13px] text-faint">Você indicou que já estão no Financeiro.</p>
                ) : (
                  <>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-faint">Não foram lançados no Financeiro por aqui. Se você já lançou à mão, marque para não contar duas vezes.</p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => void saveProject({ ...current, legacyReceived: 'inFinance' })}>
                        Já está no Financeiro
                      </Button>
                      <Button variant="secondary" onClick={() => setPaying({ payment: null, legacy: true })}>
                        Lançar no Financeiro agora
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {tasks.length > 0 && (
        <section className="mt-6">
          <SectionTitle action="Ver tarefas" onAction={() => navigate('/tasks')}>
            Tarefas · {tasks.filter((t) => t.status !== 'done').length} pendentes
          </SectionTitle>
          <ul className="space-y-1">
            {tasks.slice(0, 6).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl px-1 py-2 text-[15px]">
                <span className={`truncate ${t.status === 'done' ? 'text-faint line-through' : ''}`}>{t.title}</span>
                <span className="shrink-0 text-[13px] text-faint">{optionOf(TASK_STATUS, t.status).label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {accounts.length > 0 && (
        <section className="mt-6">
          <SectionTitle>Contas relacionadas</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <button key={a.id} type="button" onClick={() => navigate('/accounts', { open: a.id })} className="press h-9 rounded-full border border-line bg-raised px-3.5 text-sm">
                {a.name}
              </button>
            ))}
          </div>
        </section>
      )}
      <ProjectPaymentSheet project={current} payment={paying?.payment} legacy={paying?.legacy} open={paying !== null} onClose={() => setPaying(null)} />
    </Sheet>
  )
}
