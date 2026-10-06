import { ArrowUpRight, Trash2 } from 'lucide-react'
import { navigate } from '../../app/router'
import { allReceipts } from '../../data/receipts'
import { formatDateTime } from '../../lib/dates'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { MissingRateError, useStore } from '../../data/store'
import { sortByNewest } from '../../data/selectors'
import type { Currency, Transaction } from '../../data/types'
import { appendOperator, CALC_ERROR, endsWithOperator, evaluate, isExpression, resultText, type CalcOp } from '../../lib/calc'
import { amountToInput, currencyInfo, formatMoney } from '../../lib/money'
import { Button, IconButton } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { useDraft } from '../../ui/formHooks'
import { CurrencyPicker, Select } from '../../ui/Field'
import { NO_CATEGORY, pickableCategories } from '../../core/financeCategories'
import { ToggleRow } from '../planner/controls'
import { Sheet } from '../../ui/Sheet'

interface Props {
  open: boolean
  onClose(): void
  /** Type for a new entry. Ignored when editing. */
  type: 'in' | 'out'
  editing?: Transaction | null
}

/** The fast "+ / −" flow: amount, reason, confirm. Also edits an existing entry. */
export function TransactionSheet({ open, onClose, type, editing }: Props) {
  const { data, displayCurrency, settings, convert, addTransaction, updateTransaction, remove } = useStore()
  const { toast, confirm } = useFeedback()
  const reasonRef = useRef<HTMLInputElement>(null)
  const [tried, setTried] = useState(false)
  /**
   * One save per opening: a second tap (also while the sheet slides away) must not record the
   * movement twice. A ref, so even two taps in the same frame see it; released when it reopens or on error.
   */
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)

  const kind = editing?.type ?? type
  const [draft, set] = useDraft(open, () => ({
    amount: editing ? amountToInput(editing.amount) : '',
    currency: editing?.currency ?? (convert(100, displayCurrency, settings.baseCurrency) !== null ? displayCurrency : settings.baseCurrency),
    reason: editing?.reason ?? '',
    category: editing?.category ?? '',
    unnecessary: editing?.unnecessary ?? false,
  }))
  const categories = kind === 'adjust' ? [] : pickableCategories(settings, kind, editing?.category)
  useEffect(() => {
    if (!open) return
    setTried(false)
    sending.current = false
    setBusy(false)
  }, [open])

  // A plain number works as always; "2500 + 750 + 120" is calculated (no eval) and the final result is what gets saved.
  const calc = evaluate(draft.amount)
  const expression = isExpression(draft.amount)
  const cents = calc.ok ? calc.cents : null
  const amountError = calc.ok ? null : expression ? CALC_ERROR[calc.error] : 'Digite um valor'
  const tapOperator = (op: CalcOp) => set('amount', appendOperator(draft.amount, op))
  const equals = () => {
    if (calc.ok) set('amount', resultText(calc.cents))
    else setTried(true)
  }
  const reasonError = draft.reason.trim() ? null : 'O motivo é obrigatório'

  const suggestions = useMemo(() => {
    if (editing) return []
    const seen = new Set<string>()
    for (const t of sortByNewest(data.transactions)) {
      if (t.type !== kind) continue
      seen.add(t.reason)
      if (seen.size >= 6) break
    }
    return [...seen]
  }, [data.transactions, kind, editing])

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    setTried(true)
    if (amountError || reasonError || cents === null || sending.current) return
    sending.current = true
    setBusy(true)
    try {
      // Optional details: only sent when there is something to keep or change, so old records stay as they were.
      const extras = {
        ...(draft.category || editing?.category ? { category: draft.category || null } : {}),
        ...(draft.unnecessary || editing?.unnecessary ? { unnecessary: kind === 'out' && draft.unnecessary } : {}),
      }
      const input = { amount: cents, currency: draft.currency, reason: draft.reason.trim(), ...extras }
      if (editing) await updateTransaction(editing, input)
      else await addTransaction({ ...input, type: kind as 'in' | 'out' })
      if ('vibrate' in navigator) navigator.vibrate?.(10)
      toast(editing ? 'Movimentação atualizada' : 'Movimentação salva')
      onClose()
    } catch (err) {
      sending.current = false
      setBusy(false)
      toast(err instanceof MissingRateError ? err.message : 'Não foi possível salvar', 'error')
    }
  }

  const onDelete = async () => {
    if (!editing) return
    const ok = await confirm({
      title: 'Excluir movimentação?',
      message: 'O saldo será recalculado sem ela.',
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (!ok) return
    await remove('transactions', editing.id)
    toast('Movimentação excluída')
    onClose()
  }

  const title = editing ? (kind === 'adjust' ? 'Ajuste de saldo' : 'Editar movimentação') : kind === 'in' ? 'Adicionar dinheiro' : 'Retirar dinheiro'
  const verb = kind === 'in' ? 'Adicionar' : kind === 'out' ? 'Retirar' : 'Salvar'
  const confirmLabel = editing ? 'Salvar alterações' : cents ? `${verb} ${formatMoney(cents, draft.currency)}` : 'Confirmar'
  const symbol = currencyInfo(draft.currency).symbol

  // An income created by a received payment is changed where the payment lives (project/sale),
  // so the two never disagree. If that payment no longer exists, it is a normal movement again.
  const receipt = editing?.source ? allReceipts(data).find((r) => r.txId === editing.id) : undefined
  if (editing && receipt) {
    const from = receipt.source.kind === 'project' ? 'projeto' : 'venda'
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="Recebimento"
        footer={
          <Button
            size="lg"
            block
            variant="secondary"
            icon={<ArrowUpRight size={18} />}
            onClick={() => {
              onClose()
              navigate(receipt.open.path, { open: receipt.open.id })
            }}
          >
            {receipt.source.kind === 'project' ? 'Abrir projeto' : 'Abrir venda'}
          </Button>
        }
      >
        <div className="space-y-3 pt-1">
          <p className="num text-[28px] font-semibold text-income">+ {formatMoney(editing.amount, editing.currency)}</p>
          <p className="text-[15px]">{editing.reason}</p>
          <p className="text-[13px] text-faint">{formatDateTime(editing.createdAt)}</p>
          <p className="rounded-2xl bg-raised p-4 text-[15px] leading-relaxed text-soft">
            Esta entrada veio de um pagamento registrado {receipt.source.kind === 'project' ? 'no' : 'na'} {from}. Para corrigir o valor, a data ou excluir, altere o pagamento lá — o Financeiro acompanha.
          </p>
        </div>
      </Sheet>
    )
  }
  const orphan = Boolean(editing?.source)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      actions={
        editing && (
          <IconButton label="Excluir movimentação" size="sm" className="text-expense hover:bg-expense/10" onClick={onDelete}>
            <Trash2 size={18} />
          </IconButton>
        )
      }
      footer={
        <Button size="lg" block disabled={busy} onClick={() => submit()}>
          {confirmLabel}
        </Button>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-6 pt-2">
        {orphan && <p className="rounded-2xl bg-raised p-4 text-[14px] leading-relaxed text-soft">Esta entrada veio de um pagamento que não existe mais (talvez excluído em outro aparelho). Ela pode ser editada ou excluída normalmente.</p>}
        <div>
          <label htmlFor="tx-amount" className="mb-2 block text-[13px] font-semibold text-soft">
            Valor
          </label>
          <div
            className={`flex items-center gap-2 rounded-[1.25rem] border bg-raised px-5 transition-colors focus-within:border-accent-hi/70 ${
              tried && amountError ? 'border-expense/60' : 'border-line'
            }`}
          >
            <span className="text-2xl font-medium text-soft">{kind === 'out' ? '−' : kind === 'in' ? '+' : ''}</span>
            <span className="text-2xl font-medium text-soft">{symbol}</span>
            <input
              id="tx-amount"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="next"
              autoFocus={!editing}
              placeholder="0"
              value={draft.amount}
              onChange={(e) => set('amount', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  reasonRef.current?.focus()
                } else if (e.key === '=') {
                  e.preventDefault()
                  equals()
                }
              }}
              className="num h-20 min-w-0 flex-1 bg-transparent text-[40px]! font-semibold tracking-tight placeholder:text-faint/60 focus:outline-none"
            />
          </div>
          {expression ? (
            <p aria-live="polite" data-testid="calc-result" className={`num mt-1.5 text-sm ${calc.ok ? 'text-soft' : 'text-expense'}`}>
              {calc.ok ? `= ${resultText(calc.cents)}` : endsWithOperator(draft.amount) && !tried ? ' ' : amountError}
            </p>
          ) : (
            tried && amountError && <p className="mt-1.5 text-sm text-expense">{amountError}</p>
          )}
          {/* Calculator keys. They keep the focus on the field, so the phone keyboard stays open. */}
          <div className="mt-2 grid grid-cols-5 gap-2">
            {(
              [
                ['+', 'Somar', '+'],
                ['-', 'Subtrair', '−'],
                ['*', 'Multiplicar', '×'],
                ['/', 'Dividir', '÷'],
              ] as const
            ).map(([op, label, symbol]) => (
              <button
                key={op}
                type="button"
                aria-label={label}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => tapOperator(op)}
                className="press h-9 rounded-full border border-line bg-surface text-[17px] text-soft hover:text-ink"
              >
                {symbol}
              </button>
            ))}
            <button
              type="button"
              aria-label="Calcular"
              onPointerDown={(e) => e.preventDefault()}
              onClick={equals}
              className="press h-9 rounded-full border border-line bg-surface text-[17px] text-soft hover:text-ink"
            >
              =
            </button>
          </div>
          {kind !== 'adjust' && (
            <div className="mt-3">
              <CurrencyPicker
                block
                label="Moeda"
                value={draft.currency}
                onChange={(c: Currency) => set('currency', c)}
                format={(c) => `${c} ${currencyInfo(c).symbol}`}
                isDisabled={(c) => c !== settings.baseCurrency && convert(100, c, settings.baseCurrency) === null}
              />
            </div>
          )}
        </div>

        <div>
          <label htmlFor="tx-reason" className="mb-2 block text-[13px] font-semibold text-soft">
            Motivo
          </label>
          <input
            id="tx-reason"
            ref={reasonRef}
            enterKeyHint="done"
            autoComplete="off"
            placeholder={kind === 'in' ? 'Ex.: Pagamento de cliente' : 'Ex.: Assinatura do Spotify'}
            value={draft.reason}
            maxLength={120}
            onChange={(e) => set('reason', e.target.value)}
            className={`h-14 w-full rounded-[var(--radius-field)] border bg-raised px-4 text-[17px]! text-ink placeholder:text-faint focus:border-accent-hi/70 focus:outline-none ${
              tried && reasonError ? 'border-expense/60' : 'border-line'
            }`}
          />
          {tried && reasonError && <p className="mt-1.5 text-sm text-expense">{reasonError}</p>}
          {suggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set('reason', s)}
                  className="press h-9 max-w-full truncate rounded-full border border-line bg-surface px-3.5 text-sm text-soft hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        {kind !== 'adjust' && (
          <div className="space-y-3">
            <div>
              <label htmlFor="tx-category" className="mb-2 block text-[13px] font-semibold text-soft">
                Categoria <span className="font-normal tracking-normal normal-case text-faint">· opcional</span>
              </label>
              <Select id="tx-category" value={draft.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">{NO_CATEGORY}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            {kind === 'out' && (
              <ToggleRow checked={draft.unnecessary} onChange={(v) => set('unnecessary', v)} hint="Opcional — só você decide. Aparece na revisão da semana e no mês.">
                Gasto desnecessário
              </ToggleRow>
            )}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}
