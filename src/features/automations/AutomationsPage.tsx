import { Check, Sparkles, Wand2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { navigate, type RoutePath, useRoute } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { AUTOMATIONS, automationSince } from '../../core/automation/engine'
import { useStore } from '../../data/store'
import { automationPause, useAutomationActions } from '../../data/useAutomations'
import type { AutomationId, AutomationRun } from '../../data/types'
import { ACTIVITY_FILTERS, type ActivityFilter, automationStats, createdRecord, type Digest, matchesFilter, notDoneReason, OUTCOME_LABEL, pendingItems, type PendingItem, runOutcome, snoozeDate, weekDigest } from '../../core/automation/activity'
import { todayIn, useToday, zoneOf } from '../../core/period'
import { Segmented } from '../../ui/Segmented'
import { ConfirmChargeSheet } from './ConfirmChargeSheet'
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
import { historyRuns, ORIGIN_PATH, RECORD_PATH } from './runs'
import { canUndoAction } from '../../core/automation/undo'
import { offersRetry } from '../../core/rules/retry'

/** The outcomes shown as a badge (a plain "concluída" needs none). */
const OUTCOME_TONE = { corrected: 'neutral', undone: 'neutral', notDone: 'warn', skipped: 'neutral', awaiting: 'warn', pending: 'warn' } as const

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
  const outcome = runOutcome(run)
  const record = isImport || run.status === 'undone' ? null : createdRecord(run)
  const recordPath = record && (data[record.collection] as { id: string }[]).some((x) => x.id === record.id) ? RECORD_PATH[record.collection] : undefined

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
          {!isRule && !run.detail && notDoneReason(run) && <span className="mt-0.5 block text-[13px] leading-snug text-faint">{notDoneReason(run)}</span>}
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
            {record && recordPath && recordPath !== path && (
              <button type="button" className="font-medium text-accent-hi hover:text-ink" onClick={() => navigate(recordPath, { open: record.id })}>
                Ver registro
              </button>
            )}
            {outcome !== 'done' && <Badge tone={OUTCOME_TONE[outcome]}>{OUTCOME_LABEL[outcome]}</Badge>}
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

/** On/off for each automation, with its last run and how many times it acted. Turning one back on starts from today. */
export function AutomationSettings({ onHistory }: { onHistory?(id: AutomationId): void }) {
  const { settings, data } = useStore()
  const { setEnabled } = useAutomationActions()
  const today = useToday(zoneOf(settings))
  return (
    <div className="card divide-y divide-line overflow-hidden">
      {AUTOMATIONS.map((a) => {
        const on = automationSince(settings, a.id) !== null || !settings.automations?.[a.id]
        const stats = automationStats(data.automationRuns, a.id, today)
        const last = stats.last
        return (
          <div key={a.id} className="px-4 py-3.5">
            <button type="button" role="switch" aria-checked={on} onClick={() => setEnabled(a.id, !on)} className="flex w-full items-start gap-3 text-left tap">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{a.title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-faint">{a.text}</span>
              </span>
              <span className="pt-0.5">
                <Switch checked={on} />
              </span>
            </button>
            <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-faint">
              <span>{!on ? 'Pausada' : last ? `Última vez: ${formatDateValue(last.date).toLowerCase()} · ${OUTCOME_LABEL[runOutcome(last)]}` : 'Ainda não precisou agir'}</span>
              {stats.count > 0 && <span>{stats.count === 1 ? '1 vez' : `${stats.count} vezes`}</span>}
              {stats.count > 0 && onHistory && (
                <button type="button" className="font-medium text-accent-hi hover:text-ink" onClick={() => onHistory(a.id)}>
                  Ver histórico
                </button>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** One thing waiting for the person, with its next step. Charges open the usual confirmation sheet. */
function PendingRow({ item, onConfirmCharge }: { item: PendingItem; onConfirmCharge(r: AutomationRun): void }) {
  const { settings } = useStore()
  const { decline, snooze, dismiss, retry } = useAutomationActions()
  const { toast, confirm } = useFeedback()
  const [busy, setBusy] = useState(false)
  const today = todayIn(zoneOf(settings))
  const run = item.run
  const income = run?.automation === 'subscriberCharge'

  const later = async () => {
    if (!run) return
    await snooze(run, snoozeDate(today))
    toast('Adiado por 3 dias')
  }
  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const primary = (() => {
    if (item.kind === 'charge' && run) return { label: income ? 'Confirmar recebimento' : 'Confirmar pagamento', run: () => onConfirmCharge(run) }
    if (item.kind === 'retry' && run && item.action !== undefined)
      return {
        label: 'Tentar de novo',
        run: () =>
          act(async () => {
            const r = await retry(run, item.action!)
            toast(r.text, r.ok ? 'success' : 'error')
          }),
      }
    if (item.link) return { label: item.kind === 'lateSale' ? 'Abrir venda' : 'Abrir regra', run: () => navigate(item.link!.path as RoutePath, item.link!.params) }
    return null
  })()
  const secondary = async () => {
    if (!run) return
    if (item.kind === 'charge') {
      const ok = await confirm({
        title: income ? 'Não recebeu?' : 'Não pagou?',
        message: income ? `A cobrança de ${run.origin.label} sai da lista. Nada entra no Financeiro.` : `A cobrança de ${run.origin.label} sai da lista. Nada sai do Financeiro.`,
        confirmLabel: income ? 'Não recebi' : 'Não paguei',
      })
      if (ok) await decline(run)
      return
    }
    const ok = await confirm({ title: 'Dispensar?', message: 'Sai da lista de pendências e não volta. O histórico continua em Atividade.', confirmLabel: 'Dispensar' })
    if (ok) {
      await dismiss(run)
      toast('Dispensado')
    }
  }

  return (
    <div className="px-4 py-3.5">
      <span className="block text-[15px] font-medium [overflow-wrap:anywhere]">{item.title}</span>
      <span className="mt-0.5 block text-[13px] leading-snug text-soft [overflow-wrap:anywhere]">{item.detail}</span>
      <span className="mt-1 block text-[13px] text-faint">
        {formatDateValue(item.date)} · Próximo passo: {item.next.toLowerCase()}
      </span>
      <div className="mt-3 flex flex-wrap gap-2">
        {primary && (
          <Button className="min-w-0 flex-1" disabled={busy} onClick={primary.run}>
            {primary.label}
          </Button>
        )}
        {run && (item.kind === 'charge' || item.kind === 'retry') && (
          <Button variant="ghost" onClick={secondary}>
            {item.kind === 'charge' ? (income ? 'Não recebi' : 'Não paguei') : 'Dispensar'}
          </Button>
        )}
        {item.snoozable && run && (
          <Button variant="ghost" onClick={later}>
            Adiar
          </Button>
        )}
      </div>
    </div>
  )
}

type Tab = 'activity' | 'pending' | 'automations'
const PAGE = 30

export function AutomationsPage() {
  const { data, settings, syncStatus } = useStore()
  const pause = automationPause(syncStatus)
  const monthSheet = useSheet<AutomationRun>()
  const chargeSheet = useSheet<AutomationRun>()
  const route = useRoute()
  const today = useToday(zoneOf(settings))
  const onlyRule = route.params.get('rule')
  const pending = useMemo(() => pendingItems(data, today), [data, today])
  const allPending = useMemo(() => pendingItems(data, today, { includeSnoozed: true }), [data, today])
  const snoozedList = allPending.filter((i) => !pending.some((p) => p.key === i.key))
  const [tab, setTab] = useState<Tab>(() => (route.params.get('tab') as Tab) || (onlyRule ? 'activity' : pending.length ? 'pending' : 'activity'))
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [onlyAutomation, setOnlyAutomation] = useState<AutomationId | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [showSnoozed, setShowSnoozed] = useState(false)
  const digest = useMemo(() => weekDigest(data.automationRuns, data, today, pending.length), [data, today, pending.length])
  const history = useMemo(
    () => historyRuns(data.automationRuns.filter((r) => (!onlyRule || r.rule?.id === onlyRule) && (!onlyAutomation || r.automation === onlyAutomation) && matchesFilter(r, filter))),
    [data.automationRuns, onlyRule, onlyAutomation, filter],
  )
  const ruleName = onlyRule ? (data.rules.find((r) => r.id === onlyRule)?.name ?? data.automationRuns.find((r) => r.rule?.id === onlyRule)?.rule?.name ?? 'regra') : null
  const automationName = onlyAutomation ? (AUTOMATIONS.find((a) => a.id === onlyAutomation)?.title ?? '') : null
  const activeRules = data.rules.filter((r) => r.on && !r.paused).length

  const go = (d: Digest) => {
    setTab(d.tab)
    if (d.filter) setFilter(d.filter)
    setShown(PAGE)
  }

  return (
    <>
      <PageHeader title="Feito pelo Núcleo" subtitle="O que o Núcleo fez, por quê, e o que espera você" />
      {pause && <p className="card mb-5 px-4 py-3 text-[14px] leading-relaxed text-warn">{pause}</p>}
      {digest.length > 0 && !onlyRule && (
        <div className="card mb-5 divide-y divide-line">
          {digest.map((d) => (
            <button key={d.key} type="button" onClick={() => go(d)} className="flex w-full items-start gap-2.5 px-4 py-3 text-left text-[14px] leading-snug transition-colors hover:bg-tint/[0.03] tap">
              <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${d.tone === 'warn' ? 'bg-warn' : 'bg-accent'}`} />
              <span className="min-w-0 flex-1">{d.text}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mb-5">
        <Segmented
          variant="underline"
          label="Seções"
          value={tab}
          onChange={(v) => (setTab(v), setShown(PAGE))}
          options={[
            { value: 'activity', label: 'Atividade' },
            { value: 'pending', label: pending.length ? `Pendências (${pending.length})` : 'Pendências' },
            { value: 'automations', label: 'Automações' },
          ]}
        />
      </div>

      {tab === 'activity' && (
        <section>
          {onlyRule || onlyAutomation ? (
            <SectionTitle
              action="Ver tudo"
              onAction={() => {
                setOnlyAutomation(null)
                if (onlyRule) navigate('/automations', { tab: 'activity' })
              }}
            >
              Histórico de “{ruleName ?? automationName}”
            </SectionTitle>
          ) : null}
          <div className="mb-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filtrar atividade">
            {ACTIVITY_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={filter === f.value}
                onClick={() => (setFilter(f.value), setShown(PAGE))}
                className={`h-8 rounded-full px-3 text-[13px] font-medium transition-colors ${filter === f.value ? 'bg-paper text-coal' : 'bg-tint/[0.06] text-soft hover:text-ink'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {history.length ? (
            <>
              <div className="card divide-y divide-line">
                {history.slice(0, shown).map((r) => (
                  <RunRow key={r.id} run={r} onChangeMonth={monthSheet.show} />
                ))}
              </div>
              {history.length > shown && (
                <Button variant="ghost" block className="mt-3" onClick={() => setShown((n) => n + PAGE)}>
                  Mostrar mais ({history.length - shown})
                </Button>
              )}
            </>
          ) : (
            <EmptyState
              compact
              icon={<Sparkles size={20} />}
              title={filter === 'all' ? 'Nada ainda' : 'Nada com este filtro'}
              text={filter === 'all' ? 'Quando o Núcleo fizer algo sozinho, aparece aqui: o quê, quando e por quê, com a opção de desfazer.' : 'Escolha outro filtro para ver o resto do histórico.'}
            />
          )}
        </section>
      )}

      {tab === 'pending' && (
        <section>
          {pending.length ? (
            <div className="card divide-y divide-line">
              {pending.map((i) => (
                <PendingRow key={i.key} item={i} onConfirmCharge={chargeSheet.show} />
              ))}
            </div>
          ) : (
            <EmptyState compact icon={<Check size={20} />} title="Nada esperando você" text="Cobranças para confirmar, ações que não deram certo e pedidos das suas regras aparecem aqui." />
          )}
          {snoozedList.length > 0 && (
            <div className="mt-3">
              <button type="button" className="px-1 text-[13px] font-medium text-accent-hi hover:text-ink" onClick={() => setShowSnoozed((v) => !v)}>
                {showSnoozed ? 'Esconder adiadas' : snoozedList.length === 1 ? '1 adiada — mostrar' : `${snoozedList.length} adiadas — mostrar`}
              </button>
              {showSnoozed && (
                <div className="card mt-2 divide-y divide-line">
                  {snoozedList.map((i) => (
                    <PendingRow key={i.key} item={i} onConfirmCharge={chargeSheet.show} />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {tab === 'automations' && (
        <section className="space-y-3">
          <AutomationSettings onHistory={(id) => (setOnlyAutomation(id), setFilter('all'), setTab('activity'), setShown(PAGE))} />
          <button type="button" onClick={() => navigate('/rules')} className="card flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-tint/[0.03] tap">
            <span className="grid size-9 shrink-0 place-items-center rounded-full icon-tile">
              <Wand2 size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">Minhas regras</span>
              <span className="block text-[13px] text-faint">{data.rules.length ? `${activeRules} de ${data.rules.length} ${data.rules.length === 1 ? 'ligada' : 'ligadas'}` : 'Quando algo acontece, o Núcleo faz por você'}</span>
            </span>
          </button>
          <p className="px-1 text-[13px] leading-relaxed text-faint">O Núcleo automatiza ações, mas nunca inventa fatos: só considera algo pago quando você confirma ou quando escolheu “Considerar pago automaticamente” naquele item.</p>
        </section>
      )}
      <ChangeMonthSheet run={monthSheet.item} open={monthSheet.open} onClose={monthSheet.close} />
      <ConfirmChargeSheet run={chargeSheet.item} open={chargeSheet.open} onClose={chargeSheet.close} />
    </>
  )
}
