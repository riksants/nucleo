import { Check, ChevronRight, Clock3, Sparkles, Square, Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { speak, stopSpeaking, ttsSupported } from '../../lib/speech'
import { spokenText } from '../../core/assistant/ia/spoken'
import { navigate } from '../../app/router'
import { plainLine, type Fact, type Segment } from '../../../supabase/functions/_shared/ia/facts.ts'

export interface IaShown {
  segments: Segment[]
  route: string
  costMicros: number
  /** The question, for "Analisar a fundo". */
  question: string
}

const ROUTE_LABEL: Record<string, string> = { rapida: 'Resposta rápida', atenta: 'Análise', profunda: 'Análise profunda' }

function FactChip({ fact, shown }: { fact: Fact; shown?: string }) {
  const seal =
    fact.seal === 'proposto' || fact.seal === 'informado' ? null : fact.seal === 'previsto' ? (
      <Clock3 size={14} strokeWidth={2.4} aria-label="previsão" />
    ) : fact.seal === 'ausente' ? null : (
      <Check size={14} strokeWidth={2.6} aria-label="confirmado" />
    )
  const tone = fact.seal === 'proposto' || fact.seal === 'informado' ? 'text-ink' : fact.seal === 'previsto' ? 'text-soft italic' : fact.seal === 'ausente' ? 'text-faint' : 'text-ink font-medium'
  const title = `${fact.label}${fact.seal === 'proposto' ? ' — na prévia, ainda não gravado' : fact.seal === 'informado' ? ' — a partir de um valor que você informou' : fact.seal === 'previsto' ? ' — previsão' : fact.seal === 'ausente' ? ' — não encontrado' : ' — confirmado'}${fact.base ? ` (${fact.base})` : ''}`
  const body = (
    <>
      {shown ?? fact.display}
      {seal && <span className="ml-0.5 inline-flex translate-y-[1px] text-accent-hi">{seal}</span>}
    </>
  )
  if (!fact.open) return <span className={tone} title={title} data-fact={fact.id} data-seal={fact.seal}>{body}</span>
  return (
    <button type="button" title={title} data-fact={fact.id} data-seal={fact.seal} onClick={() => navigate(fact.open!.path as never, fact.open!.params)} className={`${tone} underline decoration-line decoration-dotted underline-offset-4 hover:decoration-accent-hi`}>
      {body}
    </button>
  )
}

/** Splits the segments into paragraphs at line breaks. */
function paragraphs(segments: Segment[]): Segment[][] {
  const out: Segment[][] = [[]]
  for (const s of segments) {
    if (s.t !== 'text') {
      out[out.length - 1].push(s)
      continue
    }
    const parts = s.s.split(/\n+/)
    parts.forEach((p, i) => {
      if (i > 0) out.push([])
      // a new line starts a paragraph: only the start of a line can be a list marker or heading
      const text = i > 0 || out[out.length - 1].length === 0 ? plainLine(p) : p.replace(/\*\*/g, '')
      if (text) out[out.length - 1].push({ t: 'text', s: text })
    })
  }
  return out.filter((p) => p.some((s) => s.t !== 'text' || s.s.trim()))
}

function Listen({ segments }: { segments: Segment[] }) {
  const [on, setOn] = useState(false)
  useEffect(() => () => stopSpeaking(), [])
  if (!ttsSupported()) return null
  return (
    <button
      type="button"
      aria-pressed={on}
      data-ia-listen
      onClick={() => {
        if (on) {
          stopSpeaking()
          return setOn(false)
        }
        setOn(true)
        speak(spokenText(segments), () => setOn(false))
      }}
      className="-my-2 flex min-h-11 items-center gap-1 font-medium text-accent-hi hover:text-ink"
    >
      {on ? <Square size={14} /> : <Volume2 size={16} />} {on ? 'Parar' : 'Ouvir'}
    </button>
  )
}

export function IaAnswerView({ shown, onDeep, partial }: { shown: IaShown; onDeep?(question: string): void; partial?: boolean }) {
  const paras = paragraphs(shown.segments)
  // the legend only explains the seals this answer really uses
  const seals = new Set(shown.segments.flatMap((s) => (s.t === 'fact' ? [s.fact.seal] : [])))
  return (
    <div className="min-w-0" {...(partial ? { 'data-ia-partial': true, 'aria-busy': true } : { 'data-ia-answer': true, 'data-route': shown.route })}>
      {paras.map((p, i) => {
        const first = p[0]
        const suggestion = first?.t === 'text' && /^\s*(?:[-•]\s*)?Sugest[aã]o:/i.test(first.s)
        return (
          <p key={i} className={`text-[15px] leading-relaxed ${suggestion ? 'mt-1.5 rounded-xl border border-line bg-surface px-3 py-2' : ''}`}>
            {suggestion && <Sparkles size={14} className="mr-1 inline -translate-y-[1px] text-accent-hi" aria-label="sugestão" />}
            {p.map((s, j) =>
              s.t === 'text' ? (
                <span key={j}>{s.s}</span>
              ) : s.t === 'fact' ? (
                <FactChip key={j} fact={s.fact} shown={s.shown} />
              ) : (
                <span key={j} className="text-faint" data-blocked>
                  ‹valor não confirmado›
                </span>
              ),
            )}
          </p>
        )
      })}
      {!partial && <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
        <span>
          {ROUTE_LABEL[shown.route] ?? 'IA'}
          {seals.has('confirmado') && (
            <>
              {' · '}
              <Check size={14} className="inline -translate-y-[1px]" /> confirmado
            </>
          )}
          {seals.has('previsto') && (
            <>
              {' · '}
              <Clock3 size={14} className="inline -translate-y-[1px]" /> previsão
            </>
          )}
        </span>
        {onDeep && shown.route !== 'profunda' && (
          <button type="button" onClick={() => onDeep(shown.question)} className="flex items-center gap-0.5 font-medium text-accent-hi hover:text-ink">
            Analisar a fundo <ChevronRight size={14} />
          </button>
        )}
        <Listen segments={shown.segments} />
      </div>}
    </div>
  )
}

export function IaConsentCard({ onAccept, onLater }: { onAccept(): void; onLater(): void }) {
  return (
    <div className="card space-y-3 p-4 text-[15px] leading-relaxed" data-ia-consent>
      <p className="font-medium text-ink">A IA do Assistente ficou mais capaz</p>
      <p className="text-soft">
        Agora ela consulta seus dados (agenda, finanças, metas e busca) para responder às suas perguntas. Durante cada pergunta, só os trechos necessários são enviados à Anthropic, a empresa da IA, e não ficam
        guardados nos servidores do NÚCLEO — só o custo da pergunta. Senhas e cofre nunca são enviados. A IA não altera nada sem a sua confirmação.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onAccept} className="press rounded-full bg-accent px-4 py-2 text-[15px] font-medium text-on-accent">
          Concordo, usar a IA
        </button>
        <button type="button" onClick={onLater} className="press rounded-full border border-line px-4 py-2 text-[15px] text-soft hover:text-ink">
          Agora não
        </button>
      </div>
    </div>
  )
}
