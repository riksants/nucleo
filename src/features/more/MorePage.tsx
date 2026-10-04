import { ChevronRight, UserRound } from 'lucide-react'
import { PageHeader } from '../../app/Shell'
import { ASSISTANT, SEARCH, secondarySections, SETTINGS, type Section } from '../../app/sections'
import { useStore } from '../../data/store'
import type { CollectionName } from '../../data/types'
import { useSession } from '../account/session'

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
  const { configured, userId, email, openAuth } = useSession()
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
        {/* Conta: who is signed in (sign out lives in Configurações → Conta). */}
        <a href={userId || !configured ? '#/settings' : undefined} onClick={!userId && configured ? (e) => (e.preventDefault(), openAuth('signin')) : undefined} className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-white/[0.03] tap">
          <UserRound size={20} className="text-soft" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">Conta</span>
            <span className="block truncate text-[13px] text-faint">{userId ? (email ?? 'Conectado') : configured ? 'Usando somente neste aparelho · Entrar ou criar conta' : 'Usando somente neste aparelho'}</span>
          </span>
          <ChevronRight size={18} className="text-faint" />
        </a>
        {[ASSISTANT, SEARCH, SETTINGS].map((s) => (
          <a key={s.path} href={`#${s.path}`} className="flex min-h-14 items-center gap-3 px-4 transition-colors hover:bg-white/[0.03] tap">
            <s.icon size={20} className="text-soft" />
            <span className="flex-1 text-[15px]">{s.label}</span>
            <ChevronRight size={18} className="text-faint" />
          </a>
        ))}
      </div>
    </>
  )
}
