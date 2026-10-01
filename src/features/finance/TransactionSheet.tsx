import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { MissingRateError, useStore } from '../../data/store'
import { sortByNewest } from '../../data/selectors'
import type { Currency, Transaction } from '../../data/types'
import { amountToInput, currencyInfo, formatMoney, parseAmount } from '../../lib/money'
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
    if (open) setTried(false)
  }, [open])

  const cents = parseAmount(draft.amount)
  const amountError = cents === null || cents === 0 ? 'Digite um valor' : null
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
    if (amountError || reasonError || cents === null) return
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
        <Button size="lg" block onClick={() => submit()}>
          {confirmLabel}
        </Button>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-6 pt-2">
        <div>
          <label htmlFor="tx-amount" className="mb-2 block text-[13px] font-medium tracking-wide text-soft uppercase">
            Valor
          </label>
          <div
            className={`flex items-center gap-2 rounded-[1.25rem] border bg-raised px-5 transition-colors focus-within:border-accent/70 ${
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
                }
              }}
              className="num h-20 min-w-0 flex-1 bg-transparent text-[40px]! font-semibold tracking-tight placeholder:text-faint/60 focus:outline-none"
            />
          </div>
          {tried && amountError && <p className="mt-1.5 text-sm text-expense">{amountError}</p>}
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
          <label htmlFor="tx-reason" className="mb-2 block text-[13px] font-medium tracking-wide text-soft uppercase">
            Motivo
          </label>
          <input
            id="tx-reason"
            ref={reasonRef}
            enterKeyHint="done"
            autoComplete="off"
            placeholder={kind === 'in' ? 'Ex.: Pagamento de cliente' : 'Ex.: Assinatura de ferramenta'}
            value={draft.reason}
            maxLength={120}
            onChange={(e) => set('reason', e.target.value)}
            className={`h-14 w-full rounded-[var(--radius-field)] border bg-raised px-4 text-[17px]! text-ink placeholder:text-faint focus:border-accent/70 focus:outline-none ${
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
              <label htmlFor="tx-category" className="mb-2 block text-[13px] font-medium tracking-wide text-soft uppercase">
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
