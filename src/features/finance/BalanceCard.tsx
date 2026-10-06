import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion'
import { usePrefersReducedMotion } from '../../lib/hooks'
import { Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../data/store'
import type { Cents, Currency } from '../../data/types'
import { formatDateTime } from '../../lib/dates'
import { currencyInfo, formatMoney, formatNumber } from '../../lib/money'
import { useSheet } from '../../ui/formHooks'
import { CurrencyPicker } from '../../ui/Field'
import { TransactionSheet } from './TransactionSheet'

/** Big balance number: muted currency symbol and cents, prominent whole part. */
function Figure({ cents, currency }: { cents: Cents; currency: Currency }) {
  const [whole, decimals] = formatNumber(cents).split(',')
  const { symbol, suffix } = currencyInfo(currency)
  // Very long balances (millions) step down so the figure never leaves the card on a phone.
  const long = whole.length > 9 ? 2 : whole.length > 7 ? 1 : 0
  const small = ['text-[26px] lg:text-[30px]', 'text-[22px] lg:text-[28px]', 'text-[18px] lg:text-[24px]'][long] + ' font-medium text-soft'
  const big = ['text-[52px] lg:text-[64px]', 'text-[42px] lg:text-[56px]', 'text-[34px] lg:text-[48px]'][long]
  return (
    <span className="num inline-flex items-baseline gap-1.5 whitespace-nowrap" aria-label={formatMoney(cents, currency)}>
      {cents < 0 && <span className="text-[44px] leading-none font-semibold lg:text-[56px]">−</span>}
      {!suffix && <span className={small}>{symbol}</span>}
      <span className={`${big} font-display leading-none font-bold tracking-[-0.05em]`}>
        {whole}
        <span className={small}>,{decimals}</span>
      </span>
      {suffix && <span className={small}>{symbol}</span>}
    </span>
  )
}

function useCountTo(target: Cents) {
  const reduce = usePrefersReducedMotion()
  const mv = useMotionValue(target)
  const [shown, setShown] = useState(target)
  const first = useRef(true)
  useEffect(() => {
    if (first.current || reduce) {
      first.current = false
      mv.jump(target)
      setShown(target)
      return
    }
    const controls = animate(mv, target, { duration: 0.75, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(Math.round(v)) })
    return () => controls.stop()
  }, [target, mv, reduce])
  return shown
}

/**
 * The balance. "panel" (Financeiro): a card with Retirar / Adicionar. "hero" (Início): the figure on
 * the page itself, without a box — the page puts the actions under it as round buttons.
 */
export function BalanceCard({ variant = 'panel' }: { variant?: 'panel' | 'hero' }) {
  const hero = variant === 'hero'
  const { balance, settings, displayCurrency, setDisplayCurrency, convert } = useStore()
  const sheet = useSheet<'in' | 'out'>()
  const [delta, setDelta] = useState<{ id: number; cents: Cents } | null>(null)
  const reduce = usePrefersReducedMotion()

  const converted = convert(balance, settings.baseCurrency, displayCurrency)
  const currency = converted === null ? settings.baseCurrency : displayCurrency
  const value = converted ?? balance
  const shown = useCountTo(value)

  // Show a short-lived "+€300" under the figure when the balance changes (not on currency switch).
  const prevBalance = useRef(balance)
  const deltaTimer = useRef(0)
  useEffect(() => {
    const diff = balance - prevBalance.current
    prevBalance.current = balance
    if (diff === 0) return
    setDelta({ id: Date.now(), cents: convert(diff, settings.baseCurrency, currency) ?? diff })
    window.clearTimeout(deltaTimer.current)
    deltaTimer.current = window.setTimeout(() => setDelta(null), 2400)
  }, [balance, convert, settings.baseCurrency, currency])
  useEffect(() => () => window.clearTimeout(deltaTimer.current), [])

  const rates = settings.rates
  const rateLine = (() => {
    if (currency === settings.baseCurrency) return null
    const one = convert(100, settings.baseCurrency, currency)
    if (one === null) return null
    const manual = settings.manualRates[currency] || settings.manualRates[settings.baseCurrency]
    const when = manual ? 'taxa manual' : rates ? `atualizado ${formatDateTime(rates.fetchedAt).toLowerCase()}` : ''
    return `1 ${settings.baseCurrency} = ${formatNumber(one)} ${currency} · ${when}`
  })()

  return (
    <section className={hero ? 'relative' : 'card relative overflow-hidden p-5 lg:p-7'} aria-label="Saldo">
      <div className="relative">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="shrink-0 text-[14px] font-semibold text-soft">{hero ? 'Saldo total' : 'Saldo'}</span>
          <CurrencyPicker
            size="sm"
            label="Moeda de exibição"
            value={currency}
            onChange={setDisplayCurrency}
            isDisabled={(c) => c !== settings.baseCurrency && convert(100, settings.baseCurrency, c) === null}
          />
        </div>

        <motion.div
          key={delta?.id ?? 'idle'}
          className={hero ? 'mt-3 mb-1' : 'mt-6 mb-1 lg:mt-8'}
          animate={delta ? { color: ['var(--color-ink)', delta.cents > 0 ? 'var(--color-income)' : 'var(--color-expense)', 'var(--color-ink)'] } : undefined}
          transition={{ duration: 1.1, times: [0, 0.25, 1] }}
        >
          <Figure cents={shown} currency={currency} />
        </motion.div>

        <div className="h-6">
          <AnimatePresence>
            {delta ? (
              <motion.span
                key={delta.id}
                initial={{ opacity: 0, transform: reduce ? 'none' : 'translateY(-4px)' }}
                animate={{ opacity: 1, transform: 'translateY(0px)' }}
                exit={{ opacity: 0 }}
                className={`num text-[15px] font-medium ${delta.cents > 0 ? 'text-income' : 'text-expense'}`}
              >
                {formatMoney(delta.cents, currency, { sign: true })}
              </motion.span>
            ) : (
              rateLine && (
                <motion.span key="rate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[13px] text-faint">
                  {rateLine}
                </motion.span>
              )
            )}
          </AnimatePresence>
        </div>

        {!hero && (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => sheet.show('out')}
              className="press flex h-13 items-center justify-center gap-2 rounded-full border border-line-strong bg-raised text-base font-semibold hover:bg-elevated"
            >
              <Minus size={20} strokeWidth={2.4} />
              Retirar
            </button>
            <button
              type="button"
              onClick={() => sheet.show('in')}
              className="press flex h-13 items-center justify-center gap-2 rounded-full bg-accent text-base font-semibold text-on-accent hover:brightness-[0.96]"
            >
              <Plus size={20} strokeWidth={2.4} />
              Adicionar
            </button>
          </div>
        )}
      </div>

      {!hero && <TransactionSheet type={sheet.item ?? 'in'} open={sheet.open} onClose={sheet.close} />}
    </section>
  )
}
