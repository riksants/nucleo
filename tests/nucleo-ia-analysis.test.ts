/**
 * NÚCLEO IA — Etapa 4: tendencia_financeira, previsao_do_mes and calcular.
 * Expected numbers are written by hand from the fixture AND cross-checked against the app's own
 * functions (monthForecast, balanceOf), so the lookups never drift from the screens.
 */
import { describe, expect, it } from 'vitest'
import { FactBook, renderAnswer, type Fact } from '../supabase/functions/_shared/ia/facts'
import { runLookup } from '../src/core/assistant/ia/lookups'
import { questionFacts, runCalc } from '../src/core/assistant/ia/calc'
import { monthForecast } from '../src/core/finance'
import { balanceOf } from '../src/data/selectors'
import type { DataState, Settings } from '../src/data/types'
import type { Area } from '../supabase/functions/_shared/ia/tools'
import { E, empty, settings as baseSettings, tx } from './ia-fixtures'

const settings = { ...baseSettings, startedAt: '2026-07-01T12:00:00Z' } as Settings
const EARLY = new Date('2026-11-04T15:00:00Z') // 4 days into November
const LATE = new Date('2026-11-20T15:00:00Z') // forecast ready

/** Jul–Oct identical months; November: more food. */
function history(): DataState {
  const d = empty()
  for (const m of ['07', '08', '09', '10']) {
    d.transactions.push(
      tx('in', 500000, `2026-${m}-05`, 'Salário', { category: 'salary' }),
      tx('out', 150000, `2026-${m}-06`, 'Aluguel', { category: 'housing' }),
      tx('out', 20000, `2026-${m}-02`, 'Mercado', { category: 'food' }),
      tx('out', 20000, `2026-${m}-10`, 'Mercado', { category: 'food' }),
      tx('out', 20000, `2026-${m}-20`, 'Mercado', { category: 'food' }),
      tx('out', 10000, `2026-${m}-03`, 'Uber', { category: 'transport' }),
    )
  }
  d.transactions.push(
    tx('out', 30000, '2026-11-02', 'Mercado', { category: 'food' }),
    tx('out', 30000, '2026-11-03', 'Mercado', { category: 'food' }),
    tx('out', 10000, '2026-11-03', 'Uber', { category: 'transport' }),
  )
  return d
}

const run = (name: string, input: Record<string, unknown>, data: DataState, now: Date, s: Settings = settings, areasOff: Area[] = []) => {
  const book = new FactBook()
  const r = runLookup(name, input, { data, settings: s, now, book, areasOff })
  return { r, json: JSON.parse(r.content), book, fact: (label: RegExp) => [...book.all.values()].find((f) => label.test(f.label)) as Fact }
}

