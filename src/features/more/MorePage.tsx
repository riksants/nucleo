import { ChevronRight, Search, SlidersHorizontal, UserRound } from 'lucide-react'
import { MODULE_BY_ID, MODULE_GROUPS, type ModuleDef } from '../../app/modules'
import { PageHeader } from '../../app/Shell'
import { ASSISTANT, secondarySections, SETTINGS } from '../../app/sections'
import { useStore } from '../../data/store'
import type { CollectionName } from '../../data/types'
import { SectionTitle } from '../../ui/Display'
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

/** One section: icon, name, what it is for (one line) and how many items it has. */
function SectionRow({ section, count }: { section: ModuleDef; count?: number }) {
  const Icon = section.icon
  return (
    <a href={`#${section.path}`} className="tap flex min-h-16 items-center gap-3 px-4 py-2.5">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent-hi">
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{section.label}</span>
        <span className="block text-[13px] leading-snug text-faint">{section.description}</span>
      </span>
      {count !== undefined && count > 0 && <span className="num shrink-0 text-[15px] text-faint">{count}</span>}
      <ChevronRight size={18} className="shrink-0 text-faint" />
    </a>
  )
}

/**
 * Everything that is not in the tab bar, grouped by what it is for, each with a one-line explanation.
 * Search first; personalising sections and the tab bar at the end.
 */
export function MorePage() {
  const { data, settings } = useStore()
  const { configured, userId, email, openAuth } = useSession()
  const here = new Set(secondarySections(settings).map((s) => s.path))
  const groups = MODULE_GROUPS.map((g) => ({ title: g.title, sections: g.ids.map((id) => MODULE_BY_ID[id]).filter((m) => here.has(m.path)) })).filter((g) => g.sections.length > 0)
  return (
    <>
      <PageHeader title="Mais" />
      <a href="#/search" className="tap mb-6 flex h-12 items-center gap-2.5 rounded-[var(--radius-field)] border border-line bg-raised px-4 text-[15px] text-faint">
        <Search size={18} />
        Buscar em tudo
      </a>
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.title}>
            <SectionTitle>{g.title}</SectionTitle>
            <div className="card divide-y divide-line overflow-hidden">
              {g.sections.map((m) => {
                const key = COUNT_OF[m.path]
                return <SectionRow key={m.path} section={m} count={key ? data[key].length : undefined} />
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="card mt-6 divide-y divide-line overflow-hidden">
        {/* Conta: who is signed in (sign out lives in Configurações → Conta). */}
        <a href={userId || !configured ? '#/settings' : undefined} onClick={!userId && configured ? (e) => (e.preventDefault(), openAuth('signin')) : undefined} className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-tint/[0.03] tap">
          <UserRound size={20} className="text-soft" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">Conta</span>
            <span className="block truncate text-[13px] text-faint">{userId ? (email ?? 'Conectado') : configured ? 'Usando somente neste aparelho · Entrar ou criar conta' : 'Usando somente neste aparelho'}</span>
          </span>
          <ChevronRight size={18} className="text-faint" />
        </a>
        {[ASSISTANT, SETTINGS].map((s) => (
          <a key={s.path} href={`#${s.path}`} className="flex min-h-14 items-center gap-3 px-4 transition-colors hover:bg-tint/[0.03] tap">
            <s.icon size={20} className="text-soft" />
            <span className="flex-1 text-[15px]">{s.label}</span>
            <ChevronRight size={18} className="text-faint" />
          </a>
        ))}
        <a href="#/settings?painel=secoes" className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-tint/[0.03] tap">
          <SlidersHorizontal size={20} className="text-soft" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">Personalizar seções</span>
            <span className="block truncate text-[13px] text-faint">Ligar, desligar e escolher a barra de baixo</span>
          </span>
          <ChevronRight size={18} className="text-faint" />
        </a>
      </div>
    </>
  )
}
