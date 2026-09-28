import { useStore } from '../../data/store'

/** Looks up client/project names by id for display. */
export function useNames() {
  const { data } = useStore()
  return {
    client: (id: string | null) => (id ? data.clients.find((c) => c.id === id)?.name : undefined),
    project: (id: string | null) => (id ? data.projects.find((p) => p.id === id)?.name : undefined),
  }
}
