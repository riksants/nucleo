import { useAutomationActions } from '../../data/useAutomations'
import type { AutomationRun } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { Button } from '../../ui/Button'
import { Badge } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { useSheet } from '../../ui/formHooks'
import { ConfirmChargeSheet } from './ConfirmChargeSheet'
import { isIncome } from './runs'

/** Charges the Núcleo created and that wait for the person: nothing is in Financeiro yet. */
export function PendingCharges({ runs }: { runs: AutomationRun[] }) {
  const { decline } = useAutomationActions()
  const { confirm } = useFeedback()
  const sheet = useSheet<AutomationRun>()
  if (!runs.length) return null

  const notPaid = async (run: AutomationRun) => {
    const income = isIncome(run)
    const ok = await confirm({
      title: income ? 'Não recebeu?' : 'Não pagou?',
      message: income ? `A cobrança de ${run.origin.label} sai da lista. Nada entra no Financeiro.` : `A cobrança de ${run.origin.label} sai da lista. Nada sai do Financeiro.`,
      confirmLabel: income ? 'Não recebi' : 'Não paguei',
    })
    if (ok) await decline(run)
  }

  return (
    <>
      <div className="card divide-y divide-line">
        {runs.map((run) => {
          const income = isIncome(run)
          return (
            <div key={run.id} className="px-4 py-3.5">
              <div className="flex items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{run.origin.label}</span>
                  <span className="block text-[13px] text-faint">
                    Cobrança de {formatDateValue(run.date).toLowerCase()} · <Badge tone="warn">{income ? 'a receber' : 'a pagar'}</Badge>
                  </span>
                </span>
                {run.amount !== undefined && run.currency && <span className={`num shrink-0 text-[15px] font-semibold ${income ? 'text-income' : ''}`}>{formatMoney(run.amount, run.currency)}</span>}
              </div>
              <div className="mt-3 flex gap-2">
                <Button className="flex-1" onClick={() => sheet.show(run)}>
                  {income ? 'Confirmar recebimento' : 'Confirmar pagamento'}
                </Button>
                <Button variant="ghost" onClick={() => notPaid(run)}>
                  {income ? 'Não recebi' : 'Não paguei'}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      <ConfirmChargeSheet run={sheet.item} open={sheet.open} onClose={sheet.close} />
    </>
  )
}
