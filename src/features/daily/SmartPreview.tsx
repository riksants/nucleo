/**
 * Cadastro inteligente (Etapa 4): the preview of a sentence that is money, a goal, a subscription or a client.
 * Every field can be corrected here; what is missing is asked (value, currency, date, which payment it is) and
 * "Salvar" stays off until it is answered. Nothing is saved while the person types or answers.
 */
import { useMemo } from 'react'
import { pickableCategories } from '../../core/financeCategories'
import { addDaysToDate, useToday, zoneOf } from '../../core/period'
import { knownCurrencies } from '../../core/smart/amount'
import { KIND_TITLE, missingOf, paymentLinks, type GoalDraft, type MoneyDraft, type Missing, type PaymentLink, type SmartDraft, type ToolDraft } from '../../core/smart/understand'
import { useStore } from '../../data/store'
import type { Currency } from '../../data/types'
import { parseMoney } from '../../lib/calc'
import { amountToInput, formatMoney } from '../../lib/money'
import { AmountField } from '../../ui/AmountField'
import { Field, Select, TextInput } from '../../ui/Field'
import { Segmented } from '../../ui/Segmented'
import { ToggleRow } from '../planner/controls'

const MISSING_LABEL: Record<Missing, string> = {
  amount: 'o valor',
  currency: 'a moeda',
  date: 'a data',
  name: 'o nome',
  target: 'o valor total da meta',
  deadline: 'até quando',
  billing: 'se é mensal ou anual',
  nextCharge: 'a próxima cobrança',
  link: 'se é o pagamento de algo já registrado',
  type: 'se é entrada ou saída',
}

const chip = (on: boolean) => `press h-9 shrink-0 rounded-full border px-3.5 text-[14px] font-medium transition-colors ${on ? 'border-accent/40 bg-accent/[0.14] text-accent-hi' : 'border-line bg-surface text-soft hover:text-ink'}`

function Ask({ show, children }: { show: boolean; children: React.ReactNode }) {
  return <div className={show ? 'rounded-2xl bg-warn/[0.08] p-3' : ''}>{children}</div>
}

function CurrencyChips({ value, onChange }: { value: Currency | null; onChange(c: Currency): void }) {
  const { settings } = useStore()
  const list = knownCurrencies(settings)
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Moeda">
      {list.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} className={chip(value === c)} onClick={() => onChange(c)}>
          {c}
        </button>
      ))}
    </div>
  )
}

function Money({ label, cents, currency, onChange }: { label: string; cents: number | null; currency: Currency | null; onChange(c: number | null): void }) {
  return (
    <Field label={label}>
      <AmountField currency={currency ?? 'EUR'} value={cents ? amountToInput(cents) : ''} onChange={(v) => onChange(v.trim() ? (parseMoney(v) ?? null) : null)} />
    </Field>
  )
}

function DateChips({ value, onChange, future = false, label }: { value: string | null; onChange(d: string): void; future?: boolean; label: string }) {
  const { settings } = useStore()
  const today = useToday(zoneOf(settings))
  const quick = future ? [{ d: today, l: 'Hoje' }] : [
    { d: today, l: 'Hoje' },
    { d: addDaysToDate(today, -1), l: 'Ontem' },
  ]
  return (
    <div>
      <p className="mb-2 text-[13px] font-semibold text-soft">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        {quick.map((q) => (
          <button key={q.d} type="button" className={chip(value === q.d)} onClick={() => onChange(q.d)}>
            {q.l}
          </button>
        ))}
        <input type="date" aria-label={label} value={value ?? ''} {...(future ? { min: today } : { max: addDaysToDate(today, 1) })} onChange={(e) => e.target.value && onChange(e.target.value)} className="h-9 rounded-full border border-line bg-surface px-3 text-[14px] text-soft" />
      </div>
    </div>
  )
}

