import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { todayIn, zoneOf } from '../../core/period'
import { OVER_REMAINING, projectPaymentProblem, projectRemaining } from '../../data/receipts'
import { newId, useStore } from '../../data/store'
import type { Project, ProjectPayment } from '../../data/types'
import { useReceipts } from '../../data/useReceipts'
import { formatDateValue } from '../../lib/dates'
import { amountToInput, currencyInfo, formatMoney, parseAmount } from '../../lib/money'
import { Button, IconButton } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { Field, TextInput } from '../../ui/Field'
import { useDraft } from '../../ui/formHooks'
import { Sheet } from '../../ui/Sheet'

/**
 * Receiving money for a project, without opening "Editar projeto".
 * - new: value (in the project's currency), date, optional note → "Confirmar recebimento";
 * - payment: edits/deletes that payment (its income in Financeiro follows);
 * - legacy: the old "Recebido" (from before the history) becomes a payment on the real date asked here.
 */
export function ProjectPaymentSheet({ project, payment, legacy, open, onClose }: { project: Project | null; payment?: ProjectPayment | null; legacy?: boolean; open: boolean; onClose(): void }) {
  const { settings, convert } = useStore()
  const { saveProject } = useReceipts()
  const { toast, confirm } = useFeedback()
  const today = todayIn(zoneOf(settings))
  const [draft, set] = useDraft(open, () => ({
    amount: payment ? amountToInput(payment.amount) : '',
    date: payment?.date ?? (legacy ? '' : today),
    note: payment?.note ?? (legacy ? 'Recebido antes do histórico' : ''),
  }))
  const [error, setError] = useState<string | null>(null)
  // One confirmation per opening: a second tap (also while the sheet slides away) does nothing.
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setError(null)
    sending.current = false
    setBusy(false)
  }, [open])
  if (!project) return null

  const cur = project.currency
  const remaining = projectRemaining(project, payment?.id)
  const noRate = convert(100, cur, settings.baseCurrency) === null

  const run = async (next: Project, message: string) => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    try {
      await saveProject(next)
      if ('vibrate' in navigator) navigator.vibrate?.(10)
      toast(message)
      onClose()
    } catch {
      sending.current = false
      setBusy(false)
      toast('Não foi possível salvar', 'error')
    }
  }

  const submit = async () => {
    if (legacy) {
      if (!draft.date) return setError('Informe a data em que o pagamento aconteceu')
      const pay: ProjectPayment = { id: newId(), date: draft.date, amount: project.received, currency: cur, note: draft.note.trim() }
      return run({ ...project, received: 0, legacyReceived: undefined, payments: sorted([...(project.payments ?? []), pay]) }, 'Lançado no Financeiro')
    }
    const pay: ProjectPayment = { id: payment?.id ?? newId(), date: draft.date, amount: parseAmount(draft.amount) ?? 0, currency: cur, note: draft.note.trim() }
    const problem = projectPaymentProblem(project, pay)
    setError(problem)
    if (problem) return
    const others = (project.payments ?? []).filter((x) => x.id !== pay.id)
    await run({ ...project, payments: sorted([...others, pay]) }, payment ? 'Pagamento atualizado' : 'Recebimento registrado')
  }

  const remove = async () => {
    if (!payment) return
    const ok = await confirm({
      title: 'Excluir pagamento?',
      message: `${formatMoney(payment.amount, cur)} de ${formatDateValue(payment.date).toLowerCase()}. A entrada correspondente sai do Financeiro e o saldo é recalculado.`,
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (!ok) return
    await run({ ...project, payments: (project.payments ?? []).filter((x) => x.id !== payment.id) }, 'Pagamento excluído')
  }

  const title = legacy ? 'Lançar no Financeiro' : payment ? 'Editar pagamento' : 'Registrar pagamento'
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      actions={
        payment && (
          <IconButton label="Excluir pagamento" size="sm" className="text-expense hover:bg-expense/10" onClick={remove}>
            <Trash2 size={18} />
          </IconButton>
        )
      }
      footer={
        <Button size="lg" block disabled={busy} onClick={submit}>
          {legacy ? `Lançar ${formatMoney(project.received, cur)}` : payment ? 'Salvar pagamento' : 'Confirmar recebimento'}
        </Button>
      }
    >
      <form
        className="space-y-4 pt-1"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <p className="text-[15px] text-soft">
          {project.name}
          {project.charged > 0 && !legacy && (
            <>
              {' · '}falta <span className="num font-medium text-ink">{formatMoney(remaining, cur)}</span>
            </>
          )}
        </p>
        {legacy ? (
          <p className="rounded-2xl bg-raised p-4 text-[15px] leading-relaxed text-soft">
            <span className="num font-semibold text-ink">{formatMoney(project.received, cur)}</span> foram marcados como recebidos antes do histórico de pagamentos. Informe quando esse dinheiro chegou: a entrada vai para esse dia no Financeiro.
          </p>
        ) : (
          <Field label="Valor recebido" error={error && error !== OVER_REMAINING ? error : null}>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-soft">{currencyInfo(cur).symbol}</span>
              <TextInput
                id="project-payment-amount"
                className="num pl-12"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={draft.amount}
                autoFocus={!payment}
                onChange={(e) => {
                  set('amount', e.target.value)
                  setError(null)
                }}
              />
            </div>
          </Field>
        )}
        {error === OVER_REMAINING && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-warn/10 px-4 py-3 text-[14px] text-warn" role="alert">
            <span>{OVER_REMAINING}</span>
            <button
              type="button"
              className="hit relative font-semibold text-ink"
              onClick={() => {
                set('amount', amountToInput(remaining))
                setError(null)
              }}
            >
              Usar {formatMoney(remaining, cur)}
            </button>
          </div>
        )}
        <Field label={legacy ? 'Data em que foi pago' : 'Data'} error={legacy && error ? error : null}>
          <TextInput id="project-payment-date" type="date" value={draft.date} max={legacy ? today : undefined} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Observação" hint="opcional">
          <TextInput id="project-payment-note" value={draft.note} onChange={(e) => set('note', e.target.value)} placeholder="Ex.: sinal, 2ª parcela" />
        </Field>
        {noRate && (
          <p className="text-[13px] leading-relaxed text-faint">
            Sem cotação de {cur} agora: o pagamento fica salvo e entra no saldo assim que houver cotação.
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}

const sorted = (list: ProjectPayment[]) => [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
