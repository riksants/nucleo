import { motion } from 'framer-motion'
import { CalendarClock, Plus } from 'lucide-react'
import { optionOf, PROJECT_KIND, PROJECT_STATUS } from '../../data/labels'
import { projectReceived } from '../../data/receipts'
import { projectOutstanding } from '../../data/selectors'
import type { Project } from '../../data/types'
import { formatDateValue, relativeDays } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { Badge, Progress } from '../../ui/Display'
import { useNames } from '../shared/useNames'

export function DueLabel({ date, done }: { date: string; done?: boolean }) {
  const rel = relativeDays(date)
  if (!rel) return null
  const late = !done && rel.days < 0
  // Amber only when it is really close (today or tomorrow); further ahead is plain information.
  const soon = !done && rel.days >= 0 && rel.days <= 1
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] ${late ? 'text-expense' : soon ? 'text-warn' : 'text-faint'}`}>
      <CalendarClock size={14} />
      {late ? `Atrasado · ${formatDateValue(date)}` : Math.abs(rel.days) <= 1 ? formatDateValue(date) : `${formatDateValue(date)} · ${rel.label}`}
    </span>
  )
}

export function ProjectCard({ project, onOpen, onReceive }: { project: Project; onOpen(p: Project): void; onReceive?(p: Project): void }) {
  const names = useNames()
  const status = optionOf(PROJECT_STATUS, project.status)
  const client = names.client(project.clientId)
  const outstanding = projectOutstanding(project)
  const received = projectReceived(project)
  const done = project.status === 'done'
  // Receiving is one tap from the card while something is missing (also for a finished project).
  const canReceive = Boolean(onReceive) && project.charged > 0 && outstanding > 0

  return (
    <motion.div layout="position" className="card overflow-hidden hover:border-line-strong">
      <button type="button" onClick={() => onOpen(project)} className="press block w-full p-5 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[17px] font-semibold tracking-tight">{project.name}</h3>
            <p className="mt-0.5 truncate text-sm text-soft">
              {optionOf(PROJECT_KIND, project.kind).label}
              {client && ` · ${client}`}
            </p>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
  
        {project.charged > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-baseline justify-between gap-2 text-sm">
              <span className="text-soft">
                Recebido <span className="num font-medium text-ink">{formatMoney(received, project.currency)}</span>
              </span>
              <span className="num text-faint">de {formatMoney(project.charged, project.currency)}</span>
            </div>
            <Progress value={(received / project.charged) * 100} tone={outstanding === 0 ? 'positive' : 'accent'} />
          </div>
        )}
  
        {(project.dueDate || done || outstanding > 0) && (
          <div className="mt-4 flex items-center justify-between gap-2">
            {done && project.endDate ? (
              <span className="text-[13px] text-faint">Concluído {formatDateValue(project.endDate).toLowerCase()}</span>
            ) : (
              <DueLabel date={project.dueDate} />
            )}
            {outstanding > 0 && <span className="num text-[13px] text-soft">Falta <span className="font-semibold text-ink">{formatMoney(outstanding, project.currency)}</span></span>}
          </div>
        )}
        {project.charged > 0 && outstanding === 0 && received > 0 && <p className="mt-3 text-right text-[13px] font-medium text-income">Quitado</p>}
      </button>
      {canReceive && (
        <button
          type="button"
          onClick={() => onReceive!(project)}
          className="tap flex h-12 w-full items-center justify-center gap-1.5 border-t border-line text-[15px] font-medium text-accent-hi hover:text-ink"
        >
          <Plus size={17} />
          Registrar pagamento
        </button>
      )}
    </motion.div>
  )
}
