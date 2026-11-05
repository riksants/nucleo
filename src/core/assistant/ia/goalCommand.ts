/**
 * "Cria uma meta…" — recognized by the APP (deterministic, no AI, no cost) when the sentence is a
 * creation command. The type of goal decides what happens:
 *
 * - money goal (juntar, guardar, economizar, viagem, comprar…): the SAME editable preview as the AI's
 *   actions (Etapa 3 plan, `criar_meta_financeira`): nothing is saved until the person confirms;
 * - sales goal (vender, vendas, faturar…): the app has no sales goal with automatic tracking — the answer
 *   says so and points to Vendas; NEVER turned into a money goal (that is money saved, another thing);
 * - weekly goal (treinos, tarefas, hábitos "da semana"): created on the Semana screen, where the metric
 *   is chosen — the answer points there.
 *
 * Anything it cannot read with certainty returns null and the usual path (local commands / AI) goes on.
 */
import { FactBook } from '../../../../supabase/functions/_shared/ia/facts.ts'
import type { DataState, Settings } from '../../../data/types'
import { formatMoney } from '../../../lib/money'
import type { Area } from '../../../../supabase/functions/_shared/ia/tools.ts'
import type { Plan } from './actions/plan'
import { runActionsTool } from './actions/tool'
import { questionDates, questionFacts } from './calc'

const CREATE = /\b(cri[ae]r?|crie|adicion[ae]r?|monte|montar|abr[ae]|abrir|cadastr[ae]r?|nova|novo)\b[^.?!]*\bmeta\b|\bmeta\b[^.?!]*\b(nova|criar)\b|\bquero (criar|fazer|abrir|montar) (uma )?meta\b/
const SALES = /\bvend(a|as|er|o|endo)\b|\bfatur(ar|amento|o)\b|\breceita (de|com) vendas\b/
const WEEK = /\bmeta(s)? da semana\b|\bpor semana\b.*\b(treino|tarefa|h[aá]bito|estudo)|\b(treinos?|tarefas?|h[aá]bitos?|estudo|exerc[ií]cios?)\b/

export type GoalCommand =
  | { kind: 'finance'; lines: string[]; plan: Plan }
  | { kind: 'unsupported'; lines: string[]; link: { label: string; path: string } }
  | { kind: 'ask'; lines: string[] }

const MONTH_END = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`

/** "para a viagem" → "Viagem"; otherwise a name from the amount. */
function titleOf(q: string, amount: string): string {
  const m = q.match(/\b(?:para|pra|de|da|do)\s+(?:a |o |uma |um |minha |meu )?((?:viagem|carro|casa|apartamento|reserva de emerg[eê]ncia|reserva|casamento|interc[aâ]mbio|faculdade|curso|notebook|celular|moto|reforma|f[eé]rias|aposentadoria|entrada)(?:\s+(?:para|pra|de|do|da|a|o)\s+[a-zà-ú]+)?)/i)
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return `Juntar ${amount}`
}

export function goalCommand(question: string, ctx: { data: DataState; settings: Settings; now: Date; today: string; areasOff: Area[]; uid: string; planId: string }): GoalCommand | null {
  const q = question.toLowerCase()
  if (!CREATE.test(q)) return null
  if (SALES.test(q))
    return {
      kind: 'unsupported',
      lines: ['O Núcleo ainda não tem meta de vendas com acompanhamento automático, então não vou criar outra coisa no lugar.', 'Você acompanha o total vendido e o que falta receber em Vendas.'],
      link: { label: 'Abrir Vendas', path: '/sales' },
    }
  const book = new FactBook()
  questionFacts(question, book, ctx.settings)
  const money = [...book.all.values()].filter((f) => f.kind === 'dinheiro' && f.amount)
  if (WEEK.test(q) && !money.length)
    return { kind: 'unsupported', lines: ['Metas da semana (treinos, tarefas, hábitos…) são criadas em Semana, onde você escolhe a métrica e o alvo.'], link: { label: 'Abrir Semana', path: '/week' } }
  if (money.length > 1) return null // several amounts: the AI asks which one
  if (!money.length) return { kind: 'ask', lines: ['Qual é o valor da meta? Por exemplo: “cria uma meta de juntar R$ 20 mil até julho de 2027”.'] }

  const dates = new FactBook()
  questionDates(question, dates, ctx.today)
  const when = [...dates.all.values()]
  if (when.length > 1) return null
  let deadline: string | null = null
  if (when[0]?.month) {
    const [y, m] = when[0].month.split('-').map(Number)
    deadline = MONTH_END(y, m)
  } else if (when[0]) {
    const d = when[0].display.match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/)
    if (d) {
      let y = d[3] ? Number(d[3]) : Number(ctx.today.slice(0, 4))
      if (!d[3] && `${y}-${d[2]}-${d[1]}` <= ctx.today) y += 1
      deadline = `${y}-${d[2]}-${d[1]}`
    }
  }
  if (deadline && deadline <= ctx.today) deadline = null

  const { cents, currency } = money[0].amount!
  const title = titleOf(question, formatMoney(cents, currency))
  const nul = { pessoa: null, alvo: null, hora: null, hora_fim: null, categoria: null, observacao: null, ja_recebido_ou_pago: null, entrada_recebida: null, parcelas: null, primeira_parcela: null, intervalo_parcelas: null, sentido: null, lembrete_minutos: null }
  const r = runActionsTool(
    { resumo: `Nova meta: ${title}`, acoes: [{ ref: 'a1', tipo: 'criar_meta_financeira', depende_de: [], titulo: title, valor: cents / 100, moeda: currency, data: deadline, ...nul }] },
    { data: ctx.data, settings: ctx.settings, now: ctx.now, areasOff: ctx.areasOff, uid: ctx.uid, planId: ctx.planId },
  )
  if (!r.plan) return null
  return { kind: 'finance', plan: r.plan, lines: [deadline ? 'Preparei a meta. Confira, ajuste se quiser e confirme.' : 'Preparei a meta. Falta o prazo: escolha uma data na prévia e confirme.'] }
}
