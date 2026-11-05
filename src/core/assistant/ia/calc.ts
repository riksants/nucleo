/**
 * NÚCLEO IA — runs `calcular` in the app over the facts of this turn (exact integer cents).
 *
 * - only money facts with an exact amount; never `ausente` or `proposto` (preview) facts;
 * - never two currencies in one calculation;
 * - seal of the result: `previsto` if any input is a forecast, `informado` if any input is a value the
 *   person typed, otherwise `confirmado` (a calculation over registered values);
 * - "dividir" rounds UP to the cent (like the goals screen: saving that amount reaches the target).
 */
import { CALC_OPS, type CalcOp } from '../../../../supabase/functions/_shared/ia/calc.ts'
import { factForModel, type Fact, type FactBook } from '../../../../supabase/functions/_shared/ia/facts.ts'
import type { Settings } from '../../../data/types'
import { formatMoney } from '../../../lib/money'

export interface CalcResult {
  content: string
  isError: boolean
}

const fail = (erro: string): CalcResult => ({ content: JSON.stringify({ erro }), isError: true })
const SYMBOL: Record<CalcOp, string> = { soma: '+', diferenca: '−', porcentagem_de: 'como % de', variacao: 'variação sobre', dividir: '÷', multiplicar: '×' }
const MAX_CENTS = 1e13

interface Operand {
  cents: number
  currency: string
  seal: Fact['seal']
  label: string
}

/** The label the model gave, without numbers or currency signs (values only travel in facts). */
export function cleanLabel(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/[0-9%$€£]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) : ''
  return s.length >= 3 ? s : 'Resultado do cálculo'
}

