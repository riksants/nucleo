import type { Segment } from '../../../../supabase/functions/_shared/ia/facts.ts'
import { naturalDate } from './present'

/** What "Ouvir" reads: the answer as shown, saying when a value is a forecast or came from the person. */
export function spokenText(segments: Segment[]): string {
  return segments
    .map((s) => (s.t === 'text' ? s.s : s.t === 'fact' ? `${s.fact.kind === 'data' || s.fact.kind === 'compromisso' ? naturalDate(s.shown ?? s.fact.display) : (s.shown ?? s.fact.display)}${s.fact.seal === 'previsto' ? ' (previsão)' : s.fact.seal === 'informado' ? ' (valor que você informou)' : ''}` : 'valor não confirmado'))
    .join('')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

