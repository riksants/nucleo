import { Check, UserRound } from 'lucide-react'
import { useMemo } from 'react'
import { knownProducts, type KnownProduct } from '../../core/salesSmart'
import { buyers, personName } from '../../data/sales'
import { useStore } from '../../data/store'
import { formatMoney } from '../../lib/money'
import { TextInput } from '../../ui/Field'

export interface Person {
  key: string
  clientId: string | null
  name: string
  /** "cliente" or "3 compras". */
  hint: string
}

/** Everyone the person sold to or has in Clients (one entry per person). */
export function usePeople(): Person[] {
  const { data } = useStore()
  return useMemo(() => {
    const nameOf = (id: string | null) => data.clients.find((c) => c.id === id)?.name ?? ''
    const groups = buyers(data.sales, (s) => (s.clientId ? nameOf(s.clientId) : s.clientName))
    const out: Person[] = data.clients.map((c) => {
      const g = groups.find((b) => b.clientId === c.id)
      return { key: `id:${c.id}`, clientId: c.id, name: c.name, hint: g ? `cliente · ${g.sales.length} ${g.sales.length === 1 ? 'compra' : 'compras'}` : 'cliente' }
    })
    for (const g of groups) if (!g.clientId && g.name) out.push({ key: g.key, clientId: null, name: g.name, hint: `${g.sales.length} ${g.sales.length === 1 ? 'compra' : 'compras'}` })
    return out
  }, [data.sales, data.clients])
}

/** People whose name matches what is typed (start of any word), best first. */
export function peopleLike(people: Person[], typed: string): Person[] {
  const q = personName(typed)
  if (q.length < 2) return []
  const starts = (p: Person) => personName(p.name).split(' ').some((w) => w.startsWith(q)) || personName(p.name).startsWith(q)
  return people.filter((p) => personName(p.name).includes(q)).sort((a, b) => Number(starts(b)) - Number(starts(a)) || a.name.localeCompare(b.name)).slice(0, 6)
}

/**
 * Who bought. Typing suggests existing people; a name equal to someone that exists must be chosen (or marked as
 * someone else) before saving, so the same person isn't split in two and two different people aren't merged.
 * New names stay on the sale (no client is created behind the person's back).
 */
export function BuyerField({
  value,
  onChange,
  autoFocus,
}: {
  value: { clientId: string | null; clientName: string; confirmed: boolean }
  onChange(v: { clientId: string | null; clientName: string; confirmed: boolean }): void
  autoFocus?: boolean
}) {
  const people = usePeople()
  const chosen = value.clientId ? people.find((p) => p.clientId === value.clientId) : null
  const typed = chosen ? '' : value.clientName
  const like = peopleLike(people, typed)
  const same = like.filter((p) => sameOrFirstName(p.name, typed))
  return (
    <div className="space-y-2">
      {chosen ? (
        <div className="flex items-center gap-3 rounded-[var(--radius-field)] border border-accent/40 bg-accent/[0.08] px-3.5 py-2.5">
          <UserRound size={18} className="shrink-0 text-accent-hi" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium">{chosen.name}</span>
            <span className="block text-[12px] text-faint">{chosen.hint}</span>
          </span>
          <button type="button" onClick={() => onChange({ clientId: null, clientName: '', confirmed: false })} className="shrink-0 text-[13px] font-semibold text-accent-hi">
            Trocar
          </button>
        </div>
      ) : (
        <TextInput
          value={value.clientName}
          autoFocus={autoFocus}
          placeholder="Nome de quem comprou"
          aria-label="Cliente"
          autoComplete="off"
          onChange={(e) => onChange({ clientId: null, clientName: e.target.value, confirmed: false })}
        />
      )}
      {!chosen && like.length > 0 && !value.confirmed && (
        <div className="space-y-1.5">
          {same.length > 0 && <p className="text-[13px] font-medium text-warn">{same.length > 1 ? `Há ${same.length} pessoas com esse nome. Qual é?` : 'Já existe alguém com esse nome. É essa pessoa?'}</p>}
          <div className="flex flex-wrap gap-2" aria-label="Pessoas que já existem">
            {like.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onChange({ clientId: p.clientId, clientName: p.clientId ? '' : p.name, confirmed: true })}
                className="press inline-flex h-9 max-w-full items-center gap-1.5 truncate rounded-full border border-line bg-surface px-3 text-[13px] text-soft hover:text-ink"
              >
                <span className="truncate font-medium text-ink">{p.name}</span>
                <span className="shrink-0 text-faint">· {p.hint}</span>
              </button>
            ))}
            {value.clientName.trim() && (
              <button type="button" onClick={() => onChange({ ...value, confirmed: true })} className="press inline-flex h-9 items-center rounded-full px-3 text-[13px] font-medium text-accent-hi ring-1 ring-accent/30 ring-inset">
                {same.length ? 'É outra pessoa' : `Novo: ${value.clientName.trim()}`}
              </button>
            )}
          </div>
        </div>
      )}
      {!chosen && value.confirmed && value.clientName.trim() && (
        <p className="flex items-center gap-1.5 text-[12px] text-faint">
          <Check size={14} className="text-income" /> {people.some((p) => !p.clientId && personName(p.name) === personName(value.clientName)) ? 'Vai para as compras dessa pessoa.' : 'Pessoa nova (fica só na venda; cadastro em Clientes é opcional).'}
        </p>
      )}
    </div>
  )
}

/** "João" and "João Silva": the same name, or the typed name is how the other one starts. */
export function sameOrFirstName(existing: string, typed: string): boolean {
  const e = personName(existing)
  const t = personName(typed)
  return Boolean(t) && (e === t || e.startsWith(`${t} `))
}

/** A name like an existing person's (or several) that wasn't chosen yet: saving waits for the choice. */
export function buyerNeedsChoice(people: Person[], v: { clientId: string | null; clientName: string; confirmed: boolean }): boolean {
  if (v.clientId || v.confirmed) return false
  return people.some((p) => sameOrFirstName(p.name, v.clientName))
}

export function useKnownProducts(): KnownProduct[] {
  const { data } = useStore()
  return useMemo(() => knownProducts(data.sales), [data.sales])
}

/** What was sold, with the products already sold as suggestions (picking one fills its last price). */
export function ProductField({ value, onChange, onPick, autoFocus, label = 'O que vendeu' }: { value: string; onChange(v: string): void; onPick(p: KnownProduct): void; autoFocus?: boolean; label?: string }) {
  const products = useKnownProducts()
  const q = personName(value)
  const like = q.length >= 1 ? products.filter((p) => personName(p.name).includes(q) && personName(p.name) !== q).slice(0, 5) : value ? [] : products.slice(0, 5)
  return (
    <div className="space-y-2">
      <TextInput value={value} autoFocus={autoFocus} placeholder="Ex.: Bolo de chocolate" aria-label={label} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
      {like.length > 0 && (
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1" aria-label="Já vendidos">
          {like.map((p) => (
            <button key={p.name} type="button" onClick={() => onPick(p)} className="press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] text-soft hover:text-ink">
              <span className="font-medium text-ink">{p.name}</span>
              <span className="num text-faint">{formatMoney(p.price, p.currency)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
