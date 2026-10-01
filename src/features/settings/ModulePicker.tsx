import { motion } from 'framer-motion'
import { MODULES } from '../../app/modules'
import type { ModuleId } from '../../data/types'

/** Suggested starting set for someone new. Everything else is one tap away. */
export const starterModules: Partial<Record<ModuleId, boolean>> = Object.fromEntries(
  MODULES.map((m) => [m.id, ['today', 'finance', 'tasks', 'projects', 'notes', 'inbox', 'habits', 'agenda'].includes(m.id)]),
)

export function Switch({ checked, label }: { checked: boolean; label?: string }) {
  return (
    <span role="presentation" aria-label={label} className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-accent' : 'bg-white/[0.12]'}`}>
      <motion.span
        className="absolute top-0.5 size-6 rounded-full bg-white shadow-sm shadow-black/40"
        initial={false}
        animate={{ left: checked ? 22 : 2 }}
        transition={{ type: 'spring', stiffness: 600, damping: 38 }}
      />
    </span>
  )
}

/** Toggle list of sections. Hiding a section never deletes its data. */
export function ModulePicker({
  value,
  onChange,
  isOn,
  only,
}: {
  value: Partial<Record<ModuleId, boolean>>
  onChange(next: Partial<Record<ModuleId, boolean>>): void
  isOn?(id: ModuleId): boolean
  /** Show just these sections (e.g. the ones that are new). */
  only?: ModuleId[]
}) {
  return (
    <div className="card divide-y divide-line overflow-hidden">
      {MODULES.filter((m) => !only || only.includes(m.id)).map((m) => {
        const on = isOn ? isOn(m.id) : Boolean(value[m.id])
        const Icon = m.icon
        return (
          <button
            key={m.id}
            type="button"
            role="switch"
            aria-checked={on}
            onClick={() => onChange({ ...value, [m.id]: !on })}
            className="flex min-h-15 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
          >
            <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${on ? 'bg-accent/12 text-accent-hi' : 'bg-white/[0.05] text-faint'}`}>
              <Icon size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">{m.label}</span>
              <span className="block truncate text-[13px] text-faint">{m.description}</span>
            </span>
            <Switch checked={on} />
          </button>
        )
      })}
    </div>
  )
}