function MoneyFields({ d, set, links }: { d: MoneyDraft; set(d: MoneyDraft): void; links: PaymentLink[] }) {
  const { settings } = useStore()
  const miss = new Set(missingOf(d, links))
  const cats = pickableCategories(settings, d.type, d.category ?? undefined)
  return (
    <div className="space-y-4">
      <Segmented<'in' | 'out'> block size="sm" label="Tipo" value={d.type} onChange={(type) => set({ ...d, type, category: null, link: undefined })} options={[{ value: 'out', label: 'Saída' }, { value: 'in', label: 'Entrada' }]} />
      <Ask show={miss.has('amount')}>
        <Money label="Valor" cents={d.amount} currency={d.currency} onChange={(amount) => set({ ...d, amount })} />
      </Ask>
      <Ask show={miss.has('currency')}>
        <p className="mb-2 text-[13px] font-semibold text-soft">{d.currency ? 'Moeda' : 'Em qual moeda?'}</p>
        <CurrencyChips value={d.currency} onChange={(currency) => set({ ...d, currency, link: undefined })} />
      </Ask>
      <Ask show={miss.has('date')}>
        <DateChips label={d.date ? 'Data' : 'Quando foi?'} value={d.date} onChange={(date) => set({ ...d, date })} />
      </Ask>
      {links.length > 0 && (
        <Ask show={miss.has('link')}>
          <p className="mb-2 text-[13px] font-semibold text-soft">Isso é o pagamento de algo já registrado?</p>
          <div className="space-y-2" role="radiogroup" aria-label="Pagamento de">
            {links.map((l) => (
              <button key={l.key} type="button" role="radio" aria-checked={d.link === l.key} onClick={() => set({ ...d, link: l.key })} className={`w-full rounded-2xl border px-3.5 py-2.5 text-left text-[14px] leading-snug ${d.link === l.key ? 'border-accent/40 bg-accent/[0.1]' : 'border-line bg-surface'}`}>
                {l.label}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={d.link === 'none'} onClick={() => set({ ...d, link: 'none' })} className={`w-full rounded-2xl border px-3.5 py-2.5 text-left text-[14px] ${d.link === 'none' ? 'border-accent/40 bg-accent/[0.1]' : 'border-line bg-surface'}`}>
              Não, é outra {d.type === 'in' ? 'entrada' : 'saída'}
            </button>
          </div>
        </Ask>
      )}
      <Field label="Descrição">
        <TextInput value={d.reason} onChange={(e) => set({ ...d, reason: e.target.value })} />
      </Field>
      {(!d.link || d.link === 'none') && (
        <Field label="Categoria" hint="opcional">
          <Select value={d.category ?? ''} onChange={(e) => set({ ...d, category: e.target.value || null })}>
            <option value="">Sem categoria</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  )
}

function GoalFields({ d, set }: { d: GoalDraft; set(d: GoalDraft): void }) {
  const miss = new Set(missingOf(d))
  return (
    <div className="space-y-4">
      <Ask show={miss.has('name')}>
        <Field label="Nome da meta">
          <TextInput value={d.name} placeholder="Ex.: Carro" onChange={(e) => set({ ...d, name: e.target.value })} />
        </Field>
      </Ask>
      <Ask show={miss.has('currency')}>
        <p className="mb-2 text-[13px] font-semibold text-soft">{d.currency ? 'Moeda' : 'Em qual moeda?'}</p>
        <CurrencyChips value={d.currency} onChange={(currency) => set({ ...d, currency })} />
      </Ask>
      <Ask show={miss.has('target')}>
        <Money label="Valor total da meta" cents={d.target} currency={d.currency} onChange={(target) => set({ ...d, target })} />
      </Ask>
      <Ask show={miss.has('deadline')}>
        <DateChips future label="Até quando?" value={d.deadline} onChange={(deadline) => set({ ...d, deadline })} />
      </Ask>
      {d.monthly !== null && (
        <ToggleRow checked={d.autoSave} onChange={(autoSave) => set({ ...d, autoSave })} hint={`Todo mês o Núcleo reserva ${d.currency ? formatMoney(d.monthly, d.currency) : 'o valor'} do seu saldo disponível para esta meta. Não cria saída: o dinheiro continua no saldo.`}>
          Guardar todo mês
        </ToggleRow>
      )}
    </div>
  )
}

function ToolFields({ d, set }: { d: ToolDraft; set(d: ToolDraft): void }) {
  const { settings } = useStore()
  const today = useToday(zoneOf(settings))
  const miss = new Set(missingOf(d))
  const cycle = d.billing === 'yearly' ? addDaysToDate(today, 365) : addDaysToDate(today, 30)
  return (
    <div className="space-y-4">
      <Ask show={miss.has('name')}>
        <Field label={d.name ? 'Nome' : 'Qual o nome da assinatura?'}>
          <TextInput value={d.name} placeholder="Ex.: Figma" onChange={(e) => set({ ...d, name: e.target.value })} />
        </Field>
      </Ask>
      <Ask show={miss.has('amount')}>
        <Money label="Valor" cents={d.price} currency={d.currency} onChange={(price) => set({ ...d, price })} />
      </Ask>
      <Ask show={miss.has('currency')}>
        <p className="mb-2 text-[13px] font-semibold text-soft">{d.currency ? 'Moeda' : 'Em qual moeda?'}</p>
        <CurrencyChips value={d.currency} onChange={(currency) => set({ ...d, currency })} />
      </Ask>
      <Ask show={miss.has('billing')}>
        <Segmented<'monthly' | 'yearly'> block size="sm" label="Cobrança" value={d.billing ?? ('' as 'monthly')} onChange={(billing) => set({ ...d, billing })} options={[{ value: 'monthly', label: 'Mensal' }, { value: 'yearly', label: 'Anual' }]} />
      </Ask>
      <Ask show={miss.has('nextCharge')}>
        <p className="mb-2 text-[13px] font-semibold text-soft">Próxima cobrança</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={chip(d.nextCharge === today)} onClick={() => set({ ...d, nextCharge: today })}>
            Hoje
          </button>
          {d.billing && (
            <button type="button" className={chip(d.nextCharge === cycle)} onClick={() => set({ ...d, nextCharge: cycle })}>
              {d.billing === 'yearly' ? 'Daqui a 1 ano' : 'Daqui a 1 mês'}
            </button>
          )}
          <input type="date" aria-label="Próxima cobrança" value={d.nextCharge ?? ''} min={today} onChange={(e) => e.target.value && set({ ...d, nextCharge: e.target.value })} className="h-9 rounded-full border border-line bg-surface px-3 text-[14px] text-soft" />
        </div>
      </Ask>
      <p className="text-[13px] leading-relaxed text-faint">No dia da cobrança o Núcleo cria “A pagar”. Nada sai do saldo sem a sua confirmação.</p>
    </div>
  )
}

export function useLinks(d: SmartDraft | null, text: string): PaymentLink[] {
  const { data } = useStore()
  return useMemo(() => (d?.kind === 'money' ? paymentLinks(d, data, text) : []), [d, data, text])
}

export function SmartPreview({ draft, onChange, links }: { draft: SmartDraft; onChange(d: SmartDraft): void; links: PaymentLink[] }) {
  const missing = missingOf(draft, links)
  return (
    <div className="space-y-4">
      <p className="label-mono text-faint">{KIND_TITLE[draft.kind]}</p>
      {missing.length > 0 && <p className="text-[14px] leading-relaxed text-warn">Para salvar, falta: {missing.map((m) => MISSING_LABEL[m]).join(', ')}.</p>}
      {draft.kind === 'money' && <MoneyFields d={draft} set={onChange} links={links} />}
      {draft.kind === 'goal' && <GoalFields d={draft} set={onChange} />}
      {draft.kind === 'subscription' && <ToolFields d={draft} set={onChange} />}
      {draft.kind === 'client' && (
        <Ask show={missing.includes('name')}>
          <Field label="Nome do cliente">
            <TextInput value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
          </Field>
        </Ask>
      )}
      {draft.kind === 'sale' && (
        <div className="space-y-3">
          <p className="text-[15px] leading-relaxed">
            {[draft.sale.product || 'Venda', draft.sale.clientName && `para ${draft.sale.clientName}`, draft.sale.total !== null && draft.sale.currency && formatMoney(draft.sale.total, draft.sale.currency), draft.sale.paid !== null && draft.sale.currency && `recebido ${formatMoney(draft.sale.paid, draft.sale.currency)}`, draft.sale.dueDate && `resto até ${draft.sale.dueDate.split('-').reverse().join('/')}`].filter(Boolean).join(' · ')}
          </p>
          <Ask show={missing.includes('currency')}>
            <p className="mb-2 text-[13px] font-semibold text-soft">Em qual moeda?</p>
            <CurrencyChips value={draft.sale.currency} onChange={(currency) => onChange({ ...draft, sale: { ...draft.sale, currency } })} />
          </Ask>
          <p className="text-[13px] text-faint">No próximo passo você confere a venda no formulário de Vendas antes de salvar.</p>
        </div>
      )}
    </div>
  )
}
