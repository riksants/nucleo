import { ReceiptText } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../../app/Shell'
import { matches, sortByNewest, totalsSince } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Transaction } from '../../data/types'
import { periodStart, PERIOD_LABELS, toDateInput, type Period } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { usePref } from '../../lib/prefs'
import { EmptyState, SearchField, SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { Chips, Segmented } from '../../ui/Segmented'
import { useOpenParam } from '../useOpenParam'
import { useRoute } from '../../app/router'
import { allCategories, categoryLabel, NO_CATEGORY } from '../../core/financeCategories'
import { Select } from '../../ui/Field'
import { FinanceGoalsSection } from './FinanceGoals'
import { MonthSummaryView, ThisMonthCard } from './MonthView'
import { BalanceCard } from './BalanceCard'
import { GroupedTransactions } from './TransactionList'
import { TransactionSheet } from './TransactionSheet'

type TypeFilter = 'all' | 'in' | 'out'

export function FinancePage() {
  const { params } = useRoute()
  if (params.get('view') === 'month') return <MonthSummaryView month={params.get('m')} />
  return <FinanceHome />
}

/** Spending of the last 7 days as small bars (today highlighted). Decorative summary; the list below has the details. */
function WeekBars() {
  const { data } = useStore()
  const days = Array.from({ length: 7 }, (_, i) => toDateInput(new Date(Date.now() - (6 - i) * 86_400_000)))
  const spent = days.map((d) => data.transactions.reduce((sum, t) => (t.type === 'out' && toDateInput(new Date(t.createdAt)) === d ? sum - t.baseAmount : sum), 0))
  const max = Math.max(...spent, 1)
  return (
    <div className="flex h-14 shrink-0 items-end gap-1.5" aria-hidden>
      {spent.map((v, i) => (
        <span key={days[i]} className={`w-3 rounded-full ${i === 6 ? 'bg-accent' : v ? 'bg-tint/25' : 'bg-tint/10'}`} style={{ height: `${Math.max(10, (v / max) * 100)}%` }} />
      ))}
    </div>
  )
}

function FinanceHome() {
  const { data, settings, displayCurrency, convert } = useStore()
  const [category, setCategory] = useState('all')
  const [period, setPeriod] = usePref<Period>('finance.period', 'month')
  const [typeFilter, setTypeFilter] = usePref<TypeFilter>('finance.type', 'all')
  const [query, setQuery] = useState('')
  const sheet = useSheet<Transaction>()
  useOpenParam(data.transactions, sheet.show)

  const since = periodStart(period)
  const totals = totalsSince(data.transactions, since)
  const show = (cents: number) => {
    const v = convert(cents, settings.baseCurrency, displayCurrency)
    return v === null ? formatMoney(cents, settings.baseCurrency) : formatMoney(v, displayCurrency)
  }

  const history = sortByNewest(data.transactions).filter(
    (t) =>
      (!since || new Date(t.createdAt) >= since) &&
      (typeFilter === 'all' || t.type === typeFilter) &&
      (category === 'all' || (category === 'none' ? !t.category && t.type !== 'adjust' : t.category === category)) &&
      matches(query, t.reason, String(t.amount / 100), t.category ? categoryLabel(settings, t.category) : null),
  )

  return (
    <>
      <PageHeader title="Financeiro" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-8">
        <div className="space-y-4">
          <BalanceCard />

          <section className="space-y-4 pt-2" aria-label="Resumo do período">
            <Segmented
              variant="underline"
              label="Período"
              value={period}
              onChange={setPeriod}
              options={(Object.keys(PERIOD_LABELS) as Period[]).map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
            />
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[14px] text-soft">Resultado do período</p>
                <p className={`display-num mt-1 text-[30px] leading-tight font-bold ${totals.net < 0 ? 'text-expense' : totals.net > 0 ? 'text-income' : 'text-ink'}`}>
                  {totals.net > 0 ? '+' : ''}
                  {show(totals.net)}
                </p>
              </div>
              <WeekBars />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-4">
                <p className="text-[13px] text-soft">Entradas</p>
                <p className={`display-num mt-1 text-[20px] font-bold ${totals.income ? 'text-income' : 'text-soft'}`}>{show(totals.income)}</p>
              </div>
              <div className="card p-4">
                <p className="text-[13px] text-soft">Saídas</p>
                <p className={`display-num mt-1 text-[20px] font-bold ${totals.expense ? 'text-expense' : 'text-soft'}`}>{show(totals.expense)}</p>
              </div>
            </div>
          </section>

          <ThisMonthCard />
          <FinanceGoalsSection />
        </div>

        <section>
          <SectionTitle>Histórico</SectionTitle>
          <div className="mb-3">
            <SearchField value={query} onChange={setQuery} placeholder="Buscar por motivo ou valor" />
          </div>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <Chips
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: 'all', label: 'Tudo' },
                { value: 'in', label: 'Entradas' },
                { value: 'out', label: 'Saídas' },
              ]}
            />
            <div className="min-w-[11rem] flex-1 sm:max-w-[15rem]">
              <Select aria-label="Filtrar por categoria" value={category} onChange={(e) => setCategory(e.target.value)} className="h-10!">
                <option value="all">Todas as categorias</option>
                <option value="none">{NO_CATEGORY}</option>
                {allCategories(settings)
                  .filter((c) => typeFilter === 'all' || c.type === typeFilter)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {typeFilter === 'all' ? `${c.label} (${c.type === 'in' ? 'entrada' : 'saída'})` : c.label}
                    </option>
                  ))}
              </Select>
            </div>
          </div>
          {history.length ? (
            <GroupedTransactions items={history} onOpen={sheet.show} />
          ) : (
            <EmptyState
              compact
              icon={<ReceiptText size={22} />}
              title={data.transactions.length ? 'Nada encontrado' : 'Nenhuma movimentação ainda'}
              text={data.transactions.length ? 'Tente outro período, filtro, categoria ou termo.' : 'Use os botões Adicionar e Retirar no card de saldo.'}
            />
          )}
        </section>
      </div>
      <TransactionSheet type="in" open={sheet.open} editing={sheet.item} onClose={sheet.close} />
    </>
  )
}
