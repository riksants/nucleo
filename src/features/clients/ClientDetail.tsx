import { Mail, MessageCircle, Pencil, Phone } from 'lucide-react'
import type { ReactNode } from 'react'
import { navigate } from '../../app/router'
import { CLIENT_STATUS, optionOf, PROJECT_STATUS } from '../../data/labels'
import { projectOutstanding, sumIn } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Client } from '../../data/types'
import { whatsappUrl } from '../../lib/links'
import { formatMoney } from '../../lib/money'
import { Button } from '../../ui/Button'
import { Badge, InfoRow, SectionTitle } from '../../ui/Display'
import { Sheet } from '../../ui/Sheet'

function ContactAction({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="press flex flex-1 flex-col items-center gap-1.5 rounded-2xl bg-raised py-3 text-[13px] font-medium text-soft hover:text-ink">
      <span className="text-accent-hi">{icon}</span>
      {label}
    </a>
  )
}

export function ClientDetail({ client, open, onClose, onEdit }: { client: Client | null; open: boolean; onClose(): void; onEdit(c: Client): void }) {
  const { data, displayCurrency, convert } = useStore()
  const current = client ? (data.clients.find((c) => c.id === client.id) ?? client) : null
  if (!current) return null

  const status = optionOf(CLIENT_STATUS, current.status)
  const projects = data.projects.filter((p) => p.clientId === current.id)
  const projectIds = new Set(projects.map((p) => p.id))
  const openTasks = data.tasks.filter((t) => t.projectId && projectIds.has(t.projectId) && t.status !== 'done')
  const accounts = data.accounts.filter((a) => a.clientId === current.id)
  const received = sumIn(projects.map((p) => ({ cents: p.received, currency: p.currency })), displayCurrency, convert)
  const outstanding = sumIn(projects.map((p) => ({ cents: projectOutstanding(p), currency: p.currency })), displayCurrency, convert)
  const phone = current.phone.replace(/[^\d+]/g, '')

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={current.name}
      size="lg"
      footer={
        <Button size="lg" block variant="secondary" icon={<Pencil size={18} />} onClick={() => onEdit(current)}>
          Editar cliente
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <Badge tone={status.tone}>{status.label}</Badge>
        {current.company && <span className="text-[15px] text-soft">{current.company}</span>}
      </div>

      {(phone || current.whatsapp || current.email) && (
        <div className="mb-4 flex gap-2">
          {phone && <ContactAction href={`tel:${phone}`} icon={<Phone size={20} />} label="Ligar" />}
          {current.whatsapp && <ContactAction href={whatsappUrl(current.whatsapp)} icon={<MessageCircle size={20} />} label="WhatsApp" />}
          {current.email && <ContactAction href={`mailto:${current.email}`} icon={<Mail size={20} />} label="E-mail" />}
        </div>
      )}

      {projects.length > 0 && (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-raised p-3">
            <p className="text-[13px] text-soft">Recebido</p>
            <p className="num mt-1 text-[17px] font-semibold text-income">{formatMoney(received.total, displayCurrency)}</p>
          </div>
          <div className="rounded-2xl bg-raised p-3">
            <p className="text-[13px] text-soft">A receber</p>
            <p className={`num mt-1 text-[17px] font-semibold ${outstanding.total > 0 ? 'text-warn' : 'text-soft'}`}>{formatMoney(outstanding.total, displayCurrency)}</p>
          </div>
        </div>
      )}

      <div>
        {current.email && <InfoRow label="E-mail">{current.email}</InfoRow>}
        {current.phone && <InfoRow label="Telefone">{current.phone}</InfoRow>}
        {current.whatsapp && <InfoRow label="WhatsApp">{current.whatsapp}</InfoRow>}
        {current.location && <InfoRow label="Local">{current.location}</InfoRow>}
      </div>

      {current.notes && <p className="mt-4 rounded-2xl bg-raised p-4 text-[15px] leading-relaxed whitespace-pre-wrap text-soft">{current.notes}</p>}

      {projects.length > 0 && (
        <section className="mt-6">
          <SectionTitle>Projetos · {projects.length}</SectionTitle>
          <div className="space-y-2">
            {projects.map((p) => {
              const s = optionOf(PROJECT_STATUS, p.status)
              return (
                <button key={p.id} type="button" onClick={() => navigate('/projects', { open: p.id })} className="press flex w-full items-center justify-between gap-3 rounded-2xl bg-raised px-4 py-3 text-left">
                  <span className="truncate text-[15px] font-medium">{p.name}</span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </button>
              )
            })}
          </div>
          {openTasks.length > 0 && <p className="mt-3 px-1 text-sm text-soft">{openTasks.length} tarefa(s) pendente(s) nesses projetos</p>}
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
