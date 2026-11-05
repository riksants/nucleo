/**
 * Voice with the device's own engines (no paid service): speech-to-text with the browser's recognizer
 * and text-to-speech with speechSynthesis. Where a device has none, `supported` is false and the
 * screens keep the keyboard (typing or the keyboard's own dictation) — voice is never the only way.
 * On iPhone (Safari) and Chrome the recognizer may use Apple's or Google's servers: said in the
 * privacy panel.
 */
import { useEffect, useRef, useState } from 'react'

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

/** The device has a speech recognizer (otherwise: keyboard only). */
export const speechSupported = () => recognitionClass() !== null

/**
 * Speech to text (pt-BR). `onText(text, final)`: interim text while speaking, then `final` once.
 * When the recognizer ends without a final result (iOS often does), the last text counts as final.
 */
export function useSpeech(onText: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const rec = useRef<Recognition | null>(null)
  const cb = useRef(onText)
  useEffect(() => {
    cb.current = onText
  })
  const supported = recognitionClass() !== null
  useEffect(() => () => rec.current?.abort(), [])
  const start = () => {
    const Rec = recognitionClass()
    if (!Rec || listening) return
    setError('')
    const r = new Rec()
    r.lang = 'pt-BR'
    r.interimResults = true
    r.continuous = false
    let last = ''
    let finished = false
    r.onresult = (e) => {
      const all = Array.from(e.results)
      last = all.map((x) => x[0]?.transcript ?? '').join(' ').replace(/\s+/g, ' ').trim()
      const final = all.length > 0 && all.every((x) => x.isFinal)
      if (final && last) finished = true
      cb.current(last, final && Boolean(last))
    }
    r.onerror = (e) => {
      finished = true
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Permita o uso do microfone para falar, ou digite.' : e.error === 'no-speech' ? 'Não ouvi nada. Tente de novo ou digite.' : e.error === 'aborted' ? '' : 'Não deu para ouvir agora. Você pode digitar.')
    }
    r.onend = () => {
      setListening(false)
      rec.current = null
      if (!finished && last) cb.current(last, true)
    }
    rec.current = r
    try {
      r.start()
      setListening(true)
    } catch {
      setListening(false)
      setError('Não deu para ouvir agora. Você pode digitar.')
    }
  }
  const stop = () => rec.current?.stop()
  /** Cancel: nothing is sent. */
  const cancel = () => {
    const r = rec.current
    if (!r) return
    r.onresult = null
    r.onend = () => setListening(false)
    r.abort()
  }
  return { supported, listening, error, start, stop, cancel }
}

/* ------------------------------------------------------------------ text to speech */

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'

function ptVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  return voices.find((v) => v.lang === 'pt-BR') ?? voices.find((v) => v.lang?.startsWith('pt')) ?? null
}

/** Reads a text aloud (must start from a tap on iPhone). Calls `onEnd` when done or stopped. */
export function speak(text: string, onEnd: () => void): void {
  if (!ttsSupported()) return onEnd()
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'pt-BR'
  const v = ptVoice()
  if (v) u.voice = v
  u.rate = 1.05
  u.onend = onEnd
  u.onerror = onEnd
  synth.speak(u)
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel()
}
