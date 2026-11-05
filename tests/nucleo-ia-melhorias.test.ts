/**
 * NÚCLEO IA — melhorias pós-teste no celular: comandos de meta (determinísticos, prévia editável),
 * valores que o app prova a partir dos fatos citados, datas naturais, avisos separados, alertas
 * financeiros e modo curto/completo.
 */
import { describe, expect, it } from 'vitest'
import { goalCommand } from '../src/core/assistant/ia/goalCommand'
import { naturalDate, NOTE_START } from '../src/core/assistant/ia/present'
import { runLookup } from '../src/core/assistant/ia/lookups'
import { baseMessages } from '../supabase/functions/_shared/ia/engine'
import { FactBook, renderAnswer } from '../supabase/functions/_shared/ia/facts'
import type { StartRequest } from '../supabase/functions/_shared/ia/protocol'
import { account, historyAccount, settings } from './ia-fixtures'

const ctx = { data: account(), settings, now: new Date('2026-11-05T15:00:00Z'), today: '2026-11-05', areasOff: [], uid: '11111111-1111-4111-8111-111111111111', planId: 'plano-teste-01' }

describe('criar meta: o app reconhece a intenção e o tipo', () => {
  it('meta de dinheiro → prévia editável com valor, prazo e nome; nada gravado', () => {
    const r = goalCommand('Cria uma meta de juntar 150 mil até dezembro de 2027', ctx)
    expect(r?.kind).toBe('finance')
    if (r?.kind !== 'finance') return
    const it0 = r.plan.items[0]
    expect(it0.action).toMatchObject({ tipo: 'criar_meta_financeira', valor: 150000, data: '2027-12-31', titulo: 'Juntar R$ 150.000,00' })
    expect(it0.state).toBe('pronto')
    expect(r.plan.state ?? 'preview').not.toBe('applied')
    const v = goalCommand('Quero criar uma meta financeira de R$ 20 mil para viagem até julho de 2027', ctx)
    expect(v?.kind === 'finance' && v.plan.items[0].action).toMatchObject({ titulo: 'Viagem', valor: 20000, data: '2027-07-31' })
  })
  it('sem prazo: prévia pede a data; sem valor: pergunta o valor', () => {
    const r = goalCommand('Cria uma meta para juntar R$ 5 mil', ctx)
    expect(r?.kind === 'finance' && r.lines[0]).toMatch(/Falta o prazo/)
    expect(goalCommand('Cria uma meta para a viagem', ctx)?.kind).toBe('ask')
  })
  it('meta de vendas: diz que o app não tem e não cria outra coisa no lugar', () => {
    for (const q of ['Cria uma meta de vendas de 10 mil este mês', 'Criar meta: vender 30 mil até dezembro', 'Quero criar uma meta de faturamento de R$ 50 mil']) {
      const r = goalCommand(q, ctx)
      expect(r?.kind, q).toBe('unsupported')
      expect(r?.kind === 'unsupported' && r.link.path).toBe('/sales')
    }
  })
  it('meta da semana aponta para Semana; perguntas e outras frases seguem o caminho normal', () => {
    expect(goalCommand('Cria uma meta da semana de 5 treinos', ctx)).toMatchObject({ kind: 'unsupported', link: { path: '/week' } })
    expect(goalCommand('Quanto preciso guardar por mês para juntar 10 mil até junho de 2027?', ctx)).toBeNull()
    expect(goalCommand('Como estão minhas metas?', ctx)).toBeNull()
  })
})

describe('valores calculáveis não viram "valor não confirmado"', () => {
  const book = () => {
    const b = new FactBook()
    const a = b.add({ kind: 'dinheiro', label: 'Saídas em outubro', display: 'R$ 1.709,90', seal: 'confirmado', amount: { cents: 170990, currency: 'BRL' } })
    const c = b.add({ kind: 'dinheiro', label: 'Saídas em setembro', display: 'R$ 1.670,00', seal: 'confirmado', amount: { cents: 167000, currency: 'BRL' } })
    const p = b.add({ kind: 'dinheiro', label: 'Figma por mês', display: 'R$ 30,00', seal: 'confirmado', amount: { cents: 3000, currency: 'BRL' } })
    const e = b.add({ kind: 'dinheiro', label: 'Em euro', display: '€ 100,00', seal: 'previsto', amount: { cents: 10000, currency: 'EUR' } })
    return { b, a: a.id, c: c.id, p: p.id, e: e.id }
  }
  it('diferença, ×12 e porcentagem dos valores citados são provados pelo app', () => {
    const { b, a, c, p } = book()
    const r = renderAnswer(`Você gastou {${a}} contra {${c}}: R$ 39,90 a mais, 2,4% acima. O Figma ({${p}}) dá R$ 360,00 por ano.`, b.all)
    expect(r.blocked).toEqual([])
    const derived = r.segments.filter((s) => s.t === 'fact' && s.fact.label === 'Calculado pelo app')
    expect(derived).toHaveLength(3)
  })
  it('sem os valores citados, moeda diferente ou conta que não fecha: continua bloqueado', () => {
    const { b, a, c, e } = book()
    expect(renderAnswer('Você gastou R$ 39,90 a mais.', b.all).blocked).toEqual(['R$ 39,90'])
    expect(renderAnswer(`{${a}} e {${c}}: diferença de R$ 40,00 e de 3%.`, b.all).blocked).toEqual(['R$ 40,00', '3%'])
    expect(renderAnswer(`{${e}} e {${a}}: R$ 100,00.`, b.all).blocked).toEqual(['R$ 100,00'])
  })
})

describe('apresentação', () => {
  it('datas por extenso e avisos reconhecidos', () => {
    expect(naturalDate('qua, 30/06/2027')).toBe('30 de junho de 2027')
    expect(naturalDate('seg, 30/11')).toBe('segunda, 30 de novembro')
    expect(naturalDate('qua, 05/11 · 10:00 · Reunião Vânia')).toBe('quarta, 5 de novembro · 10:00 · Reunião Vânia')
    expect(NOTE_START.test('Atenção: a previsão não inclui gastos fixos.')).toBe(true)
    expect(NOTE_START.test('Limitação: só 3 meses.')).toBe(true)
    expect(NOTE_START.test('Você gastou menos.')).toBe(false)
  })
  it('modo curto por padrão; completo em "Analisar a fundo"', () => {
    const req = { kind: 'start', turnId: 'turno-0001', text: 'oi', today: '2026-11-05', timeZone: 'America/Sao_Paulo', deep: false, consentVersion: 2, history: [], topics: '', focus: [], areasOff: [] } as StartRequest
    expect((baseMessages(req).at(-1) as { content: string }).content).toContain('"modo":"resposta_curta"')
    expect((baseMessages({ ...req, deep: true }).at(-1) as { content: string }).content).toContain('"modo":"analise_completa"')
  })
})

describe('alertas financeiros calculados pelo app', () => {
  it('vencidos a receber e gastos fixos não lançados viram alertas da previsão', () => {
    const r = JSON.parse(runLookup('previsao_do_mes', {}, { data: historyAccount(), settings, now: new Date('2026-11-20T15:00:00Z'), book: new FactBook(), areasOff: [] }).content)
    expect(r.alertas.join(' ')).toMatch(/vencidos que outras pessoas devem a você/)
    expect(r.alertas.join(' ')).toMatch(/Gastos fixos do mês passado ainda não lançados neste mês: Assinaturas/)
  })
})
