/**
 * NÚCLEO IA — Vendas e assinantes. Paid = the payment history (data/sales salePaid), owed =
 * saleRemaining, installments = installmentViews/overdueAmount/nextDue: the same functions the Vendas
 * screen uses. Received and still owed are always separate facts, and totals are per currency.
 */
import { buyerNameOf } from '../../../../data/receipts'
import { installmentViews, nextDue, overdueAmount, salePaid, saleRemaining, saleStatus, SALE_STATUS_LABEL } from '../../../../data/sales'
import { nextChargeOf, projectRevenue, SUBSCRIBER_STATUS_LABEL, INTERVAL_LABEL } from '../../../../data/subscriptions'
import { monthBounds, monthOf } from '../../../finance'
import { todayIn, zoneOf } from '../../../period'
import { absent, byCurrency, countFact, dateFact, err, has, isDay, moduleOn, moneyFact, monthLong, out, PAGE_SIZE, pageArg, textArg, type LookupCtx, type LookupResult } from './shared'

export function salesLookup(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const { data, settings, book, now } = ctx
  if (!moduleOn(ctx, 'sales')) return err('A seção Vendas está desligada.')
  const today = todayIn(zoneOf(settings), now)
  const nameOf = buyerNameOf(data.clients)
  const de = input.de == null ? null : input.de
  const ate = input.ate == null ? null : input.ate
  if ((de !== null && !isDay(de)) || (ate !== null && !isDay(ate))) return err('Datas inválidas: use AAAA-MM-DD ou null.')
  const who = textArg(input.cliente)
  const situacao = input.situacao === 'quitadas' ? 'paid' : input.situacao === 'em_aberto' ? 'open' : 'all'
  const page = pageArg(input.pagina)

  const inRange = (d: string) => (!de || d >= de) && (!ate || d <= ate)
  const list = data.sales
    .filter((s) => (!who || has(nameOf(s), who)) && inRange(s.date))
    .filter((s) => (situacao === 'paid' ? saleStatus(s) === 'paid' : situacao === 'open' ? saleRemaining(s) > 0 : true))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  const label = [situacao === 'paid' ? 'vendas quitadas' : situacao === 'open' ? 'vendas em aberto' : 'vendas', who ? `de ${who}` : '', de || ate ? 'no período pedido' : ''].filter(Boolean).join(' ')

  // Money that really arrived in the period (payment dates), over ALL sales — not only the ones sold in it.
  const received = de || ate ? data.sales.flatMap((s) => s.payments.filter((p) => inRange(p.date) && (!who || has(nameOf(s), who))).map((p) => ({ cents: p.amount, currency: s.currency }))) : []

  if (!list.length && !received.length) return out({ fatos: [absent(book, label, 'nenhuma venda encontrada')] }, [who ?? ''])
  const pageItems = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  return out(
    {
      filtro: label,
      quantidade: countFact(book, list.length, `Quantidade (${label})`, ['venda', 'vendas']),
      totais_por_moeda: {
        vendido: byCurrency(book, list.map((s) => ({ cents: s.total, currency: s.currency })), `Total vendido (${label})`, 'confirmado', '/sales'),
        ja_recebido: byCurrency(book, list.map((s) => ({ cents: salePaid(s), currency: s.currency })), `Já recebido dessas vendas (${label})`, 'confirmado', '/sales'),
        ainda_a_receber: byCurrency(book, list.map((s) => ({ cents: saleRemaining(s), currency: s.currency })), `Ainda a receber (${label})`, 'confirmado', '/sales'),
        vencido: byCurrency(book, list.map((s) => ({ cents: overdueAmount(s, today), currency: s.currency })), `Vencido e não pago (${label})`, 'confirmado', '/sales'),
        ...(received.length ? { recebido_no_periodo: byCurrency(book, received, `Recebido de vendas no período pedido${who ? ` (${who})` : ''}`, 'confirmado', '/sales') } : {}),
      },
      pagina: page,
      paginas: Math.max(1, Math.ceil(list.length / PAGE_SIZE)),
      vendas: pageItems.map((s) => {
        const views = installmentViews(s, today)
        const next = nextDue(s, today)
        return {
          comprador: nameOf(s) || 'Sem nome',
          produto: s.product || (s.items?.map((i) => i.name).join(', ') ?? ''),
          dia: dateFact(book, s.date, `Dia da venda para ${nameOf(s)}`),
          situacao: SALE_STATUS_LABEL[saleStatus(s)],
          total: moneyFact(book, s.total, s.currency, `Total da venda para ${nameOf(s)}`, 'confirmado', undefined, '/sales'),
          recebido: moneyFact(book, salePaid(s), s.currency, `Recebido da venda para ${nameOf(s)}`, salePaid(s) ? 'confirmado' : 'ausente', undefined, '/sales'),
          falta_receber: moneyFact(book, saleRemaining(s), s.currency, `Falta receber da venda para ${nameOf(s)}`, 'confirmado', undefined, '/sales'),
          ...(views.length ? { parcelas: `${views.filter((v) => v.state === 'paid').length} de ${views.length} pagas` } : {}),
          ...(overdueAmount(s, today) ? { vencido: moneyFact(book, overdueAmount(s, today), s.currency, `Vencido da venda para ${nameOf(s)}`, 'confirmado', undefined, '/sales') } : {}),
          ...(next && next < today ? { vencida_desde: dateFact(book, next, `Parcela/prazo vencido e não pago da venda para ${nameOf(s)} — vencido desde`, 'confirmado', true) } : {}),
          ...(next && next >= today ? { proximo_vencimento: dateFact(book, next, `Próximo vencimento da venda para ${nameOf(s)}`, 'confirmado', true) } : {}),
          ...(views.length ? { proxima_parcela_futura: views.find((v) => v.state !== 'paid' && v.due >= today) ? dateFact(book, views.find((v) => v.state !== 'paid' && v.due >= today)!.due, `Próxima parcela ainda não vencida da venda para ${nameOf(s)}`, 'confirmado', true) : 'nenhuma' } : {}),
          ...(s.recurring?.status === 'active' ? { recorrente: s.recurring.every === 'month' ? 'mensal' : s.recurring.every === 'week' ? 'semanal' : 'anual' } : {}),
        }
      }),
      observacoes: ['Recebido vem dos pagamentos registrados; falta receber = total menos recebido. Moedas nunca são somadas entre si.', 'Cada pagamento recebido já virou uma entrada no Financeiro: não some as duas coisas.'],
    },
    [...new Set(pageItems.map((s) => nameOf(s)))].slice(0, 5),
  )
}

