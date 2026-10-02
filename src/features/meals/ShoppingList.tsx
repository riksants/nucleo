import { Check, ChevronLeft, ChevronRight, Plus, ShoppingBasket, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { mealsOfWeek } from '../../core/meals'
import { addDaysToDate, useToday, weekStart, zoneOf } from '../../core/period'
import { buildList, groupRows, SHOPPING_CATEGORIES, type ListRow } from '../../core/shopping'
import { useStore } from '../../data/store'
import type { ShoppingEntry, WeekId } from '../../data/types'
import { Button, IconButton } from '../../ui/Button'
import { EmptyState } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft, useSheet } from '../../ui/formHooks'
import { weekLabel } from '../week/GoalForm'

/** Edit a row: manual items fully; automatic ones only their category and note. */
function ItemForm({ open, onClose, row, week, categories }: { open: boolean; onClose(): void; row: ListRow | null; week: WeekId; categories: string[] }) {
  const { save, remove } = useStore()
  const { toast } = useFeedback()
  const auto = row?.kind === 'auto'
  const [d, set] = useDraft(open, () => ({ name: row?.name ?? '', qty: row?.record?.qty ?? '', unit: row?.record?.unit ?? '', category: row?.category ?? '', note: row?.note ?? '' }))

  const submit = async () => {
    if (auto && row) {
      await save('shoppingItems', { ...(row.record ?? { week, kind: 'auto', key: row.id.split(':').slice(2).join(':'), name: row.name, qty: '', unit: '', checked: false, note: '' }), id: row.id, category: d.category.trim(), note: d.note.trim() } as ShoppingEntry)
    } else {
      if (!d.name.trim()) return 'Escreva o item'
      await save('shoppingItems', { ...row?.record, week, kind: 'manual', name: d.name.trim().slice(0, 120), qty: d.qty.trim(), unit: d.unit.trim(), category: d.category.trim() || 'Outros', checked: row?.record?.checked ?? false, note: d.note.trim() } as ShoppingEntry)
    }
    toast(row ? 'Item atualizado' : 'Item adicionado')
    onClose()
  }
  const del = row && !auto ? async () => (await remove('shoppingItems', row.id), onClose()) : undefined

  return (
    <FormSheet open={open} onClose={onClose} title={row ? (auto ? row.name : 'Editar item') : 'Novo item'} submitLabel={row ? 'Salvar' : 'Adicionar'} onSubmit={submit} onDelete={del}>
      <FormGrid>
        {auto ? (
          <p className="text-[14px] leading-relaxed text-soft">{row?.orphan ? 'Comprado antes; não está mais nas refeições desta semana.' : `Vem das refeições (${row?.meals} ${row?.meals === 1 ? 'refeição' : 'refeições'})${row?.amount ? ` · ${row.amount}` : ''}. Para mudar a quantidade, edite as refeições.`}</p>
        ) : (
          <>
            <Field label="Item">
              <TextInput value={d.name} maxLength={120} placeholder="Ex.: Detergente" onChange={(e) => set('name', e.target.value)} autoFocus={!row} />
            </Field>
            <div className="half">
              <Field label="Quantidade" hint="opcional">
                <TextInput inputMode="decimal" value={d.qty} maxLength={12} onChange={(e) => set('qty', e.target.value)} />
              </Field>
            </div>
            <div className="half">
              <Field label="Unidade" hint="opcional">
                <TextInput value={d.unit} maxLength={16} placeholder="kg, un, pacote…" onChange={(e) => set('unit', e.target.value)} />
              </Field>
            </div>
          </>
        )}
        <Field label="Categoria" hint="escolha ou digite uma nova">
          <TextInput list="shopping-categories" value={d.category} maxLength={30} onChange={(e) => set('category', e.target.value)} />
          <datalist id="shopping-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Observação" hint="opcional">
          <TextInput value={d.note} maxLength={120} onChange={(e) => set('note', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}

/** Shopping list of one week: computed from the meals + manual items. */
export function ShoppingList({ week, onWeek }: { week: WeekId; onWeek(w: WeekId): void }) {
  const { data, settings, save, remove } = useStore()
  const { confirm, toast } = useFeedback()
  const today = useToday(zoneOf(settings))
  const current = weekStart(today)
  const form = useSheet<ListRow>()
  const [quick, setQuick] = useState('')
  // Only the selected week is consolidated.
  const rows = useMemo(() => buildList(mealsOfWeek(data.meals, week), data.shoppingItems, week), [data.meals, data.shoppingItems, week])
  const groups = groupRows(rows)
  const bought = rows.filter((r) => r.checked)
  const categories = [...new Set([...SHOPPING_CATEGORIES, ...data.shoppingItems.map((e) => e.category).filter(Boolean)])]

  const toggle = async (r: ListRow) => {
    if (r.kind === 'manual' && r.record) return save('shoppingItems', { ...r.record, checked: !r.checked })
    // Automatic item: only its state is stored, under a fixed id (devices converge).
    const base: ShoppingEntry = r.record ?? ({ id: r.id, week, kind: 'auto', key: r.id.split(':').slice(2).join(':'), name: r.name, qty: '', unit: '', category: '', checked: false, note: '' } as ShoppingEntry)
    return save('shoppingItems', { ...base, name: r.name, checked: !r.checked })
  }
  const addQuick = async () => {
    const name = quick.trim()
    if (!name) return
    await save('shoppingItems', { week, kind: 'manual', name: name.slice(0, 120), qty: '', unit: '', category: 'Outros', checked: false, note: '' })
    setQuick('')
  }
  const clearBought = async () => {
    const ok = await confirm({ title: 'Limpar comprados?', message: `${bought.length} ${bought.length === 1 ? 'item comprado sai' : 'itens comprados saem'} da lista. Itens ainda não comprados continuam.`, confirmLabel: 'Limpar' })
    if (!ok) return
    for (const r of bought) {
      if (r.kind === 'manual') await remove('shoppingItems', r.id)
      else if (r.record) await save('shoppingItems', { ...r.record, cleared: true })
    }
    toast('Comprados removidos da lista')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center gap-1">
        <IconButton label="Semana anterior" size="sm" onClick={() => onWeek(addDaysToDate(week, -7))}>
          <ChevronLeft size={18} />
        </IconButton>
        <p className="min-w-0 truncate px-1 text-[15px] font-semibold">{weekLabel(week)}</p>
        <IconButton label="Próxima semana" size="sm" onClick={() => onWeek(addDaysToDate(week, 7))}>
          <ChevronRight size={18} />
        </IconButton>
        {week !== current && (
          <Button variant="ghost" className="h-9! px-3!" onClick={() => onWeek(current)}>
            Esta semana
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <TextInput aria-label="Adicionar item à lista" placeholder="Adicionar item" value={quick} maxLength={120} onChange={(e) => setQuick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addQuick())} />
        <IconButton label="Adicionar item" tone="accent" className="size-12! shrink-0" onClick={addQuick}>
          <Plus size={18} />
        </IconButton>
      </div>

      {rows.length ? (
        <>
          {groups.map((g) => (
            <section key={g.category}>
              <h3 className="mb-1.5 px-1 text-[13px] font-medium tracking-wide text-soft uppercase">{g.category}</h3>
              <div className="card divide-y divide-line">
                {g.rows.map((r) => (
                  <div key={r.id} className="flex items-center gap-1 pr-1">
                    <button type="button" role="checkbox" aria-checked={r.checked} aria-label={`${r.checked ? 'Desmarcar' : 'Marcar'} ${r.name}${r.amount ? ` (${r.amount})` : ''}`} onClick={() => toggle(r)} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left">
                      <span className={`grid size-7 shrink-0 place-items-center rounded-lg border-2 transition-colors ${r.checked ? 'border-income bg-income text-bg' : 'border-line-strong'}`}>{r.checked && <Check size={17} strokeWidth={3} />}</span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[16px] leading-snug break-words ${r.checked ? 'text-faint line-through' : ''}`}>{r.name}</span>
                        {(r.amount || r.note || r.orphan) && <span className="block text-[13px] text-faint">{[r.amount, r.note, r.orphan ? 'fora das refeições' : ''].filter(Boolean).join(' · ')}</span>}
                      </span>
                    </button>
                    <button type="button" onClick={() => form.show(r)} className="shrink-0 rounded-xl px-2.5 py-2 text-[13px] text-faint hover:text-ink">
                      {r.kind === 'manual' ? 'Editar' : 'Detalhes'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {bought.length > 0 && (
            <Button variant="ghost" icon={<Trash2 size={16} />} onClick={clearBought}>
              Limpar comprados ({bought.length})
            </Button>
          )}
          <p className="px-1 text-[12.5px] leading-relaxed text-faint">Itens das refeições somam quantidades só quando as unidades combinam (g com kg, ml com l). Sem quantidade na refeição, a lista também fica sem. Itens que você adiciona nunca são alterados pelas refeições.</p>
        </>
      ) : (
        <EmptyState icon={<ShoppingBasket size={22} />} title="Lista vazia" text="Os ingredientes das refeições desta semana aparecem aqui sozinhos. Você também pode adicionar itens." />
      )}
      <ItemForm open={form.open} onClose={form.close} row={form.item} week={week} categories={categories} />
    </div>
  )
}
