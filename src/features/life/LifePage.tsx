import { useEffect, useState } from 'react'
import { useRoute } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { useStore } from '../../data/store'
import { Segmented } from '../../ui/Segmented'
import { ChangesView } from './ChangesView'
import { LifeCalendar } from './LifeCalendar'
import { PlansView } from './Plans'

type View = 'calendar' | 'projects' | 'objectives' | 'changes'
const VIEWS: { value: View; label: string }[] = [
  { value: 'calendar', label: 'Calendário' },
  { value: 'projects', label: 'Projetos pessoais' },
  { value: 'objectives', label: 'Objetivos' },
  { value: 'changes', label: 'O que mudou?' },
]

/** "Vida": internal navigation (no new tabs in the bottom bar). */
export function LifePage() {
  const { params } = useRoute()
  const { data } = useStore()
  const requested = params.get('view') as View | null
  // A link to a plan (search, calendar) opens the list that holds it.
  const openId = params.get('open')
  const fromOpen = openId ? data.lifePlans.find((p) => p.id === openId)?.kind : undefined
  const linked: View | null = fromOpen === 'objective' ? 'objectives' : fromOpen === 'project' ? 'projects' : VIEWS.some((v) => v.value === requested) ? requested! : null
  // Kept in state: opening an item clears the URL params, the tab must stay.
  const [view, setView] = useState<View>(linked ?? 'calendar')
  useEffect(() => {
    if (linked) setView(linked)
  }, [linked, openId])

  return (
    <>
      <PageHeader title="Vida" />
      <div className="no-scrollbar -mx-5 mb-5 overflow-x-auto px-5 lg:mx-0 lg:px-0">
        <Segmented<View> size="sm" label="Vida" value={view} onChange={setView} options={VIEWS} />
      </div>
      {view === 'calendar' && <LifeCalendar />}
      {view === 'projects' && <PlansView key="projects" kind="project" />}
      {view === 'objectives' && <PlansView key="objectives" kind="objective" />}
      {view === 'changes' && <ChangesView />}
    </>
  )
}
