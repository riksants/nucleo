import { ReceiptText } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../../app/Shell'
import { matches, sortByNewest, totalsSince } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Transaction } from '../../data/types'
import { periodStart, PERIOD_LABELS, type Period } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { usePref } from '../../lib/prefs'
import { EmptyState, SearchField, SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { Chips, Segmented } from '../../ui/Segmented'
import { useOpenParam } from '../useOpenParam'
import { BalanceCard } from './BalanceCard'
import { GroupedTransactions } from './TransactionList'
import { TransactionSheet } from './TransactionSheet'

type TypeFilter = 'all' | 'in' | 'out'

export function FinancePage() {
  const { data, settings, displayCurrency, convert } = useStore()
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
      matches(query, t.reason, String(t.amount / 100)),
  )

  return (
    <>
      <PageHeader title="Financeiro" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-8">
        <div className="space-y-4 lg:sticky lg:top-10">
          <BalanceCard />

          <div className="card p-5">
            <div className="mb-5 overflow-x-auto no-scrollbar">
              <Segmented
                block
                size="sm"
                label="Período"
                value={period}
                onChange={setPeriod}
                options={(Object.keys(PERIOD_LABELS) as Period[]).map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[13px] text-soft">Entradas</p>
                <p className={`num mt-1 text-[22px] font-semibold ${totals.income ? 'text-income' : 'text-soft'}`}>{show(totals.income)}</p>
              </div>
              <div>
                <p className="text-[13px] text-soft">Saídas</p>
                <p className={`num mt-1 text-[22px] font-semibold ${totals.expense ? 'text-expense' : 'text-soft'}`}>{show(totals.expense)}</p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
              <p className="text-[15px] text-soft">Resultado do período</p>
              <p className={`num text-[17px] font-semibold ${totals.net < 0 ? 'text-expense' : 'text-ink'}`}>
                {totals.net > 0 ? '+' : ''}
                {show(totals.net)}
              </p>
            </div>
          </div>
        </div>

        <section>
          <SectionTitle>Histórico</SectionTitle>
          <div className="mb-3">
            <SearchField value={query} onChange={setQuery} placeholder="Buscar por motivo ou valor" />
          </div>
          <div className="mb-5">
            <Chips
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: 'all', label: 'Tudo' },
                { value: 'in', label: 'Entradas' },
                { value: 'out', label: 'Saídas' },
              ]}
            />
          </div>
          {history.length ? (
            <GroupedTransactions items={history} onOpen={sheet.show} />
          ) : (
            <EmptyState
              compact
              icon={<ReceiptText size={22} />}
              title={data.transactions.length ? 'Nada encontrado' : 'Nenhuma movimentação ainda'}
              text={data.transactions.length ? 'Tente outro período, filtro ou termo.' : 'Use os botões Adicionar e Retirar no card de saldo.'}
            />
          )}
        </section>
      </div>
      <TransactionSheet type="in" open={sheet.open} editing={sheet.item} onClose={sheet.close} />
    </>
  )
}
