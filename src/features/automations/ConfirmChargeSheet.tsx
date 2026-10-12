import { useState } from 'react'
import { todayIn, zoneOf } from '../../core/period'
import { useAutomationActions } from '../../data/useAutomations'
import { useStore } from '../../data/store'
import type { AutomationRun } from '../../data/types'
import { parseMoney } from '../../lib/calc'
import { formatDateValue } from '../../lib/dates'
import { amountToInput } from '../../lib/money'
import { AmountField } from '../../ui/AmountField'
import { Button } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { Field, TextInput } from '../../ui/Field'
import { Sheet } from '../../ui/Sheet'
import { isIncome } from './runs'

/** "Confirmar recebimento" / "Confirmar pagamento": only now the money enters Financeiro. */
export function ConfirmChargeSheet({ run, open, onClose }: { run: AutomationRun | null; open: boolean; onClose(): void }) {
  const { settings } = useStore()
  const { confirm } = useAutomationActions()
  const { toast } = useFeedback()
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [shownFor, setShownFor] = useState<string | null>(null)
  if (open && run && shownFor !== run.id) {
    setShownFor(run.id)
    setAmount(amountToInput(run.amount ?? 0))
    setDate(todayIn(zoneOf(settings)))
  }
  if (!run) return null
  const income = isIncome(run)
  const currency = run.currency ?? settings.baseCurrency

  const submit = async () => {
    const cents = parseMoney(amount)
    if (!cents || cents <= 0) return toast(income ? 'Digite o valor recebido' : 'Digite o valor pago', 'error')
    setBusy(true)
    try {
      const error = await confirm(run, { amount: cents, date })
      if (error) return toast(error, 'error')
      toast(income ? 'Recebimento confirmado' : 'Pagamento confirmado')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={income ? 'Confirmar recebimento' : 'Confirmar pagamento'}
      footer={
        <Button size="lg" block disabled={busy} onClick={submit}>
          {income ? 'Confirmar recebimento' : 'Confirmar pagamento'}
        </Button>
      }
    >
      <div className="space-y-4 pt-1">
        <p className="text-[15px] leading-relaxed text-soft">
          {run.origin.label} · cobrança de {formatDateValue(run.date).toLowerCase()}. {income ? 'A entrada vai para o Financeiro' : 'A saída vai para o Financeiro'} só depois que você confirmar.
        </p>
        <Field label={income ? 'Valor recebido' : 'Valor pago'}>
          <AmountField currency={currency} value={amount} onChange={setAmount} autoFocus />
        </Field>
        <Field label={income ? 'Data do recebimento' : 'Data do pagamento'}>
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  )
}