export function subscribersLookup(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const { data, settings, book, now } = ctx
  if (!moduleOn(ctx, 'subscribers')) return err('A seção Assinantes está desligada.')
  const today = todayIn(zoneOf(settings), now)
  const month = monthOf(today)
  const { from, to } = monthBounds(month)
  const plans = new Map(data.subPlans.map((p) => [p.id, p]))
  const list = data.subscribers.filter((s) => (input.situacao === 'ativos' ? s.status === 'active' || s.status === 'trial' : true))
  if (!list.length) return out({ fatos: [absent(book, 'Assinantes', 'nenhum assinante')] })
  const anchor = new Date(`${today}T12:00:00Z`)
  return out(
    {
      quantidade: countFact(book, list.length, 'Assinantes', ['assinante', 'assinantes']),
      receita_prevista_por_moeda: projectRevenue(data.subscribers, data.subPlans).map((r) => ({
        moeda: r.currency,
        ativos: r.active,
        ...(r.monthlyPlans ? { planos_mensais: moneyFact(book, r.monthlyPlans, r.currency, `Planos mensais ativos (${r.currency})`, 'previsto', 'soma dos planos mensais dos assinantes ativos', '/subscribers') } : {}),
        no_ano: moneyFact(book, r.yearly, r.currency, `Receita prevista no ano (${r.currency})`, 'previsto', 'planos mensais × 12 + planos anuais', '/subscribers'),
      })),
      recebido_neste_mes: byCurrency(book, data.subscribers.flatMap((s) => s.payments.filter((p) => p.date >= from && p.date <= to).map((p) => ({ cents: p.amount, currency: p.currency }))), `Recebido de assinantes em ${monthLong(month)}`, 'confirmado', '/subscribers'),
      assinantes: list.slice(0, 40).map((s) => {
        const plan = plans.get(s.planId)
        const next = s.status === 'cancelled' ? '' : nextChargeOf(s, plan, anchor)
        const paidThisMonth = s.payments.some((p) => p.date >= from && p.date <= to)
        return {
          nome: s.name,
          situacao: SUBSCRIBER_STATUS_LABEL[s.status],
          plano: plan ? `${plan.name} (${INTERVAL_LABEL[plan.interval]})` : 'sem plano',
          ...(plan ? { valor: moneyFact(book, plan.price, plan.currency, `Valor do plano de ${s.name}`, 'confirmado', undefined, '/subscribers') } : {}),
          ...(next ? { proxima_cobranca: dateFact(book, next, `Próxima cobrança de ${s.name}`, 'previsto', true) } : {}),
          pagou_neste_mes: paidThisMonth ? 'sim' : 'não há pagamento registrado neste mês',
        }
      }),
      observacao: 'Assinantes são pessoas que pagam a você. Pagamento só conta quando registrado (ou com cobrança automática ligada).',
    },
    list.slice(0, 5).map((s) => s.name),
  )
}
