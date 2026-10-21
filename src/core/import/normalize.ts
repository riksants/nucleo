/**
 * Bank descriptions, made comparable. "CARREFOUR 1234 DUBAI", "CARREFOUR UAE 0192" and "POS CARREFOUR"
 * all become the merchant "carrefour": codes, terminal numbers, card words, ids and symbols are left
 * out; the original text is always kept on the movement (`bank.raw`).
 */

/** Without accents, lower case, single spaces. */
export function plain(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Words that say how the money moved, not who it was with (pt / es / en). */
const NOISE = new Set(
  (
    'pos tpv compra compras compra-en pago pagos pagamento pagto pag pgto purchase card tarjeta tarj cartao cartão visa mastercard maestro mc amex debit debito credito credit ' +
    'contactless applepay apple googlepay gpay pay transaccion transacao transaction trx txn ref referencia reference recibo adeudo cargo abono ' +
    'transferencia transfer transf trf ted doc pix bizum sepa inst instantanea instant recebido recebida enviado enviada received sent ' +
    'de da do das dos del la las el los en para por a e y o the to from at in on of com sa sl slu ltd llc inc bv gmbh ltda me eireli plc co ' +
    'www http https net org online int intl nacional internacional fecha data op oper operacion operacao comercio comerc est estab ' +
    'eur usd brl aed gbp chf' +
    ' uae ae es esp spain espana br bra brasil brazil pt prt uk gb us usa'
  ).split(' '),
)

/** First words that name a kind of place, not the place: "restaurante x" keeps two words. */
const GENERIC = new Set('restaurante restaurant rest bar cafe cafeteria supermercado super supermarket mercado farmacia pharmacy hotel loja tienda shop store posto gasolinera padaria panaderia'.split(' '))

/** Meaningful words of a description, in order. */
export function significantTokens(s: string): string[] {
  return plain(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2 && !/\d/.test(t) && !NOISE.has(t))
}

/** The comparable form of a description ("carrefour dubai"). Empty when nothing meaningful is left. */
export function normDescription(s: string): string {
  return significantTokens(s).join(' ')
}

/** Who the money was with, as one key ("carrefour", "restaurante tio"). Used to learn categories. */
export function merchantKey(s: string): string {
  const t = significantTokens(s).filter((x) => x.length >= 3 || /^[a-z]{2}$/.test(x))
  if (!t.length) return ''
  return GENERIC.has(t[0]) && t[1] ? `${t[0]} ${t[1]}` : t[0]
}

/** A cleaner text for the movement: single spaces; "MERCADONA VALENCIA" → "Mercadona Valencia". */
export function prettyDescription(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim()
  if (!one) return ''
  const letters = one.replace(/[^\p{L}]/gu, '')
  if (letters.length < 3 || letters !== letters.toUpperCase()) return one
  return one
    .toLowerCase()
    .split(' ')
    .map((w) => (/\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/** Do two descriptions name the same thing? Shared meaningful word, or one name inside the other. */
export function textsMatch(a: string, b: string): boolean {
  const ta = significantTokens(a).filter((t) => t.length >= 3)
  const tb = new Set(significantTokens(b).filter((t) => t.length >= 3))
  if (ta.some((t) => tb.has(t))) return true
  const ca = ta.join('')
  const cb = [...tb].join('')
  if (ca.length >= 5 && cb.length >= 5) return ca.includes(cb) || cb.includes(ca)
  return false
}

/** Share of words in common (0–1). */
export function similarity(a: string, b: string): number {
  const ta = new Set(significantTokens(a))
  const tb = new Set(significantTokens(b))
  if (!ta.size || !tb.size) return 0
  let common = 0
  for (const t of ta) if (tb.has(t)) common++
  return common / (ta.size + tb.size - common)
}
