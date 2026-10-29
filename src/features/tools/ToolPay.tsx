import { Check, CircleHelp } from 'lucide-react'
import { useState } from 'react'
import { currentToolCycle } from '../../core/automation/toolCharge'
import { todayIn, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import { useAutomationActions } from '../../data/useAutomations'
import type { AutomationRun, Tool } from '../../data/types'
import { parseMoney } from '../../lib/calc'
import { formatDateValue, relativeDays } from '../../lib/dates'
import { amountToInput, formatMoney } from '../../lib/money'
import { AmountField } from '../../ui/AmountField'
import { Button } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft } from '../../ui/formHooks'
import { Switch } from '../settings/ModulePicker'

/** "Já paguei": amount and date (prefilled), and whether the expense goes into Financeiro. */
export function PaySheet({ tool, onClose }: { tool: Tool | null; onClose(): void }) {
  const { settings, data } = useStore()
  const { payNow } = useAutomationActions()
  const { toast } = useFeedback()
  const today = todayIn(zoneOf(settings))
  const cycle = tool ? currentToolCycle(tool, { data, today }) : null
  const [d, set] = useDraft(!!tool, () => ({ amount: tool ? amountToInput(cycle?.run?.amount ?? tool.price) : '', date: today, deduct: true }))
  const submit = async () => {
    if (!tool) return
    const amount = parseMoney(d.amount)
    if (!amount || amount <= 0) return 'Digite o valor pago'
    const error = await payNow(tool, { amount, date: d.date, deduct: d.deduct })
    if (error) return error
    toast(d.deduct ? `${tool.name}: pagamento registrado e descontado do saldo` : `${tool.name}: marcado como pago`)
    onClose()
  }
  return (
    <FormSheet open={!!tool} onClose={onClose} title="Já paguei" submitLabel="Registrar pagamento" onSubmit={submit}>
      {tool && (
        <FormGrid>
          <p className="text-[14px] text-soft">
            {tool.name}
            {cycle ? ` · cobrança de ${formatDateValue(cycle.date).toLowerCase()}` : ''}
          </p>
          <Field label="Valor pago">
            <AmountField value={d.amount} onChange={(v) => set('amount', v)} currency={tool.currency} />
          </Field>
          <Field label="Data do pagamento">
            <TextInput type="date" value={d.date} max={today} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <button type="button" role="switch" aria-checked={d.deduct} onClick={() => set('deduct', !d.deduct)} className="flex w-full items-start gap-3 rounded-2xl bg-raised px-4 py-3 text-left">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">Descontar do saldo</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-faint">{d.deduct ? 'Entra como saída no Financeiro.' : 'Fica só como pago aqui: o saldo não muda (ex.: pago por outra conta).'}</span>
            </span>
            <Switch checked={d.deduct} />
          </button>
        </FormGrid>
      )}
    </FormSheet>
  )
}

/**
 * After the due date: the charge that wasn't confirmed, asked plainly — with the three answers the person can give.
 * A presumed one ("Pagamento presumido") is shown as such and can be confirmed or corrected.
 */
export function DueCard({ run }: { run: AutomationRun }) {
  const { confirm, confirmNoExpense, notYet } = useAutomationActions()
  const { toast } = useFeedback()
  const { settings } = useStore()
  const [busy, setBusy] = useState(false)
  const today = todayIn(zoneOf(settings))
  const rel = relativeDays(run.date)
  const when = rel && rel.days === -1 ? 'venceu ontem' : `venceu ${formatDateValue(run.date).toLowerCase()}`
  const money = run.amount !== undefined && run.currency ? formatMoney(run.amount, run.currency) : ''
  const act = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fn()
      if (typeof r === 'string') toast(r, 'error')
      else toast(done)
    } finally {
      setBusy(false)
    }
  }
  const deduct = () => act(() => confirm(run, { amount: run.amount ?? 0, date: run.date > today ? today : run.date }), 'Pagamento confirmado e descontado do saldo')
  return (
    <div className="px-4 py-4">
      <div className="flex items-start gap-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${run.presumed ? 'bg-warn/[0.14] text-warn' : 'icon-tile'}`}>{run.presumed ? <CircleHelp size={18} /> : <Check size={18} />}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">
            {run.origin.label} {money && <span className="num font-medium text-soft">· {money}</span>}
          </span>
          <span className="block text-[13px] leading-snug text-soft">
            {run.presumed ? `Pagamento presumido (${when}): ainda não confirmado por você.${run.created.length ? ' Já descontado do saldo.' : ''}` : `Sua assinatura ${when}. O pagamento é provável. Quer confirmar?`}
          </span>
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {run.presumed ? (
          <>
            {!run.created.length && (
              <Button disabled={busy} onClick={deduct}>
                Confirmar e descontar
              </Button>
            )}
            <Button variant="secondary" disabled={busy} onClick={() => act(() => confirmNoExpense(run), run.created.length ? 'Pagamento confirmado' : 'Confirmado sem descontar')}>
              {run.created.length ? 'Confirmar' : 'Confirmar sem descontar'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => act(() => notYet(run), 'Voltou para “A pagar”')}>
              Não paguei
            </Button>
          </>
        ) : (
          <>
            <Button disabled={busy} onClick={deduct}>
              Confirmar e descontar
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => act(() => confirmNoExpense(run), 'Confirmado sem descontar')}>
              Sem descontar
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => act(() => notYet(run), 'Fica em “A pagar”')}>
              Ainda não paguei
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
