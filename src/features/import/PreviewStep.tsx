import { memo, useMemo, useState } from 'react'
import { STATUS_LABEL, windowLabel, type Analysis, type AnalyzedLine, type LineAction, type LineStatus } from '../../core/import/analyze'
import { actionOf, categoryOf, lineMoney, transferOf, type Decision } from '../../core/import/plan'
import { totalsOf } from '../../core/import/checks'
import { formatMoney } from '../../lib/money'
import { ToggleRow } from '../planner/controls'
import { plain } from '../../core/import/normalize'
import { categoryLabel, pickableCategories } from '../../core/financeCategories'
import { useStore } from '../../data/store'
import type { Tone } from '../../data/labels'
import { Badge } from '../../ui/Display'
import { Button } from '../../ui/Button'
import { SearchField } from '../../ui/Display'
import { Select } from '../../ui/Field'

const PAGE = 100
const TONE: Record<LineStatus, Tone> = { new: 'accent', duplicate: 'neutral', possible: 'warn', reconciled: 'positive', review: 'warn' }

type Filter = 'all' | LineStatus | 'categorized' | 'attention'

/** What the person can do with a line (labels in their words). */
function choices(l: AnalyzedLine): { value: LineAction; label: string }[] {
  if (l.locked) return []
  if (l.status === 'new') return [
    { value: 'import', label: 'Importar' },
    { value: 'skip', label: 'Não importar' },
  ]
  if (l.match) return [
    { value: 'reconcile', label: 'Conciliar (é a mesma)' },
    { value: 'import', label: 'Importar como nova' },
    { value: 'skip', label: 'Ignorar' },
  ]
  return [
    { value: 'skip', label: 'Ignorar' },
    { value: 'import', label: 'Importar mesmo assim' },
  ]
}

const ddmmyy = (day: string) => (day ? day.split('-').reverse().join('/') : '—')

interface RowProps {
  l: AnalyzedLine
  d: Decision | undefined
  selected: boolean
  onDecide(i: number, d: Decision): void
  onSelect(i: number): void
}

