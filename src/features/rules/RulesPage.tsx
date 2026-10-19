import { Ellipsis, Sparkles, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { clearParams, navigate, useRoute } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { describeRule } from '../../core/rules/sentence'
import type { RuleSuggestion } from '../../core/rules/suggestions'
import { TEMPLATES, type RuleDraft } from '../../core/rules/templates'
import { useStore } from '../../data/store'
import type { Rule } from '../../data/types'
import { parseMoney } from '../../lib/calc'
import { amountToInput } from '../../lib/money'
import { AmountField } from '../../ui/AmountField'
import { Button } from '../../ui/Button'
import { Badge, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, TextInput } from '../../ui/Field'
import { Sheet } from '../../ui/Sheet'
import { Switch } from '../settings/ModulePicker'
import { RuleBuilder } from './RuleBuilder'
import { SuggestionCard } from './SuggestionCard'
import { ruleStats, useRuleNames, useRules } from './useRules'

type Draft = RuleDraft & { name: string }
const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
const draftOf = (r: Rule): Draft => ({ name: r.name, trigger: r.trigger, conditions: r.conditions, actions: r.actions, ...(r.template ? { template: r.template } : {}) })

/** "Cadastrar como conta fixa": confirmed by the person; the bill then creates "A pagar" each month (Parte 1). */
function FixedExpenseSheet({ s, open, onClose }: { s: RuleSuggestion | null; open: boolean; onClose(): void }) {
  const { createFixedBill, answer } = useRules()
  const { toast } = useFeedback()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [day, setDay] = useState('')
  const [shownFor, setShownFor] = useState<string | null>(null)
  const f = s?.fixedExpense
  if (open && s && f && shownFor !== s.key) {
    setShownFor(s.key)
    setName(f.name)
    setValue(amountToInput(f.amount))
    setDay(String(f.day))
  }
  if (!s || !f) return null
  const save = async () => {
    const amount = parseMoney(value || '0')
    const d = Math.round(Number(day))
    if (!name.trim()) return toast('Digite o nome', 'error')
    if (!amount) return toast('Digite o valor', 'error')
    if (!(d >= 1 && d <= 31)) return toast('O dia vai de 1 a 31', 'error')
    await createFixedBill({ name: name.trim(), amount, currency: f.currency, day: d })
    await answer(s.key, 'accepted')
    toast('Conta fixa cadastrada em Assinaturas')
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title="Cadastrar como conta fixa" footer={<Button size="lg" block onClick={save}>Cadastrar</Button>}>
      <div className="space-y-4 pt-1">
        <p className="text-[15px] leading-relaxed text-soft">Fica em Assinaturas. Todo mês, no dia, o Núcleo cria “A pagar” e você confirma quando pagar. Nenhuma despesa é lançada sozinha.</p>
        <Field label="Nome">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Valor">
          <AmountField currency={f.currency} value={value} onChange={setValue} />
        </Field>
        <Field label="Dia do mês">
          <TextInput inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </Field>
      </div>
    </Sheet>
  )
}

function RuleMenu({ rule, open, onClose, onEdit }: { rule: Rule | null; open: boolean; onClose(): void; onEdit(r: Rule): void }) {
  const { duplicate, move, removeRule, rules } = useRules()
  const { toast, confirm } = useFeedback()
  if (!rule) return null
  const i = rules.findIndex((r) => r.id === rule.id)
  const item = (label: string, run: () => void, tone = '') => (
    <button type="button" onClick={run} className={`flex w-full items-center px-4 py-3.5 text-left text-[15px] transition-colors hover:bg-tint/[0.03] ${tone}`}>
      {label}
    </button>
  )
  return (
    <Sheet open={open} onClose={onClose} title={rule.name}>
      <div className="card divide-y divide-line overflow-hidden">
        {item('Editar', () => (onClose(), onEdit(rule)))}
        {item('Duplicar', async () => {
          await duplicate(rule)
          toast('Regra duplicada (desligada)')
          onClose()
        })}
        {i > 0 && item('Subir na ordem', async () => (await move(rule, -1), onClose()))}
        {i < rules.length - 1 && item('Descer na ordem', async () => (await move(rule, 1), onClose()))}
        {item('Ver histórico', () => (onClose(), navigate('/automations', { rule: rule.id })))}
        {item(
          'Excluir',
          async () => {
            const ok = await confirm({ title: 'Excluir esta regra?', message: 'O que ela já fez continua em “Feito pelo Núcleo”, e ainda dá para desfazer.', confirmLabel: 'Excluir', danger: true })
            if (!ok) return
            await removeRule(rule)
            toast('Regra excluída')
            onClose()
          },
          'text-expense',
        )}
      </div>
      <p className="mt-3 px-1 text-[13px] leading-relaxed text-faint">Quando várias regras respondem ao mesmo acontecimento, a de cima roda primeiro.</p>
    </Sheet>
  )
}

function RuleCard({ rule, onMenu, onEdit }: { rule: Rule; onMenu(r: Rule): void; onEdit(r: Rule): void }) {
  const { data } = useStore()
  const { setOn } = useRules()
  const names = useRuleNames()
  const { toast } = useFeedback()
  const stats = ruleStats(rule.id, data.automationRuns)
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => onEdit(rule)} className="min-w-0 flex-1 text-left">
          <span className="block text-[15px] font-medium">{rule.name}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-soft">{describeRule(rule, names).summary}</span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={rule.on}
          aria-label={rule.on ? 'Desligar' : 'Ligar'}
          className="pt-0.5"
          onClick={async () => {
            await setOn(rule, !rule.on)
            toast(rule.on ? 'Regra desligada' : 'Regra ligada a partir de hoje')
          }}
        >
          <Switch checked={rule.on} />
        </button>
      </div>
      {rule.paused && <p className="mt-2 text-[13px] text-warn">Pausada por segurança: {rule.paused.reason.toLowerCase()}. Confira e ligue de novo.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-faint">
        <span>{stats.last ? `Última vez: ${ddmm(stats.last)}` : 'Ainda não rodou'}</span>
        {stats.count > 0 && <span>{stats.count === 1 ? '1 vez' : `${stats.count} vezes`}</span>}
        <button type="button" className="font-medium text-accent-hi hover:text-ink" onClick={() => navigate('/automations', { rule: rule.id })}>
          Ver histórico
        </button>
        <span className="flex-1" />
        <button type="button" aria-label="Mais opções" onClick={() => onMenu(rule)} className="grid size-9 place-items-center rounded-full text-soft hover:text-ink">
          <Ellipsis size={18} />
        </button>
      </div>
    </div>
  )
}

