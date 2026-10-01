import { Plus } from 'lucide-react'
import { useState } from 'react'
import { DEFAULT_CATEGORIES } from '../../core/financeCategories'
import { newId, useStore } from '../../data/store'
import type { FinanceCategory, FinanceCategorySettings } from '../../data/types'
import { Button } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { TextInput } from '../../ui/Field'
import { Segmented } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { Switch } from '../settings/ModulePicker'

/**
 * Personal finance categories. Nothing here rewrites movements: hiding only
 * removes a category from the pickers, renaming a personal one changes the
 * label shown for every movement that uses it.
 */
export function CategoriesSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { settings, updateSettings } = useStore()
  const { toast } = useFeedback()
  const [type, setType] = useState<'out' | 'in'>('out')
  const [name, setName] = useState('')
  const cfg: FinanceCategorySettings = settings.financeCategories ?? { custom: [], hidden: [] }
  const hidden = new Set(cfg.hidden)
  const list = [...DEFAULT_CATEGORIES, ...cfg.custom].filter((c) => c.type === type)

  const write = (next: FinanceCategorySettings) => updateSettings({ financeCategories: next })
  const toggle = (c: FinanceCategory) => write({ ...cfg, hidden: hidden.has(c.id) ? cfg.hidden.filter((x) => x !== c.id) : [...cfg.hidden, c.id] })
  const rename = (c: FinanceCategory, label: string) => write({ ...cfg, custom: cfg.custom.map((x) => (x.id === c.id ? { ...x, label } : x)) })
  const add = async () => {
    const label = name.trim()
    if (!label) return
    if (list.some((c) => c.label.toLowerCase() === label.toLowerCase())) return toast('Essa categoria já existe', 'error')
    await write({ ...cfg, custom: [...cfg.custom, { id: `c-${newId()}`, label: label.slice(0, 40), type }] })
    setName('')
    toast('Categoria criada')
  }

  return (
    <Sheet open={open} onClose={onClose} title="Categorias financeiras">
      <div className="space-y-5 pt-1">
        <p className="text-[14px] leading-relaxed text-soft">A categoria é sempre opcional. Ocultar uma categoria não altera as movimentações que já a usam.</p>
        <Segmented<'out' | 'in'> block size="sm" label="Tipo" value={type} onChange={setType} options={[{ value: 'out', label: 'Saídas' }, { value: 'in', label: 'Entradas' }]} />
        <div className="card divide-y divide-line">
          {list.map((c) => {
            const custom = c.id.startsWith('c-')
            return (
              <div key={c.id} className="flex min-h-13 items-center gap-3 px-4 py-2">
                {custom ? (
                  <TextInput aria-label={`Nome da categoria ${c.label}`} defaultValue={c.label} maxLength={40} className="h-10!" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.label && rename(c, e.target.value.trim())} />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[15px]">{c.label}</span>
                )}
                <button type="button" role="switch" aria-checked={!hidden.has(c.id)} aria-label={`Mostrar ${c.label}`} onClick={() => toggle(c)} className="shrink-0 p-1">
                  <Switch checked={!hidden.has(c.id)} />
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex gap-2">
          <TextInput aria-label="Nova categoria" placeholder={type === 'out' ? 'Ex.: Pets' : 'Ex.: Aluguel recebido'} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
          <Button variant="secondary" icon={<Plus size={17} />} onClick={add} className="shrink-0">
            Adicionar
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
