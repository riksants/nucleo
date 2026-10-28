import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion'
import { usePrefersReducedMotion } from '../../lib/hooks'
import { Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { reserveSummary } from '../../core/reserved'
import { useStore } from '../../data/store'
import type { Cents, Currency } from '../../data/types'
import { formatDateTime } from '../../lib/dates'
import { currencyInfo, formatMoney, formatNumber } from '../../lib/money'
import { useSheet } from '../../ui/formHooks'
import { CurrencyPicker } from '../../ui/Field'
import { TransactionSheet } from './TransactionSheet'
import { EASE_OUT_SOFT } from '../../lib/motion'

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
      <span className={`${big} font-display leading-none font-semibold tracking-[-0.042em]`}>
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
    const controls = animate(mv, target, { duration: 0.75, ease: EASE_OUT_SOFT, onUpdate: (v) => setShown(Math.round(v)) })
    return () => controls.stop()
  }, [target, mv, reduce])
  return shown
}

/**
 * Financeiro's balance block: a flat vermilion slab with coal type, like the site's primary button grown into a
 * surface. No tilt or sheen: the figure is data you read, so it stays still.
 */
function AccentCard({ children }: { children: ReactNode }) {
  return <div className="relative overflow-clip rounded-[1.5rem] bg-accent p-5 text-coal lg:p-7">{children}</div>
}

/**
 * The balance.
 * - "card" (Financeiro): the vermilion block with Adicionar / Retirar.
 * - "hero" (Início): the figure on the page itself, without a box; the page puts the actions under it as round buttons.
 * `note`: a line under the figure (e.g. "+€267,61 em outubro"), shown when there is no fresh change to announce.
 */
export function BalanceCard({ variant = 'card', note }: { variant?: 'card' | 'hero'; note?: ReactNode }) {
  const hero = variant === 'hero'
  const { balance, data, settings, displayCurrency, setDisplayCurrency, convert } = useStore()
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

  // Saldo / Reservado para metas / Disponível: shown only when some goal reserves money from the balance.
  const reserve = reserveSummary(data.financeGoals, balance, settings.baseCurrency, convert)
  const inShown = (cents: Cents) => formatMoney(convert(cents, settings.baseCurrency, currency) ?? cents, convert(cents, settings.baseCurrency, currency) === null ? settings.baseCurrency : currency)
  const reserveBlock = reserve.hasReserve && (
    <div className={`mt-3 border-t pt-3 ${hero ? 'border-line' : 'border-coal/20'}`}>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className={`text-[13px] ${hero ? 'text-soft' : 'text-coal/80'}`}>Reservado para metas</p>
          <p className="num text-[17px] font-semibold [overflow-wrap:anywhere]">{inShown(reserve.reserved)}</p>
        </div>
        <div className="min-w-0">
          <p className={`text-[13px] ${hero ? 'text-soft' : 'text-coal/80'}`}>Disponível</p>
          <p className={`num text-[17px] font-semibold [overflow-wrap:anywhere] ${reserve.available < 0 && hero ? 'text-expense' : ''}`}>{inShown(reserve.available)}</p>
        </div>
      </div>
      {reserve.missing.length > 0 && (
        <p className={`mt-2 text-[12px] leading-snug ${hero ? 'text-faint' : 'text-coal/80'}`}>
          Reserva em {reserve.missing.join(', ')} ainda sem cotação: o Disponível ainda não a considera.
        </p>
      )}
      {reserve.available < 0 && <p className={`mt-2 text-[12px] leading-snug ${hero ? 'text-faint' : 'text-coal/80'}`}>As metas têm mais reservado do que o saldo atual.</p>}
    </div>
  )

  const ink = hero ? 'var(--color-ink)' : 'var(--color-coal)'
  const content = (
    <>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className={`shrink-0 text-[14px] font-semibold ${hero ? 'text-soft' : 'text-coal/80'}`}>{hero ? 'Saldo total' : 'Saldo'}</span>
        <CurrencyPicker
          size="sm"
          label="Moeda de exibição"
          value={currency}
          onChange={setDisplayCurrency}
          tone={hero ? 'default' : 'onAccent'}
          isDisabled={(c) => c !== settings.baseCurrency && convert(100, settings.baseCurrency, c) === null}
        />
      </div>

      <motion.div
        key={delta?.id ?? 'idle'}
        className={hero ? 'mt-3 mb-1' : 'mt-6 mb-1 lg:mt-8 [&_.text-soft]:text-coal/75'}
        style={{ color: ink }}
        // On the vermilion card the figure keeps its coal: green or red on vermilion would not read.
        animate={delta && hero ? { color: [ink, delta.cents > 0 ? 'var(--color-income)' : 'var(--color-expense)', ink] } : undefined}
        transition={{ duration: 1.1, times: [0, 0.25, 1] }}
      >
        <Figure cents={shown} currency={currency} />
      </motion.div>

      <div className="min-h-6">
        <AnimatePresence initial={false}>
          {delta ? (
            <motion.span
              key={delta.id}
              initial={{ opacity: 0, transform: reduce ? 'none' : 'translateY(-4px)' }}
              animate={{ opacity: 1, transform: 'translateY(0px)' }}
              exit={{ opacity: 0 }}
              className={`num text-[15px] font-semibold ${hero ? (delta.cents > 0 ? 'text-income' : 'text-expense') : 'text-coal'}`}
            >
              {formatMoney(delta.cents, currency, { sign: true })}
            </motion.span>
          ) : rateLine ? (
            <motion.span key="rate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`text-[13px] ${hero ? 'text-faint' : 'text-coal/80'}`}>
              {rateLine}
            </motion.span>
          ) : (
            note && (
              <motion.span key="note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[14px] font-semibold">
                {note}
              </motion.span>
            )
          )}
        </AnimatePresence>
      </div>

      {reserveBlock}

      {!hero && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => sheet.show('in')}
            className="press flex h-13 items-center justify-center gap-2 rounded-full bg-coal text-base font-medium tracking-[-0.01em] text-paper hover:bg-coal/85"
          >
            <Plus size={20} strokeWidth={2.4} />
            Adicionar
          </button>
          <button
            type="button"
            onClick={() => sheet.show('out')}
            className="press flex h-13 items-center justify-center gap-2 rounded-full text-base font-medium tracking-[-0.01em] text-coal ring-1 ring-coal/35 ring-inset hover:bg-coal/[0.08]"
          >
            <Minus size={20} strokeWidth={2.4} />
            Retirar
          </button>
        </div>
      )}
    </>
  )

  return (
    <section aria-label="Saldo" className="relative">
      {hero ? content : <AccentCard>{content}</AccentCard>}
      {!hero && <TransactionSheet type={sheet.item ?? 'in'} open={sheet.open} onClose={sheet.close} />}
    </section>
  )
}
