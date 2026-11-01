/**
 * NÚCLEO IA — Metas: money goals (core/financeGoals), weekly goals (core/weekGoals + metrics),
 * purchase goals and personal plans (core/plans). Reserving for a goal is never an expense.
 */
import { goalPlan } from '../../../financeGoals'
import { goalProgress } from '../../../weekGoals'
import { weekMetrics } from '../../../metrics'
import { planProgress, PLAN_STATUS_LABEL, KIND_LABEL as PLAN_KIND } from '../../../plans'
import { todayIn, weekStart, zoneOf } from '../../../period'
import { formatMoney } from '../../../../lib/money'
import { factForModel, type Fact } from '../../../../../supabase/functions/_shared/ia/facts.ts'
import { absent, dateFact, dayLabelYear, fold, moduleOn, out, type LookupCtx, type LookupResult } from './shared'

export function financeGoals(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const today = todayIn(zoneOf(ctx.settings), ctx.now)
  const q = typeof input.nome === 'string' ? fold(input.nome) : ''
  const list = (ctx.data.financeGoals ?? []).filter((g) => g.status === 'active' && (!q || fold(g.name).includes(q)))
  if (!list.length) {
    const f = ctx.book.add({ kind: 'texto', label: q ? `Meta “${input.nome}”` : 'Metas de dinheiro ativas', display: 'nenhuma encontrada', seal: 'ausente', open: { path: '/finance' } })
    return out({ fatos: [factForModel(f)] })
  }
  return out({
    metas: list.slice(0, 10).map((g) => {
      const p = goalPlan(g, today)
      const m = (cents: number, label: string, seal: Fact['seal'] = 'confirmado', base?: string) => factForModel(ctx.book.add({ kind: 'dinheiro', label, display: formatMoney(cents, g.currency), seal, base, open: { path: '/finance' } }))
      return {
        nome: g.name,
        alvo: m(g.target, `Alvo da meta “${g.name}”`),
        guardado: m(g.saved, `Guardado na meta “${g.name}”`),
        falta: m(p.missing, `Falta para a meta “${g.name}”`),
        progresso: factForModel(ctx.book.add({ kind: 'porcentagem', label: `Progresso da meta “${g.name}”`, display: `${p.percent}%`, seal: 'confirmado' })),
        prazo: factForModel(ctx.book.add({ kind: 'data', label: `Prazo da meta “${g.name}”`, display: dayLabelYear(g.deadline), seal: 'confirmado' })),
        dias_restantes: factForModel(ctx.book.add({ kind: 'contagem', label: `Dias até o prazo da meta “${g.name}”`, display: p.daysLeft === 1 ? '1 dia' : `${p.daysLeft} dias`, seal: 'confirmado' })),
        guardar_por_mes: p.perMonth != null ? m(p.perMonth, `Quanto guardar por mês para “${g.name}” chegar no prazo`, 'previsto', 'o que falta dividido pelos meses até o prazo') : null,
        guardar_por_semana: p.perWeek != null ? m(p.perWeek, `Quanto guardar por semana para “${g.name}” chegar no prazo`, 'previsto', 'o que falta dividido pelas semanas até o prazo') : null,
        no_ritmo: p.reached ? 'meta atingida' : p.due ? 'prazo encerrado' : p.onPace == null ? 'cedo demais para dizer' : p.onPace ? 'sim' : 'não',
        conta_no_saldo: Boolean(g.inBalance),
        guardar_todo_mes_automatico: Boolean(g.autoSave),
      }
    }),
    observacao: 'Reservar para uma meta não é uma saída de dinheiro: o valor continua no saldo como reservado.',
  }, list.map((g) => g.name))
}


/* ------------------------------------------------------------------ weekly goals, purchase goals, plans */

export function goalsAndPlans(_input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const { data, settings, book, now } = ctx
  const today = todayIn(zoneOf(settings), now)
  const week = weekStart(today)
  const pct = (n: number, label: string) => factForModel(book.add({ kind: 'porcentagem', label, display: `${n}%`, seal: 'confirmado' }))

  const weekly = moduleOn(ctx, 'week') || moduleOn(ctx, 'today') ? data.weeklyGoals.filter((g) => g.week === week && g.status !== 'archived') : []
  const metrics = weekly.length ? weekMetrics(data, settings, week, now) : null
  const purchase = moduleOn(ctx, 'goals') ? data.goals.filter((g) => !g.purchasedAt) : []
  const plans = moduleOn(ctx, 'life') ? data.lifePlans.filter((p) => p.status === 'active' || p.status === 'planning') : []
  if (!weekly.length && !purchase.length && !plans.length) return out({ fatos: [absent(book, 'Metas da semana, metas de compra e planos ativos', 'nenhum encontrado')] })

  return out(
    {
      metas_da_semana: weekly.map((g) => {
        const p = goalProgress(g, metrics)
        const val = (n: number) => (g.kind === 'money' ? formatMoney(n, settings.baseCurrency) : String(n))
        return {
          titulo: g.title,
          situacao: g.status === 'done' || p.achieved ? 'atingida' : 'em andamento',
          progresso: p.noData ? 'sem dados ainda nesta semana' : pct(p.percent, `Progresso da meta da semana “${g.title}”`),
          feito_e_alvo: p.noData ? null : factForModel(book.add({ kind: g.kind === 'money' ? 'dinheiro' : 'contagem', label: `Feito / alvo de “${g.title}”`, display: `${val(p.value)} de ${val(p.target)}`, seal: 'confirmado' })),
          calculado_pelo_app: p.auto,
        }
      }),
      metas_de_compra: purchase.slice(0, 15).map((g) => ({ nome: g.name, preco: factForModel(book.add({ kind: 'dinheiro', label: `Preço de “${g.name}”`, display: formatMoney(g.price, g.currency), seal: 'confirmado' })) })),
      planos: plans.slice(0, 15).map((p) => {
        const prog = planProgress(p, data.planSteps, data.tasks)
        const next = data.planSteps.filter((s) => s.planId === p.id && s.status !== 'done').sort((a, b) => a.order - b.order)[0]
        return {
          titulo: p.title,
          tipo: PLAN_KIND[p.kind]?.one ?? p.kind,
          situacao: PLAN_STATUS_LABEL[p.status] ?? p.status,
          ...(p.deadline ? { prazo: dateFact(book, p.deadline, `Prazo de “${p.title}”`, 'confirmado', true) } : {}),
          progresso: prog.percent == null ? 'sem etapas' : pct(prog.percent, `Progresso de “${p.title}”`),
          etapas: prog.source === 'steps' ? `${prog.done} de ${prog.total}` : null,
          proxima_etapa: next ? next.title : null,
        }
      }),
    },
    [...weekly.map((g) => g.title), ...plans.map((p) => p.title)],
  )
}
