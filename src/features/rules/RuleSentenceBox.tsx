import { Mic, Square } from 'lucide-react'
import { useState } from 'react'
import { ruleReply, RULE_EXAMPLES } from '../../core/assistant/ruleReply'
import { readRuleSentence, type RuleSketch } from '../../core/assistant/ruleSentence'
import type { Reply } from '../../core/assistant/actions'
import type { RuleDraft } from '../../core/rules/templates'
import { newId, useStore } from '../../data/store'
import { Button } from '../../ui/Button'
import { TextInput } from '../../ui/Field'
import { useSpeech } from '../daily/SmartCapture'

type Draft = RuleDraft & { name: string }

const chip = 'press h-9 shrink-0 rounded-full border border-line bg-surface px-3.5 text-[14px] font-medium text-soft transition-colors hover:text-ink'

/**
 * "Descreva sua regra": a sentence (typed or spoken) becomes a rule draft with the same local reader as the
 * Assistant. Never saves: a clear sentence opens the editor already filled (the preview), an unclear one asks
 * (a goal, a currency) with buttons, and a sentence that isn't a rule says so with examples.
 */
export function RuleSentenceBox({ onDraft }: { onDraft(d: Draft): void }) {
  const { data, settings } = useStore()
  const [text, setText] = useState('')
  const [reply, setReply] = useState<Reply | null>(null)
  const speech = useSpeech(setText)

  const answer = (sketch: RuleSketch) => {
    const r = ruleReply(sketch, { data, settings, now: new Date(), newId })
    const raw = r.proposal && r.link?.params?.draft
    if (raw) {
      try {
        onDraft(JSON.parse(raw) as Draft)
        setReply(null)
        setText('')
        return
      } catch {
        /* falls through to the message */
      }
    }
    setReply(r)
  }
  const read = () => {
    if (!text.trim()) return
    const sketch = readRuleSentence(text)
    if (!sketch) return setReply({ lines: ['Isso não parece uma regra. Comece com “Quando…”, “Sempre que…” ou “Toda segunda…”, e diga o que fazer. Por exemplo:'], list: RULE_EXAMPLES.slice(0, 4).map((title) => ({ title })) })
    answer(sketch)
  }

  return (
    <div className="card space-y-3 p-4">
      <p className="text-[15px] font-medium">Descreva sua regra</p>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <TextInput
            aria-label="Descreva sua regra em uma frase"
            placeholder="Ex.: Quando uma despesa passar de R$ 500, destacar para revisão"
            value={text}
            enterKeyHint="go"
            onChange={(e) => {
              setText(e.target.value)
              setReply(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                read()
              }
            }}
            className={speech.supported ? 'pr-12' : ''}
          />
          {speech.supported && (
            <button
              type="button"
              onClick={speech.listening ? speech.stop : speech.start}
              aria-label={speech.listening ? 'Parar de ouvir' : 'Falar'}
              aria-pressed={speech.listening}
              className={`press absolute top-1/2 right-1.5 grid size-9 -translate-y-1/2 place-items-center rounded-full ${speech.listening ? 'bg-accent text-on-accent' : 'text-soft hover:bg-tint/[0.06] hover:text-ink'}`}
            >
              {speech.listening ? <Square size={14} fill="currentColor" /> : <Mic size={18} />}
            </button>
          )}
        </div>
        <Button variant="secondary" onClick={read} disabled={!text.trim()} className="h-12! shrink-0 px-4!">
          Entender
        </Button>
      </div>
      {speech.listening && <p className="px-1 text-[13px] font-medium text-accent-hi">Ouvindo… fale naturalmente.</p>}
      {speech.error && <p className="px-1 text-[13px] text-warn">{speech.error}</p>}
      {reply && (
        <div className="space-y-2.5 rounded-2xl bg-tint/[0.04] p-3.5" role="status">
          {reply.lines.map((l) => (
            <p key={l} className="text-[14px] leading-relaxed">
              {l}
            </p>
          ))}
          {reply.choices && (
            <div className="flex flex-wrap gap-2">
              {reply.choices.map((c) => (
                <button key={c.label} type="button" className={chip} onClick={() => answer(c.sketch)}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {reply.list && (
            <ul className="space-y-1.5">
              {reply.list.map((x) => (
                <li key={x.title}>
                  <button type="button" className="text-left text-[14px] leading-snug text-accent-hi hover:text-ink" onClick={() => (setText(x.title), setReply(null))}>
                    “{x.title}”
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="text-[13px] leading-relaxed text-faint">Nada é salvo aqui: a frase abre o editor já preenchido para você conferir.</p>
    </div>
  )
}
