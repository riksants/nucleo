import { ChevronDown, Plus, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { automationSince } from '../../core/automation/engine'
import { pickableCategories } from '../../core/financeCategories'
import { ACTION_LABEL, CONDITION_LABEL, ORIGIN_LABEL, TRIGGER_GROUPS, TRIGGERS, triggerInfo, WEEKDAY_LABEL } from '../../core/rules/catalog'
import { describeAction, describeCondition, describeRule, describeTrigger } from '../../core/rules/sentence'
import type { RuleDraft } from '../../core/rules/templates'
import { TOKENS } from '../../core/rules/text'
import { MAX_ACTIONS } from '../../core/rules/types'
import { ruleProblem } from '../../core/rules/validate'
import { useStore } from '../../data/store'
import { CLIENT_STATUS, PROJECT_STATUS, TASK_PRIORITY } from '../../data/labels'
import type { MoneyOrigin, Rule, RuleAction, RuleActionKind, RuleCondition, RuleConditionField, RuleTriggerKind, Weekday } from '../../data/types'
import { parseMoney } from '../../lib/calc'
import { amountToInput } from '../../lib/money'
import { AmountField } from '../../ui/AmountField'
import { Button } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { Field, Select, TextArea, TextInput } from '../../ui/Field'
import { Sheet } from '../../ui/Sheet'
import { useRuleNames, useRules } from './useRules'

type Draft = RuleDraft & { name: string }

/** Monday first, as people read a week. */
const WEEK: Weekday[] = [1, 2, 3, 4, 5, 6, 0]

function MultiChips<V extends string | number>({ values, options, onChange }: { values: V[]; options: { value: V; label: string }[]; onChange(v: V[]): void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = values.includes(o.value)
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}
            className={`press h-9 rounded-full border px-3.5 text-sm font-medium ${on ? 'border-transparent bg-ink text-bg' : 'border-line bg-surface text-soft hover:text-ink'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** One part of the sentence: tapping opens its options right below. */
function Part({ text, open, onToggle, onRemove, children, placeholder }: { text: string; open: boolean; onToggle(): void; onRemove?(): void; children?: ReactNode; placeholder?: boolean }) {
  return (
    <div className="rounded-[var(--radius-field)] border border-line bg-raised">
      <div className="flex items-center">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 px-4 py-2.5 text-left">
          <span className={`min-w-0 flex-1 text-[15px] leading-snug ${placeholder ? 'text-faint' : ''}`}>{text}</span>
          <ChevronDown size={18} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label="Tirar" className="grid size-11 shrink-0 place-items-center text-faint hover:text-expense">
            <X size={18} />
          </button>
        )}
      </div>
      {open && children && <div className="space-y-4 border-t border-line px-4 py-4">{children}</div>}
    </div>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[12px] font-bold tracking-[0.12em] text-accent-hi uppercase">{children}</p>
}

function TokenChips({ kinds, onAdd }: { kinds: RuleTriggerKind; onAdd(token: string): void }) {
  const allowed = new Set(triggerInfo(kinds).tokens)
  const tokens = TOKENS.filter((t) => allowed.has(t.key))
  if (!tokens.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[12px] text-faint">Inserir:</span>
      {tokens.map((t) => (
        <button key={t.key} type="button" onClick={() => onAdd(`{${t.key}}`)} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-soft hover:text-ink">
          + {t.label}
        </button>
      ))}
    </div>
  )
}

function MoneyBox({ cents, currency, onChange, label }: { cents: number; currency: string; onChange(c: number): void; label: string }) {
  const [text, setText] = useState(() => (cents ? amountToInput(cents) : ''))
  return (
    <Field label={label}>
      <AmountField
        currency={currency}
        value={text}
        onChange={(v) => {
          setText(v)
          onChange(parseMoney(v || '0') ?? 0)
        }}
      />
    </Field>
  )
}

function ConditionEditor({ c, trigger, onChange }: { c: RuleCondition; trigger: RuleTriggerKind; onChange(c: RuleCondition): void }) {
  const { data, settings } = useStore()
  const info = triggerInfo(trigger)
  const currencies = [...new Set([settings.baseCurrency, ...(settings.currencies ?? []), ...('currency' in c ? [c.currency] : [])])]
  switch (c.field) {
    case 'amount':
      return (
        <>
          <Field label="Comparação">
            <Select value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })}>
              <option value="gt">maior que</option>
              <option value="lt">menor que</option>
              <option value="between">entre</option>
            </Select>
          </Field>
          <Field label="Moeda" hint="só valores nesta moeda contam">
            <Select value={c.currency} onChange={(e) => onChange({ ...c, currency: e.target.value })}>
              {currencies.map((cur) => (
                <option key={cur} value={cur}>
                  {cur}
                </option>
              ))}
            </Select>
          </Field>
          <MoneyBox key={`a-${c.currency}`} label={c.op === 'between' ? 'De' : 'Valor'} cents={c.value} currency={c.currency} onChange={(value) => onChange({ ...c, value })} />
          {c.op === 'between' && <MoneyBox key={`b-${c.currency}`} label="Até" cents={c.value2 ?? 0} currency={c.currency} onChange={(value2) => onChange({ ...c, value2 })} />}
        </>
      )
    case 'text':
      return (
        <Field label="Texto que precisa aparecer" hint="sem diferença de acento ou maiúscula">
          <TextInput value={c.contains} onChange={(e) => onChange({ ...c, contains: e.target.value })} placeholder="ex.: aluguel" />
        </Field>
      )
    case 'category': {
      const type = info.income ? 'in' : 'out'
      return <MultiChips values={c.values} options={pickableCategories(settings, type).map((x) => ({ value: x.id, label: x.label }))} onChange={(values) => onChange({ ...c, values })} />
    }
    case 'origin':
      return <MultiChips<MoneyOrigin> values={c.values} options={(Object.keys(ORIGIN_LABEL) as MoneyOrigin[]).filter((o) => (info.income ? o !== 'tool' : o === 'manual' || o === 'tool')).map((o) => ({ value: o, label: ORIGIN_LABEL[o] }))} onChange={(values) => onChange({ ...c, values })} />
    case 'client':
      return data.clients.length ? <MultiChips values={c.values} options={data.clients.map((x) => ({ value: x.id, label: x.name }))} onChange={(values) => onChange({ ...c, values })} /> : <p className="text-sm text-faint">Nenhum cliente cadastrado ainda.</p>
    case 'project':
      return data.projects.length ? <MultiChips values={c.values} options={data.projects.map((x) => ({ value: x.id, label: x.name }))} onChange={(values) => onChange({ ...c, values })} /> : <p className="text-sm text-faint">Nenhum projeto cadastrado ainda.</p>
    case 'status':
    case 'statusBefore': {
      const options = trigger === 'clientStatus' ? CLIENT_STATUS : PROJECT_STATUS
      return <MultiChips values={c.values} options={options.map((o) => ({ value: o.value as string, label: o.label }))} onChange={(values) => onChange({ ...c, values })} />
    }
    case 'priority':
      return <MultiChips values={c.values} options={TASK_PRIORITY.map((o) => ({ value: o.value, label: o.label }))} onChange={(values) => onChange({ ...c, values })} />
    case 'goal':
      return <MultiChips values={c.values} options={data.financeGoals.filter((g) => g.status === 'active').map((g) => ({ value: g.id, label: g.name }))} onChange={(values) => onChange({ ...c, values })} />
    case 'weekday':
      return <MultiChips<Weekday> values={c.values} options={WEEK.map((d) => ({ value: d, label: WEEKDAY_LABEL[d] }))} onChange={(values) => onChange({ ...c, values })} />
    case 'currency':
      return <MultiChips values={c.values} options={currencies.map((x) => ({ value: x, label: x }))} onChange={(values) => onChange({ ...c, values })} />
  }
}

function newCondition(field: RuleConditionField, base: string): RuleCondition {
  if (field === 'amount') return { field, op: 'gt', value: 0, currency: base }
  if (field === 'text') return { field, contains: '' }
  return { field, values: [] } as RuleCondition
}

function newAction(kind: RuleActionKind, trigger: RuleTriggerKind): RuleAction {
  switch (kind) {
    case 'reservePercent':
      return { kind, goalId: '', percent: 10 }
    case 'reserveFixed':
      return { kind, goalId: '', amount: 0 }
    case 'createTask':
      return { kind, title: '', dueDays: null, linkProject: triggerInfo(trigger).tokens.includes('projeto'), priority: 'none' }
    case 'projectStatus':
      return { kind, status: 'done' }
    case 'clientStatus':
      return { kind, status: 'done' }
    case 'setCategory':
      return { kind, category: '' }
    case 'createNote':
      return { kind, title: '', body: '' }
    case 'addInbox':
      return { kind, text: '' }
  }
}

function ActionEditor({ a, trigger, onChange }: { a: RuleAction; trigger: RuleTriggerKind; onChange(a: RuleAction): void }) {
  const { data, settings } = useStore()
  const info = triggerInfo(trigger)
  const goals = data.financeGoals.filter((g) => g.status === 'active')
  const goalSelect = (goalId: string, set: (id: string) => void) => (
    <Field label="Para a meta">
      <Select value={goalId} onChange={(e) => set(e.target.value)}>
        <option value="">Escolher…</option>
        {goals.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} ({g.currency}){g.inBalance ? '' : ' — fora do saldo'}
          </option>
        ))}
      </Select>
    </Field>
  )
  const append = (text: string, token: string) => `${text.trimEnd()} ${token}`.trimStart()
  switch (a.kind) {
    case 'reservePercent':
      return (
        <>
          <Field label="Porcentagem do valor recebido">
            <TextInput inputMode="numeric" value={String(a.percent || '')} onChange={(e) => onChange({ ...a, percent: Math.round(Number(e.target.value.replace(/\D/g, '')) || 0) })} />
          </Field>
          {goalSelect(a.goalId, (goalId) => onChange({ ...a, goalId }))}
        </>
      )
    case 'reserveFixed': {
      const goal = goals.find((g) => g.id === a.goalId)
      return (
        <>
          {goalSelect(a.goalId, (goalId) => onChange({ ...a, goalId }))}
          {goal && <MoneyBox key={goal.currency} label={`Valor (em ${goal.currency})`} cents={a.amount} currency={goal.currency} onChange={(amount) => onChange({ ...a, amount })} />}
        </>
      )
    }
    case 'createTask':
      return (
        <>
          <Field label="Título">
            <TextInput value={a.title} onChange={(e) => onChange({ ...a, title: e.target.value })} placeholder="ex.: Enviar recibo" />
          </Field>
          <TokenChips kinds={trigger} onAdd={(t) => onChange({ ...a, title: append(a.title, t) })} />
          <Field label="Prazo">
            <Select value={a.dueDays === null ? 'none' : a.dueDays === 0 ? 'same' : 'days'} onChange={(e) => onChange({ ...a, dueDays: e.target.value === 'none' ? null : e.target.value === 'same' ? 0 : 3 })}>
              <option value="none">Sem data</option>
              <option value="same">No mesmo dia</option>
              <option value="days">Daqui alguns dias</option>
            </Select>
          </Field>
          {a.dueDays !== null && a.dueDays > 0 && (
            <Field label="Daqui quantos dias">
              <TextInput inputMode="numeric" value={String(a.dueDays)} onChange={(e) => onChange({ ...a, dueDays: Math.min(365, Math.max(1, Math.round(Number(e.target.value.replace(/\D/g, '')) || 1))) })} />
            </Field>
          )}
          <Field label="Prioridade">
            <MultiChips values={[a.priority]} options={TASK_PRIORITY.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => onChange({ ...a, priority: v.filter((x) => x !== a.priority)[0] ?? a.priority })} />
          </Field>
          {info.tokens.includes('projeto') && (
            <label className="flex items-center gap-3 text-[15px]">
              <input type="checkbox" className="size-5 accent-[var(--color-accent)]" checked={a.linkProject} onChange={(e) => onChange({ ...a, linkProject: e.target.checked })} />
              Ligar a tarefa ao projeto
            </label>
          )}
        </>
      )
    case 'projectStatus':
      return <MultiChips values={[a.status]} options={PROJECT_STATUS.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => onChange({ ...a, status: v.filter((x) => x !== a.status)[0] ?? a.status })} />
    case 'clientStatus':
      return <MultiChips values={[a.status]} options={CLIENT_STATUS.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => onChange({ ...a, status: v.filter((x) => x !== a.status)[0] ?? a.status })} />
    case 'setCategory': {
      const type = info.income ? 'in' : 'out'
      return (
        <>
          <MultiChips values={[a.category]} options={pickableCategories(settings, type).map((x) => ({ value: x.id, label: x.label }))} onChange={(v) => onChange({ ...a, category: v.filter((x) => x !== a.category)[0] ?? a.category })} />
          <p className="text-[13px] text-faint">Só é aplicada quando a movimentação estiver sem categoria — nunca troca a que você escolheu.</p>
        </>
      )
    }
    case 'createNote':
      return (
        <>
          <Field label="Título">
            <TextInput value={a.title} onChange={(e) => onChange({ ...a, title: e.target.value })} />
          </Field>
          <Field label="Texto">
            <TextArea value={a.body} onChange={(e) => onChange({ ...a, body: e.target.value })} />
          </Field>
          <TokenChips kinds={trigger} onAdd={(t) => onChange({ ...a, body: append(a.body, t) })} />
        </>
      )
    case 'addInbox':
      return (
        <>
          <Field label="Texto">
            <TextInput value={a.text} onChange={(e) => onChange({ ...a, text: e.target.value })} />
          </Field>
          <TokenChips kinds={trigger} onAdd={(t) => onChange({ ...a, text: append(a.text, t) })} />
        </>
      )
  }
}

/** What the person should know before saving (never blocks). */
function warnings(d: Draft, data: ReturnType<typeof useStore>['data'], settings: ReturnType<typeof useStore>['settings']): string[] {
  const out: string[] = []
  for (const c of d.conditions) if (c.field === 'amount') out.push(`Esta regra só olha valores em ${c.currency}. Para outra moeda, duplique a regra e troque a moeda.`)
  for (const a of d.actions) {
    if (a.kind !== 'reserveFixed' && a.kind !== 'reservePercent') continue
    const g = data.financeGoals.find((x) => x.id === a.goalId)
    if (g && !g.inBalance) out.push(`A meta ${g.name} não está marcada como “Este dinheiro está no meu saldo”: a reserva não será feita. Ligue isso na meta, em Financeiro.`)
    if (a.kind === 'reservePercent' && g) out.push(`Se o dinheiro vier em outra moeda, os ${a.percent}% são convertidos para ${g.currency} pela cotação do dia. Reservar não cria saída: o dinheiro continua no seu saldo.`)
  }
  if (d.trigger.kind === 'projectDone' && d.actions.some((a) => a.kind === 'clientStatus') && automationSince(settings, 'projectClient')) out.push('A automação pronta “Projetos e clientes” já conclui o cliente quando o último projeto dele termina.')
  if (d.trigger.kind === 'taskOverdue') out.push('Vale para tarefas que atrasarem a partir de hoje, uma vez por prazo.')
  return [...new Set(out)]
}

export function RuleBuilder({ open, onClose, initial, existing, onSaved }: { open: boolean; onClose(): void; initial: Draft | null; existing?: Rule; onSaved?(rule: Rule): void }) {
  const { data, settings } = useStore()
  const names = useRuleNames()
  const { toast } = useFeedback()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [openPart, setOpenPart] = useState<string | null>(null)
  const [shownFor, setShownFor] = useState<object | null>(null)
  const [note, setNote] = useState<string | null>(null)
  if (open && initial && shownFor !== initial) {
    setShownFor(initial)
    setDraft(initial)
    setOpenPart(null)
    setNote(null)
  }
  const { saveRule } = useRules()
  if (!draft) return null
  const info = triggerInfo(draft.trigger.kind)
  const toggle = (p: string) => setOpenPart((cur) => (cur === p ? null : p))

  const setTrigger = (kind: RuleTriggerKind) => {
    const next = triggerInfo(kind)
    const conditions = draft.conditions.filter((c) => next.conditions.includes(c.field))
    const actions = draft.actions.filter((a) => next.actions.includes(a.kind))
    setNote(conditions.length < draft.conditions.length || actions.length < draft.actions.length ? 'Algumas condições ou ações não valem para este “Quando” e foram tiradas.' : null)
    setDraft({ ...draft, trigger: { kind, ...(kind === 'monthDay' ? { day: draft.trigger.day ?? 1 } : {}), ...(kind === 'weekDay' ? { weekdays: draft.trigger.weekdays ?? [1] } : {}) }, conditions, actions })
  }
  const setCondition = (i: number, c: RuleCondition) => setDraft({ ...draft, conditions: draft.conditions.map((x, n) => (n === i ? c : x)) })
  const setAction = (i: number, a: RuleAction) => setDraft({ ...draft, actions: draft.actions.map((x, n) => (n === i ? a : x)) })
  const usedFields = new Set(draft.conditions.map((c) => c.field))
  const freeFields = info.conditions.filter((f) => !usedFields.has(f))

  const save = async (on: boolean) => {
    const problem = ruleProblem(draft, data)
    if (problem) return toast(problem, 'error')
    const rule = await saveRule(draft, on, existing)
    toast(on ? 'Regra salva e ligada' : 'Regra salva desligada')
    onSaved?.(rule)
    onClose()
  }

  const sentence = describeRule(draft, names)
  const warn = warnings(draft, data, settings)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={existing ? 'Editar regra' : 'Nova regra'}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="lg" block onClick={() => save(true)}>
            Salvar e ligar
          </Button>
          <Button size="lg" block variant="secondary" onClick={() => save(false)}>
            Salvar desligada
          </Button>
        </div>
      }
    >
      <div className="space-y-6 pt-1">
        <Field label="Nome da regra">
          <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="ex.: Separe para impostos" />
        </Field>

        <section>
          <Heading>Quando</Heading>
          <Part text={describeTrigger(draft.trigger)} open={openPart === 'trigger'} onToggle={() => toggle('trigger')}>
            {TRIGGER_GROUPS.map((group) => (
              <div key={group}>
                <p className="mb-1.5 text-[12px] font-semibold text-faint">{group}</p>
                <div className="flex flex-wrap gap-2">
                  {TRIGGERS.filter((t) => t.group === group).map((t) => (
                    <button key={t.kind} type="button" aria-pressed={t.kind === draft.trigger.kind} onClick={() => setTrigger(t.kind)} className={`press rounded-full border px-3.5 py-2 text-left text-sm ${t.kind === draft.trigger.kind ? 'border-transparent bg-ink text-bg' : 'border-line bg-surface text-soft hover:text-ink'}`}>
                      {t.label.charAt(0).toUpperCase() + t.label.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {draft.trigger.kind === 'monthDay' && (
              <Field label="Dia do mês" hint="29, 30 e 31 caem no último dia dos meses mais curtos">
                <Select value={String(draft.trigger.day ?? 1)} onChange={(e) => setDraft({ ...draft, trigger: { kind: 'monthDay', day: Number(e.target.value) } })}>
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {draft.trigger.kind === 'weekDay' && <MultiChips<Weekday> values={draft.trigger.weekdays ?? []} options={WEEK.map((d) => ({ value: d, label: WEEKDAY_LABEL[d] }))} onChange={(weekdays) => setDraft({ ...draft, trigger: { kind: 'weekDay', weekdays } })} />}
            {info.scheduled && <p className="text-[13px] text-faint">Regras por data não reservam dinheiro — para isso existe “Guardar todo mês” na meta.</p>}
          </Part>
          {note && <p className="mt-2 text-[13px] text-soft">{note}</p>}
        </section>

        {info.conditions.length > 0 && (
          <section>
            <Heading>Se (todas verdadeiras)</Heading>
            <div className="space-y-2">
              {draft.conditions.map((c, i) => (
                <Part key={`${c.field}-${i}`} text={describeCondition(c, names)} open={openPart === `c${i}`} onToggle={() => toggle(`c${i}`)} onRemove={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, n) => n !== i) })}>
                  <ConditionEditor c={c} trigger={draft.trigger.kind} onChange={(next) => setCondition(i, next)} />
                </Part>
              ))}
              {freeFields.length > 0 && (
                <Part text={draft.conditions.length ? '+ Adicionar outra condição' : '+ Adicionar condição (opcional)'} placeholder open={openPart === 'addc'} onToggle={() => toggle('addc')}>
                  <div className="flex flex-wrap gap-2">
                    {freeFields.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => {
                          setDraft({ ...draft, conditions: [...draft.conditions, newCondition(f, settings.baseCurrency)] })
                          setOpenPart(`c${draft.conditions.length}`)
                        }}
                        className="press rounded-full border border-line bg-surface px-3.5 py-2 text-sm text-soft hover:text-ink"
                      >
                        {CONDITION_LABEL[f].charAt(0).toUpperCase() + CONDITION_LABEL[f].slice(1)}
                      </button>
                    ))}
                  </div>
                  <p className="text-[13px] text-faint">Várias opções numa mesma condição valem como “qualquer uma delas”.</p>
                </Part>
              )}
            </div>
          </section>
        )}

        <section>
          <Heading>Faça</Heading>
          <div className="space-y-2">
            {draft.actions.map((a, i) => (
              <Part key={`${a.kind}-${i}`} text={describeAction(a, names)} open={openPart === `a${i}`} onToggle={() => toggle(`a${i}`)} onRemove={() => setDraft({ ...draft, actions: draft.actions.filter((_, n) => n !== i) })}>
                <ActionEditor a={a} trigger={draft.trigger.kind} onChange={(next) => setAction(i, next)} />
              </Part>
            ))}
            {draft.actions.length < MAX_ACTIONS && (
              <Part text={draft.actions.length ? '+ Adicionar ação' : '+ Escolher o que fazer'} placeholder open={openPart === 'adda'} onToggle={() => toggle('adda')}>
                <div className="flex flex-col gap-1.5">
                  {info.actions.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setDraft({ ...draft, actions: [...draft.actions, newAction(k, draft.trigger.kind)] })
                        setOpenPart(`a${draft.actions.length}`)
                      }}
                      className="flex items-center gap-2 rounded-lg px-2 py-2 text-left text-[15px] text-soft hover:bg-tint/[0.04] hover:text-ink"
                    >
                      <Plus size={16} className="shrink-0 text-accent-hi" />
                      {ACTION_LABEL[k]}
                    </button>
                  ))}
                </div>
              </Part>
            )}
          </div>
        </section>

        <section className="rounded-[var(--radius-field)] bg-accent/8 px-4 py-3.5">
          <p className="text-[12px] font-bold tracking-[0.12em] text-accent-hi uppercase">Em resumo</p>
          <p className="mt-1 text-[15px] leading-relaxed">{sentence.summary}</p>
          {warn.map((w) => (
            <p key={w} className="mt-2 text-[13px] leading-relaxed text-soft">
              {w}
            </p>
          ))}
          <p className="mt-2 text-[13px] leading-relaxed text-faint">Tudo o que a regra fizer aparece em “Feito pelo Núcleo”, com Desfazer. Ela nunca cria entradas ou saídas de dinheiro.</p>
        </section>
      </div>
    </Sheet>
  )
}
