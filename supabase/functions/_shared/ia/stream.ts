/**
 * NÚCLEO IA — progressive answers (Etapa 5). When the app asks with `Accept: application/x-ndjson`,
 * the function answers one JSON per line:
 *
 *   {"t":"r"}                      a model call starts (anything shown before is discarded)
 *   {"t":"d","s":"…"}              text written by the model so far (a piece)
 *   {"t":"end","status":200,"body":{…}}   the same body as the JSON answer (tools | answer | error)
 *
 * The pieces are RAW model text: the app never shows them as they are. It shows only complete
 * sentences, always passed through the guard (renderAnswer) with the facts of the turn — a value that
 * is not a fact is hidden exactly as in the final answer, and the final answer replaces the preview.
 */

export const STREAM_TYPE = 'application/x-ndjson'

export type StreamEvent = { t: 'r' } | { t: 'd'; s: string } | { t: 'end'; status: number; body: unknown }

export const encodeEvent = (e: StreamEvent): string => `${JSON.stringify(e)}\n`

/**
 * The part of a partial answer that is safe to show: up to the last COMPLETE sentence (". ", "! ",
 * "? " or a line break), never inside an open {fN} reference. Decimal points ("1.500") are not ends.
 */
export function stablePrefix(text: string): string {
  let cut = -1
  const re = /[.!?…](?=\s)|\n/g
  for (let m = re.exec(text); m; m = re.exec(text)) cut = m.index + 1
  if (cut <= 0) return ''
  const s = text.slice(0, cut)
  const open = s.lastIndexOf('{')
  return open > s.lastIndexOf('}') ? s.slice(0, open) : s
}

/** Reads an NDJSON body, calling `onEvent` per line. Resolves with the `end` event (or null). */
export async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (e: StreamEvent) => void): Promise<Extract<StreamEvent, { t: 'end' }> | null> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let end: Extract<StreamEvent, { t: 'end' }> | null = null
  const line = (l: string) => {
    if (!l.trim()) return
    let e: StreamEvent
    try {
      e = JSON.parse(l) as StreamEvent
    } catch {
      return
    }
    if (e.t === 'end') end = e
    else onEvent(e)
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl = buf.indexOf('\n')
    while (nl >= 0) {
      line(buf.slice(0, nl))
      buf = buf.slice(nl + 1)
      nl = buf.indexOf('\n')
    }
  }
  line(buf + dec.decode())
  return end
}