describe('tendencia_financeira', () => {
  it('média só de meses completos, mês atual contra os MESMOS dias, leitura do app e categorias que subiram', () => {
    const { json, fact } = run('tendencia_financeira', { meses: 6, categoria: null }, history(), EARLY)
    // 6 asked, only Jul–Oct are complete and inside the app's use
    expect(json.mes_a_mes.map((m: { mes: string }) => m.mes)).toEqual(['julho de 2026', 'agosto de 2026', 'setembro de 2026', 'outubro de 2026'])
    expect(fact(/^Saídas: média por mês$/).display).toBe('R$ 2.200,00')
    expect(fact(/^Entradas: média por mês$/).display).toBe('R$ 5.000,00')
    // days 1–4 of each month: food 200 (day 2) + Uber 100 (day 3) = 300; November: 600 + 100 = 700
    expect(fact(/^Saídas: média dos mesmos dias/).display).toBe('R$ 300,00')
    expect(fact(/^Saídas em novembro de 2026 até hoje$/).display).toBe('R$ 700,00')
    expect(fact(/^Saídas: novembro de 2026 até hoje menos/).display).toBe('R$ 400,00')
    expect(fact(/^Saídas: variação/).display).toBe('+133%')
    expect(json.mes_atual.leitura_do_app).toBe('acima_do_normal')
    expect(json.mes_atual.categorias_que_mais_subiram[0].categoria).toBe('Alimentação')
    expect(json.mes_atual.categorias_que_mais_cairam).toEqual([])
    expect(json.limitacoes.join(' ')).toMatch(/mesmos dias/)
    expect(json.limitacoes.join(' ')).toMatch(/4 de 6/)
  })

  it('categoria: média e comparação só daquela categoria', () => {
    const { json, fact } = run('tendencia_financeira', { meses: 3, categoria: 'mercado' }, history(), EARLY)
    expect(json.categoria).toBe('Alimentação')
    expect(fact(/^Gasto com Alimentação: média por mês$/).display).toBe('R$ 600,00')
    expect(fact(/^Gasto com Alimentação: média dos mesmos dias/).display).toBe('R$ 200,00')
    expect(json.limitacoes.join(' ')).not.toMatch(/instável/)
  })

  it('menos de 2 meses completos: diz que é insuficiente e não dá média nem leitura', () => {
    const { json, book } = run('tendencia_financeira', { meses: 6, categoria: null }, history(), EARLY, { ...settings, startedAt: '2026-10-01T12:00:00Z' } as Settings)
    expect(json.dados_insuficientes).toBe(true)
    expect(json.media).toBeUndefined()
    expect(json.mes_atual).toBeUndefined()
    expect([...book.all.values()].some((f) => f.seal === 'ausente' && /insuficiente/.test(f.display))).toBe(true)
  })
})

/** History + money to come: sales, subscribers, a project and tools in two currencies. */
function withReceivables(): DataState {
  const d = history()
  // November so far, up to the 20th: enough expenses for the forecast
  d.transactions.push(tx('out', 150000, '2026-11-06', 'Aluguel', { category: 'housing' }), tx('out', 20000, '2026-11-12', 'Mercado', { category: 'food' }), tx('out', 20000, '2026-11-18', 'Mercado', { category: 'food' }))
  d.clients = [E('c1', { name: 'Vânia', status: 'active' })]
  d.sales = [
    // 1.000 in 2 installments: 300 overdue (10/11) + 300 due 25/11; 400 down payment received
    E('s1', { clientId: 'c1', clientName: '', product: 'Site', quantity: 1, date: '2026-10-01', total: 100000, currency: 'BRL', dueDate: '', payments: [{ id: 'p1', date: '2026-10-01', amount: 40000, note: '' }], notes: '', installments: [{ id: 'i1', due: '2026-11-10', amount: 30000 }, { id: 'i2', due: '2026-11-25', amount: 30000 }] }),
    // EUR, due inside the month: listed apart, never added to the BRL scenario
    E('s2', { clientId: null, clientName: 'John', product: 'Logo', quantity: 1, date: '2026-11-01', total: 20000, currency: 'EUR', dueDate: '2026-11-28', payments: [], notes: '' }),
    // next month: not in this month
    E('s3', { clientId: null, clientName: 'Maria', product: 'Consultoria', quantity: 1, date: '2026-11-01', total: 50000, currency: 'BRL', dueDate: '2026-12-15', payments: [], notes: '' }),
  ]
  d.subPlans = [E('pl1', { offeringId: 'o1', name: 'Mensal', price: 5000, currency: 'BRL', interval: 'monthly' })]
  d.subscribers = [
    E('sb1', { offeringId: 'o1', planId: 'pl1', name: 'Bruno', nextCharge: '2026-11-25', status: 'active', payments: [] }),
    // already paid this month → not counted again
    E('sb2', { offeringId: 'o1', planId: 'pl1', name: 'Ana', nextCharge: '2026-11-27', status: 'active', payments: [{ id: 'sp', date: '2026-11-02', amount: 5000, currency: 'BRL', note: '' }] }),
    E('sb3', { offeringId: 'o1', planId: 'pl1', name: 'Teste', nextCharge: '2026-11-26', status: 'trial', payments: [] }),
    // charge day passed this month, not paid → late, outside the scenarios (not silently rolled to next month)
    E('sb4', { offeringId: 'o1', planId: 'pl1', name: 'Caio', nextCharge: '2026-11-12', status: 'active', payments: [] }),
  ]
  d.projects = [E('pr1', { name: 'App', clientId: 'c1', status: 'inProgress', charged: 200000, currency: 'BRL', payments: [{ id: 'pp', date: '2026-09-10', amount: 50000, note: '' }] })]
  d.tools = [E('to1', { name: 'Figma', price: 3000, currency: 'BRL', billing: 'monthly', nextCharge: '2026-11-25', status: 'active' }), E('to2', { name: 'Hosting', price: 1000, currency: 'USD', billing: 'monthly', nextCharge: '2026-11-28', status: 'active' })]
  return d
}

