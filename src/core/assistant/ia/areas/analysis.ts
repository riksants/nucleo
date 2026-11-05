/**
 * NÚCLEO IA — Etapa 4: analyses over the app's own numbers (core/finance, data/sales,
 * data/subscriptions, core/finance monthForecast). Nothing is recalculated here in a new way:
 * month totals come from totalsBetween, the forecast from monthForecast, what is owed from
 * installmentViews/saleRemaining/projectRemaining.
 *
 * Rules kept by construction:
 * - confirmed (registered) and forecast values are separate facts with different seals;
 * - only "saldo hoje" is money the person has; everything to come is `previsto`, with its base;
 * - currencies are never summed together (scenarios use the main currency only);
 * - every forecast returns its limitations, and too little history is said, not hidden.
 */
import { projectRemaining } from '../../../../data/receipts'
import { installmentViews, nextDue, overdueAmount, saleRemaining } from '../../../../data/sales'
import { balanceOf } from '../../../../data/selectors'
import { nextChargeOf } from '../../../../data/subscriptions'
import type { Currency } from '../../../../data/types'
import { factForModel } from '../../../../../supabase/functions/_shared/ia/facts.ts'
import { addMonthsTo, categoryRanking, financeIndex, monthBounds, monthForecast, monthOf, startDay, totalsBetween, FORECAST_MIN, type MoneyTotals } from '../../../finance'
import { categoryLabel, fixedCategoryIds } from '../../../financeCategories'
import { addDaysToDate, todayIn, zoneOf } from '../../../period'
import { categoryIdFor } from './finance'
import { absent, areaOn, byCurrency, countFact, dayLabel, err, monthLong, moneyFact, moduleOn, out, type LookupCtx, type LookupResult } from './shared'

/** Above / below the usual: more than this far from the average (app's reading, not the model's). */
export const USUAL_BAND = 0.1

const lanc = (k: number) => (k === 1 ? '1 lançamento' : `${k} lançamentos`)

function reading(now: number, avg: number): 'acima_do_normal' | 'abaixo_do_normal' | 'dentro_do_normal' | 'sem_base' {
  if (avg <= 0) return now > 0 ? 'acima_do_normal' : 'sem_base'
  if (now > avg * (1 + USUAL_BAND)) return 'acima_do_normal'
  if (now < avg * (1 - USUAL_BAND)) return 'abaixo_do_normal'
  return 'dentro_do_normal'
}

const pctFact = (ctx: LookupCtx, now: number, avg: number, label: string) =>
  avg > 0 ? factForModel(ctx.book.add({ kind: 'porcentagem', label, display: `${now >= avg ? '+' : '−'}${Math.round(Math.abs((now - avg) / avg) * 100)}%`, seal: 'confirmado' })) : null

/* ------------------------------------------------------------------ trend */

