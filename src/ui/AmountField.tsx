import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Currency } from '../data/types'
import { appendOperator, CALC_ERROR, endsWithOperator, evaluate, isExpression, resultText, type CalcOp } from '../lib/calc'
import { currencyInfo } from '../lib/money'

const KEYS: { op: CalcOp | '='; label: string; symbol: string }[] = [
  { op: '+', label: 'Somar', symbol: '+' },
  { op: '-', label: 'Subtrair', symbol: '−' },
  { op: '*', label: 'Multiplicar', symbol: '×' },
  { op: '/', label: 'Dividir', symbol: '÷' },
  { op: '=', label: 'Calcular', symbol: '=' },
]

/**
 * The one money field of the app: the phone's own numeric keyboard + "+ − × ÷ =" keys that never take
 * the focus away, so "200 + 50 = 250" is typed in one go with the keyboard open.
 *
 * Keeping the focus: on iPhone the focus moves at the end of the touch (after touchend), so blocking
 * pointerdown is not enough. The keys listen to touchstart/touchend natively (React registers touch
 * listeners as passive, where preventDefault is ignored), cancel them and run the key themselves; mouse
 * keeps the focus with mousedown.preventDefault. If a platform still moves the focus, it is given back
 * inside the same tap (allowed as a user gesture), caret at the end.
 */