describe('previsao_do_mes', () => {
  it('saldo de hoje confirmado; o resto previsto, com base, moedas separadas e vencido fora dos cenários', () => {
    const data = withReceivables()
    const { json, book, fact } = run('previsao_do_mes', {}, data, LATE)
    const f = monthForecast(data, settings, LATE)
    if (!f.ready) throw new Error('forecast should be ready')

    expect(fact(/^Saldo hoje/)).toMatchObject({ seal: 'confirmado', amount: { cents: balanceOf(settings, data.transactions), currency: 'BRL' } })
    // to come in BRL: installment 300 (25/11) + Bruno 50 = 350; EUR 200 apart; Ana (paid), trial and December out
    const inBRL = fact(/^Previsto para entrar.*\(BRL\)$/)
    expect(inBRL).toMatchObject({ seal: 'previsto', display: 'R$ 350,00' })
    expect(fact(/^Previsto para entrar.*\(EUR\)$/)).toMatchObject({ seal: 'previsto', display: '€ 200,00' })
    expect(json.entra_ate_o_fim_do_mes.itens.map((i: { de: string }) => i.de)).toEqual(['Vânia', 'Bruno', 'John'])
    // overdue: confirmed fact, explicitly outside the scenarios
    // overdue installment 300 + Caio's unpaid charge 50
    expect(fact(/^Vencido e não pago.*\(BRL\)$/)).toMatchObject({ seal: 'confirmado', display: 'R$ 350,00' })
    expect(fact(/^A receber de projetos.*\(BRL\)$/).display).toBe('R$ 1.500,00')
    // fixed expenses: rent already in November; nothing fixed from October missing
    expect(json.gastos_fixos.ja_lancados_neste_mes.map((x: { categoria: string }) => x.categoria)).toEqual(['Moradia'])
    expect(json.gastos_fixos.do_mes_passado_ainda_nao_lancados_neste_mes).toEqual([])

    // scenarios = the app's own monthForecast; + only BRL to come (350)
    expect(fact(/SEM contar recebimentos$/)).toMatchObject({ seal: 'previsto', amount: { cents: f.estimate, currency: 'BRL' } })
    expect(fact(/SE as parcelas/)).toMatchObject({ seal: 'previsto', amount: { cents: f.estimate + 35000, currency: 'BRL' } })
    expect(fact(/^Cobranças de ferramentas em outra moeda.*\(USD\)$/).seal).toBe('previsto')

    // nothing forecast is ever labelled as received or available
    for (const x of book.all.values()) if (x.seal === 'previsto') expect(x.label, x.label).not.toMatch(/já recebid|disponível|^Recebid/i)
    const lim = json.limitacoes.join(' ')
    expect(lim).toMatch(/PREVISÃO: não é dinheiro recebido nem disponível/)
    expect(lim).toMatch(/outras moedas/)
    expect(lim).toMatch(/em teste ou pausados/)
  })

  it('área Vendas desligada: nada de vendas ou assinantes, e a limitação diz por quê', () => {
    const { json, book } = run('previsao_do_mes', {}, withReceivables(), LATE, settings, ['vendas'])
    expect(json.entra_ate_o_fim_do_mes.itens).toEqual([])
    expect([...book.all.values()].some((f) => /Vânia|Bruno|John/.test(f.label))).toBe(false)
    expect(json.limitacoes.join(' ')).toMatch(/Vendas fora do alcance/)
  })

  it('início do mês: sem cenário de saldo, e diz o que falta para prever', () => {
    const { json } = run('previsao_do_mes', {}, history(), EARLY)
    expect(json.cenarios_fim_do_mes).toMatchObject({ selo: 'ausente' })
    expect(json.limitacoes.join(' ')).toMatch(/pelo menos 7 dias/)
  })
})

