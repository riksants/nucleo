import { ExternalLink, Pencil } from 'lucide-react'
import { navigate } from '../../app/router'
import { optionOf, PROJECT_KIND, PROJECT_STATUS, TASK_STATUS } from '../../data/labels'
import { projectOutstanding } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Project } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { displayUrl, normalizeUrl } from '../../lib/links'
import { formatMoney } from '../../lib/money'
import { Button } from '../../ui/Button'
import { Badge, InfoRow, SectionTitle } from '../../ui/Display'
import { Sheet } from '../../ui/Sheet'
import { useNames } from '../shared/useNames'

export function ProjectDetail({ project, open, onClose, onEdit }: { project: Project | null; open: boolean; onClose(): void; onEdit(p: Project): void }) {
  const { data } = useStore()
  const names = useNames()
  const current = project ? (data.projects.find((p) => p.id === project.id) ?? project) : null
  if (!current) return null

  const status = optionOf(PROJECT_STATUS, current.status)
  const tasks = data.tasks.filter((t) => t.projectId === current.id)
  const accounts = data.accounts.filter((a) => a.projectId === current.id)
  const outstanding = projectOutstanding(current)
  const client = names.client(current.clientId)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={current.name}
      size="lg"
      footer={
        <Button size="lg" block variant="secondary" icon={<Pencil size={18} />} onClick={() => onEdit(current)}>
          Editar projeto
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2 pb-4">
        <Badge tone={status.tone}>{status.label}</Badge>
        <Badge>{optionOf(PROJECT_KIND, current.kind).label}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 pb-2">
        {[
          { label: 'Cobrado', value: current.charged, className: '' },
          { label: 'Recebido', value: current.received, className: 'text-income' },
          { label: 'A receber', value: outstanding, className: outstanding > 0 ? 'text-warn' : 'text-soft' },
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
    </Sheet>
  )
}
