/**
 * NÚCLEO IA — what the usage panel shows (Etapa 5). Pure: from ia_my_usage to percentages and an
 * estimate of questions left. Dollars only for the owner; everyone else sees percentages.
 */

/** Typical cost of one question (measured: Haiku ≈ US$ 0,002; a little margin). */
export const TYPICAL_QUESTION_MICROS = 2500
export const WARN_AT = 0.8

export interface UsageRow {
  tier: string
  validUntil: string | null
  spentDay: number
  daily: number
  spentPeriod: number
  period: number
  spentSonnet: number
  sonnetPeriod: number
}

const ratio = (spent: number, cap: number) => (cap > 0 ? Math.min(1, Math.max(0, spent / cap)) : 1)

export const TIER_LABEL: Record<string, string> = { trial: 'Teste grátis', subscriber: 'Assinatura', owner: 'Dono do app', none: 'Sem IA no plano' }

export function usageView(u: UsageRow, now = Date.now()) {
  const day = ratio(u.spentDay, u.daily)
  const period = ratio(u.spentPeriod, u.period)
  const deep = ratio(u.spentSonnet, u.sonnetPeriod)
  const left = Math.max(0, Math.min(u.daily - u.spentDay, u.period - u.spentPeriod))
  const daysLeft = u.validUntil ? Math.max(0, Math.ceil((Date.parse(u.validUntil) - now) / 86_400_000)) : null
  const usd = (m: number) => `US$ ${(m / 1e6).toFixed(2).replace('.', ',')}`
  return {
    label: TIER_LABEL[u.tier] ?? u.tier,
    day,
    period,
    deep,
    questionsLeft: Math.floor(left / TYPICAL_QUESTION_MICROS),
    daysLeft,
    blocked: u.tier === 'none' || left <= 0,
    warn: !(u.tier === 'none') && (day >= WARN_AT || period >= WARN_AT),
    dollars: u.tier === 'owner' ? { day: `${usd(u.spentDay)} de ${usd(u.daily)}`, period: `${usd(u.spentPeriod)} de ${usd(u.period)}`, deep: `${usd(u.spentSonnet)} de ${usd(u.sonnetPeriod)}` } : null,
  }
}