describe('calcular', () => {
  const S = { baseCurrency: 'BRL' }
  const setup = () => {
    const book = new FactBook()
    const add = (cents: number, currency = 'BRL', seal: Fact['seal'] = 'confirmado', label = 'x') => book.add({ kind: 'dinheiro', label, display: `${currency} ${cents}`, seal, amount: { cents, currency } }).id
    return { book, add }
  }
  const calc = (book: FactBook, input: Record<string, unknown>) => {
    const r = runCalc({ numero: null, valor_informado: null, moeda_informada: null, rotulo: 'Resultado', ...input }, book, S)
    return { ...r, json: JSON.parse(r.content) }
  }

  it('contas exatas em centavos e selo herdado', () => {
    const { book, add } = setup()
    const a = add(61240, 'BRL', 'confirmado', 'Gasto out')
    const b = add(50010, 'BRL', 'confirmado', 'Gasto set')
    const p = add(100000, 'BRL', 'previsto', 'Previsto')
    expect(calc(book, { operacao: 'diferenca', fatos: [a, b] }).json.resultado).toMatchObject({ valor: 'R$ 112,30', selo: 'confirmado' })
    expect(calc(book, { operacao: 'soma', fatos: [a, b, p] }).json.resultado).toMatchObject({ valor: 'R$ 2.112,50', selo: 'previsto' })
    expect(calc(book, { operacao: 'soma', fatos: [a, p] }).json.aviso).toMatch(/nunca como dinheiro recebido/)
    expect(calc(book, { operacao: 'variacao', fatos: [a, b] }).json.resultado.valor).toBe('+22,5%')
    expect(calc(book, { operacao: 'porcentagem_de', fatos: [b, a] }).json.resultado.valor).toBe('81,7%')
    expect(calc(book, { operacao: 'multiplicar', fatos: [b], numero: 12 }).json.resultado.valor).toBe('R$ 6.001,20')
  })

  it('valor informado pela pessoa: guardar por mês arredonda para cima e o selo diz que veio dela', () => {
    const { book, add } = setup()
    const saved = add(385000, 'BRL', 'confirmado', 'Guardado')
    const left = calc(book, { operacao: 'diferenca', fatos: ['informado', saved], valor_informado: 10000 })
    expect(left.json.resultado).toMatchObject({ valor: 'R$ 6.150,00', selo: 'informado' })
    const perMonth = calc(book, { operacao: 'dividir', fatos: [left.json.resultado.id], numero: 7, rotulo: 'Guardar por mês até 2027' })
    expect(perMonth.json.resultado).toMatchObject({ valor: 'R$ 878,58', selo: 'informado', rotulo: 'Guardar por mês até' })
    expect(perMonth.json.resultado.base).toMatch(/arredondado para cima/)
    // the person's own number, written by the model, is shown as that fact (not blocked)
    const r = renderAnswer(`Faltam {${left.json.resultado.id}} para os R$ 10.000,00; guarde {${perMonth.json.resultado.id}} por mês.`, book.all)
    expect(r.blocked).toEqual([])
  })

  it('recusa: moedas misturadas, fato ausente, de prévia, inexistente ou que não é dinheiro', () => {
    const { book, add } = setup()
    const brl = add(1000)
    const eur = add(1000, 'EUR')
    const none = add(0, 'BRL', 'ausente')
    const prev = add(500, 'BRL', 'proposto')
    const count = book.add({ kind: 'contagem', label: 'n', display: '3', seal: 'confirmado' }).id
    expect(calc(book, { operacao: 'soma', fatos: [brl, eur] }).json.erro).toMatch(/Moedas diferentes/)
    expect(calc(book, { operacao: 'diferenca', fatos: [brl, none] }).json.erro).toMatch(/não encontrado/)
    expect(calc(book, { operacao: 'diferenca', fatos: [brl, prev] }).json.erro).toMatch(/prévia/)
    expect(calc(book, { operacao: 'diferenca', fatos: [brl, 'f99'] }).json.erro).toMatch(/não existe/)
    expect(calc(book, { operacao: 'diferenca', fatos: [brl, count] }).json.erro).toMatch(/não é um valor em dinheiro/)
    expect(calc(book, { operacao: 'dividir', fatos: [brl], numero: 0 }).isError).toBe(true)
    expect(calc(book, { operacao: 'porcentagem_de', fatos: [brl, add(0)] }).json.erro).toMatch(/zero/)
    expect(calc(book, { operacao: 'soma', fatos: [brl, 'informado'], valor_informado: 5, moeda_informada: 'EUR' }).json.erro).toMatch(/Moedas diferentes/)
  })
})

