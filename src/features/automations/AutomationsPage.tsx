import { Check, Sparkles, Wand2, X } from 'lucide-react'
import { useState } from 'react'
import { navigate, useRoute } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { AUTOMATIONS, automationSince } from '../../core/automation/engine'
import { useStore } from '../../data/store'
import { automationPause, useAutomationActions } from '../../data/useAutomations'
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
import { canUndoAction } from '../../core/automation/undo'
import { offersRetry } from '../../core/rules/retry'

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
  const { data } = useStore()
  const { undo, linkedRuns, undoOne, retry } = useAutomationActions()
  const { toast, confirm } = useFeedback()
  const isRule = run.automation === 'rule'
  const isImport = run.automation === 'bankImport'
  const path = isRule || isImport ? undefined : ORIGIN_PATH[run.origin.collection]
  const done = run.status === 'done'
  const goal = run.automation === 'goalSave'
  const ruleExists = isRule && run.rule && data.rules.some((r) => r.id === run.rule!.id)
  const causeGone = isRule && run.cause?.txId && !data.transactions.some((t) => t.id === run.cause!.txId)
  // The amount on the right, unless the summary already says it ("Pagamento automático de Ana: €50,00").
  const money = run.amount !== undefined && run.amount > 0 && run.currency ? formatMoney(run.amount, run.currency) : null
  const showMoney = money !== null && !run.summary.includes(money)

  const doUndo = async () => {
    const ok = await confirm({ title: 'Desfazer?', message: run.summary, confirmLabel: 'Desfazer' })
    if (!ok) return
    // Rules that ran because of the money this run brought in: offered to undo together.
    const linked = isRule ? [] : linkedRuns(run)
    const alsoLinked =
      linked.length > 0 &&
      (await confirm({
        title: linked.length === 1 ? 'Desfazer também o que uma regra fez por causa disso?' : `Desfazer também o que ${linked.length} regras fizeram por causa disso?`,
        message: linked.map((r) => r.summary).join(' · '),
        confirmLabel: 'Desfazer também',
      }))
    const { partial } = await undo(run, 'undone', alsoLinked)
    if (run.fromPending && partial) return toast('Não desfeito: você alterou a movimentação depois. Se quiser, apague-a no Financeiro.', 'error')
    toast(
      run.fromPending
        ? 'Confirmação desfeita: a cobrança voltou para a lista'
        : partial
          ? 'Desfeito. O que você alterou depois (a movimentação, a data da próxima cobrança…) foi mantido.'
          : 'Desfeito',
    )
  }
  const skip = async () => {
    await undo(run, 'skipped')
    toast('Mês pulado')
  }
  const [busy, setBusy] = useState(false)
  const undoThis = async (i: number) => {
    const a = run.actions![i]
    const ok = await confirm({ title: 'Desfazer só esta ação?', message: a.text, confirmLabel: 'Desfazer' })
    if (!ok) return
    const r = await undoOne(run, i)
    toast(!r ? 'Esta ação não pode ser desfeita sozinha.' : r.partial ? 'Desfeito. O que você alterou depois foi mantido.' : 'Ação desfeita')
  }
  const retryThis = async (i: number) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await retry(run, i)
      toast(r.text, r.ok ? 'success' : 'error')
    } finally {
      setBusy(false)
    }
  }
  const manyActions = (run.actions?.filter((a) => a.ok && !a.undone).length ?? 0) > 1
  const conv = run.cause?.conversion

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className={`block text-[15px] leading-snug ${done ? '' : 'text-soft'}`}>{isRule && run.actions?.length ? `Regra “${run.rule?.name ?? ''}”` : run.summary}</span>
          {isRule && run.actions?.length ? (
            <span className="mt-1 block space-y-0.5">
              {run.actions.map((a, i) => (
                <span key={i} className="block">
                  <span className={`flex items-start gap-1.5 text-[13px] leading-snug ${a.ok && !a.undone ? 'text-soft' : 'text-faint'}`}>
                    {a.ok && !a.undone ? <Check size={14} className="mt-0.5 shrink-0 text-income" /> : <X size={14} className="mt-0.5 shrink-0 text-faint" />}
                    <span className={`first-letter:uppercase ${a.undone ? 'line-through' : ''}`}>{a.ok ? a.text : `Não fez — ${a.text}`}</span>
                    {a.undone && <span className="shrink-0 no-underline">(desfeita)</span>}
                  </span>
                  {a.attempts?.map((t) => (
                    <span key={t.id} className="ml-5 block text-[12px] leading-snug text-faint">
                      Tentado de novo em {formatDateValue(t.at.slice(0, 10)).toLowerCase()}: {t.ok ? 'deu certo' : `ainda não — ${t.text}`}
                    </span>
                  ))}
                  {(offersRetry(run, i) || (manyActions && canUndoAction(run, i))) && (
                    <span className="ml-5 flex flex-wrap gap-x-3">
                      {offersRetry(run, i) && (
                        <button type="button" disabled={busy} className="text-[13px] font-medium text-accent-hi hover:text-ink disabled:opacity-50" onClick={() => retryThis(i)}>
                          Tentar de novo
                        </button>
                      )}
                      {manyActions && canUndoAction(run, i) && (
                        <button type="button" className="text-[13px] font-medium text-soft hover:text-ink" onClick={() => undoThis(i)}>
                          Desfazer só esta
                        </button>
                      )}
                    </span>
                  )}
                </span>
              ))}
            </span>
          ) : (
            run.detail && <span className="mt-0.5 block text-[13px] leading-snug text-soft">{run.detail}</span>
          )}
          {isRule && run.cause && <span className="mt-1 block text-[13px] leading-snug text-faint">Por causa de: {run.cause.label}</span>}
          {isRule && run.chain && <span className="mt-0.5 block text-[13px] leading-snug text-faint">Iniciada em cadeia: {run.chain.path.map((p) => `“${p.name}”`).join(' → ')}</span>}
          {conv && (
            <span className="mt-0.5 block text-[13px] leading-snug text-faint">
              Comparado convertendo {formatMoney(conv.amount, conv.from)} ≈ {formatMoney(conv.converted, conv.to)} (1 {conv.from} = {conv.rate.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} {conv.to}, cotação {conv.rateAt === 'manual' ? 'manual' : conv.rateAt === 'desconhecido' ? 'sem data' : `de ${new Date(conv.rateAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`})
            </span>
          )}
          {causeGone && <span className="mt-0.5 block text-[13px] leading-snug text-faint">A movimentação que originou isto foi apagada.</span>}
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-faint">
            <span>{formatDateValue(run.date)}</span>
            {path && (
              <button type="button" className="font-medium text-accent-hi hover:text-ink" onClick={() => navigate(path, path === '/finance' ? undefined : { open: run.origin.id })}>
                {run.origin.label}
              </button>
            )}
            {isImport && (
              <button type="button" className="font-medium text-accent-hi hover:text-ink" onClick={() => navigate('/imports', { open: run.id })}>
                Ver importação
              </button>
            )}
            {ruleExists && (
              <button type="button" className="font-medium text-accent-hi hover:text-ink" onClick={() => navigate('/rules', { open: run.rule!.id })}>
                Ver regra
              </button>
            )}
            {STATUS_LABEL[run.status] && <Badge>{STATUS_LABEL[run.status]}</Badge>}
          </span>
        </span>
        {showMoney && <span className="num shrink-0 text-[15px] font-semibold">{money}</span>}
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
          {done && !goal && !isImport && (
            <button type="button" className="text-[14px] font-medium text-soft hover:text-ink" onClick={doUndo}>
              {run.fromPending ? 'Desfazer confirmação' : run.automation === 'subscriberCharge' ? 'Não pagou · desfazer' : manyActions ? 'Desfazer tudo' : 'Desfazer'}
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
  const { data, syncStatus } = useStore()
  const pause = automationPause(syncStatus)
  const monthSheet = useSheet<AutomationRun>()
  const route = useRoute()
  const onlyRule = route.params.get('rule')
  const pending = pendingRuns(data.automationRuns)
  const history = historyRuns(onlyRule ? data.automationRuns.filter((r) => r.rule?.id === onlyRule) : data.automationRuns)
  const ruleName = onlyRule ? (data.rules.find((r) => r.id === onlyRule)?.name ?? data.automationRuns.find((r) => r.rule?.id === onlyRule)?.rule?.name ?? 'regra') : null

  return (
    <>
      <PageHeader title="Feito pelo Núcleo" subtitle="O que o Núcleo fez sozinho, e o que espera você" />
      {pause && <p className="card mb-6 px-4 py-3 text-[14px] leading-relaxed text-warn">{pause}</p>}
      <div className="grid gap-7 lg:grid-cols-2 lg:items-start">
        <div className="space-y-7">
          {pending.length > 0 && !onlyRule && (
            <section>
              <SectionTitle>Esperando você</SectionTitle>
              <PendingCharges runs={pending} />
            </section>
          )}
          <section>
            {onlyRule ? (
              <SectionTitle action="Ver tudo" onAction={() => navigate('/automations')}>
                Histórico de “{ruleName}”
              </SectionTitle>
            ) : (
              <SectionTitle>Histórico</SectionTitle>
            )}
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
          <button type="button" onClick={() => navigate('/rules')} className="card mt-3 flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-tint/[0.03] tap">
            <span className="grid size-9 shrink-0 place-items-center rounded-full icon-tile">
              <Wand2 size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">Minhas regras</span>
              <span className="block text-[13px] text-faint">Quando algo acontece, o Núcleo faz por você</span>
            </span>
          </button>
          <p className="mt-2 px-1 text-[13px] leading-relaxed text-faint">O Núcleo automatiza ações, mas nunca inventa fatos: só considera algo pago quando você confirma ou quando escolheu “Considerar pago automaticamente” naquele item.</p>
        </section>
      </div>
      <ChangeMonthSheet run={monthSheet.item} open={monthSheet.open} onClose={monthSheet.close} />
    </>
  )
}
