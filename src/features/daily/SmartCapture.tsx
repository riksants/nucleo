/**
 * Cadastro inteligente (optional): write — or say — one sentence, check the fields in the usual form, create.
 * Nothing is saved while typing; the form is the confirmation and uses the same checks as the manual way.
 * Voice uses the browser's own speech recognition when the device has it (no paid service); otherwise the
 * keyboard's dictation or typing does the same.
 */
import { ChevronDown, Mic, Sparkles, Square } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { answerCapture, captureQuestions, parseCapture, type CaptureDraft } from '../../core/capture'
import { addDaysToDate, useToday, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import type { Weekday } from '../../data/types'
import { Button } from '../../ui/Button'
import { TextInput } from '../../ui/Field'

/* ------------------------------------------------------------------ voz */

interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Speech to text with the device's recognizer (pt-BR). `supported` is false where the browser has none. */
export function useSpeech(onText: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const rec = useRef<Recognition | null>(null)
  const supported = recognitionClass() !== null
  useEffect(() => () => rec.current?.abort(), [])
  const start = () => {
    const Rec = recognitionClass()
    if (!Rec) return
    setError('')
    const r = new Rec()
    r.lang = 'pt-BR'
    r.interimResults = true
    r.continuous = false
    r.onresult = (e) => onText(Array.from(e.results, (x) => x[0]?.transcript ?? '').join(' ').trim())
    r.onerror = (e) => setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Permita o uso do microfone para falar.' : e.error === 'no-speech' ? 'Não ouvi nada. Tente de novo.' : 'Não deu para ouvir agora. Você pode digitar.')
    r.onend = () => setListening(false)
    rec.current = r
    try {
      r.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }
  const stop = () => rec.current?.stop()
  return { supported, listening, error, start, stop }
}

/* ------------------------------------------------------------------ the sentence field */

const WEEK: { d: Weekday; label: string }[] = [
  { d: 1, label: 'Seg' },
  { d: 2, label: 'Ter' },
  { d: 3, label: 'Qua' },
  { d: 4, label: 'Qui' },
  { d: 5, label: 'Sex' },
  { d: 6, label: 'Sáb' },
  { d: 0, label: 'Dom' },
]

const chip = (on = false) => `press h-9 shrink-0 rounded-full border px-3.5 text-[14px] font-medium transition-colors ${on ? 'border-accent/40 bg-accent/[0.14] text-accent-hi' : 'border-line bg-surface text-soft hover:text-ink'}`

/** What is still unclear, one row of choices each (never guessed). */
function Questions({ draft, today, onAnswer }: { draft: CaptureDraft; today: string; onAnswer(d: CaptureDraft): void }) {
  const [monthDay, setMonthDay] = useState('')
  const q = captureQuestions(draft)
  if (!q.length) return null
  return (
    <div className="space-y-3 rounded-2xl bg-warn/[0.08] p-3.5" role="group" aria-label="Falta confirmar">
      {q.includes('time') && draft.timeOptions && (
        <div>
          <p className="mb-2 text-[14px] font-medium">Qual horário?</p>
          <div className="flex flex-wrap gap-2">
            {draft.timeOptions.map((t) => (
              <button key={t} type="button" className={chip()} onClick={() => onAnswer(answerCapture(draft, { time: t }))}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
      {q.includes('date') && (
        <div>
          <p className="mb-2 text-[14px] font-medium">Qual dia?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip()} onClick={() => onAnswer(answerCapture(draft, { date: today }))}>
              Hoje
            </button>
            <button type="button" className={chip()} onClick={() => onAnswer(answerCapture(draft, { date: addDaysToDate(today, 1) }))}>
              Amanhã
            </button>
            <input type="date" aria-label="Outro dia" min={today} className="h-9 rounded-full border border-line bg-surface px-3 text-[14px] text-soft" onChange={(e) => e.target.value && onAnswer(answerCapture(draft, { date: e.target.value }))} />
          </div>
        </div>
      )}
      {q.includes('weekday') && (
        <div>
          <p className="mb-2 text-[14px] font-medium">Em que dia da semana?</p>
          <div className="flex flex-wrap gap-1.5">
            {WEEK.map((w) => (
              <button key={w.d} type="button" className={chip()} onClick={() => onAnswer(answerCapture(draft, { weekday: w.d }))}>
                {w.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {q.includes('monthDay') && (
        <div>
          <p className="mb-2 text-[14px] font-medium">Em que dia do mês?</p>
          <div className="flex gap-2">
            <TextInput inputMode="numeric" aria-label="Dia do mês" placeholder="Ex.: 5" value={monthDay} onChange={(e) => setMonthDay(e.target.value.replace(/\D/g, '').slice(0, 2))} className="h-10! max-w-24" />
            <Button variant="secondary" disabled={!(Number(monthDay) >= 1 && Number(monthDay) <= 31)} onClick={() => onAnswer(answerCapture(draft, { monthDay: Number(monthDay) }))}>
              Ok
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * One line to write (or say) the whole thing. `onDraft` gets the result once nothing important is missing.
 * `submitLabel`: "Preencher" inside a form, "Entender" in the create sheet.
 */
export function SmartField({ onDraft, submitLabel = 'Entender', placeholder, autoFocus }: { onDraft(d: CaptureDraft): void; submitLabel?: string; placeholder?: string; autoFocus?: boolean }) {
  const { settings } = useStore()
  const today = useToday(zoneOf(settings))
  const [text, setText] = useState('')
  const [pending, setPending] = useState<CaptureDraft | null>(null)
  const speech = useSpeech(setText)
  const done = (d: CaptureDraft) => {
    if (captureQuestions(d).length) setPending(d)
    else {
      setPending(null)
      onDraft(d)
    }
  }
  const read = () => text.trim() && done(parseCapture(text, today))
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <TextInput
            aria-label="Escreva em uma frase"
            placeholder={placeholder ?? 'Ex.: Dentista amanhã às 15h'}
            value={text}
            autoFocus={autoFocus}
            enterKeyHint="go"
            onChange={(e) => {
              setText(e.target.value)
              setPending(null)
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
          {submitLabel}
        </Button>
      </div>
      {speech.listening && <p className="px-1 text-[13px] font-medium text-accent-hi">Ouvindo… fale naturalmente.</p>}
      {speech.error && <p className="px-1 text-[13px] text-warn">{speech.error}</p>}
      {pending && <Questions draft={pending} today={today} onAnswer={done} />}
    </div>
  )
}

/** Inside a form (Novo hábito, Novo recorrente): a quiet "Escrever em uma frase" that fills the fields below. */
export function SmartLine({ onDraft, placeholder }: { onDraft(d: CaptureDraft): void; placeholder: string }) {
  const [open, setOpen] = useState(false)
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-accent/[0.1] px-3.5 text-[14px] font-medium text-accent-hi hover:bg-accent/[0.16]">
        <Sparkles size={16} /> Escrever em uma frase
      </button>
    )
  return (
    <SmartField
      submitLabel="Preencher"
      placeholder={placeholder}
      autoFocus
      onDraft={(d) => {
        onDraft(d)
        setOpen(false)
      }}
    />
  )
}

/** Small disclosure for the less used fields of a form ("Mais opções"). */
export function MoreOptions({ children, label = 'Mais opções', defaultOpen = false }: { children: ReactNode; label?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 py-1 text-[14px] font-medium text-soft hover:text-ink">
        {label}
        <ChevronDown size={16} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="mt-4 space-y-5">{children}</div>}
    </div>
  )
}
