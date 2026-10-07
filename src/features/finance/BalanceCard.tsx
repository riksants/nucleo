import { AnimatePresence, animate, motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { usePrefersReducedMotion } from '../../lib/hooks'
import { Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
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
 * Purple card with depth for Financeiro: layered shadow, top highlight, a soft sheen and a slight 3D tilt that
 * follows the finger or the mouse (springs back on release). Reduced motion: flat, no tilt.
 */
function Card3D({ children }: { children: ReactNode }) {
  const reduce = usePrefersReducedMotion()
  const rx = useMotionValue(0)
  const ry = useMotionValue(0)
  const springX = useSpring(rx, { stiffness: 220, damping: 22 })
  const springY = useSpring(ry, { stiffness: 220, damping: 22 })
  const sheenX = useTransform(springY, [-8, 8], [20, 80])
  const sheen = useMotionTemplate`linear-gradient(110deg, transparent ${useTransform(sheenX, (v) => v - 22)}%, rgb(255 255 255 / 0.16) ${sheenX}%, transparent ${useTransform(sheenX, (v) => v + 22)}%)`
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce || (e.pointerType !== 'mouse' && e.buttons === 0)) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    ry.set(px * 12)
    rx.set(-py * 10)
  }
  const reset = () => {
    rx.set(0)
    ry.set(0)
  }
  return (
    <div style={{ perspective: 1000 }}>
      <motion.div
        onPointerMove={move}
        onPointerLeave={reset}
        onPointerUp={reset}
        onPointerCancel={reset}
        style={reduce ? undefined : { rotateX: springX, rotateY: springY }}
        className="relative overflow-clip rounded-[1.75rem] border border-white/15 p-5 text-white shadow-[0_28px_56px_-20px_rgb(76_35_214/0.6),0_10px_20px_-10px_rgb(20_10_60/0.45),inset_0_1px_0_rgb(255_255_255/0.35)] lg:p-7"
      >
        {/* Body: deep purple with a lit top-left, and two embossed rings for depth. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_12%_0%,#a07dff_0%,transparent_55%),linear-gradient(140deg,#7a48ff_0%,#5a2be6_48%,#34128f_100%)]" />
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full border border-white/12 bg-white/[0.04]" />
        <div aria-hidden className="pointer-events-none absolute -right-6 -bottom-28 size-64 rounded-full border border-white/10 bg-white/[0.03]" />
        {!reduce && <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: sheen }} />}
        <div className="relative">
          {children}
        </div>
      </motion.div>
    </div>
  )
}

/**
 * The balance.
 * - "card" (Financeiro): the purple 3D card with Adicionar / Retirar.
 * - "hero" (Início): the figure on the page itself, without a box; the page puts the actions under it as round buttons.
 * `note`: a line under the figure (e.g. "+€267,61 em outubro"), shown when there is no fresh change to announce.
 */
export function BalanceCard({ variant = 'card', note }: { variant?: 'card' | 'hero'; note?: ReactNode }) {
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

  const ink = hero ? 'var(--color-ink)' : '#ffffff'
  const content = (
    <>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className={`shrink-0 text-[14px] font-semibold ${hero ? 'text-soft' : 'text-white/80'}`}>{hero ? 'Saldo total' : 'Saldo'}</span>
        <CurrencyPicker
          size="sm"
          label="Moeda de exibição"
          value={currency}
          onChange={setDisplayCurrency}
          tone={hero ? 'default' : 'glass'}
          isDisabled={(c) => c !== settings.baseCurrency && convert(100, settings.baseCurrency, c) === null}
        />
      </div>

      <motion.div
        key={delta?.id ?? 'idle'}
        className={hero ? 'mt-3 mb-1' : 'mt-6 mb-1 lg:mt-8 [&_.text-soft]:text-white/70'}
        style={{ color: ink }}
        animate={delta ? { color: [ink, delta.cents > 0 ? 'var(--color-income)' : 'var(--color-expense)', ink] } : undefined}
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
              className={`num text-[15px] font-semibold ${hero ? (delta.cents > 0 ? 'text-income' : 'text-expense') : 'text-white'}`}
            >
              {formatMoney(delta.cents, currency, { sign: true })}
            </motion.span>
          ) : rateLine ? (
            <motion.span key="rate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`text-[13px] ${hero ? 'text-faint' : 'text-white/70'}`}>
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

      {!hero && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => sheet.show('in')}
            className="press flex h-13 items-center justify-center gap-2 rounded-full bg-white text-base font-bold text-accent-on-white shadow-sm shadow-black/20 hover:bg-white/90"
          >
            <Plus size={20} strokeWidth={2.4} />
            Adicionar
          </button>
          <button
            type="button"
            onClick={() => sheet.show('out')}
            className="press flex h-13 items-center justify-center gap-2 rounded-full border border-white/40 bg-white/[0.06] text-base font-bold text-white hover:bg-white/12"
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
      {hero ? content : <Card3D>{content}</Card3D>}
      {!hero && <TransactionSheet type={sheet.item ?? 'in'} open={sheet.open} onClose={sheet.close} />}
    </section>
  )
}