export function trendLookup(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const { data, settings, now, book } = ctx
  const base = settings.baseCurrency
  const tz = zoneOf(settings)
  const today = todayIn(tz, now)
  const want = typeof input.meses === 'number' && Number.isInteger(input.meses) ? Math.min(12, Math.max(2, input.meses)) : 6
  const catName = typeof input.categoria === 'string' && input.categoria.trim() ? input.categoria.trim().slice(0, 60) : null
  const cat = catName ? categoryIdFor(catName, ctx) : null
  if (catName && !cat) return err(`Categoria "${catName}" não encontrada.`)

  const index = financeIndex(data.transactions, settings)
  const started = startDay(settings)
  const current = monthOf(today)
  // complete months only, and only months fully inside the time the app was in use
  const months: string[] = []
  for (let i = want; i >= 1; i--) {
    const m = addMonthsTo(current, -i)
    if (monthBounds(m).from >= started) months.push(m)
  }
  const pick = (t: MoneyTotals) => (cat ? (t.byCategory[cat.id] ?? 0) : t.expense)
  const what = cat ? `Gasto com ${cat.label}` : 'Saídas'

  const perMonth = months.map((m) => {
    const b = monthBounds(m)
    return { m, t: totalsBetween(index, b.from, b.to) }
  })
  const limitacoes = [
    'Valores na moeda principal; movimentos em outras moedas entram pela cotação do dia em que foram lançados.',
    'Transferências entre contas próprias e ajustes de saldo não contam.',
    `Só entram meses completos desde que você começou a usar o app (${months.length} de ${want} pedidos).`,
  ]
  const mes_a_mes = perMonth.map(({ m, t }) => ({
    mes: monthLong(m),
    ...(cat
      ? { gasto: moneyFact(book, pick(t), base, `${what} em ${monthLong(m)}`, pick(t) ? 'confirmado' : 'ausente') }
      : {
          entradas: moneyFact(book, t.income, base, `Entradas em ${monthLong(m)}`, t.income ? 'confirmado' : 'ausente'),
          saidas: moneyFact(book, t.expense, base, `Saídas em ${monthLong(m)}`, t.expense ? 'confirmado' : 'ausente', lanc(t.expenseCount)),
          resultado: moneyFact(book, t.net, base, `Resultado de ${monthLong(m)} (entradas menos saídas)`),
        }),
  }))

  if (perMonth.length < 2) {
    return out(
      {
        dados_insuficientes: true,
        fatos: [absent(book, `Média de ${what.toLowerCase()} por mês`, 'histórico insuficiente: menos de 2 meses completos')],
        mes_a_mes,
        limitacoes: [...limitacoes, 'Sem pelo menos 2 meses completos não dá para dizer o que é normal: não tire conclusões de tendência.'],
      },
      [cat?.label ?? 'finanças'],
    )
  }

  const n = perMonth.length
  const used = `média de ${n} meses completos (${perMonth.map(({ m }) => monthLong(m)).join(', ')})`
  const avg = Math.round(perMonth.reduce((s, x) => s + pick(x.t), 0) / n)
  const avgIncome = Math.round(perMonth.reduce((s, x) => s + x.t.income, 0) / n)
  const media = {
    [cat ? 'gasto_medio' : 'saidas_medias']: moneyFact(book, avg, base, `${what}: média por mês`, avg ? 'confirmado' : 'ausente', used),
    ...(cat ? {} : { entradas_medias: moneyFact(book, avgIncome, base, 'Entradas: média por mês', avgIncome ? 'confirmado' : 'ausente', used) }),
  }

  // The current month, compared with the SAME days of the complete months (never a whole month).
  let mes_atual: Record<string, unknown> | null = null
  const cb = monthBounds(current)
  if (started <= cb.from) {
    const day = Number(today.slice(8, 10))
    const sameDays = perMonth.map(({ m }) => {
      const b = monthBounds(m)
      return totalsBetween(index, b.from, addDaysToDate(b.from, Math.min(day, b.days) - 1))
    })
    const nowT = totalsBetween(index, cb.from, today)
    const nowV = pick(nowT)
    const avgSame = Math.round(sameDays.reduce((s, t) => s + pick(t), 0) / n)
    const label = `${monthLong(current)} até hoje`
    mes_atual = {
      periodo: label,
      valor: moneyFact(book, nowV, base, `${what} em ${label}`, nowV ? 'confirmado' : 'ausente', cat ? undefined : lanc(nowT.expenseCount)),
      media_mesmos_dias: moneyFact(book, avgSame, base, `${what}: média dos mesmos dias (dia 1 ao ${day}) dos meses anteriores`, avgSame ? 'confirmado' : 'ausente', used),
      diferenca: moneyFact(book, nowV - avgSame, base, `${what}: ${label} menos a média dos mesmos dias`),
      ...(pctFact(ctx, nowV, avgSame, `${what}: variação sobre a média dos mesmos dias`) ? { variacao: pctFact(ctx, nowV, avgSame, `${what}: variação sobre a média dos mesmos dias`) } : {}),
      leitura_do_app: reading(nowV, avgSame),
    }
    limitacoes.push(`O mês atual está em andamento: a comparação usa só os mesmos dias (1 ao ${day}) dos meses anteriores, não o mês inteiro.`)

    if (!cat) {
      // categories that moved the most against their usual (same days), biggest absolute change first
      const ids = new Set([...Object.keys(nowT.byCategory), ...sameDays.flatMap((t) => Object.keys(t.byCategory))])
      const moves = [...ids]
        .map((id) => {
          const v = nowT.byCategory[id] ?? 0
          const a = Math.round(sameDays.reduce((s, t) => s + (t.byCategory[id] ?? 0), 0) / n)
          return { id, v, a, d: v - a }
        })
        .filter((x) => x.d !== 0)
        .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
      const show = (x: (typeof moves)[number]) => {
        const name = categoryLabel(settings, x.id || undefined)
        return {
          categoria: name,
          agora: moneyFact(book, x.v, base, `Gasto com ${name} em ${label}`, x.v ? 'confirmado' : 'ausente'),
          media_mesmos_dias: moneyFact(book, x.a, base, `Gasto com ${name}: média dos mesmos dias`, x.a ? 'confirmado' : 'ausente', used),
          diferenca: moneyFact(book, x.d, base, `Gasto com ${name}: diferença sobre a média dos mesmos dias`),
          ...(x.a === 0 ? { nova_neste_mes: true } : {}),
        }
      }
      mes_atual.categorias_que_mais_subiram = moves.filter((x) => x.d > 0).slice(0, 3).map(show)
      mes_atual.categorias_que_mais_cairam = moves.filter((x) => x.d < 0).slice(0, 3).map(show)
      if (!nowT.expenseCount) limitacoes.push('Ainda não há saídas registradas neste mês.')
    }
  }
  if (n < 3) limitacoes.push('Com só 2 meses de base, a média é instável: trate a comparação como indício, não como conclusão.')
  limitacoes.push(`"leitura_do_app" é acima/abaixo do normal quando passa ${Math.round(USUAL_BAND * 100)}% da média; dentro disso é normal.`)

  // the biggest categories of the complete months, for context ("onde vai o dinheiro")
  const totalAll = perMonth.reduce<Record<string, number>>((acc, { t }) => {
    for (const [k, v] of Object.entries(t.byCategory)) acc[k] = (acc[k] ?? 0) + v
    return acc
  }, {})
  const maiores_categorias = cat
    ? undefined
    : categoryRanking({ byCategory: totalAll })
        .slice(0, 5)
        .map((c) => ({ categoria: categoryLabel(settings, c.category || undefined), media_por_mes: moneyFact(book, Math.round(c.amount / n), base, `Gasto com ${categoryLabel(settings, c.category || undefined)}: média por mês`, 'confirmado', used) }))

  return out({ moeda_principal: base, categoria: cat?.label ?? null, media, mes_atual, mes_a_mes, maiores_categorias, limitacoes }, [cat?.label ?? 'finanças'])
}