describe('trava (ajustes da rodada real da Etapa 4)', () => {
  const book = new FactBook()
  book.add({ kind: 'data', label: 'Vencimento', display: 'seg, 30/11', seal: 'previsto' })
  book.add({ kind: 'dinheiro', label: 'Informado', display: 'R$ 500,00', seal: 'informado', amount: { cents: 50000, currency: 'BRL' } })
  book.add({ kind: 'dinheiro', label: 'Preço', display: 'R$ 30,50', seal: 'confirmado', amount: { cents: 3050, currency: 'BRL' } })
  book.add({ kind: 'dinheiro', label: 'Projeto', display: 'R$ 1.500,00', seal: 'confirmado', amount: { cents: 150000, currency: 'BRL' } })
  it('data por extenso de um fato e dinheiro sem centavos igual ao fato passam', () => {
    expect(renderAnswer('Até 30 de novembro, gastar R$ 500 a mais; faltam R$ 1.500 do projeto.', book.all).blocked).toEqual([])
  })
  it('valor arredondado, data sem fato e dinheiro sem fato continuam bloqueados', () => {
    expect(renderAnswer('Cerca de R$ 30 por mês, até 15 de dezembro, uns R$ 501.', book.all).blocked).toEqual(['R$ 30', '15 de dezembro', 'R$ 501'])
  })
})

describe('valores escritos na pergunta', () => {
  it('viram fatos "informado" (moeda pela palavra ou símbolo; "mil"); números sem moeda não', () => {
    const book = new FactBook()
    questionFacts('Dá pra gastar 500 reais? Quero juntar 10 mil em 3 meses e mandar € 200 e US$ 1.200,50', book, { baseCurrency: 'BRL' })
    expect([...book.all.values()].map((f) => `${f.display}|${f.seal}`)).toEqual(['R$ 500,00|informado', 'R$ 10.000,00|informado', '€ 200,00|informado', 'US$ 1.200,50|informado'])
    expect(renderAnswer('Sim, dá para gastar R$ 500 a mais.', book.all).blocked).toEqual([])
    expect(renderAnswer('Sim, sobra R$ 400.', book.all).blocked).toEqual(['R$ 400'])
  })
})