const Row = memo(function Row({ l, d, selected, onDecide, onSelect }: RowProps) {
  const { settings } = useStore()
  const action = actionOf(l, d)
  const options = choices(l)
  const transfer = transferOf(l, d)
  const category = transfer ? null : categoryOf(l, d)
  const cats = pickableCategories(settings, l.type, category ?? undefined)
  const suggested = d?.category === undefined && l.category
  const showRaw = l.line.description.replace(/\s+/g, ' ').trim() !== l.reason
  return (
    <div className="px-4 py-3" data-line={l.i}>
      <div className="flex items-start gap-3">
        {!l.locked && action === 'import' ? (
          <input type="checkbox" aria-label={`Selecionar ${l.reason}`} checked={selected} onChange={() => onSelect(l.i)} className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]" />
        ) : (
          <span className="mt-1 size-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-snug [overflow-wrap:anywhere]">{l.reason}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-faint [overflow-wrap:anywhere]">
            {ddmmyy(l.day)}
            {showRaw ? ` · ${l.line.description}` : ''}
          </span>
        </span>
        <span className={`num shrink-0 text-[15px] font-semibold ${transfer ? 'text-soft' : l.type === 'out' ? 'text-expense' : 'text-income'}`}>{l.currency ? lineMoney(l) : '—'}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-7">
        <Badge tone={TONE[l.status]}>{STATUS_LABEL[l.status]}</Badge>
        {action === 'import' && l.status !== 'new' && <Badge tone="accent">vai importar</Badge>}
        {action === 'reconcile' && l.status !== 'reconciled' && <Badge tone="positive">vai conciliar</Badge>}
        {action === 'import' && transfer && <Badge tone="neutral">transferência</Badge>}
        {l.note && <span className="text-[13px] leading-snug text-soft">{l.note}</span>}
      </div>
      {l.warnings?.length ? <p className="mt-1 pl-7 text-[13px] leading-snug text-warn">{l.warnings.join(' ')}</p> : null}
      {(options.length > 0 || action === 'import') && (
        <div className="mt-2 grid gap-2 pl-7 sm:grid-cols-2">
          {options.length > 0 && (
            <Select aria-label={`O que fazer com ${l.reason}`} value={action} onChange={(e) => onDecide(l.i, { ...d, action: e.target.value as LineAction })} className="h-10!">
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
          {action === 'import' && !transfer && (
            <Select aria-label={`Categoria de ${l.reason}`} value={category ?? ''} onChange={(e) => onDecide(l.i, { action, ...d, category: e.target.value || null })} className="h-10!">
              <option value="">Sem categoria</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
      {action === 'import' && l.transfer && (
        <div className="mt-2 pl-7">
          <ToggleRow checked={transfer} onChange={(v) => onDecide(l.i, { action, ...d, transfer: v })} hint={l.transfer.why}>
            Transferência entre minhas contas
          </ToggleRow>
        </div>
      )}
      {action === 'import' && !transfer && (suggested || (l.hint && !category)) && (
        <p className="mt-1.5 pl-7 text-[13px] leading-snug text-faint">
          {suggested && l.category ? (
            <>Categoria sugerida {l.category.why}.</>
          ) : l.hint ? (
            <button type="button" className="font-medium text-accent-hi hover:text-ink" onClick={() => onDecide(l.i, { action, ...d, category: l.hint!.id })}>
              Usar {categoryLabel(settings, l.hint.id)}? ({l.hint.why})
            </button>
          ) : null}
        </p>
      )}
    </div>
  )
})

export function PreviewStep({
  analysis,
  decisions,
  onDecide,
  onDecideMany,
  saving,
  onConfirm,
}: {
  analysis: Analysis
  decisions: Map<number, Decision>
  onDecide(i: number, d: Decision): void
  onDecideMany(changes: Map<number, Decision>): void
  saving: boolean
  onConfirm(): void
}) {
  const { settings } = useStore()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const c = analysis.counts

  const visible = useMemo(() => {
    const q = plain(query)
    return analysis.lines.filter((l) => {
      if (q && !plain(`${l.reason} ${l.line.description}`).includes(q) && !String(l.amount / 100).includes(q)) return false
      if (filter === 'all') return true
      if (filter === 'attention') return l.status === 'possible' || l.status === 'review' || Boolean(l.status === 'new' && l.warnings?.length)
      if (filter === 'categorized') return actionOf(l, decisions.get(l.i)) === 'import' && Boolean(categoryOf(l, decisions.get(l.i)))
      return l.status === filter
    })
  }, [analysis.lines, filter, query, decisions])

  const toImport = analysis.lines.filter((l) => actionOf(l, decisions.get(l.i)) === 'import').length
  const totals = totalsOf(analysis.lines.filter((l) => actionOf(l, decisions.get(l.i)) === 'import').map((l) => ({ type: l.type, amount: l.amount, currency: l.currency, transfer: transferOf(l, decisions.get(l.i)) })))
  const toReconcile = analysis.lines.filter((l) => actionOf(l, decisions.get(l.i)) === 'reconcile').length
  const hints = analysis.lines.filter((l) => l.hint && actionOf(l, decisions.get(l.i)) === 'import' && !categoryOf(l, decisions.get(l.i)))
  const selectable = visible.filter((l) => actionOf(l, decisions.get(l.i)) === 'import')
  const sel = [...selected].map((i) => analysis.lines[i]).filter((l) => l && actionOf(l, decisions.get(l.i)) === 'import')
  const selTypes = new Set(sel.map((l) => l.type))
  const batchCats = selTypes.size === 1 ? pickableCategories(settings, [...selTypes][0]) : []

  const toggle = (i: number) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })
  const applyCategory = (id: string) => {
    const changes = new Map<number, Decision>()
    for (const l of sel) changes.set(l.i, { action: 'import', ...decisions.get(l.i), category: id || null })
    onDecideMany(changes)
    setSelected(new Set())
  }
  const acceptHints = () => {
    const changes = new Map<number, Decision>()
    for (const l of hints) changes.set(l.i, { action: 'import', ...decisions.get(l.i), category: l.hint!.id })
    onDecideMany(changes)
  }

  const confirm = (
    <Button size="lg" block disabled={saving || (!toImport && !toReconcile)} onClick={onConfirm}>
      {saving
        ? 'Gravando…'
        : toImport || toReconcile
          ? [toImport ? `Importar ${toImport === 1 ? '1 movimentação' : `${toImport} movimentações`}` : '', toReconcile ? `conciliar ${toReconcile}` : ''].filter(Boolean).join(' e ').replace(/^c/, 'C')
          : 'Nada para importar'}
    </Button>
  )

  const tile = (f: Filter, label: string, n: number, tone = '') => (
    <button type="button" aria-pressed={filter === f} onClick={() => (setFilter(filter === f ? 'all' : f), setShown(PAGE))} className={`card px-3 py-2.5 text-left transition-colors ${filter === f ? 'border-accent-hi/60 bg-accent/10' : 'hover:bg-tint/[0.03]'}`}>
      <span className={`num block text-[20px] leading-tight font-semibold ${tone}`}>{n}</span>
      <span className="block text-[13px] leading-snug text-soft">{label}</span>
    </button>
  )

  return (
    <div className="space-y-5">
      {analysis.from && <p className="text-[14px] text-soft">Movimentações de {windowLabel(analysis.from, analysis.to)}</p>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {tile('all', 'lidas', c.read)}
        {tile('new', 'novas', c.new, 'text-accent-hi')}
        {tile('duplicate', 'duplicadas', c.duplicate)}
        {tile('reconciled', 'já no Núcleo', c.reconciled, 'text-income')}
        {tile('categorized', 'com categoria', analysis.lines.filter((l) => actionOf(l, decisions.get(l.i)) === 'import' && categoryOf(l, decisions.get(l.i))).length)}
        {tile('attention', 'precisam de atenção', c.attention, c.attention ? 'text-warn' : '')}
      </div>
      {totals.length > 0 && (
        <div className="card divide-y divide-line" aria-label="Totais do que vai entrar">
          {totals.map((t) => (
            <div key={t.currency} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-[14px]">
              <span className="label-mono text-faint">{t.currency}</span>
              <span>
                Entradas <span className="num font-semibold text-income">{formatMoney(t.income, t.currency)}</span>
              </span>
              <span>
                Saídas <span className="num font-semibold">{formatMoney(t.expense, t.currency)}</span>
              </span>
              {t.transfers > 0 && <span className="text-soft">{t.transfers === 1 ? '1 transferência entre contas (fora dos totais)' : `${t.transfers} transferências entre contas (fora dos totais)`}</span>}
            </div>
          ))}
          {totals.length > 1 && <p className="px-4 py-2.5 text-[13px] text-faint">Cada moeda tem o seu total: valores de moedas diferentes não são somados.</p>}
        </div>
      )}
      {c.attention > 0 && (
        <p className="text-[14px] leading-relaxed text-warn">
          {c.attention === 1 ? '1 linha precisa de revisão' : `${c.attention} linhas precisam de revisão`}. Elas ficam de fora, a menos que você escolha o que fazer com cada uma.
        </p>
      )}
      {confirm}

      <div className="space-y-3">
        <SearchField value={query} onChange={(v) => (setQuery(v), setShown(PAGE))} placeholder="Buscar (ex.: Carrefour)" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {selectable.length > 0 && (
            <button type="button" className="text-[14px] font-medium text-accent-hi hover:text-ink" onClick={() => setSelected(sel.length === selectable.length ? new Set() : new Set(selectable.map((l) => l.i)))}>
              {sel.length && sel.length === selectable.length ? 'Desmarcar todas' : `Selecionar ${selectable.length === analysis.lines.length ? 'todas' : `as ${selectable.length} visíveis`}`}
            </button>
          )}
          {hints.length > 0 && (
            <button type="button" className="text-[14px] font-medium text-accent-hi hover:text-ink" onClick={acceptHints}>
              Aceitar {hints.length === 1 ? 'a sugestão de categoria' : `as ${hints.length} sugestões de categoria`}
            </button>
          )}
        </div>
        {sel.length > 0 && (
          <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="text-[14px] font-medium">{sel.length === 1 ? '1 selecionada' : `${sel.length} selecionadas`}</span>
            {batchCats.length ? (
              <div className="min-w-[12rem] flex-1">
                <Select aria-label="Aplicar categoria às selecionadas" value="" onChange={(e) => e.target.value && applyCategory(e.target.value === '-' ? '' : e.target.value)} className="h-10!">
                  <option value="">Categoria para todas…</option>
                  <option value="-">Sem categoria</option>
                  {batchCats.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <span className="text-[13px] text-faint">Selecione só entradas ou só saídas para aplicar uma categoria.</span>
            )}
            <button type="button" className="text-[14px] font-medium text-soft hover:text-ink" onClick={() => setSelected(new Set())}>
              Limpar
            </button>
          </div>
        )}
      </div>

      {visible.length ? (
        <div className="card divide-y divide-line">
          {visible.slice(0, shown).map((l) => (
            <Row key={l.i} l={l} d={decisions.get(l.i)} selected={selected.has(l.i)} onDecide={onDecide} onSelect={toggle} />
          ))}
        </div>
      ) : (
        <p className="card px-4 py-6 text-center text-[14px] text-soft">Nenhuma linha neste filtro.</p>
      )}
      {visible.length > shown && (
        <Button variant="secondary" block onClick={() => setShown((n) => n + PAGE)}>
          Mostrar mais {Math.min(PAGE, visible.length - shown)} (de {visible.length - shown})
        </Button>
      )}

      {confirm}
    </div>
  )
}
