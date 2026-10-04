import { ArrowUp, ChevronRight, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { navigate, useRoute } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { runIntent, type Reply } from '../../core/assistant/actions'
import { aiActive, resolveIntent } from '../../core/assistant/resolve'
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

interface Message {
  id: number
  from: 'me' | 'nucleo'
  text?: string
  reply?: Reply
}

/** Conversation of this session only (memory, last 20 messages) — never saved or synced. */
let session: Message[] = []
let seq = 0
const MAX = 20

const QUICK = ['Organizar meu dia', 'Organizar minha semana', 'O que tenho hoje?', 'Como estão minhas metas?', 'Resumo financeiro']

function ReplyView({ reply, onFollow }: { reply: Reply; onFollow(text: string): void }) {
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
      {reply.proposal && <ProposalCard proposal={reply.proposal} />}
      {reply.link && (
        <button type="button" onClick={() => navigate(reply.link!.path as never, reply.link!.params)} className="mt-2 flex items-center gap-1 text-[14px] font-medium text-accent-hi hover:text-ink">
          {reply.link.label} <ChevronRight size={15} />
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
  const { data, settings } = useStore()
  const { params } = useRoute()
  const { all } = useInsights()
  const mark = useMarkInsight()
  const [messages, setMessages] = useState<Message[]>(session)
  const [text, setText] = useState('')
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

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question) return
    setText('')
    const { settings: s0 } = latest.current
    const today = nowIn(zoneOf(s0)).date
    // Local commands first; the optional AI only when on, consented, online — never otherwise.
    const r = await resolveIntent(question, today, { ai: s0.assistantAi, online: navigator.onLine, available: aiAvailable(), call: interpretWithAi })
    const { data: d, settings: s } = latest.current
    const reply = runIntent(r.intent, { data: d, settings: s, now: new Date() })
    if (r.via === 'ai') reply.lines = [...reply.lines, '(interpretado com IA)']
    if (r.note) reply.lines = [r.note, ...reply.lines]
    push([{ from: 'me', text: question }, { from: 'nucleo', reply }])
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
      <PageHeader title="Assistente" subtitle={aiActive(settings.assistantAi) ? 'Usa o que está no seu NÚCLEO. Frases que os comandos não entendem vão para a IA (só a frase).' : 'Usa só o que está no seu NÚCLEO — nada é enviado para fora'} />
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
        </div>

        <div className="space-y-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="card flex gap-3 p-4 text-[15px] leading-relaxed text-soft">
              <Sparkles size={18} className="mt-0.5 shrink-0 text-accent-hi" />
              <p>Pergunte sobre o seu dia, semana, metas e gastos, ou peça para criar tarefas, metas e compromissos. Antes de mudar qualquer coisa, eu mostro a proposta para você confirmar.</p>
            </div>
          )}
          {messages.map((m) =>
            m.from === 'me' ? (
              <p key={m.id} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent/15 px-4 py-2.5 text-[15px] break-words">
                {m.text}
              </p>
            ) : (
              <div key={m.id} className="max-w-full">
                <ReplyView reply={m.reply!} onFollow={ask} />
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
        className="fixed inset-x-0 bottom-[calc(max(8px,env(safe-area-inset-bottom))+66px)] z-30 border-t border-line bg-bg/92 px-4 py-2.5 backdrop-blur-xl reduce-transparency:bg-bg reduce-transparency:backdrop-blur-none lg:bottom-0 lg:left-64 lg:pb-[max(10px,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <input aria-label="Pergunte ao NÚCLEO" placeholder="Pergunte ao NÚCLEO…" value={text} maxLength={300} enterKeyHint="send" autoComplete="off" onChange={(e) => setText(e.target.value)} className="h-12 min-w-0 flex-1 rounded-[var(--radius-field)] border border-line bg-raised px-4 text-[16px] text-ink placeholder:text-faint focus:border-accent/70 focus:outline-none" />
          <IconButton label="Enviar" tone="accent" type="submit" className="size-12! shrink-0" disabled={!text.trim()}>
            <ArrowUp size={19} />
          </IconButton>
        </div>
      </form>
    </>
  )
}
