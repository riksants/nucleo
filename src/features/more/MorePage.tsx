import { ChevronRight } from 'lucide-react'
import { PageHeader } from '../../app/Shell'
import { ASSISTANT, SEARCH, secondarySections, SETTINGS, type Section } from '../../app/sections'
import { useStore } from '../../data/store'
import type { CollectionName } from '../../data/types'

const COUNT_OF: Partial<Record<string, CollectionName>> = {
  '/clients': 'clients',
  '/goals': 'goals',
  '/tools': 'tools',
  '/accounts': 'accounts',
  '/notes': 'notes',
  '/portfolio': 'portfolio',
  '/sales': 'sales',
  '/subscribers': 'subscribers',
}

function Tile({ section, count }: { section: Section; count?: number }) {
  const Icon = section.icon
  return (
    <a href={`#${section.path}`} className="card press flex flex-col justify-between gap-6 p-4 hover:border-line-strong">
      <span className="grid size-11 place-items-center rounded-2xl bg-accent/12 text-accent-hi">
        <Icon size={21} />
      </span>
      <span className="flex items-end justify-between gap-2">
        <span className="text-[16px] font-semibold tracking-tight">{section.label}</span>
        {count !== undefined && count > 0 && <span className="num text-[15px] text-faint">{count}</span>}
      </span>
    </a>
  )
}

export function MorePage() {
  const { data, settings } = useStore()
  return (
    <>
      <PageHeader title="Mais" />
      <div className="grid grid-cols-2 gap-3">
        {secondarySections(settings).map((s) => {
          const key = COUNT_OF[s.path]
          return <Tile key={s.path} section={s} count={key ? data[key].length : undefined} />
        })}
      </div>
      <div className="card mt-6 divide-y divide-line overflow-hidden">
        {[ASSISTANT, SEARCH, SETTINGS].map((s) => (
          <a key={s.path} href={`#${s.path}`} className="flex min-h-14 items-center gap-3 px-4 transition-colors hover:bg-white/[0.03]">
            <s.icon size={20} className="text-soft" />
            <span className="flex-1 text-[15px]">{s.label}</span>
            <ChevronRight size={18} className="text-faint" />
          </a>
        ))}
      </div>
    </>
  )
}
