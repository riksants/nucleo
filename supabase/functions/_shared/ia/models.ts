/**
 * NÚCLEO IA — models and prices, in ONE place.
 *
 * Verified on the official Anthropic docs (models/overview, pricing, prompt-caching, effort) on
 * 2026-11-01. Prices are US$ per million tokens; costs are kept in micro-dollars (1 US$ = 1e6).
 * Changing a model or a price = changing this table (and nothing else).
 */

export type ModelKey = 'haiku' | 'sonnet' | 'opus'
export type Effort = 'low' | 'medium' | 'high'

export interface ModelInfo {
  id: string
  /** US$ per million tokens. */
  input: number
  output: number
  cacheWrite5m: number
  cacheRead: number
  /** Haiku 5.5 only: above this many prompt tokens the request is billed at `longContext` prices. */
  longContextAbove?: number
  longContext?: { input: number; output: number; cacheWrite5m: number; cacheRead: number }
  /** Ceiling of output tokens (thinking included) for one call. */
  maxOutput: number
  /** Off = never routed to (Opus stays off until quality tests justify it). */
  enabled: boolean
}

export const MODELS: Record<ModelKey, ModelInfo> = {
  haiku: {
    id: 'claude-haiku-5-5',
    input: 0.1,
    output: 0.5,
    cacheWrite5m: 0.125,
    cacheRead: 0.01,
    longContextAbove: 100_000,
    longContext: { input: 0.5, output: 2.5, cacheWrite5m: 0.625, cacheRead: 0.05 },
    maxOutput: 2_000,
    enabled: true,
  },
  sonnet: { id: 'claude-sonnet-5-5', input: 2, output: 10, cacheWrite5m: 2.5, cacheRead: 0.1, maxOutput: 4_000, enabled: true },
  opus: { id: 'claude-opus-5-5', input: 4, output: 20, cacheWrite5m: 5, cacheRead: 0.2, maxOutput: 4_000, enabled: false },
}

/** Hard ceiling of input tokens in one call (keeps Haiku far below its long-context price band). */
export const MAX_INPUT_TOKENS = 20_000

export interface UsageLike {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/** Real cost of one call, in micro-dollars (rounded up: the budget never under-counts). */
export function costMicros(model: ModelKey, u: UsageLike): number {
  const m = MODELS[model]
  const write = u.cache_creation_input_tokens ?? 0
  const read = u.cache_read_input_tokens ?? 0
  const prompt = u.input_tokens + write + read
  const p = m.longContextAbove && m.longContext && prompt > m.longContextAbove ? m.longContext : m
  // tokens × (US$ / 1e6 tokens) × 1e6 micro = tokens × price
  return Math.ceil(u.input_tokens * p.input + write * p.cacheWrite5m + read * p.cacheRead + u.output_tokens * p.output)
}

/**
 * The most a call can cost, for the reservation made BEFORE it: every input token billed as a
 * cache write (the dearest input) and every allowed output token used.
 */
export function maxCallMicros(model: ModelKey, inputTokens: number, maxTokens: number): number {
  const m = MODELS[model]
  const p = m.longContextAbove && m.longContext && inputTokens > m.longContextAbove ? m.longContext : m
  return Math.ceil(inputTokens * Math.max(p.input, p.cacheWrite5m) + maxTokens * p.output)
}

/**
 * Largest `max_tokens` that keeps the call within `remainingMicros` (the per-question cap),
 * or 0 when not even a short answer fits.
 */
export function affordableMaxTokens(model: ModelKey, inputTokens: number, remainingMicros: number, minUseful = 400): number {
  const m = MODELS[model]
  const p = m.longContextAbove && m.longContext && inputTokens > m.longContextAbove ? m.longContext : m
  const left = remainingMicros - Math.ceil(inputTokens * Math.max(p.input, p.cacheWrite5m))
  const n = Math.min(m.maxOutput, Math.floor(left / p.output))
  return n >= minUseful ? n : 0
}

/**
 * Conservative token estimate of a request body before sending it (the real count comes back in
 * `usage`). The newer tokenizer gives ~30% more tokens; Portuguese JSON runs ~3 chars per token,
 * so 2.5 chars per token over-estimates on purpose.
 */
export const estimateTokens = (chars: number) => Math.ceil(chars / 2.5)

export const usd = (micros: number) => micros / 1_000_000
