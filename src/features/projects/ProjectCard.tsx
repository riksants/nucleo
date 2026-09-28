import { motion } from 'framer-motion'
import { CalendarClock } from 'lucide-react'
import { optionOf, PROJECT_KIND, PROJECT_STATUS } from '../../data/labels'
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
  const soon = !done && rel.days >= 0 && rel.days <= 3
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] ${late ? 'text-expense' : soon ? 'text-warn' : 'text-faint'}`}>
      <CalendarClock size={14} />
      {late ? `Atrasado · ${formatDateValue(date)}` : `${formatDateValue(date)} · ${rel.label}`}
    </span>
  )
}

export function ProjectCard({ project, onOpen }: { project: Project; onOpen(p: Project): void }) {
  const names = useNames()
  const status = optionOf(PROJECT_STATUS, project.status)
  const client = names.client(project.clientId)
  const outstanding = projectOutstanding(project)
  const done = project.status === 'done'

  return (
    <motion.button
      layout="position"
      type="button"
      onClick={() => onOpen(project)}
      className="card press block w-full p-5 text-left hover:border-line-strong"
    >
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
              Recebido <span className="num font-medium text-ink">{formatMoney(project.received, project.currency)}</span>
            </span>
            <span className="num text-faint">de {formatMoney(project.charged, project.currency)}</span>
          </div>
          <Progress value={(project.received / project.charged) * 100} tone={outstanding === 0 ? 'positive' : 'accent'} />
        </div>
      )}

      {(project.dueDate || done || outstanding > 0) && (
        <div className="mt-4 flex items-center justify-between gap-2">
          {done && project.endDate ? (
            <span className="text-[13px] text-faint">Concluído {formatDateValue(project.endDate).toLowerCase()}</span>
          ) : (
            <DueLabel date={project.dueDate} />
          )}
          {outstanding > 0 && <span className="num text-[13px] font-medium text-warn">Falta {formatMoney(outstanding, project.currency)}</span>}
        </div>
      )}
    </motion.button>
  )
}
