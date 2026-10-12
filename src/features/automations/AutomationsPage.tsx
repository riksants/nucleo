import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { navigate } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { AUTOMATIONS, automationSince } from '../../core/automation/engine'
import { useStore } from '../../data/store'
import { useAutomationActions } from '../../data/useAutomations'
import type { AutomationRun } from '../../data/types'
import { parseMoney } from '../../lib/calc'
import { formatDateValue } from '../../lib/dates'
import { amountToInput, formatMoney } from '../../lib/money'
import { AmountField } from '../../ui/AmountField'
import { Button } from '../../ui/Button'
import { Badge, EmptyState, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field } from '../../ui/Field'
import { useSheet } from '../../ui/formHooks'
import { Sheet } from '../../ui/Sheet'
import { Switch } from '../settings/ModulePicker'
import { PendingCharges } from './PendingCharges'
import { historyRuns, ORIGIN_PATH, pendingRuns } from './runs'

const STATUS_LABEL: Partial<Record<AutomationRun['status'], string>> = { undone: 'desfeito', skipped: 'pulado' }

/** "Mudar este mês" of a goal reservation. */
function ChangeMonthSheet({ run, open, onClose }: { run: AutomationRun | null; open: boolean; onClose(): void }) {
  const { changeMonth } = useAutomationActions()
  const { toast } = useFeedback()
  const [value, setValue] = useState('')
  const [shownFor, setShownFor] = useState<string | null>(null)
  if (open && run && shownFor !== run.id) {
    setShownFor(run.id)
    setValue(amountToInput(run.status === 'done' ? (run.amount ?? 0) : 0))
  }
  if (!run) return null
  const save = async () => {
    const cents = parseMoney(value || '0')
    if (cents === null) return toast('Digite um valor', 'error')
    const error = await changeMonth(run, cents)
    if (error) return toast(error, 'error')
    toast(cents ? 'Valor deste mês alterado' : 'Mês pulado')
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title="Mudar este mês" footer={<Button size="lg" block onClick={save}>Salvar</Button>}>
      <div className="space-y-4 pt-1">
        <p className="text-[15px] leading-relaxed text-soft">Quanto reservar para {run.origin.label} em {formatDateValue(run.date).toLowerCase()}. Só este mês muda; nos próximos, o valor calculado se ajusta sozinho.</p>
        <Field label="Valor deste mês">
          <AmountField currency={run.currency ?? 'EUR'} value={value} onChange={setValue} autoFocus />
        </Field>
      </div>
    </Sheet>
  )
}

function RunRow({ run, onChangeMonth }: { run: AutomationRun; onChangeMonth(r: AutomationRun): void }) {
  const { undo } = useAutomationActions()
  const { toast, confirm } = useFeedback()
  const path = ORIGIN_PATH[run.origin.collection]
  const done = run.status === 'done'
  const goal = run.automation === 'goalSave'

  const doUndo = async () => {
    const ok = await confirm({ title: 'Desfazer?', message: run.summary, confirmLabel: 'Desfazer' })
    if (!ok) return
    const { partial } = await undo(run)
    toast(partial ? 'Desfeito. A data da próxima cobrança ficou como você deixou.' : 'Desfeito')
  }
  const skip = async () => {
    await undo(run, 'skipped')
    toast('Mês pulado')
  }

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className={`block text-[15px] leading-snug ${done ? '' : 'text-soft'}`}>{run.summary}</span>
          {run.detail && <span className="mt-0.5 block text-[13px] leading-snug text-soft">{run.detail}</span>}
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-faint">
            <span>{formatDateValue(run.date)}</span>
            {path && (
              <button type="button" className="font-medium text-accent-hi hover:text-ink" onClick={() => navigate(path, path === '/finance' ? undefined : { open: run.origin.id })}>
                {run.origin.label}
              </button>
            )}
            {STATUS_LABEL[run.status] && <Badge>{STATUS_LABEL[run.status]}</Badge>}
          </span>
        </span>
        {run.amount !== undefined && run.amount > 0 && run.currency && <span className="num shrink-0 text-[15px] font-semibold">{formatMoney(run.amount, run.currency)}</span>}
      </div>
      {(done || (goal && run.status === 'skipped')) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {goal && (
            <button type="button" className="text-[14px] font-medium text-accent-hi hover:text-ink" onClick={() => onChangeMonth(run)}>
              Mudar este mês
            </button>
          )}
          {goal && done && (
            <button type="button" className="text-[14px] font-medium text-soft hover:text-ink" onClick={skip}>
              Pular este mês
            </button>
          )}
          {done && !goal && (
            <button type="button" className="text-[14px] font-medium text-soft hover:text-ink" onClick={doUndo}>
              {run.automation === 'subscriberCharge' ? 'Não pagou · desfazer' : 'Desfazer'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** On/off for each automation. Turning one back on starts from today (the time it was off is not caught up). */
export function AutomationSettings() {
  const { settings } = useStore()
  const { setEnabled } = useAutomationActions()
  return (
    <div className="card divide-y divide-line overflow-hidden">
      {AUTOMATIONS.map((a) => {
        const on = automationSince(settings, a.id) !== null || !settings.automations?.[a.id]
        return (
          <button key={a.id} type="button" role="switch" aria-checked={on} onClick={() => setEnabled(a.id, !on)} className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-tint/[0.03] tap">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">{a.title}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-faint">{a.text}</span>
            </span>
            <span className="pt-0.5">
              <Switch checked={on} />
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function AutomationsPage() {
  const { data } = useStore()
  const monthSheet = useSheet<AutomationRun>()
  const pending = pendingRuns(data.automationRuns)
  const history = historyRuns(data.automationRuns)

  return (
    <>
      <PageHeader title="Feito pelo Núcleo" subtitle="O que o Núcleo fez sozinho, e o que espera você" />
      <div className="grid gap-7 lg:grid-cols-2 lg:items-start">
        <div className="space-y-7">
          {pending.length > 0 && (
            <section>
              <SectionTitle>Esperando você</SectionTitle>
              <PendingCharges runs={pending} />
            </section>
          )}
          <section>
            <SectionTitle>Histórico</SectionTitle>
            {history.length ? (
              <div className="card divide-y divide-line">
                {history.map((r) => (
                  <RunRow key={r.id} run={r} onChangeMonth={monthSheet.show} />
                ))}
              </div>
            ) : (
              <EmptyState compact icon={<Sparkles size={20} />} title="Nada ainda" text="Quando o Núcleo fizer algo sozinho, aparece aqui, com a opção de desfazer." />
            )}
          </section>
        </div>
        <section>
          <SectionTitle>Automações</SectionTitle>
          <AutomationSettings />
          <p className="mt-2 px-1 text-[13px] leading-relaxed text-faint">O Núcleo automatiza ações, mas nunca inventa fatos: só considera algo pago quando você confirma ou quando escolheu “Considerar pago automaticamente” naquele item.</p>
        </section>
      </div>
      <ChangeMonthSheet run={monthSheet.item} open={monthSheet.open} onClose={monthSheet.close} />
    </>
  )
}
