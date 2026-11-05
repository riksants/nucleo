import { ArrowUp, ChevronRight, MessageCircle, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { navigate, useRoute } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { runIntent, type Reply } from '../../core/assistant/actions'
import { aiActive, resolveIntent } from '../../core/assistant/resolve'
import { ruleReply } from '../../core/assistant/ruleReply'
import { readRuleSentence, type RuleSketch } from '../../core/assistant/ruleSentence'
import { newId } from '../../data/store'
import { aiAvailable, interpretWithAi } from './ai'
import { ASSISTANT_LIMIT, type Insight } from '../../core/insights'
import { replanItem } from '../../core/reorganize'
import { addDaysToDate, nowIn, zoneOf } from '../../core/period'
import { buildAgenda } from '../../core/agenda'
import { busyOf } from '../../core/timeline'
import { useStore } from '../../data/store'
import { IconButton } from '../../ui/Button'
import { SectionTitle } from '../../ui/Display'
import { InsightCard, useInsights, useMarkInsight } from './Insights'
import { ProposalCard } from './ProposalCard'
import { readIntent } from '../../core/assistant/intents'
import { askIa } from '../../core/assistant/ia/client'
import { newConversation, remember, type Conversation } from '../../core/assistant/ia/conversation'
import { areasOffFor } from '../../core/assistant/ia/lookups'
import { localAnswers } from '../../core/assistant/ia/localFirst'
import { CONSENT_VERSION } from '../../../supabase/functions/_shared/ia/protocol.ts'
import { useSession } from '../account/session'
import { currentUid, iaTransport, NUCLEO_IA } from './iaApi'
import { IaAnswerView, IaConsentCard, type IaShown } from './IaAnswerView'
import { IaPrivacySheet } from './IaPrivacySheet'
import { IaPlanCard } from './IaPlanCard'
import type { Plan } from '../../core/assistant/ia/actions/plan'

interface Message {
  id: number
  from: 'me' | 'nucleo'
  text?: string
  reply?: Reply
  /** NÚCLEO IA answer. */
  ia?: IaShown
  /** NÚCLEO IA: the plan proposed in that answer (editable preview, applied only on confirm). */
  plan?: Plan | null
  /** The answer spoke of a prepared change, but no preview was built. */
  noPlan?: boolean
}

/** Conversation of this session only (memory, last 20 messages) — never saved or synced. */
let session: Message[] = []
/** NÚCLEO IA context of this session (one account; dropped when the account changes). */
let iaConversation: Conversation | null = null
let iaLater = false
let seq = 0
const MAX = 20

const QUICK = ['Organizar meu dia', 'Organizar minha semana', 'O que tenho hoje?', 'Como estão minhas metas?', 'Resumo financeiro']

function ReplyView({ reply, onFollow, onChoose }: { reply: Reply; onFollow(text: string): void; onChoose(label: string, sketch: RuleSketch): void }) {
  return (
    <div className="min-w-0">
      {reply.lines.map((l, i) => (
        <p key={i} className="text-[15px] leading-relaxed">
          {l}
        </p>
      ))}
      {reply.list && reply.list.length > 0 && (
        <ul className="card mt-2 divide-y divide-line">
          {reply.list.map((x, i) => (
            <li key={i}>
              {reply.lines[0]?.includes('Exemplos') || reply.lines[0]?.startsWith('Não entendi') ? (
                <button type="button" onClick={() => onFollow(x.title)} className="block w-full px-4 py-2.5 text-left text-[15px] text-accent-hi hover:text-ink">
                  {x.title}
                </button>
              ) : (
                <div className="px-4 py-2.5">
                  <p className="text-[15px] leading-snug break-words">{x.title}</p>
                  {x.meta && <p className="text-[13px] leading-snug text-faint">{x.meta}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {reply.rule && (
        <div className="card mt-2 space-y-2 px-4 py-3.5">
          <p className="label-mono text-faint">Quando</p>
          <p className="text-[15px] leading-snug first-letter:uppercase">{reply.rule.when}</p>
          {reply.rule.ifs.length > 0 && (
            <>
              <p className="pt-1 label-mono text-faint">Se</p>
              {reply.rule.ifs.map((x) => (
                <p key={x} className="text-[15px] leading-snug first-letter:uppercase">
                  {x}
                </p>
              ))}
            </>
          )}
          <p className="pt-1 label-mono text-faint">Faça</p>
          {reply.rule.dos.map((x) => (
            <p key={x} className="text-[15px] leading-snug first-letter:uppercase">
              → {x}
            </p>
          ))}
        </div>
      )}
      {reply.choices && reply.choices.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {reply.choices.map((c) => (
            <button key={c.label} type="button" onClick={() => onChoose(c.label, c.sketch)} className="press rounded-full border border-line bg-surface px-4 py-2 text-[15px] text-ink hover:border-accent-hi/60">
              {c.label}
            </button>
          ))}
        </div>
      )}
      {reply.proposal && <ProposalCard proposal={reply.proposal} />}
      {reply.link && (
        <button type="button" onClick={() => navigate(reply.link!.path as never, reply.link!.params)} className="mt-2 flex items-center gap-1 text-[14px] font-medium text-accent-hi hover:text-ink">
          {reply.link.label} <ChevronRight size={16} />
        </button>
      )}
    </div>
  )
}

/**
 * Assistente do NÚCLEO. Works with the person's own records on this device
 * (deterministic commands, offline). Writes are always shown as a proposal to
 * confirm. Nothing is sent anywhere.
 */
export function AssistantPage() {
  const { data, settings, updateSettings } = useStore()
  const { userId } = useSession()
  const { params } = useRoute()
  const { all } = useInsights()
  const mark = useMarkInsight()
  const [messages, setMessages] = useState<Message[]>(session)
  const [text, setText] = useState('')
  const [iaStatus, setIaStatus] = useState<string | null>(null)
  const [later, setLater] = useState(iaLater)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  // NÚCLEO IA: build flag + switch on + the new consent + an account. Otherwise exactly the old Assistant.
  const iaReady = NUCLEO_IA && Boolean(userId) && aiActive(settings.assistantAi) && settings.assistantAi?.consentVersion === CONSENT_VERSION
  const askConsent = NUCLEO_IA && Boolean(userId) && aiActive(settings.assistantAi) && settings.assistantAi?.consentVersion !== CONSENT_VERSION && !later
  const endRef = useRef<HTMLDivElement>(null)
  const latest = useRef({ data, settings })
  latest.current = { data, settings }

  const push = (m: Omit<Message, 'id'>[]) => {
    setMessages((prev) => {
      const next = [...prev, ...m.map((x) => ({ ...x, id: ++seq }))].slice(-MAX)
      session = next
      return next
    })
  }
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages.length])

  const ask = async (q: string, opts: { deep?: boolean } = {}) => {
    const question = q.trim()
    if (!question || iaStatus) return
    setText('')
    const { settings: s0 } = latest.current
    // A rule sentence ("Sempre que…, guarda 20% para…"): preview first, never written without confirming.
    const sketch = readRuleSentence(question)
    if (sketch) {
      const { data: d, settings: s } = latest.current
      push([{ from: 'me', text: question }, { from: 'nucleo', reply: ruleReply(sketch, { data: d, settings: s, now: new Date(), newId }) }])
      return
    }
    const today = nowIn(zoneOf(s0)).date
    // NÚCLEO IA: local commands still answer first (free, offline); everything else goes to the IA.
    if (iaReady && userId) {
      // The conversation belongs to one account: another login starts a new one.
      const conv = iaConversation?.uid === userId ? iaConversation : newConversation(userId)
      const local = opts.deep ? null : readIntent(question, today)
      if (local && localAnswers(local, question)) {
        const { data: d, settings: s } = latest.current
        const reply = runIntent(local, { data: d, settings: s, now: new Date() })
        iaConversation = remember(conv, question, [...reply.lines, ...(reply.list ?? []).slice(0, 8).map((x) => `${x.title}${x.meta ? ` (${x.meta})` : ''}`)].join(' · '))
        push([{ from: 'me', text: question }, { from: 'nucleo', reply }])
        return
      }
      if (!navigator.onLine) {
        const { data: d, settings: s } = latest.current
        const reply = runIntent(local ?? { type: 'unknown' }, { data: d, settings: s, now: new Date() })
        reply.lines = ['A IA precisa de conexão. Os comandos do Assistente continuam funcionando sem internet.', ...reply.lines]
        push([{ from: 'me', text: opts.deep ? `Analisar a fundo: ${question}` : question }, { from: 'nucleo', reply }])
        return
      }
      push([{ from: 'me', text: opts.deep ? `Analisar a fundo: ${question}` : question }])
      setIaStatus('Pensando…')
      try {
        const r = await askIa(question, conv, {
          transport: iaTransport,
          snapshot: () => latest.current,
          now: () => new Date(),
          currentUid,
          today,
          timeZone: zoneOf(s0),
          areasOff: areasOffFor(s0),
          onStatus: setIaStatus,
        }, opts)
        if (r.kind === 'answer') {
          iaConversation = r.conversation
          push([{ from: 'nucleo', ia: { segments: r.segments, route: r.route, costMicros: r.costMicros, question }, plan: r.plan, noPlan: r.claimedPlanWithoutOne }])
        } else {
          iaConversation = r.conversation
          push([{ from: 'nucleo', reply: { lines: [r.message] } }])
        }
      } finally {
        setIaStatus(null)
      }
      return
    }
    // Local commands first; the optional AI only when on, consented, online — never otherwise.
    const r = await resolveIntent(question, today, { ai: s0.assistantAi, online: navigator.onLine, available: aiAvailable(), call: interpretWithAi })
    const { data: d, settings: s } = latest.current
    const reply = runIntent(r.intent, { data: d, settings: s, now: new Date() })
    if (r.via === 'ai') reply.lines = [...reply.lines, '(interpretado com IA)']
    if (r.note) reply.lines = [r.note, ...reply.lines]
    push([{ from: 'me', text: question }, { from: 'nucleo', reply }])
  }
  /** A tapped option of a question (which goal, which currency): the same rule continues. */
  const choose = (label: string, sketch: RuleSketch) => {
    const { data: d, settings: s } = latest.current
    push([{ from: 'me', text: label }, { from: 'nucleo', reply: ruleReply(sketch, { data: d, settings: s, now: new Date(), newId }) }])
  }
  // "?ask=" from other screens (e.g. Hoje → Organizar meu dia).
  useEffect(() => {
    const q = params.get('ask')
    if (q) ask(q)
  }, [params.get('ask')]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = (i: Insight) => {
    const a = i.action?.do
    if (!a) return
    mark(i.key, 'accepted')
    if (a.kind === 'open') return navigate(a.path as never, a.params)
    if (a.kind === 'reorganizeDay') return ask('Organizar meu dia')
    if (a.kind === 'reorganizeWeek') return ask('Organizar minha semana')
    const { data: d, settings: s } = latest.current
    const today = nowIn(zoneOf(s)).date
    const busy = busyOf(buildAgenda(d, s, today, addDaysToDate(today, 2))).find((b) => b.key === a.key && b.date === a.date)
    const proposal = busy ? replanItem(d, s, busy) : null
    push([{ from: 'me', text: i.title }, { from: 'nucleo', reply: proposal ? { lines: [proposal.summary], proposal } : { lines: ['Não encontrei um horário livre nos próximos 7 dias dentro da sua faixa de horário. Você pode ajustar a faixa em Configurações.'] } }])
  }

  const shown = all.slice(0, ASSISTANT_LIMIT)
  return (
    <>
      <PageHeader title="Assistente" subtitle={iaReady ? 'Usa o que está no seu NÚCLEO. Perguntas que os comandos não respondem vão para a IA, com só os trechos necessários.' : aiActive(settings.assistantAi) ? 'Usa o que está no seu NÚCLEO. Frases que os comandos não entendem vão para a IA (só a frase).' : 'Usa só o que está no seu NÚCLEO — nada é enviado para fora'} />
      <div className="mx-auto max-w-2xl pb-36">
        {shown.length > 0 && (
          <section className="mb-6">
            <SectionTitle>Precisa de atenção</SectionTitle>
            <div className="card divide-y divide-line">
              {shown.map((i) => (
                <InsightCard key={i.key} insight={i} onAction={act} />
              ))}
            </div>
          </section>
        )}

        <div className="no-scrollbar -mx-5 -mt-1.5 mb-3.5 flex gap-2 overflow-x-auto px-5 py-1.5 lg:mx-0 lg:flex-wrap lg:px-0">
          {QUICK.map((q) => (
            <button key={q} type="button" onClick={() => ask(q)} className="press h-10 shrink-0 rounded-full border border-line bg-surface px-4 text-[14px] font-medium text-soft hover:text-ink">
              {q}
            </button>
          ))}
          {iaReady && (
            <button type="button" onClick={() => setPrivacyOpen(true)} className="press flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-[14px] font-medium text-soft hover:text-ink">
              <ShieldCheck size={16} /> Privacidade da IA
            </button>
          )}
        </div>

        <div className="space-y-4" aria-live="polite">
          {askConsent && (
            <IaConsentCard
              onAccept={() => updateSettings({ assistantAi: { enabled: true, consentAt: new Date().toISOString(), consentVersion: CONSENT_VERSION } })}
              onLater={() => {
                iaLater = true
                setLater(true)
              }}
            />
          )}
          {messages.length === 0 && (
            <div className="card flex gap-3 p-4 text-[15px] leading-relaxed text-soft">
              <MessageCircle size={18} className="mt-0.5 shrink-0 text-accent-hi" />
              <p>Pergunte sobre o seu dia, semana, metas e gastos, ou peça para criar tarefas, metas e compromissos. Antes de mudar qualquer coisa, eu mostro a proposta para você confirmar.</p>
            </div>
          )}
          {messages.map((m) =>
            m.from === 'me' ? (
              <p key={m.id} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[15px] break-words text-bg">
                {m.text}
              </p>
            ) : m.ia ? (
              <div key={m.id} className="max-w-full">
                <IaAnswerView shown={m.ia} onDeep={(q) => ask(q, { deep: true })} />
                {m.plan && <IaPlanCard plan={m.plan} />}
                {m.noPlan && (
                  <p className="mt-2 rounded-xl border border-line bg-surface px-3 py-2 text-[14px] text-soft" role="alert" data-no-plan>
                    Nenhuma prévia foi montada nesta resposta, então nada será gravado. Se quiser fazer essa alteração, peça de novo.
                  </p>
                )}
              </div>
            ) : (
              <div key={m.id} className="max-w-full">
                <ReplyView reply={m.reply!} onFollow={(t) => ask(t)} onChoose={choose} />
              </div>
            ),
          )}
          {iaStatus && (
            <p className="flex items-center gap-2 text-[14px] text-soft" data-ia-status role="status">
              <span className="size-2 animate-pulse rounded-full bg-accent-hi motion-reduce:animate-none" />
              {iaStatus}
            </p>
          )}
          <div ref={endRef} className="scroll-mb-44 lg:scroll-mb-24" />
        </div>
      </div>

      {iaReady && <IaPrivacySheet open={privacyOpen} onClose={() => setPrivacyOpen(false)} />}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
        className="fixed inset-x-0 bottom-[calc(max(8px,env(safe-area-inset-bottom))+66px)] z-30 border-t border-line bg-bg/92 px-4 py-2.5 backdrop-blur-xl reduce-transparency:bg-bg reduce-transparency:backdrop-blur-none lg:bottom-0 lg:left-64 lg:pb-[max(10px,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <input aria-label="Pergunte ao NÚCLEO" placeholder="Pergunte ao NÚCLEO…" value={text} maxLength={300} enterKeyHint="send" autoComplete="off" onChange={(e) => setText(e.target.value)} className="h-12 min-w-0 flex-1 rounded-[var(--radius-field)] border border-line bg-raised px-4 text-[16px] text-ink placeholder:text-faint focus:border-accent-hi/70 focus:outline-none" />
          <IconButton label="Enviar" tone="accent" type="submit" className="size-12! shrink-0" disabled={!text.trim()}>
            <ArrowUp size={20} />
          </IconButton>
        </div>
      </form>
    </>
  )
}
