/**
 * NÚCLEO IA — Finanças: month/week summary (core/finance), movements with filters and the bills and
 * subscriptions the person PAYS (tools + recurring bills). Amounts in the base currency are the app's
 * own `baseAmount` (fixed when the movement was made); original amounts keep their currency.
 */
import { categoryRanking, dayOfTransaction, financeIndex, monthBounds, monthForecast, monthOf, monthSummary, totalsBetween } from '../../../finance'
import { allCategories, categoryLabel } from '../../../financeCategories'
import { recurringState, nextRecurring } from '../../../habits'
import { addDaysToDate, todayIn, weekStart, zoneOf } from '../../../period'
import { isPaidTool, nextChargeDate } from '../../../../data/selectors'
import { formatMoney } from '../../../../lib/money'
import { factForModel, type Fact } from '../../../../../supabase/functions/_shared/ia/facts.ts'
import { absent, byCurrency, countFact, dateFact, dayLabel, err, fold, isDay, monthLong, moneyFact, moduleOn, out, PAGE_SIZE, pageArg, textArg, type LookupCtx, type LookupResult } from './shared'

/** How people say it → the app's default category id (used only if that category exists). */
const SYNONYMS: Record<string, string> = {
  mercado: 'food', supermercado: 'food', comida: 'food', restaurante: 'food', restaurantes: 'food', ifood: 'food', lanche: 'food', padaria: 'food',
  uber: 'transport', gasolina: 'transport', combustivel: 'transport', onibus: 'transport', metro: 'transport', taxi: 'transport',
  aluguel: 'housing', condominio: 'housing', casa: 'housing',
  luz: 'bills', agua: 'bills', internet: 'bills', telefone: 'bills', celular: 'bills',
  farmacia: 'health', remedio: 'health', medico: 'health', academia: 'health',
  roupa: 'shopping', roupas: 'shopping',
  curso: 'education', cursos: 'education', faculdade: 'education',
  streaming: 'subscriptions', netflix: 'subscriptions', spotify: 'subscriptions',
  viagens: 'travel', passagem: 'travel', passagens: 'travel', hotel: 'travel',
}

export function categoryIdFor(name: string, ctx: LookupCtx, type: 'in' | 'out' = 'out'): { id: string; label: string } | null {
  const q = fold(name)
  if (!q) return null
  const cats = allCategories(ctx.settings).filter((c) => c.type === type)
  const syn = SYNONYMS[q] ? cats.find((c) => c.id === SYNONYMS[q]) : undefined
  if (syn) return { id: syn.id, label: syn.label }
  const exact = cats.find((c) => fold(c.label) === q)
  if (exact) return { id: exact.id, label: exact.label }
  const part = cats.filter((c) => fold(c.label).includes(q) || q.includes(fold(c.label)))
  return part.length === 1 ? { id: part[0].id, label: part[0].label } : null
}

