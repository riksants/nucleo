/**
 * Etapa 4.4 — Importar extrato: transferências entre contas próprias (preservadas, fora de renda/despesa),
 * datas e valores suspeitos, totais por moeda, texto colado, Excel (.xlsx) e o mesmo arquivo de novo.
 */
import { describe, expect, it } from 'vitest'
import { totalsOf } from '../src/core/import/checks'
import { readPasted, readFileAsync } from '../src/core/import/read'
import { transferOf } from '../src/core/import/plan'
import { undoImport } from '../src/core/import/undo'
import { financeIndex, totalsBetween } from '../src/core/finance'
import { planRulesForWrite } from '../src/core/rules/engine'
import { readZip, ZipError } from '../src/core/intake/zip'
import { readXlsx, serialToDate } from '../src/core/intake/xlsx'
import { totalsSince } from '../src/data/selectors'
import type { Transaction } from '../src/data/types'
import { analyzeText, importInto } from './import-helpers'
import { ctx, data, put, rule, TODAY, tx } from './rules-helpers'

const csv = (rows: string[]) => ['Data;Descrição;Valor', ...rows].join('\n')

describe('transferências entre contas próprias', () => {
  const wiseIn: Transaction = { ...tx('w1', { type: 'in', amount: 50000, baseAmount: 50000, reason: 'Top up from Sabadell' }), bank: { importId: 'import-w', day: '2026-10-10', date: '10/10/2026', raw: 'TOP UP FROM SABADELL', account: 'Wise' } }

  it('a outra parte já está no Núcleo (outra conta): sugerida como transferência, sem categoria', () => {
    const a = analyzeText(csv(['10/10/2026;Transferencia a Wise;-500,00']), data({ transactions: [wiseIn] }))
    const l = a.lines[0]
    expect(l.transfer).toMatchObject({ suggested: true, pairTxId: 'w1' })
    expect(l.category).toBeNull()
    expect(transferOf(l, undefined)).toBe(true)
  })

  it('importar marca os dois lados, preserva os registros e o saldo; desfazer devolve a outra parte como estava', () => {
    const d0 = data({ transactions: [wiseIn] })
    const a = analyzeText(csv(['10/10/2026;Transferencia a Wise;-500,00']), d0)
    const { data: d1, plan } = importInto(d0, a)
    const created = d1.transactions.find((t) => t.id === a.lines[0].id)!
    const pair = d1.transactions.find((t) => t.id === 'w1')!
    expect(created).toMatchObject({ type: 'out', amount: 50000, baseAmount: -50000, transfer: { pairId: 'w1' } })
    expect(pair.transfer).toEqual({ pairId: created.id })
    // Balance: both movements count (net zero); totals: neither is income nor expense.
    expect(d1.transactions.reduce((s, t) => s + t.baseAmount, 0)).toBe(0)
    expect(totalsSince(d1.transactions, null)).toEqual({ income: 0, expense: 0, net: 0 })
    const idx = financeIndex(d1.transactions, ctx().settings)
    expect(totalsBetween(idx, '2026-10-01', '2026-10-31')).toMatchObject({ income: 0, expense: 0 })
    expect(plan.run.bankImport?.transfers).toBe(1)
    const u = undoImport(plan.run, d1, TODAY)!
    const back = d1.transactions.map((t) => u.ops.find((o) => o.op === 'put' && o.item.id === t.id)?.item ?? t).filter((t) => !u.ops.some((o) => o.op === 'remove' && o.id === t.id)) as Transaction[]
    expect(back.map((t) => t.id)).toEqual(['w1'])
    expect(back[0].transfer).toBeUndefined()
  })

  it('só a palavra “transferência” não basta: vira dica, nunca assume (pagar alguém por transferência é gasto)', () => {
    const a = analyzeText(csv(['10/10/2026;Transferencia a Joao Silva;-80,00']))
    expect(a.lines[0].transfer).toMatchObject({ suggested: false })
    expect(transferOf(a.lines[0], undefined)).toBe(false)
  })

  it('texto que diz “entre contas” é sugerido', () => {
    const a = analyzeText(csv(['10/10/2026;Transf. entre contas proprias;-200,00']))
    expect(a.lines[0].transfer?.suggested).toBe(true)
  })

  it('a pessoa pode desmarcar: entra como saída comum', () => {
    const d0 = data({ transactions: [wiseIn] })
    const a = analyzeText(csv(['10/10/2026;Transferencia a Wise;-500,00']), d0)
    const { data: d1 } = importInto(d0, a, new Map([[0, { action: 'import', transfer: false }]]))
    expect(d1.transactions.find((t) => t.id === a.lines[0].id)!.transfer).toBeUndefined()
    expect(d1.transactions.find((t) => t.id === 'w1')!.transfer).toBeUndefined()
  })

  it('nenhuma regra de dinheiro reage a uma transferência', () => {
    const r = rule('moneyIn', [{ kind: 'createTask', title: 'x', dueDays: 0, linkProject: false, priority: 'none' }])
    const t = { ...tx('t9'), transfer: {} }
    expect(planRulesForWrite(data({ rules: [r] }), [put('transactions', t)], 'person', ctx())).toEqual([])
  })
})