export function RulesPage() {
  const { data } = useStore()
  const { rules, suggestion, answer } = useRules()
  const route = useRoute()
  const [builder, setBuilder] = useState<{ initial: Draft; existing?: Rule; suggestion?: string } | null>(null)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [menu, setMenu] = useState<Rule | null>(null)
  const [fixed, setFixed] = useState<RuleSuggestion | null>(null)

  const edit = (initial: Draft, existing?: Rule, suggestionKey?: string) => {
    setBuilder({ initial, existing, suggestion: suggestionKey })
    setBuilderOpen(true)
  }
  const create = (s: RuleSuggestion) => {
    if (s.fixedExpense) return setFixed(s)
    if (s.draft) edit({ ...s.draft }, undefined, s.key)
  }

  // ?open=<rule id> (from "Feito pelo Núcleo") · ?suggestion=1 (from Início).
  const openId = route.params.get('open')
  const fromHome = route.params.get('suggestion')
  const fromAssistant = route.params.get('draft')
  useEffect(() => {
    if (fromAssistant) {
      // "Ajustar no editor" from the Assistant: only opens the editor, nothing is saved.
      try {
        const d = JSON.parse(fromAssistant) as Draft
        if (d && typeof d.name === 'string' && d.trigger?.kind && Array.isArray(d.conditions) && Array.isArray(d.actions)) edit({ name: d.name, trigger: d.trigger, conditions: d.conditions, actions: d.actions })
      } catch {
        /* a broken link opens the page as usual */
      }
      clearParams()
    } else if (openId) {
      const r = data.rules.find((x) => x.id === openId)
      if (r) edit(draftOf(r), r)
      clearParams()
    } else if (fromHome && suggestion) {
      create(suggestion)
      clearParams()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, fromHome, fromAssistant])

  return (
    <>
      <PageHeader
        title="Minhas regras"
        subtitle="Quando algo acontece, o Núcleo faz por você"
        actions={
          <Button icon={<Wand2 size={18} />} onClick={() => edit({ name: '', trigger: { kind: 'projectPayment' }, conditions: [], actions: [] })}>
            Nova regra
          </Button>
        }
      />
      <div className="grid gap-7 lg:grid-cols-2 lg:items-start">
        <div className="space-y-7">
          {suggestion && (
            <section>
              <SectionTitle>Sugestão do Núcleo</SectionTitle>
              <SuggestionCard s={suggestion} onCreate={create} />
            </section>
          )}
          <section>
            <SectionTitle>Suas regras</SectionTitle>
            {rules.length ? (
              <div className="card divide-y divide-line">
                {rules.map((r) => (
                  <RuleCard key={r.id} rule={r} onMenu={setMenu} onEdit={(x) => edit(draftOf(x), x)} />
                ))}
              </div>
            ) : (
              <div className="card px-4 py-5 text-center">
                <Sparkles size={20} className="mx-auto text-accent-hi" />
                <p className="mt-2 text-[15px] font-medium">Nenhuma regra ainda</p>
                <p className="mt-1 text-[13px] leading-relaxed text-faint">Comece por um modelo pronto ao lado, ou crie a sua. Nada liga sozinho.</p>
              </div>
            )}
          </section>
        </div>
        <section>
          <SectionTitle>Modelos prontos</SectionTitle>
          <div className="card divide-y divide-line overflow-hidden">
            {TEMPLATES.map((t) => {
              const used = rules.some((r) => r.template === t.id)
              return (
                <button key={t.id} type="button" onClick={() => edit(t.draft())} className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-tint/[0.03] tap">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[15px] font-medium">
                      {t.name}
                      {used && <Badge>em uso</Badge>}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-faint">{t.text}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-2 px-1 text-[13px] leading-relaxed text-faint">
            O que uma regra faz nunca dispara outra regra. Regras não criam entradas nem saídas: reservar para uma meta não é uma saída. {data.automationRuns.some((r) => r.automation === 'rule') ? '' : 'Tudo o que elas fizerem aparece em “Feito pelo Núcleo”, com Desfazer.'}
          </p>
        </section>
      </div>
      <RuleBuilder
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        initial={builder?.initial ?? null}
        existing={builder?.existing}
        onSaved={() => {
          if (builder?.suggestion) void answer(builder.suggestion, 'accepted')
        }}
      />
      <RuleMenu rule={menu} open={!!menu} onClose={() => setMenu(null)} onEdit={(r) => edit(draftOf(r), r)} />
      <FixedExpenseSheet s={fixed} open={!!fixed} onClose={() => setFixed(null)} />
    </>
  )
}