export function financeSummary(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const { settings, data, now, book } = ctx
  const base = settings.baseCurrency
  const tz = zoneOf(settings)
  const today = todayIn(tz, now)
  const money = (cents: number, label: string, seal: Fact['seal'], baseText?: string) => factForModel(book.add({ kind: 'dinheiro', label, display: formatMoney(cents, base), seal, base: baseText, open: { path: '/finance' }, amount: { cents, currency: base } }))
  const periodo = input.periodo
  const ref = String(input.referencia ?? '')
  let from: string
  let to: string
  let label: string
  let prev: { from: string; to: string; label: string } | null = null
  if (periodo === 'mes') {
    if (!/^\d{4}-\d{2}$/.test(ref)) return err('Referência do mês inválida: use AAAA-MM.')
    const b = monthBounds(ref)
    from = b.from
    to = ref === monthOf(today) ? today : b.to
    label = monthLong(ref)
  } else if (periodo === 'semana') {
    if (!isDay(ref)) return err('Referência da semana inválida: use AAAA-MM-DD.')
    from = weekStart(ref)
    const sunday = addDaysToDate(from, 6)
    to = sunday > today && from <= today ? today : sunday
    // relative names keep dates out of labels (dates only travel inside facts)
    const ago = Math.round((Date.parse(weekStart(today)) - Date.parse(from)) / (7 * 86_400_000))
    label = ago === 0 ? 'esta semana' : ago === 1 ? 'a semana passada' : ago > 1 ? `a semana de ${ago} semanas atrás` : 'uma semana futura'
  } else return err('Período inválido: use "mes" ou "semana".')
  if (from > today) return out({ periodo: label, aviso: 'Esse período ainda não começou.', fatos: [factForModel(book.add({ kind: 'texto', label: `Movimentações em ${label}`, display: 'nenhuma (período futuro)', seal: 'ausente' }))] })

  const cat = typeof input.categoria === 'string' && input.categoria.trim() ? categoryIdFor(input.categoria, ctx) : null
  if (typeof input.categoria === 'string' && input.categoria.trim() && !cat) {
    const names = allCategories(settings).filter((c) => c.type === 'out').map((c) => c.label)
    return err(`Categoria "${input.categoria}" não encontrada. Categorias de saída: ${names.join(', ')}.`)
  }

  const index = financeIndex(data.transactions, settings)
  const totals = totalsBetween(index, from, to)
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1
  // the same days of the previous period, for a fair comparison
  if (periodo === 'mes') {
    const pm = monthBounds(addMonth(ref, -1))
    const upto = Math.min(days, pm.days)
    prev = { from: pm.from, to: addDaysToDate(pm.from, upto - 1), label: `${monthLong(addMonth(ref, -1))}${to < monthBounds(ref).to ? ` (até o dia ${upto})` : ''}` }
  } else {
    prev = { from: addDaysToDate(from, -7), to: addDaysToDate(to, -7), label: 'os mesmos dias da semana anterior' }
  }
  const before = totalsBetween(index, prev.from, prev.to)

  // the movements behind the numbers (allowlist: reason, day, amount, category)
  const flows = data.transactions.filter((t) => t.type !== 'adjust' && !t.transfer)
  const inRange = flows.filter((t) => {
    const d = dayOfTransaction(t, tz)
    return d >= from && d <= to
  })
  const outs = inRange.filter((t) => t.type === 'out' && (!cat || (t.category ?? '') === cat.id))
  const top = [...outs].sort((a, b) => a.baseAmount - b.baseAmount).slice(0, 5)
  const n = (k: number) => (k === 1 ? '1 lançamento' : `${k} lançamentos`)

  const fatos: unknown[] = []
  let comparacao: unknown = null
  let totais: Record<string, unknown> | null = null
  if (cat) {
    const now$ = totals.byCategory[cat.id] ?? 0
    const was = before.byCategory[cat.id] ?? 0
    const prevCount = flows.filter((t) => {
      const d = dayOfTransaction(t, tz)
      return t.type === 'out' && (t.category ?? '') === cat.id && d >= prev!.from && d <= prev!.to
    }).length
    fatos.push(now$ ? money(now$, `Gasto com ${cat.label} em ${label}`, 'confirmado', n(outs.length)) : factForModel(book.add({ kind: 'dinheiro', label: `Gasto com ${cat.label} em ${label}`, display: formatMoney(0, base), seal: 'ausente', base: 'nenhum lançamento nessa categoria' })))
    if (was || now$) {
      comparacao = {
        periodo_anterior: prev.label,
        gasto_anterior: was ? money(was, `Gasto com ${cat.label} em ${prev.label}`, 'confirmado', n(prevCount)) : 'nenhum',
        diferenca: money(now$ - was, `Diferença de ${cat.label}: ${label} menos ${prev.label}`, 'confirmado'),
        ...(was > 0 ? { variacao: factForModel(book.add({ kind: 'porcentagem', label: `Variação de ${cat.label}`, display: `${now$ >= was ? '+' : '−'}${Math.round(Math.abs((now$ - was) / was) * 100)}%`, seal: 'confirmado' })) } : {}),
      }
    }
  } else {
    totais = {
      entradas: totals.income ? money(totals.income, `Entradas em ${label}`, 'confirmado') : factForModel(book.add({ kind: 'dinheiro', label: `Entradas em ${label}`, display: formatMoney(0, base), seal: 'ausente', base: 'nenhuma entrada registrada' })),
      saidas: totals.expense ? money(totals.expense, `Saídas em ${label}`, 'confirmado', n(totals.expenseCount)) : factForModel(book.add({ kind: 'dinheiro', label: `Saídas em ${label}`, display: formatMoney(0, base), seal: 'ausente', base: 'nenhuma saída registrada' })),
      resultado_entradas_menos_saidas: money(totals.income - totals.expense, `Resultado do período (entradas menos saídas — NÃO é o total de entradas) em ${label}`, 'confirmado'),
    }
    if (before.count) {
      comparacao = {
        periodo_anterior: prev.label,
        entradas_antes: money(before.income, `Entradas em ${prev.label}`, 'confirmado'),
        saidas_antes: money(before.expense, `Saídas em ${prev.label}`, 'confirmado'),
        diferenca_saidas: money(totals.expense - before.expense, `Diferença de saídas: ${label} menos ${prev.label}`, 'confirmado'),
      }
    }
  }

  const categorias = cat
    ? undefined
    : categoryRanking(totals)
        .slice(0, 8)
        .map((c) => ({ categoria: categoryLabel(settings, c.category || undefined), valor: money(c.amount, `Gasto com ${categoryLabel(settings, c.category || undefined)} em ${label}`, 'confirmado') }))
  const maiores = top.map((t) => ({
    descricao: t.reason || 'Sem descrição',
    dia: factForModel(book.add({ kind: 'data', label: `Dia de “${t.reason}”`, display: dayLabel(dayOfTransaction(t, tz)), seal: 'confirmado' })),
    valor: money(-t.baseAmount, `Saída “${t.reason}”`, 'confirmado'),
    categoria: categoryLabel(settings, t.category),
  }))

  let saldo: unknown = undefined
  if (periodo === 'mes' && !cat) {
    const s = monthSummary(data, settings, ref, now)
    saldo = { inicio_do_periodo: money(s.opening, `Saldo no início de ${label}`, 'confirmado'), fim_do_periodo: money(s.closing, ref === monthOf(today) ? 'Saldo hoje' : `Saldo no fim de ${label}`, 'confirmado') }
    if (ref === monthOf(today)) {
      const f = monthForecast(data, settings, now)
      ;(saldo as Record<string, unknown>).previsao_fim_do_mes = f.ready
        ? money(f.estimate, `Previsão de saldo em ${dayLabel(monthBounds(ref).to)}`, 'previsto', `saldo de hoje menos o ritmo de gastos variáveis (${formatMoney(f.dailyVariable, base)}/dia por ${f.daysLeft} dias) e ${f.upcomingCount} cobrança(s) de ferramentas até o fim do mês`)
        : 'Ainda sem dados suficientes para prever (o app precisa de pelo menos 7 dias e 5 saídas no mês).'
    }
  }

  return out({
    periodo: label,
    moeda_principal: base,
    observacoes: [
      'Valores na moeda principal; movimentos em outras moedas entram convertidos pela cotação do dia em que foram lançados.',
      'Transferências entre contas próprias e ajustes de saldo não contam como entrada nem saída.',
      ...(to !== (periodo === 'mes' ? monthBounds(ref).to : addDaysToDate(from, 6)) ? ['Período em andamento: considera até hoje.'] : []),
    ],
    categoria: cat?.label ?? null,
    ...(fatos.length ? { fatos } : {}),
    ...(totais ? { totais } : {}),
    saldo,
    categorias,
    maiores_saidas: maiores,
    comparacao,
  }, [label, cat?.label ?? ''])
}