export function runCalc(input: Record<string, unknown>, book: FactBook, settings: Pick<Settings, 'baseCurrency'>): CalcResult {
  const op = input.operacao as CalcOp
  if (!CALC_OPS.includes(op)) return fail('Operação inválida.')
  const ids = Array.isArray(input.fatos) ? input.fatos.filter((x): x is string => typeof x === 'string').map((x) => x.trim()) : []
  const need = op === 'soma' ? [2, 12] : op === 'dividir' || op === 'multiplicar' ? [1, 1] : [2, 2]
  if (ids.length < need[0] || ids.length > need[1]) return fail(op === 'soma' ? 'Soma precisa de 2 a 12 fatos.' : op === 'dividir' || op === 'multiplicar' ? 'Use exatamente 1 fato e o "numero".' : 'Use exatamente 2 fatos, na ordem da conta.')

  const operands: Operand[] = []
  let informed: Fact | null = null
  for (const id of ids) {
    if (id === 'informado') {
      const v = input.valor_informado
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) * 100 > MAX_CENTS) return fail('Faltou valor_informado (o valor que a pessoa disse).')
      const cur = typeof input.moeda_informada === 'string' && input.moeda_informada.trim() ? input.moeda_informada.trim().toUpperCase() : settings.baseCurrency
      if (!/^[A-Z]{3}$/.test(cur)) return fail('moeda_informada inválida: use um código como BRL, EUR ou USD.')
      const cents = Math.round(v * 100)
      operands.push({ cents, currency: cur, seal: 'informado', label: 'valor que você informou' })
      // the person's own amount becomes a fact too, so the answer can cite it ({fN}) instead of retyping it
      informed ??= book.add({ kind: 'dinheiro', label: 'Valor que você informou', display: formatMoney(cents, cur), seal: 'informado', amount: { cents, currency: cur } })
      continue
    }
    const f = book.all.get(id)
    if (!f) return fail(`O fato ${id} não existe nesta resposta: consulte de novo e use os ids devolvidos.`)
    if (f.kind !== 'dinheiro' || !f.amount) return fail(`O fato ${id} não é um valor em dinheiro calculável.`)
    if (f.seal === 'ausente') return fail(`O fato ${id} é "não encontrado": não entra em conta. Diga que o dado não existe.`)
    if (f.seal === 'proposto') return fail(`O fato ${id} é de uma prévia ainda não gravada: não entra em conta.`)
    operands.push({ cents: f.amount.cents, currency: f.amount.currency, seal: f.seal, label: f.label })
  }
  const currencies = new Set(operands.map((o) => o.currency))
  if (currencies.size > 1) return fail(`Moedas diferentes (${[...currencies].join(', ')}) não podem entrar na mesma conta. Faça uma conta por moeda.`)
  const currency = operands[0].currency

  let n: number | null = null
  if (op === 'dividir' || op === 'multiplicar') {
    if (typeof input.numero !== 'number' || !Number.isInteger(input.numero) || input.numero < 1 || input.numero > 600) return fail('"numero" precisa ser um inteiro de 1 a 600.')
    n = input.numero
  }

  const [a, b] = operands
  const seal: Fact['seal'] = operands.some((o) => o.seal === 'previsto') ? 'previsto' : operands.some((o) => o.seal === 'informado') ? 'informado' : 'confirmado'
  const expr = op === 'soma' ? operands.map((o) => o.label).join(' + ') : n !== null ? `${a.label} ${SYMBOL[op]} ${n}` : `${a.label} ${SYMBOL[op]} ${b.label}`
  const label = cleanLabel(input.rotulo)

  if (op === 'porcentagem_de' || op === 'variacao') {
    if (b.cents === 0) return fail('O segundo valor é zero: a porcentagem não existe.')
    const ratio = op === 'porcentagem_de' ? a.cents / b.cents : (a.cents - b.cents) / Math.abs(b.cents)
    const pct = Math.round(ratio * 1000) / 10
    const display = `${op === 'variacao' ? (pct > 0 ? '+' : pct < 0 ? '−' : '') : pct < 0 ? '−' : ''}${String(Math.abs(pct)).replace('.', ',')}%`
    const fact = book.add({ kind: 'porcentagem', label, display, seal, base: `cálculo do app: ${expr}` })
    return { content: JSON.stringify({ resultado: factForModel(fact), ...(informed ? { valor_informado: factForModel(informed) } : {}) }), isError: false }
  }

  let cents: number
  let note: string | undefined
  if (op === 'soma') cents = operands.reduce((s, o) => s + o.cents, 0)
  else if (op === 'diferenca') cents = a.cents - b.cents
  else if (op === 'multiplicar') cents = a.cents * n!
  else {
    cents = Math.sign(a.cents) * Math.ceil(Math.abs(a.cents) / n!)
    if (Math.abs(a.cents) % n! !== 0) note = 'arredondado para cima ao centavo'
  }
  if (Math.abs(cents) > MAX_CENTS) return fail('Resultado grande demais.')
  const fact = book.add({ kind: 'dinheiro', label, display: formatMoney(cents, currency), seal, base: `cálculo do app: ${expr}${note ? ` (${note})` : ''}`, amount: { cents, currency } })
  return {
    content: JSON.stringify({
      resultado: factForModel(fact),
      ...(informed ? { valor_informado: factForModel(informed) } : {}),
      ...(seal === 'previsto' ? { aviso: 'Resultado baseado em previsão: apresente como previsão, nunca como dinheiro recebido ou disponível.' } : {}),
      ...(seal === 'informado' ? { aviso: 'Resultado usa um valor que a pessoa informou (não registrado no app): deixe isso claro.' } : {}),
    }),
    isError: false,
  }
}

const AMOUNT = /(R\$|US\$|€|\$)?\s?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)(?:\s?(mil)\b)?(?:\s?(reais|real|euros?|d[oó]lares?)\b)?/gi

/**
 * Amounts the PERSON wrote in the question ("500 reais", "R$ 1.200", "10 mil") become `informado`
 * facts of the turn, used only to show the answer: when the model repeats the person's own number it
 * is shown as that (with the "você informou" seal), not hidden. Never a value of the app.
 */
export function questionFacts(text: string, book: FactBook, settings: Pick<Settings, 'baseCurrency'>): void {
  const seen = new Set<string>()
  for (const m of text.matchAll(AMOUNT)) {
    const [, sign, num, mil, word] = m
    if (!sign && !mil && !word) continue
    const w = (word ?? '').toLowerCase()
    const currency = sign === 'R$' || /^rea|^real/.test(w) ? 'BRL' : sign === '€' || w.startsWith('euro') ? 'EUR' : sign === 'US$' || sign === '$' || /^d[oó]lar/.test(w) ? 'USD' : settings.baseCurrency
    const value = Number(num.replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) continue
    const cents = Math.round(value * (mil ? 1000 : 1) * 100)
    if (cents > MAX_CENTS || seen.has(`${cents}${currency}`)) continue
    seen.add(`${cents}${currency}`)
    book.add({ kind: 'dinheiro', label: 'Valor que você informou', display: formatMoney(cents, currency), seal: 'informado', amount: { cents, currency } })
  }
}
