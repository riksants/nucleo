/**
 * NÚCLEO IA — lookups the APP already knows a question needs ("quanto gastei este mês?" needs the month
 * summary). They run here, on the device, with the same functions, privacy areas and facts as when the
 * model asks for them, and go with the question: the model answers in ONE call instead of two (one
 * round trip to the function and one model call less). Conservative on purpose: only finance, only when
 * the intent and the period are clear; anything else stays exactly as before (the model asks).
 */
import { fold } from './areas/shared'
import { SYNONYMS, categoryIdFor } from './areas/finance'
import type { LookupCtx } from './areas/shared'

export interface Prefetch {
  tool: 'resumo_financeiro' | 'previsao_do_mes' | 'tendencia_financeira'
  args: Record<string, unknown>
}

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const FINANCE = /\b(gastei|gastos?|gastando|despesas?|saidas?|entrou|entradas?|recebi|financas|financeiro|saldo|sobrou|economizei)\b/
/** Other areas: the model decides (sales, projects, goals, subscriptions, a specific movement…). */
const OTHER = /\b(vendas?|vendi|projetos?|clientes?|metas?|assinaturas?|assinantes?|ferramentas?|parcelas?|deve|devendo|transferencias?|quais|qual foi|lista|listar|maior|maiores|onde)\b/
const FORECAST = /\b(no azul|no vermelho|sobrar|vai sobrar|fechar o mes|vou fechar|posso gastar|da pra gastar|da para gastar|consigo gastar|fim do mes|previsao)\b/
const TREND = /\b(normal|media|tendencia|ultimos \d+ meses|ultimos meses|evolu\w*|vem subindo|vem caindo)\b/

const pad = (n: number) => String(n).padStart(2, '0')

/** The month the question is about: this month by default, "mês passado", or a named month. */
function monthOf(q: string, today: string): string | null {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  if (/\b(mes passado|mes anterior|ultimo mes)\b/.test(q) && !/\bcompar/.test(q)) return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`
  const named = [...q.matchAll(new RegExp(`\\b(${MONTHS.join('|')})(?:\\s+de\\s+(\\d{4}))?\\b`, 'g'))]
  if (named.length > 1) return null // two months: handled by twoMonths()
  if (named.length === 1) {
    const mm = MONTHS.indexOf(named[0][1]) + 1
    const yy = named[0][2] ? Number(named[0][2]) : mm > m ? y - 1 : y
    return `${yy}-${pad(mm)}`
  }
  return `${y}-${pad(m)}`
}

/** A category the person named, only when it is certain (a known synonym or a category's exact name). */
function categoryOf(q: string, ctx: Pick<LookupCtx, 'settings'>): string | null {
  for (const w of q.split(/[^a-z]+/).filter((x) => x.length >= 3)) {
    const c = categoryIdFor(w, ctx as LookupCtx)
    if (c && (SYNONYMS[w] || fold(c.label) === w)) return w
  }
  return null
}

/** "outubro comparado com setembro": both months, when exactly two are named (past or this month). */
function twoMonths(q: string, today: string): string[] | null {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const named = [...q.matchAll(new RegExp(`(?<![a-z])(${MONTHS.join('|')})(?:\\s+de\\s+(\\d{4}))?(?![a-z])`, 'g'))]
  if (named.length !== 2) return null
  const ids = named.map((n) => {
    const mm = MONTHS.indexOf(n[1]) + 1
    return `${n[2] ? Number(n[2]) : mm > m ? y - 1 : y}-${pad(mm)}`
  })
  return ids[0] !== ids[1] && ids.every((x) => x <= today.slice(0, 7)) ? ids : null
}

export function prefetchFor(question: string, today: string, ctx: Pick<LookupCtx, 'settings'>): Prefetch[] {
  const q = fold(question)
  if (OTHER.test(q)) return []
  if (FORECAST.test(q)) return [{ tool: 'previsao_do_mes', args: {} }]
  const cat = categoryOf(q, ctx)
  if (TREND.test(q)) return [{ tool: 'tendencia_financeira', args: { meses: 6, categoria: cat } }]
  if (!FINANCE.test(q) && !cat) return []
  const both = twoMonths(q, today)
  if (both) return both.map((referencia) => ({ tool: 'resumo_financeiro' as const, args: { periodo: 'mes', referencia, categoria: cat } }))
  const month = monthOf(q, today)
  if (!month || month > today.slice(0, 7)) return []
  const first: Prefetch = { tool: 'resumo_financeiro', args: { periodo: 'mes', referencia: month, categoria: cat } }
  // "este mês comparado com o mês passado": the previous month WHOLE too (the summary itself compares
  // only the same days), so the model has both and answers in one call
  if (/\b(compar\w*|mes passado|mes anterior|que no mes)\b/.test(q) && month === today.slice(0, 7)) {
    const y = Number(month.slice(0, 4))
    const m = Number(month.slice(5, 7))
    return [first, { tool: 'resumo_financeiro', args: { periodo: 'mes', referencia: m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`, categoria: cat } }]
  }
  return [first]
}
