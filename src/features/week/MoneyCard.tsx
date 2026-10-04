import { ChevronRight, Wallet } from 'lucide-react'
import { useMemo } from 'react'
import { navigate } from '../../app/router'
import { monthOf, weekMoney } from '../../core/finance'
import { categoryLabel } from '../../core/financeCategories'
import { goalPlan } from '../../core/financeGoals'
import { weekMoneySentences } from '../../core/financeText'
import { addDaysToDate } from '../../core/period'
import type { FlatMetrics } from '../../core/weekSummary'
import { useStore } from '../../data/store'
import type { WeekId, WeekSnapshot } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { Progress, SectionTitle } from '../../ui/Display'

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className={`num text-[clamp(16px,4.4vw,19px)] leading-tight font-semibold break-words ${tone ?? ''}`}>{value}</p>
      <p className="truncate text-[13px] text-faint">{label}</p>
    </div>
  )
}

/**
 * Weekly money review inside "Semana". Live weeks read the movements (previous
 * week compared on the same days); a closed week shows its snapshot numbers.
 * Details open the month summary in Financeiro — no second finance screen.
 */
export function MoneyCard({ week, today, isCurrent, snapshot, flat, prevFlat }: { week: WeekId; today: string; isCurrent: boolean; snapshot: WeekSnapshot | null; flat: FlatMetrics; prevFlat: FlatMetrics }) {
  const { data, settings } = useStore()
  const cur = settings.baseCurrency
  const live = useMemo(() => (snapshot ? null : weekMoney(data, settings, week)), [snapshot, data.transactions, settings, week, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const n = (k: string) => flat[k] ?? 0
  const t = live?.totals
  const income = t ? t.income : n('finance.income')
  const expense = t ? t.expense : n('finance.expense')
  const net = t ? t.net : n('finance.net')
  // v1 snapshots have no count: any income/expense means there were movements.
  const count = t ? t.count : (flat['finance.count'] ?? (flat['finance.net'] !== null && flat['finance.net'] !== undefined ? 1 : 0))
  const top = live ? live.top : (snapshot?.financeTop ?? null)
  const prevExpense = prevFlat['finance.expense']
  const sentences = weekMoneySentences(
    {
      current: isCurrent,
      income,
      expense,
      net,
      count,
      dailyAverage: live ? live.dailyAverage : Math.round(expense / 7),
      top: top ? { label: categoryLabel(settings, top.category), amount: top.amount } : null,
      expenseDiff: live ? live.expenseDiff : prevExpense !== null && prevExpense !== undefined && count ? expense - prevExpense : null,
      unnecessaryCount: t ? t.unnecessaryCount : n('finance.unnecessaryCount'),
      unnecessaryAmount: t ? t.unnecessaryAmount : n('finance.unnecessaryAmount'),
      saved: flat['finance.saved'] ?? null,
    },
    cur,
  )
  const goal = data.financeGoals.filter((g) => g.status === 'active' && g.deadline >= today).sort((a, b) => (a.deadline < b.deadline ? -1 : 1))[0]
  const plan = goal ? goalPlan(goal, today) : null
  if (!count && !goal && !flat['finance.saved']) return null

  return (
    <section>
      <SectionTitle>Dinheiro</SectionTitle>
      <div className="card p-5">
        {count ? (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="gastou" value={formatMoney(expense, cur)} />
            <Stat label="recebeu" value={formatMoney(income, cur)} tone={income ? 'text-income' : ''} />
            <Stat label="saldo da semana" value={formatMoney(net, cur, { sign: true })} tone={net < 0 ? 'text-expense' : ''} />
          </div>
        ) : (
          <p className="text-[15px] text-faint">Nenhuma movimentação registrada {isCurrent ? 'nesta semana ainda' : 'nesta semana'}.</p>
        )}
        {sentences.length > 0 && (
          <div className="mt-4 space-y-1 text-[15px] leading-relaxed text-soft">
            {sentences.map((s) => (
              <p key={s}>{s}</p>
            ))}
            {count > 0 && <p className="text-[13px] text-faint">{count} {count === 1 ? 'movimentação' : 'movimentações'} na semana.</p>}
          </div>
        )}
        {goal && plan && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="flex items-baseline justify-between gap-3 text-[14px]">
              <span className="min-w-0 truncate">{goal.name}</span>
              <span className="num shrink-0 text-soft">{plan.percent}%</span>
            </div>
            <div className="mt-1.5">
              <Progress value={plan.percent} tone={plan.reached ? 'positive' : 'goal'} />
            </div>
          </div>
        )}
        <button type="button" onClick={() => navigate('/finance', monthOf(addDaysToDate(week, 6)) === monthOf(today) ? { view: 'month' } : { view: 'month', m: monthOf(addDaysToDate(week, 6)) })} className="mt-4 flex w-full items-center gap-2 rounded-xl text-left text-[14px] font-medium text-accent-hi hover:text-ink">
          <Wallet size={16} /> <span className="flex-1">Ver detalhes financeiros</span> <ChevronRight size={16} />
        </button>
      </div>
    </section>
  )
}
