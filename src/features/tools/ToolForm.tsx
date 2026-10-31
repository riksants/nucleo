import { TOOL_BILLING, TOOL_STATUS } from '../../data/labels'
import { pauseTool, resumeTool, withStatus } from '../../core/toolPause'
import { todayIn, zoneOf } from '../../core/period'
import { formatDateValue } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { useStore } from '../../data/store'
import type { Tool, ToolBilling, ToolStatus } from '../../data/types'
import { amountToInput } from '../../lib/money'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, MoneyInput, Select, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft } from '../../ui/formHooks'
import { parseMoney } from '../../lib/calc'
import { Switch } from '../settings/ModulePicker'

export function ToolForm({ open, onClose, tool }: { open: boolean; onClose(): void; tool: Tool | null }) {
  const { data, settings, save, displayCurrency } = useStore()
  const { toast, confirm } = useFeedback()
  const today = todayIn(zoneOf(settings))
  const del = useDelete()
  const [d, set] = useDraft(open, () => ({
    name: tool?.name ?? '',
    link: tool?.link ?? '',
    plan: tool?.plan ?? '',
    price: tool ? amountToInput(tool.price) : '',
    currency: tool?.currency ?? displayCurrency,
    billing: tool?.billing ?? ('monthly' as ToolBilling),
    nextCharge: tool?.nextCharge ?? '',
    notes: tool?.notes ?? '',
    status: tool?.status ?? ('active' as ToolStatus),
    autoPaid: Boolean(tool?.autoPaid),
    afterDue: (tool?.afterDue ?? 'ask') as NonNullable<Tool['afterDue']>,
    remindDays: tool?.remindDays === undefined ? '' : String(tool.remindDays),
  }))
  /** What happened with each charge: expected amount, what was actually paid, and how. Kept forever. */
  const history = tool
    ? data.automationRuns
        .filter((r) => r.automation === 'toolCharge' && r.origin.id === tool.id)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, 12)
        .map((r) => {
          const tx = r.created.find((c) => c.collection === 'transactions')
          const paid = tx ? data.transactions.find((t) => t.id === tx.id) : undefined
          const label = r.status === 'pending' ? 'A pagar' : r.status === 'undone' ? 'Desfeito' : r.status === 'skipped' ? 'Não pago' : r.presumed ? 'Presumido' : paid ? 'Pago' : 'Pago, sem saída no saldo'
          return { id: r.id, date: r.date, expected: r.amount ?? tool.price, currency: r.currency ?? tool.currency, paid: paid?.amount, paidCurrency: paid?.currency, label }
        })
    : []

  const free = d.billing === 'free'
  const recurring = d.billing === 'monthly' || d.billing === 'yearly'
  const dated = recurring || d.billing === 'once'

  const submit = async () => {
    if (!d.name.trim()) return 'Informe o nome da assinatura'
    const price = free || !d.price.trim() ? 0 : parseMoney(d.price)
    if (price === null) return 'Confira o preço'
    const { autoPaid, afterDue, remindDays, ...fields } = d
    const { autoPaid: _old, ...base } = tool ?? ({} as Partial<Tool>)
    void _old
    const next = {
      ...base,
      ...fields,
      ...(autoPaid && !free ? { autoPaid: true } : {}),
      afterDue: afterDue === 'ask' || autoPaid ? undefined : afterDue,
      remindDays: remindDays === '' ? undefined : Number(remindDays),
      name: d.name.trim(),
      link: d.link.trim(),
      plan: d.plan.trim(),
      notes: d.notes.trim(),
      price,
      nextCharge: dated ? d.nextCharge : '',
      status: free && d.status === 'active' ? 'free' : d.status,
    } as Tool
    // Choosing "Pausada" in the list works like the button: no charge while paused, nothing charged afterwards.
    await save('tools', withStatus(tool, next, today))
    toast(tool ? 'Assinatura atualizada' : 'Assinatura adicionada')
    onClose()
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={tool ? 'Editar assinatura' : 'Nova assinatura'}
      submitLabel={tool ? 'Salvar' : 'Adicionar'}
      onSubmit={submit}
      size="lg"
      onDelete={tool ? () => del('tools', tool.id, 'assinatura', { feminine: true, after: onClose }) : undefined}
    >
      <FormGrid>
        {tool && (tool.status === 'active' || tool.status === 'paused') && tool.billing !== 'free' && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-raised px-4 py-3">
            <span className="min-w-0 flex-1 text-[14px] text-soft">
              {tool.status === 'paused' ? `Pausada${tool.pausedAt ? ` desde ${formatDateValue(tool.pausedAt).toLowerCase()}` : ''}: sem cobranças nem avisos.` : 'Parou de usar por um tempo? Pause sem perder o histórico.'}
            </span>
            <button
              type="button"
              onClick={async () => {
                if (tool.status === 'paused') {
                  const resumed = resumeTool(tool, today)
                  const ok = await confirm({ title: 'Retomar a assinatura?', message: resumed.nextCharge ? `Próxima cobrança: ${formatDateValue(resumed.nextCharge).toLowerCase()}. O período pausado não é cobrado.` : 'O período pausado não é cobrado.', confirmLabel: 'Retomar' })
                  if (!ok) return
                  await save('tools', resumed)
                  toast(`${tool.name}: retomada`)
                } else {
                  await save('tools', pauseTool(tool, today))
                  toast(`${tool.name}: pausada`)
                }
                onClose()
              }}
              className="press h-9 shrink-0 rounded-full px-3.5 text-[14px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]"
            >
              {tool.status === 'paused' ? 'Retomar' : 'Pausar'}
            </button>
          </div>
        )}
        <div className="half">
          <Field label="Nome">
            <TextInput value={d.name} onChange={(e) => set('name', e.target.value)} autoFocus={!tool} />
          </Field>
        </div>
        <div className="half">
          <Field label="Plano" hint="opcional">
            <TextInput value={d.plan} onChange={(e) => set('plan', e.target.value)} placeholder="Ex.: Pro" />
          </Field>
        </div>
        <Field label="Site / link" hint="opcional">
          <TextInput type="url" inputMode="url" autoCapitalize="none" value={d.link} onChange={(e) => set('link', e.target.value)} placeholder="site.com" />
        </Field>
        <div className="half">
          <Field label="Recorrência">
            <Select value={d.billing} onChange={(e) => set('billing', e.target.value as ToolBilling)}>
              {TOOL_BILLING.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="half">
          <Field label="Status">
            <Select value={d.status} onChange={(e) => set('status', e.target.value as ToolStatus)}>
              {TOOL_STATUS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {!free && (
          <Field label="Preço">
            <MoneyInput value={d.price} onChange={(v) => set('price', v)} currency={d.currency} onCurrency={(c) => set('currency', c)} />
          </Field>
        )}
        {dated && (
          <Field label={recurring ? 'Próxima cobrança' : 'Data da cobrança'} hint="opcional">
            <TextInput type="date" value={d.nextCharge} onChange={(e) => set('nextCharge', e.target.value)} />
          </Field>
        )}
        {dated && (
          <button type="button" role="switch" aria-checked={d.autoPaid} onClick={() => set('autoPaid', !d.autoPaid)} className="flex w-full items-start gap-3 rounded-2xl bg-raised px-4 py-3 text-left">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">Considerar pago automaticamente na data da cobrança</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-faint">
                {d.autoPaid ? 'A saída entra sozinha no Financeiro no dia da cobrança.' : 'Desligado: no dia, fica “A pagar” e só vira saída quando você confirmar.'}
              </span>
            </span>
            <Switch checked={d.autoPaid} />
          </button>
        )}
        {dated && !d.autoPaid && (
          <Field label="Se eu não confirmar até o dia seguinte" hint="você pode corrigir depois">
            <Select value={d.afterDue} onChange={(e) => set('afterDue', e.target.value as NonNullable<Tool['afterDue']>)}>
              <option value="ask">Perguntar se paguei (padrão)</option>
              <option value="presume">Registrar como pagamento presumido, sem mexer no saldo</option>
              <option value="presumeDeduct">Registrar como presumido e descontar do saldo</option>
            </Select>
          </Field>
        )}
        {dated && !free && (
          <Field label="Avisar">
            <Select value={d.remindDays} onChange={(e) => set('remindDays', e.target.value)}>
              <option value="">Padrão das notificações</option>
              <option value="0">No dia</option>
              <option value="1">1 dia antes</option>
              <option value="2">2 dias antes</option>
              <option value="3">3 dias antes</option>
              <option value="7">1 semana antes</option>
            </Select>
          </Field>
        )}
        <Field label="Observação" hint="opcional">
          <TextArea rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {history.length > 0 && (
          <section aria-label="Histórico de cobranças">
            <p className="mb-2 text-[13px] font-semibold text-soft">Histórico</p>
            <ul className="card divide-y divide-line">
              {history.map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                  <span className="num w-20 shrink-0 text-soft">{formatDateValue(h.date)}</span>
                  <span className="min-w-0 flex-1 text-faint">
                    previsto <span className="num text-soft">{formatMoney(h.expected, h.currency)}</span>
                    {h.paid !== undefined && h.paid !== h.expected && (
                      <>
                        {' · '}pago <span className="num text-soft">{formatMoney(h.paid, h.paidCurrency ?? h.currency)}</span>
                      </>
                    )}
                  </span>
                  <span className={`shrink-0 font-semibold ${h.label === 'A pagar' ? 'text-warn' : h.label === 'Pago' ? 'text-income' : 'text-faint'}`}>{h.label}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </FormGrid>
    </FormSheet>
  )
}
