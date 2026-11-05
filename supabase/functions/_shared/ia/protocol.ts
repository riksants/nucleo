/**
 * NÚCLEO IA — what the app and the `nucleo-ia` function exchange. Validated on both sides.
 * The user is NEVER part of the body: the server takes it from the verified login.
 */
import { z } from 'zod'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const CONSENT_VERSION = 2
export const HISTORY_TURNS = 6

export const StartRequest = z.object({
  kind: z.literal('start'),
  /** Turn id, made by the app; unique per question. */
  turnId: z.string().regex(/^[A-Za-z0-9_-]{8,48}$/),
  text: z.string().trim().min(1).max(600),
  today: day,
  timeZone: z.string().min(1).max(64),
  /** "Analisar a fundo". */
  deep: z.boolean(),
  consentVersion: z.literal(CONSENT_VERSION),
  /** Last exchanges, compact (answers with facts already as plain values). */
  history: z.array(z.object({ q: z.string().max(600), a: z.string().max(900) })).max(HISTORY_TURNS),
  /** One line with older topics. */
  topics: z.string().max(400),
  /** Recent lookups (tool + arguments) — what is "in focus". */
  focus: z.array(z.object({ tool: z.string().max(40), args: z.record(z.string(), z.unknown()), about: z.array(z.string().max(80)).max(5).optional() })).max(8),
  /** Areas the person turned off for the AI (or whose section is off). */
  areasOff: z.array(z.string().max(20)).max(20),
  /** Etapa 5: long-term reminders the person confirmed (only when on). Optional for older apps. */
  memory: z.array(z.string().max(200)).max(20).optional(),
  /** Lookups the app already ran for this question (same functions and areas as the model's): one call less. */
  prefetch: z.array(z.object({ tool: z.string().max(40), args: z.record(z.string(), z.unknown()), content: z.string().max(12_000) })).max(2).optional(),
})
export type StartRequest = z.infer<typeof StartRequest>

export const ContinueRequest = z.object({
  kind: z.literal('continue'),
  envelope: z.string().min(10).max(600_000),
  results: z
    .array(z.object({ id: z.string().max(80), content: z.string().max(12_000), isError: z.boolean() }))
    .min(1)
    .max(6),
})
export type ContinueRequest = z.infer<typeof ContinueRequest>

export const TurnRequest = z.discriminatedUnion('kind', [StartRequest, ContinueRequest])
export type TurnRequest = z.infer<typeof TurnRequest>

export type StopReason = 'end' | 'refusal' | 'max_tokens' | 'steps' | 'request-limit'

export type TurnResponse =
  | { kind: 'tools'; calls: { id: string; name: string; input: Record<string, unknown> }[]; envelope: string; route: string; model: string }
  | { kind: 'answer'; text: string; route: string; model: string; costMicros: number; steps: number; stop: StopReason }

export type ErrorCode = 'auth' | 'input' | 'consent' | 'turn' | 'busy' | 'duplicate' | 'limit' | 'global-limit' | 'paused' | 'no-plan' | 'not-configured' | 'upstream'
export interface TurnError {
  error: ErrorCode
  message: string
}
