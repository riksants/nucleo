/**
 * What a short captured text probably is ("Comprar arroz amanhã" → item de compras ou tarefa; "Pagar internet dia 10"
 * → lembrete/conta; "Ideia para um novo site" → anotação ou projeto). Local word rules + the Assistente's date reader:
 * no AI, nothing executed — these are only suggestions the person confirms in the usual form.
 */
import { readDate, readTime } from './assistant/intents'

export type SuggestionKind = 'shopping' | 'task' | 'event' | 'bill' | 'note' | 'project' | 'lifeProject' | 'objective'

export interface Suggestion {
  kind: SuggestionKind
  /** Short label for the button ("Tarefa · amanhã"). */
  label: string
  date?: string
  time?: string
  /** For bills that repeat ("todo dia 5"): the day of the month. */
  dayOfMonth?: number
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const has = (t: string, words: string[]) => words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(t))

const SHOP = ['comprar', 'compra', 'compras', 'mercado', 'supermercado', 'feira']
const PAY = ['pagar', 'paga', 'boleto', 'fatura', 'conta de', 'aluguel', 'internet', 'luz', 'agua', 'condominio', 'iptu', 'ipva', 'mensalidade', 'renovar', 'renovacao', 'vence', 'vencimento']
const MEET = ['reuniao', 'consulta', 'dentista', 'medico', 'medica', 'encontro', 'call', 'entrevista', 'aniversario', 'jantar com', 'almoco com', 'exame']
const IDEA = ['ideia', 'ideias', 'anotar', 'nota', 'lembrete', 'livro', 'filme', 'serie', 'receita', 'frase', 'link', 'referencia', 'inspiracao']
const WORK = ['site', 'app', 'aplicativo', 'cliente', 'projeto', 'landing', 'logo', 'marca', 'proposta', 'orcamento']
const LIFE = ['viagem', 'viajar', 'mudanca', 'mudar', 'reforma', 'casamento', 'curso', 'aprender', 'objetivo', 'meta', 'sonho']
const TODO = ['ligar', 'enviar', 'mandar', 'responder', 'fazer', 'terminar', 'finalizar', 'revisar', 'marcar', 'agendar', 'levar', 'buscar', 'resolver', 'lembrar', 'cancelar', 'renovar']

const DAY = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const when = (date: string | undefined, today: string) => {
  if (!date) return ''
  if (date === today) return ' · hoje'
  const t = new Date(`${today}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  if (date === t.toISOString().slice(0, 10)) return ' · amanhã'
  return ` · ${DAY.format(new Date(`${date}T12:00:00Z`)).replace('.', '')}`
}

/** Up to three suggestions, most likely first. `enabled` hides kinds whose section is off. */
export function suggestFor(text: string, today: string, enabled: (kind: SuggestionKind) => boolean = () => true): Suggestion[] {
  const t = fold(text)
  const date = readDate(t, today)?.date
  const time = readTime(t)?.time
  const repeats = /\b(todo|toda|todos|todas) (dia|mes|semana|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b|\bmensal\b/.test(t)
  const dayOfMonth = Number(t.match(/\bdia (\d{1,2})\b/)?.[1]) || undefined
  const out: Suggestion[] = []
  const push = (s: Suggestion) => !out.some((o) => o.kind === s.kind) && enabled(s.kind) && out.push(s)

  if (has(t, PAY)) {
    const bill = { kind: 'bill' as const, label: `Conta recorrente${dayOfMonth ? ` · todo dia ${dayOfMonth}` : ''}`, dayOfMonth }
    const remind = { kind: 'task' as const, label: `Lembrete${when(date, today)}`, date, time }
    // "todo dia 5" → a recurring bill first; a single date → a reminder first (the bill stays as an option).
    if (repeats) push(bill)
    push(remind)
    if (!repeats && dayOfMonth) push(bill)
  }
  if (has(t, SHOP)) {
    push({ kind: 'shopping', label: 'Lista de compras' })
    push({ kind: 'task', label: `Tarefa${when(date, today)}`, date, time })
  }
  if (has(t, MEET) || (time && !has(t, PAY))) push({ kind: 'event', label: `Compromisso${when(date, today)}${time ? ` · ${time}` : ''}`, date, time })
  if (has(t, IDEA) || /^(ideia|nota)\b/.test(t)) {
    push({ kind: 'note', label: 'Anotação' })
    if (has(t, WORK)) push({ kind: 'project', label: 'Projeto de trabalho' })
  }
  if (has(t, WORK) && !has(t, IDEA) && has(t, ['novo', 'nova', 'criar', 'fazer'])) push({ kind: 'project', label: 'Projeto de trabalho' })
  if (has(t, LIFE)) push({ kind: has(t, ['objetivo', 'meta', 'sonho', 'aprender']) ? 'objective' : 'lifeProject', label: has(t, ['objetivo', 'meta', 'sonho', 'aprender']) ? 'Objetivo' : 'Projeto pessoal' })
  if (has(t, TODO) || date) push({ kind: 'task', label: `Tarefa${when(date, today)}`, date, time })
  if (!out.length) push({ kind: 'task', label: 'Tarefa' })
  if (out.length < 2) push({ kind: 'note', label: 'Anotação' })
  return out.slice(0, 3)
}

/**
 * Lines of a note that look like something to do ("Lembrar de renovar o domínio dia 10", "Finalizar o site do
 * cliente"): each with its best suggestion (task or bill), so the person doesn't copy it to another section by hand.
 */
export function actionsInNote(body: string, today: string, enabled: (kind: SuggestionKind) => boolean = () => true): { line: string; suggestion: Suggestion }[] {
  const out: { line: string; suggestion: Suggestion }[] = []
  for (const raw of body.split('\n')) {
    const line = raw.replace(/^\s*(?:[-*•]\s*(?:\[[ xX]\]\s*)?)?/, '').trim()
    if (line.length < 6 || line.length > 160 || /^\s*[-*]\s*\[[xX]\]/.test(raw)) continue
    const t = fold(line)
    const actionable = has(t, TODO) || has(t, PAY) || !!readDate(t, today)
    if (!actionable) continue
    const s = suggestFor(line, today, enabled).find((x) => x.kind === 'task' || x.kind === 'bill' || x.kind === 'event')
    if (s) out.push({ line, suggestion: s })
    if (out.length >= 3) break
  }
  return out
}
