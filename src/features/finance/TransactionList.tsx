import { motion } from 'framer-motion'
import { usePrefersReducedMotion } from '../../lib/hooks'
import { ArrowDownLeft, ArrowUpRight, SlidersHorizontal } from 'lucide-react'
import { categoryLabel } from '../../core/financeCategories'
import { useStore } from '../../data/store'
import type { Transaction } from '../../data/types'
import { formatDateTime, formatDay } from '../../lib/dates'
import { formatMoney } from '../../lib/money'

const ICONS = {
  in: { icon: ArrowDownLeft, className: 'bg-income/12 text-income' },
  out: { icon: ArrowUpRight, className: 'bg-expense/12 text-expense' },
  adjust: { icon: SlidersHorizontal, className: 'bg-white/[0.06] text-soft' },
}

export function TransactionRow({ tx, onOpen, showDay = true }: { tx: Transaction; onOpen(tx: Transaction): void; showDay?: boolean }) {
  const { displayCurrency, convert, settings } = useStore()
  const { icon: Icon, className } = ICONS[tx.type]
  const positive = tx.baseAmount >= 0
  const signed = positive ? tx.amount : -tx.amount
  const converted = tx.currency !== displayCurrency ? convert(Math.abs(tx.baseAmount), settings.baseCurrency, displayCurrency) : null
  const when = showDay ? formatDateTime(tx.createdAt) : formatDateTime(tx.createdAt).split(' • ')[1]
  const details = [when, tx.category && tx.type !== 'adjust' ? categoryLabel(settings, tx.category) : null, tx.unnecessary && tx.type === 'out' ? 'desnecessário' : null].filter(Boolean).join(' · ')

  return (
    <button type="button" onClick={() => onOpen(tx)} className="flex w-full items-center gap-3.5 rounded-2xl px-2 py-3 text-left transition-colors hover:bg-white/[0.03] active:bg-white/[0.04]">
      <span className={`grid size-11 shrink-0 place-items-center rounded-full ${className}`}>
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{tx.reason}</span>
        <span className="mt-0.5 block truncate text-[13px] text-faint">{details}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className={`num block text-[16px] font-semibold ${tx.type === 'adjust' ? 'text-soft' : positive ? 'text-income' : 'text-ink'}`}>
          {formatMoney(signed, tx.currency, { sign: true })}
        </span>
        {converted !== null && <span className="num mt-0.5 block text-[13px] text-faint">≈ {formatMoney(converted, displayCurrency)}</span>}
      </span>
    </button>
  )
}

/** History grouped under day headings ("Hoje", "Ontem", "12 set"). */
export function GroupedTransactions({ items, onOpen }: { items: Transaction[]; onOpen(tx: Transaction): void }) {
  const reduce = usePrefersReducedMotion()
  const groups: { day: string; items: Transaction[] }[] = []
  for (const tx of items) {
    const day = formatDay(new Date(tx.createdAt))
    const last = groups[groups.length - 1]
    if (last?.day === day) last.items.push(tx)
    else groups.push({ day, items: [tx] })
  }
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <motion.section key={g.day} initial={{ opacity: 0, transform: reduce ? 'none' : 'translateY(6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
          <h3 className="mb-1 px-2 text-[13px] font-medium text-faint">{g.day}</h3>
          <div className="card p-1.5">
            {g.items.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} onOpen={onOpen} showDay={false} />
            ))}
          </div>
        </motion.section>
      ))}
    </div>
  )
}
