import { FolderKanban } from 'lucide-react'
import { PageHeader } from '../../app/Shell'
import { ACTIVE_PROJECT_STATUSES, projectOutstanding, sortByNewest, sumIn } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Project } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { usePref } from '../../lib/prefs'
import { EmptyState } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { Chips } from '../../ui/Segmented'
import { useOpenParam } from '../useOpenParam'
import { ProjectCard } from './ProjectCard'
import { ProjectDetail } from './ProjectDetail'
import { ProjectForm } from './ProjectForm'
import { ProjectPaymentSheet } from './ProjectPaymentSheet'

type Filter = 'active' | 'idea' | 'paused' | 'done' | 'all'

const FILTERS: { value: Filter; label: string; test(p: Project): boolean }[] = [
  { value: 'active', label: 'Ativos', test: (p) => ACTIVE_PROJECT_STATUSES.has(p.status) },
  { value: 'idea', label: 'Ideias', test: (p) => p.status === 'idea' },
  { value: 'paused', label: 'Pausados', test: (p) => p.status === 'paused' },
  { value: 'done', label: 'Concluídos', test: (p) => p.status === 'done' },
  { value: 'all', label: 'Todos', test: () => true },
]

export function ProjectsPage() {
  const { data, displayCurrency, convert } = useStore()
  const [filter, setFilter] = usePref<Filter>('projects.filter', 'active')
  const detail = useSheet<Project>()
  const form = useSheet<Project>()
  const receive = useSheet<Project>()
  useOpenParam(data.projects, detail.show)

  const test = FILTERS.find((f) => f.value === filter)?.test ?? (() => true)
  const list = sortByNewest(data.projects).filter(test)
  const activeCount = data.projects.filter((p) => ACTIVE_PROJECT_STATUSES.has(p.status)).length
  const receivable = sumIn(
    data.projects.map((p) => ({ cents: projectOutstanding(p), currency: p.currency })),
    displayCurrency,
    convert,
  )

  const edit = (p: Project | null) => {
    detail.close()
    form.show(p)
  }

  return (
    <>
      <PageHeader
        title="Projetos"
        subtitle="De trabalho · prazos e valores a receber"
        primary={{ label: 'Novo', aria: 'Novo projeto', onPress: () => edit(null) }}
      />

      {data.projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban size={22} />}
          title="Nenhum projeto ainda"
          text="Registre os sites e apps que você faz, com prazos e valores."
          action="Adicionar projeto"
          onAction={() => edit(null)}
        />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3">
            <div className="card p-4">
              <p className="text-[13px] text-soft">Em andamento</p>
              <p className="num mt-1 text-[24px] font-semibold">{activeCount}</p>
            </div>
            <div className="card p-4">
              <p className="text-[13px] text-soft">A receber</p>
              <p className={`num mt-1 text-[24px] font-semibold ${receivable.total > 0 ? 'text-accent-hi' : ''}`}>
                {formatMoney(receivable.total, displayCurrency, { compact: true })}
              </p>
            </div>
          </div>
          <div className="mb-5">
            <Chips value={filter} onChange={setFilter} options={FILTERS} />
          </div>
          {list.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {list.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={detail.show} onReceive={receive.show} />
              ))}
            </div>
          ) : (
            <EmptyState compact icon={<FolderKanban size={22} />} title="Nada por aqui" text="Nenhum projeto com esse status." />
          )}
        </>
      )}

      <ProjectDetail project={detail.item} open={detail.open} onClose={detail.close} onEdit={edit} />
      <ProjectForm project={form.item} open={form.open} onClose={form.close} />
      <ProjectPaymentSheet project={receive.item ? (data.projects.find((p) => p.id === receive.item!.id) ?? receive.item) : null} open={receive.open} onClose={receive.close} />
    </>
  )
}