function addMonth(m: string, n: number): string {
  const y = Number(m.slice(0, 4))
  const mo = Number(m.slice(5, 7)) - 1 + n
  const d = new Date(Date.UTC(y, mo, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}


/* ------------------------------------------------------------------ movements */

const ORIGIN: Record<string, string> = { project: 'recebimento de projeto', sale: 'recebimento de venda', saleGeneral: 'recebimento de venda (pagamento geral)', subscriber: 'cobrança de assinante', tool: 'pagamento de ferramenta' }

export function movements(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const { settings, data, book } = ctx
  const tz = zoneOf(settings)
  const { de, ate } = input
  if (!isDay(de) || !isDay(ate) || ate < de) return err('Datas inválidas: use AAAA-MM-DD, com "ate" depois de "de".')
  if (Date.parse(ate) - Date.parse(de) > 366 * 86_400_000) return err('Período grande demais: no máximo 1 ano por consulta.')
  const tipo = input.tipo === 'entrada' ? 'in' : input.tipo === 'saida' ? 'out' : null
  const catName = textArg(input.categoria)
  const cat = catName ? categoryIdFor(catName, ctx, tipo ?? 'out') : null
  if (catName && !cat) return err(`Categoria "${catName}" não encontrada. Categorias: ${allCategories(settings).map((c) => c.label).join(', ')}.`)
  const text = textArg(input.texto)
  const page = pageArg(input.pagina)
  const list = data.transactions
    .filter((t) => t.type !== 'adjust')
    .map((t) => ({ t, day: dayOfTransaction(t, tz) }))
    .filter(({ t, day }) => day >= de && day <= ate && (!tipo || t.type === tipo) && (!cat || (t.category ?? '') === cat.id) && (!text || fold(t.reason).includes(fold(text))))
    .sort((a, b) => (a.day === b.day ? (a.t.createdAt < b.t.createdAt ? 1 : -1) : a.day < b.day ? 1 : -1))
  const filtro = [tipo === 'in' ? 'entradas' : tipo === 'out' ? 'saídas' : 'lançamentos', cat ? `de ${cat.label}` : '', text ? `com “${text}”` : ''].filter(Boolean).join(' ')
  if (!list.length) return out({ fatos: [absent(book, `Lançamentos (${filtro}) no período pedido`, 'nenhum lançamento encontrado')] }, [filtro])
  const flows = list.filter(({ t }) => !t.transfer)
  const base = settings.baseCurrency
  const sumIn = flows.filter(({ t }) => t.type === 'in').reduce((s, { t }) => s + t.baseAmount, 0)
  const sumOut = flows.filter(({ t }) => t.type === 'out').reduce((s, { t }) => s - t.baseAmount, 0)
  const pageItems = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  return out(
    {
      filtro,
      total_de_lancamentos: countFact(book, list.length, `Quantidade de lançamentos (${filtro})`, ['lançamento', 'lançamentos']),
      totais: {
        moeda_principal: base,
        ...(sumIn ? { entradas: moneyFact(book, sumIn, base, `Entradas (${filtro})`, 'confirmado', 'na moeda principal, pela cotação do dia de cada lançamento') } : {}),
        ...(sumOut ? { saidas: moneyFact(book, sumOut, base, `Saídas (${filtro})`, 'confirmado', 'na moeda principal, pela cotação do dia de cada lançamento') } : {}),
        por_moeda_original: byCurrency(book, flows.map(({ t }) => ({ cents: t.type === 'in' ? t.amount : -t.amount, currency: t.currency })), 'Saldo do filtro na moeda original'),
      },
      pagina: page,
      paginas: Math.ceil(list.length / PAGE_SIZE),
      lancamentos: pageItems.map(({ t, day }) => ({
        dia: dateFact(book, day, 'Dia do lançamento'),
        tipo: t.type === 'in' ? 'entrada' : 'saída',
        descricao: t.reason || 'Sem descrição',
        valor: moneyFact(book, t.amount, t.currency, `${t.type === 'in' ? 'Entrada' : 'Saída'} “${t.reason}”`),
        categoria: t.transfer ? 'Transferência entre contas próprias (não é entrada nem saída)' : categoryLabel(settings, t.category),
        ...(t.source ? { origem: ORIGIN[t.source.kind] ?? 'recebimento' } : {}),
        ...(t.bank ? { importado_de_extrato: true } : {}),
      })),
      observacoes: ['Transferências aparecem na lista, mas ficam fora dos totais de entradas e saídas.', 'Lançamentos com "origem" são a própria entrada daquele recebimento: não some de novo com a venda ou o projeto.'],
    },
    [filtro],
  )
}

/* ------------------------------------------------------------------ what the person pays */

const BILLING: Record<string, string> = { monthly: 'mensal', yearly: 'anual', once: 'pagamento único', free: 'grátis' }
const TOOL_STATUS: Record<string, string> = { active: 'ativa', cancelled: 'cancelada', trial: 'em teste', free: 'grátis', paused: 'pausada' }

export function paidRecurring(_input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const { data, settings, book, now } = ctx
  const today = todayIn(zoneOf(settings), now)
  const tools = moduleOn(ctx, 'tools') ? data.tools : []
  const bills = moduleOn(ctx, 'recurring') ? data.recurring.filter((r) => r.bill && recurringState(r, today) !== 'ended') : []
  if (!tools.length && !bills.length) return out({ fatos: [absent(book, 'Contas e assinaturas que você paga', 'nenhuma cadastrada')] })
  const paying = tools.filter((t) => isPaidTool(t))
  return out(
    {
      ferramentas_e_assinaturas: tools.slice(0, 40).map((t) => {
        const next = isPaidTool(t) ? nextChargeDate(t, new Date(`${today}T12:00:00Z`)) : ''
        return {
          nome: t.name,
          situacao: TOOL_STATUS[t.status] ?? t.status,
          cobranca: BILLING[t.billing] ?? t.billing,
          preco: t.price ? moneyFact(book, t.price, t.currency, `Preço de ${t.name}`, 'confirmado', undefined, '/tools') : 'sem valor',
          ...(next ? { proxima_cobranca: dateFact(book, next, `Próxima cobrança de ${t.name}`, 'previsto') } : {}),
          pagamento_automatico: Boolean(t.autoPaid),
        }
      }),
      total_mensal_das_pagas: byCurrency(book, paying.filter((t) => t.billing === 'monthly').map((t) => ({ cents: t.price, currency: t.currency })), 'Total mensal das assinaturas ativas', 'confirmado', '/tools'),
      total_anual_das_pagas: byCurrency(book, paying.filter((t) => t.billing === 'yearly').map((t) => ({ cents: t.price, currency: t.currency })), 'Total anual das assinaturas anuais ativas', 'confirmado', '/tools'),
      contas_recorrentes: bills.slice(0, 30).map((r) => {
        const next = nextRecurring(r, today)
        return { titulo: r.title, ...(next ? { proxima: dateFact(book, next, `Próxima ocorrência de ${r.title}`, 'previsto') } : {}) }
      }),
      observacao: 'Valores separados por moeda. Pagamento automático só marca pago se a pessoa ligou essa opção na ferramenta.',
    },
    paying.slice(0, 5).map((t) => t.name),
  )
}
