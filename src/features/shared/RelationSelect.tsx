import { useStore } from '../../data/store'
import { Select } from '../../ui/Field'

export function ClientSelect({ value, onChange }: { value: string | null; onChange(id: string | null): void }) {
  const { data } = useStore()
  const clients = [...data.clients].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Nenhum</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
          {c.company ? ` · ${c.company}` : ''}
        </option>
      ))}
    </Select>
  )
}

export function ProjectSelect({ value, onChange }: { value: string | null; onChange(id: string | null): void }) {
  const { data } = useStore()
  const projects = [...data.projects].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Nenhum</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  )
}