export function AmountField({
  value,
  onChange,
  currency,
  sign,
  size = 'md',
  id,
  placeholder,
  autoFocus,
  invalid,
  error,
  showError,
  inputRef,
  enterKeyHint,
  onEnter,
  keys = 'focus',
  trailing,
  ariaLabel,
}: {
  value: string
  onChange(v: string): void
  /** Shows its symbol inside the field. */
  currency?: Currency
  /** "+" / "−" in front (incomes / expenses). */
  sign?: string
  size?: 'md' | 'lg'
  id?: string
  placeholder?: string
  /** Focuses on open without scrolling the page (the sheet keeps the field in view itself). */
  autoFocus?: boolean
  invalid?: boolean
  /** Message when the plain value is not valid (expressions show their own). */
  error?: string | null
  /** Show `error` (e.g. after a submit attempt). */
  showError?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  enterKeyHint?: 'next' | 'done'
  onEnter?(): void
  /** 'always' (main amount of a sheet) or 'focus' (shown while the field is being used). */
  keys?: 'always' | 'focus'
  /** Under the field, full width (e.g. a currency picker) — the amount keeps the whole row. */
  trailing?: ReactNode
  ariaLabel?: string
}) {
  const own = useRef<HTMLInputElement>(null)
  const input = inputRef ?? own
  const keysRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  // Latest value/handler for the native touch listeners (registered once).
  const latest = useRef({ value, onChange })
  useEffect(() => {
    latest.current = { value, onChange }
  })

  const calc = evaluate(value)
  const expression = isExpression(value)

  /** Runs a key and keeps typing where it was: focus on the field, caret at the end. */
  const press = (op: CalcOp | '=') => {
    const { value: v, onChange: change } = latest.current
    if (op === '=') {
      const r = evaluate(v)
      if (r.ok) change(resultText(r.cents))
    } else change(appendOperator(v, op))
    const el = input.current
    if (!el) return
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    requestAnimationFrame(() => {
      const end = el.value.length
      el.setSelectionRange(end, end)
    })
  }

  // Native, non-passive touch listeners on the keys (see above).
  useEffect(() => {
    const box = keysRef.current
    if (!box) return
    let down: HTMLElement | null = null
    const keyOf = (t: EventTarget | null) => (t instanceof Element ? (t.closest('[data-key]') as HTMLElement | null) : null)
    const onStart = (e: TouchEvent) => {
      const k = keyOf(e.target)
      if (!k) return
      e.preventDefault()
      down = k
      k.dataset.pressed = 'true'
    }
    const onEnd = (e: TouchEvent) => {
      if (!down) return
      e.preventDefault()
      const k = down
      down = null
      delete k.dataset.pressed
      const touch = e.changedTouches[0]
      const over = touch ? keyOf(document.elementFromPoint(touch.clientX, touch.clientY)) : k
      if (over === k) press(k.dataset.key as CalcOp | '=')
    }
    const onCancel = () => {
      if (down) delete down.dataset.pressed
      down = null
    }
    box.addEventListener('touchstart', onStart, { passive: false })
    box.addEventListener('touchend', onEnd, { passive: false })
    box.addEventListener('touchcancel', onCancel)
    return () => {
      box.removeEventListener('touchstart', onStart)
      box.removeEventListener('touchend', onEnd)
      box.removeEventListener('touchcancel', onCancel)
    }
    // press reads everything through refs
  }, [focused, keys]) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus on open without letting the browser scroll the page to it.
  useLayoutEffect(() => {
    if (autoFocus) input.current?.focus({ preventScroll: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const showKeys = keys === 'always' || focused || expression
  const symbol = currency ? currencyInfo(currency).symbol : ''
  const big = size === 'lg'
  const message = expression ? (calc.ok ? `= ${resultText(calc.cents)}` : endsWithOperator(value) && !showError ? '' : CALC_ERROR[calc.error]) : showError ? error : null

  return (
    <div data-amount-field className="min-w-0">
      <div className="flex min-w-0 gap-2">
        <div
          className={`flex min-w-0 flex-1 items-center gap-2 border bg-raised transition-colors focus-within:border-accent-hi/70 ${big ? 'rounded-[1.25rem] px-5' : 'rounded-[var(--radius-field)] px-4 focus-within:bg-elevated'} ${invalid || (showError && message && !calc.ok) ? 'border-expense/60' : 'border-line'}`}
        >
          {sign && <span className={`${big ? 'text-2xl font-medium' : ''} shrink-0 text-soft`}>{sign}</span>}
          {symbol && <span className={`${big ? 'text-2xl font-medium' : ''} shrink-0 text-soft`}>{symbol}</span>}
          <input
            ref={input}
            id={id}
            aria-label={ariaLabel}
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint={enterKeyHint}
            placeholder={placeholder ?? (big ? '0' : '0,00')}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === '=') {
                e.preventDefault()
                press('=')
              } else if (e.key === 'Enter' && onEnter) {
                e.preventDefault()
                onEnter()
              }
            }}
            className={`num min-w-0 flex-1 bg-transparent text-ink placeholder:text-faint/60 focus:outline-none ${big ? 'h-20 text-[40px]! font-semibold tracking-tight' : 'h-12'}`}
          />
        </div>
      </div>
      {message ? (
        <p aria-live="polite" data-testid="calc-result" className={`num mt-1.5 text-sm ${expression && calc.ok ? 'text-soft' : 'text-expense'}`}>
          {message}
        </p>
      ) : (
        expression && <p aria-live="polite" data-testid="calc-result" className="mt-1.5 text-sm">&nbsp;</p>
      )}
      {showKeys && (
        <div ref={keysRef} className="mt-2 grid grid-cols-5 gap-2" role="group" aria-label="Calculadora">
          {KEYS.map((k) => (
            <button
              key={k.op}
              type="button"
              tabIndex={-1}
              data-key={k.op}
              aria-label={k.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => press(k.op)}
              className={`h-11 touch-manipulation rounded-full border text-[20px] font-medium transition-[transform,background-color] duration-100 select-none active:scale-[0.96] data-[pressed=true]:scale-[0.96] data-[pressed=true]:bg-raised ${k.op === '=' ? 'border-accent/30 bg-accent/12 text-accent-hi' : 'border-line bg-surface text-soft hover:text-ink'}`}
            >
              {k.symbol}
            </button>
          ))}
        </div>
      )}
      {trailing && <div className="mt-2">{trailing}</div>}
    </div>
  )
}
