/**
 * NÚCLEO IA — what the usage panel shows. The AI is FREE for everyone (no trial, no subscription):
 * a daily limit that renews at midnight and a monthly one that renews on the 1st (Brasília time),
 * automatically and without any charge. Dollars only for the owner; everyone else sees percentages.
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
  /** When the daily and monthly limits renew (from the server). */
  dayResets: string | null
  periodResets: string | null
}

const ratio = (spent: number, cap: number) => (cap > 0 ? Math.min(1, Math.max(0, spent / cap)) : 1)

export const TIER_LABEL: Record<string, string> = { free: 'Grátis', owner: 'Dono do app', none: 'IA indisponível nesta conta' }

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
/** "1º de dezembro" — the first day of the next period, in Brasília time. */
export function renewLabel(iso: string | null): string {
  if (!iso) return 'no dia 1º'
  const d = new Date(Date.parse(iso) + 12 * 3_600_000) // noon after the renewal instant: always the right day
  const day = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric' }).format(d)
  const month = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', month: 'numeric' }).format(d)) - 1
  return `em ${day === '1' ? '1º' : day} de ${MONTHS[month]}`
}

export function usageView(u: UsageRow) {
  const day = ratio(u.spentDay, u.daily)
  const period = ratio(u.spentPeriod, u.period)
  const deep = ratio(u.spentSonnet, u.sonnetPeriod)
  const leftDay = u.daily - u.spentDay
  const leftPeriod = u.period - u.spentPeriod
  const left = Math.max(0, Math.min(leftDay, leftPeriod))
  const none = u.tier === 'none' || u.period <= 0
  const usd = (m: number) => `US$ ${(m / 1e6).toFixed(2).replace('.', ',')}`
  const monthRenew = renewLabel(u.periodResets)
  return {
    label: TIER_LABEL[u.tier] ?? u.tier,
    day,
    period,
    deep,
    questionsLeft: Math.floor(left / TYPICAL_QUESTION_MICROS),
    blocked: none || left <= 0,
    /** What to say when nothing is left (null while there is room). */
    blockedText: none
      ? 'A IA não está disponível para esta conta no momento. Os comandos do Assistente continuam funcionando.'
      : leftPeriod <= 0
        ? `O limite gratuito deste mês acabou. Ele volta sozinho ${monthRenew}, sem custo. Os comandos do Assistente continuam funcionando.`
        : leftDay <= 0
          ? 'O limite gratuito de hoje acabou. Ele volta sozinho à meia-noite, sem custo. Os comandos do Assistente continuam funcionando.'
          : null,
    renew: { day: 'Renova à meia-noite', period: `Renova ${monthRenew}` },
    warn: !none && (day >= WARN_AT || period >= WARN_AT),
    dollars: u.tier === 'owner' ? { day: `${usd(u.spentDay)} de ${usd(u.daily)}`, period: `${usd(u.spentPeriod)} de ${usd(u.period)}`, deep: `${usd(u.spentSonnet)} de ${usd(u.sonnetPeriod)}` } : null,
  }
}