describe('datas e valores suspeitos', () => {
  it('data no futuro vai para revisão; valor muito acima do resto é apontado', () => {
    const rows = ['01/10/2026;Café;-2,50', '02/10/2026;Pão;-3,10', '03/10/2026;Café;-2,80', '04/10/2026;Metro;-1,50', '05/10/2026;Livro;-12,00', '06/10/2026;TV;-1.400,00', '20/12/2026;Futuro;-10,00']
    const a = analyzeText(csv(rows))
    const future = a.lines.find((l) => l.reason.includes('Futuro'))!
    expect(future.status).toBe('review')
    expect(future.warnings?.[0]).toMatch(/futuro/)
    const tv = a.lines.find((l) => l.reason === 'TV')!
    expect(tv.status).toBe('new')
    expect(tv.warnings?.[0]).toMatch(/muito acima/)
  })
})

describe('totais por moeda', () => {
  it('nunca soma moedas diferentes; transferências ficam fora', () => {
    const t = totalsOf([
      { type: 'in', amount: 1000, currency: 'EUR', transfer: false },
      { type: 'out', amount: 300, currency: 'EUR', transfer: false },
      { type: 'out', amount: 9000, currency: 'BRL', transfer: false },
      { type: 'out', amount: 500, currency: 'EUR', transfer: true },
    ])
    expect(t).toEqual([
      { currency: 'EUR', income: 1000, expense: 300, transfers: 1 },
      { currency: 'BRL', income: 0, expense: 9000, transfers: 0 },
    ])
  })
})

describe('texto colado', () => {
  it('uma movimentação por linha: sinais, C/D, ano deduzido e linhas que não são movimentação', () => {
    const r = readPasted(['Extrato de outubro', '05/10 MERCADONA VALENCIA -45,20', '06/10/2026 Salário 2.500,00 C', '07/10 Uber 12,90 D', '08/10 Sem sinal 30,00', 'Saldo do dia 1.234,00'].join('\n'), TODAY)
    if (r.kind !== 'lines') throw new Error(r.kind)
    expect(r.ignored).toBe(2)
    expect(r.lines.map((l) => [l.day, l.amount, l.description])).toEqual([
      ['2026-10-05', -4520, 'MERCADONA VALENCIA'],
      ['2026-10-06', 250000, 'Salário'],
      ['2026-10-07', -1290, 'Uber'],
      ['2026-10-08', null, 'Sem sinal'],
    ])
    expect(r.lines[3].error).toMatch(/sem sinal/)
    expect(r.lines[0].date).toMatch(/ano deduzido/)
  })

  it('tabela copiada (tab) é lida como CSV', () => {
    const r = readPasted('Data\tDescrição\tValor\n05/10/2026\tMercado\t-45,20\n06/10/2026\tSalário\t2500,00', TODAY)
    expect(r.kind).toBe('csv')
  })

  it('texto sem movimentações: diz o que precisa', () => {
    const r = readPasted('olá, isto não é extrato', TODAY)
    expect(r).toMatchObject({ kind: 'error' })
  })
})

import { makeZip } from './zip-helpers'

const XLSX = {
  'xl/workbook.xml': '<workbook><sheets><sheet name="Extrato" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Data</t></si><si><t>Descrição</t></si><si><t>Valor</t></si><si><t>Mercado &amp; Cia</t></si><si><r><t>Sal</t></r><r><t>ário</t></r></si></sst>',
  'xl/styles.xml': '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" s="1"><v>46300</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>-45.2</v></c></row><row r="3"><c r="A3" s="1"><v>46301</v></c><c r="B3" t="s"><v>4</v></c><c r="C3"><v>2500</v></c></row></sheetData></worksheet>',
}

describe('Excel (.xlsx), lido no aparelho', () => {
  it('lê textos, números e datas (formato de data)', async () => {
    const x = await readXlsx(await makeZip(XLSX))
    expect(x.rows).toEqual([
      ['Data', 'Descrição', 'Valor'],
      [serialToDate(46300)!, 'Mercado & Cia', '-45.2'],
      [serialToDate(46301)!, 'Salário', '2500'],
    ])
    expect(serialToDate(46300)).toBe('05/10/2026') // 46023 = 01/01/2026
  })

  it('vira a mesma prévia de um CSV', async () => {
    const r = await readFileAsync(await makeZip(XLSX), 'extrato.xlsx')
    expect(r).toMatchObject({ kind: 'csv', source: 'xlsx' })
    expect(r.kind !== 'error' && r.hash).toBeTruthy()
  })

  it('arquivo compactado suspeito (descompactado enorme) é recusado com motivo', async () => {
    const zip = await makeZip({ 'a.txt': 'x'.repeat(2_000_000) })
    await expect(readZip(zip, () => true)).rejects.toBeInstanceOf(ZipError)
  })

  it('outro tipo de arquivo compactado não é tratado como planilha', async () => {
    const r = await readFileAsync(await makeZip({ 'word/document.xml': '<w/>' }), 'contrato.zip')
    expect(r.kind).toBe('error')
  })
})

describe('mesmo arquivo de novo', () => {
  it('o conteúdo tem a mesma marca; as linhas aparecem como duplicadas', async () => {
    const text = csv(['10/10/2026;Café;-2,50'])
    const a = await readFileAsync(new TextEncoder().encode(text), 'a.csv')
    const b = await readFileAsync(new TextEncoder().encode(text), 'b.csv')
    expect(a.kind !== 'error' && b.kind !== 'error' && a.hash === b.hash).toBe(true)
    const first = analyzeText(text)
    const { data: d1 } = importInto(data(), first)
    expect(analyzeText(text, d1).lines[0].status).toBe('duplicate')
  })
})