/* ------------------------------------------------------------------ month forecast */

interface Due {
  quem: string
  cents: number
  currency: Currency
  day: string
}

export function forecastLookup(_input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const { data, settings, now, book } = ctx
  const base = settings.baseCurrency
  const tz = zoneOf(settings)
  const today = todayIn(tz, now)
  const month = monthOf(today)
  const { to } = monthBounds(month)
  const label = monthLong(month)
  const f = monthForecast(data, settings, now)
  const balance = balanceOf(settings, data.transactions)
  const limitacoes: string[] = [
    'Tudo aqui, exceto o saldo de hoje, é PREVISÃO: não é dinheiro recebido nem disponível.',
    'Entradas sem data marcada (salário, vendas novas, serviços avulsos) não são previstas.',
  ]

  // ---- money expected to come in (only what has a due date inside the month and is not paid)
  const comingIn: Due[] = []
  const late: Due[] = []
  const salesOn = moduleOn(ctx, 'sales') && areaOn(ctx, 'vendas')
  const subsOn = moduleOn(ctx, 'subscribers') && areaOn(ctx, 'vendas')
  const projectsOn = moduleOn(ctx, 'projects') && areaOn(ctx, 'clientes')
  if (salesOn) {
    for (const s of data.sales) {
      if (saleRemaining(s) <= 0) continue
      const who = s.clientName || data.clients.find((c) => c.id === s.clientId)?.name || 'venda'
      const od = overdueAmount(s, today)
      if (od > 0) late.push({ quem: who, cents: od, currency: s.currency, day: nextDue(s, today) })
      if (s.installments?.length) {
        for (const v of installmentViews(s, today)) if (v.state !== 'paid' && v.state !== 'overdue' && v.due >= today && v.due <= to) comingIn.push({ quem: who, cents: v.amount - v.paid, currency: s.currency, day: v.due })
      } else {
        const d = nextDue(s, today)
        if (d && d >= today && d <= to) comingIn.push({ quem: who, cents: saleRemaining(s), currency: s.currency, day: d })
      }
    }
  } else limitacoes.push('Vendas fora do alcance da IA (área desligada ou seção oculta): parcelas a receber não entram.')
  if (subsOn) {
    const plans = new Map(data.subPlans.map((p) => [p.id, p]))
    const anchor = new Date(`${today}T12:00:00Z`)
    const { from } = monthBounds(month)
    for (const s of data.subscribers) {
      if (s.status !== 'active') continue
      const plan = plans.get(s.planId)
      if (!plan) continue
      const paidThisMonth = s.payments.some((p) => p.date >= from && p.date <= to)
      // a charge of this month whose day passed without payment: late (out of the scenarios), never silently dropped
      if (!paidThisMonth && s.nextCharge >= from && s.nextCharge < today) {
        late.push({ quem: s.name, cents: plan.price, currency: plan.currency, day: s.nextCharge })
        continue
      }
      const next = nextChargeOf(s, plan, anchor)
      // already paid this month → the charge of this month is not counted again
      if (!next || next < today || next > to || paidThisMonth) continue
      comingIn.push({ quem: s.name, cents: plan.price, currency: plan.currency, day: next })
    }
    limitacoes.push('Assinantes em teste ou pausados não entram; quem já pagou neste mês não é contado de novo.')
  }
  const noDate = projectsOn ? data.projects.filter((p) => projectRemaining(p) > 0).map((p) => ({ cents: projectRemaining(p), currency: p.currency })) : []

  // ---- money expected to go out
  const bills = moduleOn(ctx, 'recurring') ? data.recurring.filter((r) => r.bill).length : 0
  if (bills) limitacoes.push('Contas recorrentes não têm valor cadastrado no app: não entram na previsão de saídas.')
  const index = financeIndex(data.transactions, settings)
  const prevMonth = addMonthsTo(month, -1)
  const pb = monthBounds(prevMonth)
  const nowT = totalsBetween(index, monthBounds(month).from, today)
  const prevT = startDay(settings) <= pb.from ? totalsBetween(index, pb.from, pb.to) : null
  const fixedNow = nowT.fixedExpense
  const fixedPrev = prevT ? prevT.fixedExpense : null
  // which fixed categories already appeared this month, and which appeared last month but not yet in this one
  const fixedIds = fixedCategoryIds(settings)
  const fixedLine = (id: string, cents: number, when: string) => ({ categoria: categoryLabel(settings, id || undefined), valor: moneyFact(book, cents, base, `${categoryLabel(settings, id || undefined)} (gasto fixo) ${when}`, 'confirmado') })
  const fixedThis = Object.entries(nowT.byCategory).filter(([id, v]) => fixedIds.has(id) && v > 0)
  const fixedMissing = prevT ? Object.entries(prevT.byCategory).filter(([id, v]) => fixedIds.has(id) && v > 0 && !(nowT.byCategory[id] > 0)) : []

  const entra_ate_o_fim_do_mes = {
    total_por_moeda: byCurrency(book, comingIn, `Previsto para entrar até o fim de ${label} (parcelas e cobranças com data, ainda não pagas)`, 'previsto', '/sales'),
    itens: comingIn
      .sort((a, b) => (a.day < b.day ? -1 : 1))
      .slice(0, 15)
      .map((d) => ({ de: d.quem, valor: moneyFact(book, d.cents, d.currency, `Previsto de ${d.quem} (ainda não recebido)`, 'previsto', 'parcela ou cobrança com data neste mês', '/sales'), dia: factForModel(book.add({ kind: 'data', label: `Vencimento previsto de ${d.quem}`, display: dayLabel(d.day), seal: 'previsto' })) })),
  }

  const payload: Record<string, unknown> = {
    moeda_principal: base,
    saldo_hoje: moneyFact(book, balance, base, 'Saldo hoje (dinheiro registrado no app)', 'confirmado'),
    entra_ate_o_fim_do_mes,
    vencido_e_nao_pago: late.length ? { total_por_moeda: byCurrency(book, late, 'Vencido e não pago A VOCÊ (dinheiro a receber que pode não entrar)', 'confirmado', '/sales'), observacao: 'É dinheiro que outras pessoas devem a você: já venceu e não foi pago, então fica FORA dos cenários. Se for pago, o saldo AUMENTA (nunca diminui).' } : 'nada vencido',
    a_receber_sem_data: noDate.length ? { total_por_moeda: byCurrency(book, noDate, 'A receber de projetos, sem data de pagamento', 'confirmado', '/projects'), observacao: 'Sem data: fica FORA dos cenários deste mês.' } : 'nada',
    gastos_fixos: {
      neste_mes_ate_hoje: moneyFact(book, fixedNow, base, `Gastos fixos lançados em ${label} até hoje`, fixedNow ? 'confirmado' : 'ausente'),
      ...(fixedPrev !== null ? { mes_passado: moneyFact(book, fixedPrev, base, `Gastos fixos lançados em ${monthLong(prevMonth)}`, fixedPrev ? 'confirmado' : 'ausente') } : {}),
      ja_lancados_neste_mes: fixedThis.map(([id, v]) => fixedLine(id, v, `lançado em ${label}`)),
      ...(prevT ? { do_mes_passado_ainda_nao_lancados_neste_mes: fixedMissing.map(([id, v]) => fixedLine(id, v, `lançado em ${monthLong(prevMonth)}, ainda não neste mês`)) } : {}),
      observacao: 'A previsão não projeta gastos fixos (aluguel, contas): se algum ainda não foi lançado neste mês, o saldo real tende a ficar menor que o previsto.',
    },
  }

  if (f.ready) {
    const inBase = comingIn.filter((d) => d.currency === base).reduce((s, d) => s + d.cents, 0)
    const pace = `média diária dos gastos variáveis deste mês × ${f.daysLeft} dia(s) restantes`
    payload.sai_ate_o_fim_do_mes = {
      media_diaria_de_gastos_variaveis: moneyFact(book, f.dailyVariable, base, 'Média diária dos gastos variáveis neste mês até hoje', 'confirmado'),
      gastos_variaveis_previstos: moneyFact(book, f.dailyVariable * f.daysLeft, base, 'Gastos variáveis previstos até o fim do mês', 'previsto', pace),
      cobrancas_de_ferramentas: moneyFact(book, f.upcoming, base, 'Cobranças de ferramentas previstas até o fim do mês', f.upcoming ? 'previsto' : 'ausente', `${f.upcomingCount} cobrança(s) na moeda principal`, '/tools'),
      ...(f.upcomingOther.length ? { cobrancas_em_outras_moedas: byCurrency(book, f.upcomingOther.map((o) => ({ cents: o.amount, currency: o.currency })), 'Cobranças de ferramentas em outra moeda até o fim do mês (não convertidas)', 'previsto', '/tools') } : {}),
    }
    payload.cenarios_fim_do_mes = {
      sem_contar_recebimentos: moneyFact(book, f.estimate, base, 'Saldo previsto no fim do mês SEM contar recebimentos', 'previsto', `saldo de hoje menos os gastos variáveis previstos (${pace}) e as cobranças de ferramentas`),
      ...(inBase
        ? { se_os_recebimentos_previstos_entrarem: moneyFact(book, f.estimate + inBase, base, `Saldo previsto no fim do mês SE as parcelas e cobranças previstas em ${base} forem pagas`, 'previsto', `cenário anterior mais o previsto para entrar em ${base}`) }
        : {}),
    }
    limitacoes.push('O ritmo de gastos usa só os dias já passados deste mês; um gasto grande e raro pode distorcer a previsão.')
    if (comingIn.some((d) => d.currency !== base) || f.upcomingOther.length) limitacoes.push('Valores em outras moedas aparecem separados e não entram nos cenários (sem conversão).')
  } else {
    payload.cenarios_fim_do_mes = absent(book, `Previsão de saldo no fim de ${label}`, 'ainda sem dados suficientes')
    limitacoes.push(`Sem previsão de saldo: o app precisa de pelo menos ${FORECAST_MIN.days} dias, ${FORECAST_MIN.expenses} saídas e ${FORECAST_MIN.expenseDays} dias com gasto neste mês (hoje: ${f.daysElapsed} dias, ${f.expenses} saídas).`)
  }
  payload.dias_ate_o_fim_do_mes = countFact(book, Math.round((Date.parse(to) - Date.parse(today)) / 86_400_000), 'Dias até o fim do mês', ['dia', 'dias'])
  payload.limitacoes = limitacoes
  return out(payload, [label])
}
