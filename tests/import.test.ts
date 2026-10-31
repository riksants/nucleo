import { describe, expect, it } from 'vitest'
import { defaultAction } from '../src/core/import/analyze'
import { guessMapping, readSheet } from '../src/core/import/csv'
import { decodeBytes, sniff } from '../src/core/import/decode'
import { merchantKey, normDescription, prettyDescription } from '../src/core/import/normalize'
import { learnFrom, learnedGuess } from '../src/core/import/categorize'
import { readOfx } from '../src/core/import/ofx'
import { csvLines, readFile, templateOf } from '../src/core/import/read'
import { undoImport } from '../src/core/import/undo'
import { inferDecimal, parseAmount, parseDate } from '../src/core/import/values'
import type { Transaction } from '../src/data/types'
import { analyzeText, enc, importInto, linesOf } from './import-helpers'
import { client, data, goal, project, rule, sale, settings, TODAY, tx } from './rules-helpers'

const csvSemicolon = `Fecha;Concepto;Importe;Saldo
15/10/2026;MERCADONA VALENCIA 1234;-45,30;1.954,70
16/10/2026;NOMINA OCTUBRE;2.000,00;3.954,70
17/10/2026;UBER *TRIP 8812;-12,50;3.942,20
`

describe('CSV: separadores, decimais, datas, cabeçalhos', () => {
  it('ponto e vírgula + decimal com vírgula + cabeçalho em espanhol', () => {
    const lines = linesOf(csvSemicolon)
    expect(lines.map((l) => [l.day, l.amount, l.description])).toEqual([
      ['2026-10-15', -4530, 'MERCADONA VALENCIA 1234'],
      ['2026-10-16', 200000, 'NOMINA OCTUBRE'],
      ['2026-10-17', -1250, 'UBER *TRIP 8812'],
    ])
    expect(lines[0].balance).toBe(195470)
  })

  it('vírgula + decimal com ponto + cabeçalho em inglês + datas mês/dia', () => {
    const lines = linesOf(`Date,Description,Amount,Currency
10/15/2026,"Coffee, Blue Bottle",-4.50,USD
10/16/2026,Client payment,"1,250.00",USD
`)
    expect(lines.map((l) => [l.day, l.amount, l.currency, l.description])).toEqual([
      ['2026-10-15', -450, 'USD', 'Coffee, Blue Bottle'],
      ['2026-10-16', 125000, 'USD', 'Client payment'],
    ])
  })

  it('tab + cabeçalho em português + datas ISO', () => {
    const lines = linesOf(`Data\tDescrição\tValor\n2026-10-01\tPadaria Pão Quente\t-8,90\n2026-10-02\tPix recebido Ana\t150,00\n`)
    expect(lines.map((l) => [l.day, l.amount])).toEqual([
      ['2026-10-01', -890],
      ['2026-10-02', 15000],
    ])
  })

  it('débito e crédito em colunas separadas', () => {
    const lines = linesOf(`Data;Histórico;Débito;Crédito;Saldo
01/10/2026;Aluguel;1.500,00;;3.000,00
02/10/2026;Salário;;5.000,00;8.000,00
03/10/2026;Tarifa;-12,00;;7.988,00
`)
    expect(lines.map((l) => l.amount)).toEqual([-150000, 500000, -1200])
  })

  it('valores negativos em formatos diferentes', () => {
    expect(parseAmount('-12,50', ',')).toBe(-1250)
    expect(parseAmount('12,50-', ',')).toBe(-1250)
    expect(parseAmount('(12.50)', '.')).toBe(-1250)
    expect(parseAmount('€ -1.234,56', ',')).toBe(-123456)
    expect(parseAmount('R$ 1.234,56', ',')).toBe(123456)
    expect(parseAmount('−7.00', '.')).toBe(-700)
    expect(parseAmount('1 234,56', ',')).toBe(123456)
    expect(parseAmount('abc', '.')).toBeNull()
  })

  it('decimal decidido pela coluna inteira', () => {
    expect(inferDecimal(['1.234,56', '-12,50'])).toBe(',')
    expect(inferDecimal(['1,234.56', '-12.50'])).toBe('.')
    expect(inferDecimal(['12,5', '3,75'])).toBe(',')
  })

  it('datas em formatos diferentes', () => {
    expect(parseDate('31/12/2026', 'dmy')).toBe('2026-12-31')
    expect(parseDate('12/31/2026', 'mdy')).toBe('2026-12-31')
    expect(parseDate('2026-12-31T10:00:00Z', 'dmy')).toBe('2026-12-31')
    expect(parseDate('20261231', 'dmy')).toBe('2026-12-31')
    expect(parseDate('31.12.26', 'dmy')).toBe('2026-12-31')
    expect(parseDate('31-dic-2026', 'dmy')).toBe('2026-12-31')
    expect(parseDate('Dec 31, 2026', 'dmy')).toBe('2026-12-31')
    expect(parseDate('31 de dezembro de 2026'.replace(/ de /g, ' '), 'dmy')).toBe('2026-12-31')
    expect(parseDate('31/02/2026', 'dmy')).toBeNull()
    expect(parseDate('16/10/2026 10:22', 'dmy')).toBe('2026-10-16')
  })

  it('cabeçalho depois de linhas sobre a conta, e linhas de saldo ignoradas', () => {
    const text = `Cuenta;ES12 3456 7890
Titular;Rik
;
F. Operativa;Concepto;F. Valor;Importe;Saldo
16/10/2026;BIZUM DE ANA;16/10/2026;20,00;100,00
17/10/2026;SALDO FINAL;;;100,00
`
    const lines = linesOf(text)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ day: '2026-10-16', amount: 2000 })
  })

  it('cabeçalho que não reconhece: mostra o que falta (tela de colunas)', () => {
    const r = readFile(enc(`a;b;c\nfoo;bar;baz\nqux;quux;corge\n`), 'x.csv')
    expect(r.kind).toBe('csv')
    if (r.kind !== 'csv') return
    expect(r.guess.missing).toEqual(expect.arrayContaining(['data', 'valor']))
    expect(csvLines(r.sheet, r.mapping).problems[0]).toBe('Não consegui identificar a coluna de data.')
  })

  it('sem cabeçalho: reconhece pelos valores', () => {
    const lines = linesOf(`15/10/2026;Mercadona;-45,30\n16/10/2026;Lidl;-10,00\n`)
    expect(lines.map((l) => [l.day, l.amount, l.description])).toEqual([
      ['2026-10-15', -4530, 'Mercadona'],
      ['2026-10-16', -1000, 'Lidl'],
    ])
  })

  it('Windows-1252 (banco espanhol) vira texto certo', () => {
    const bytes = new Uint8Array([0x44, 0xe9, 0x62, 0x69, 0x74, 0x6f]) // "Débito" em 1252
    expect(decodeBytes(bytes)).toBe('Débito')
  })

  it('formatos que não são extrato: mensagem humana', () => {
    expect(sniff(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toMatchObject({ kind: 'unsupported', message: expect.stringContaining('PDF') })
    expect(sniff(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toMatchObject({ kind: 'unsupported', message: expect.stringContaining('Excel') })
    expect(readFile(enc('apenas uma frase sem colunas'), 'x.txt')).toMatchObject({ kind: 'error', message: expect.stringContaining('formato diferente') })
  })

  it('modelo salvo é aplicado sozinho no próximo arquivo com o mesmo cabeçalho', () => {
    const text = `Quando|O quê|Quanto\n15/10/2026|Mercadona|-45,30\n`
    const r = readFile(enc(text), 'a.csv')
    if (r.kind !== 'csv') throw new Error()
    const mapping = { ...r.mapping, columns: { date: 0, description: 1, amount: 2 }, decimal: ',' as const }
    const tpl = templateOf('Meu banco', r.guess, mapping, { currency: 'EUR' }, 't1', new Date())
    const again = readFile(enc(`Quando|O quê|Quanto\n20/10/2026|Lidl|-10,00\n`), 'b.csv', [tpl])
    expect(again.kind === 'csv' && again.template?.name).toBe('Meu banco')
    expect(linesOf(`Quando|O quê|Quanto\n20/10/2026|Lidl|-10,00\n`, 'b.csv', [tpl])[0]).toMatchObject({ day: '2026-10-20', amount: -1000 })
  })

  it('Wise: Payment Reference é memo, não id', () => {
    const r = readFile(enc(`TransferWise ID,Date,Amount,Currency,Description,Payment Reference,Running Balance\nTRANSFER-1,16-10-2026,-20.00,EUR,Card transaction,REF9,100.00\n`), 'wise.csv')
    if (r.kind !== 'csv') throw new Error()
    expect(r.mapping.columns).toMatchObject({ id: 0, date: 1, amount: 2, currency: 3, description: 4, memo: 5, balance: 6 })
  })
})

const ofx = (fitid = 'F1') => `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR
<BANKACCTFROM><BANKID>0081<ACCTID>ES1200810001234567
</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261015120000[-3:BRT]<TRNAMT>-45.30<FITID>${fitid}<NAME>MERCADONA<MEMO>COMPRA TARJ 1234
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261016<TRNAMT>200.00<FITID>F2<NAME>PERFECT CLEAN BCN
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

describe('OFX', () => {
  it('lê data, valor, tipo, descrição, memo, FITID, moeda e conta', () => {
    const r = readOfx(ofx())!
    expect(r.currency).toBe('EUR')
    expect(r.account).toBe('•••4567')
    expect(r.lines[0]).toMatchObject({ day: '2026-10-15', amount: -4530, fitid: 'F1', description: 'MERCADONA · COMPRA TARJ 1234', memo: 'COMPRA TARJ 1234', currency: 'EUR' })
    expect(r.lines[1]).toMatchObject({ day: '2026-10-16', amount: 20000, fitid: 'F2' })
  })

  it('OFX 2 (XML, tags fechadas)', () => {
    const r = readOfx(`<?xml version="1.0"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261001</DTPOSTED><TRNAMT>-10,50</TRNAMT><FITID>X</FITID><MEMO>Padaria</MEMO></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`)!
    expect(r.lines[0]).toMatchObject({ amount: -1050, currency: 'BRL', description: 'Padaria', fitid: 'X' })
  })

  it('arquivo repetido: tudo duplicado na segunda vez (pelo FITID)', () => {
    const first = analyzeText(ofx(), data(), { account: '•••4567' }, 'a.ofx')
    const { data: after } = importInto(data(), first, undefined, 'import-1', 'a.ofx')
    const second = analyzeText(ofx(), after, { account: '•••4567' }, 'a.ofx')
    expect(second.counts).toMatchObject({ new: 0, duplicate: 2 })
  })
})

describe('Normalização de descrições', () => {
  it('reconhece o mesmo estabelecimento', () => {
    expect(merchantKey('CARREFOUR 1234 DUBAI')).toBe('carrefour')
    expect(merchantKey('CARREFOUR UAE 0192')).toBe('carrefour')
    expect(merchantKey('POS CARREFOUR')).toBe('carrefour')
    expect(merchantKey('COMPRA TARJ. 5432 MERCADONA VALENCIA')).toBe('mercadona')
    expect(merchantKey('Transferencia de Ana Silva')).toBe('ana')
    expect(merchantKey('RESTAURANTE TIO PEPE 22')).toBe('restaurante tio')
    expect(normDescription('UBER   *TRIP 8812 HELP.UBER.COM')).toBe('uber trip help uber')
  })
  it('descrição mais limpa, original preservado', () => {
    expect(prettyDescription('MERCADONA  VALENCIA')).toBe('Mercadona Valencia')
    expect(prettyDescription('Padaria do João')).toBe('Padaria do João')
  })
})

describe('Deduplicação', () => {
  it('importar o mesmo arquivo duas vezes não duplica nada', () => {
    const a = analyzeText(csvSemicolon)
    expect(a.counts).toMatchObject({ read: 3, new: 3, duplicate: 0 })
    const { data: after } = importInto(data(), a)
    expect(after.transactions).toHaveLength(3)
    const again = analyzeText(csvSemicolon, after)
    expect(again.counts).toMatchObject({ new: 0, duplicate: 3 })
    const { data: twice } = importInto(after, again, undefined, 'import-2')
    expect(twice.transactions).toHaveLength(3)
  })

  it('arquivos diferentes com a mesma transação (período sobreposto)', () => {
    const { data: after } = importInto(data(), analyzeText(csvSemicolon))
    const overlap = `Fecha;Concepto;Importe
17/10/2026;UBER *TRIP 8812;-12,50
18/10/2026;LIDL 22;-30,00
`
    const a = analyzeText(overlap, after)
    expect(a.lines.map((l) => l.status)).toEqual(['duplicate', 'new'])
  })

  it('mesma transação em CSV e depois em OFX (sem o mesmo id): reconhecida', () => {
    const csv = `Fecha;Concepto;Importe\n15/10/2026;MERCADONA;-45,30\n`
    const { data: after } = importInto(data(), analyzeText(csv, data(), { account: '•••4567' }))
    const a = analyzeText(ofx(), after, { account: '•••4567' }, 'a.ofx')
    // OFX: "MERCADONA · COMPRA TARJ 1234" — not the same text, but the same merchant, value and day.
    expect(a.lines[0].status).toBe('possible')
    expect(defaultAction(a.lines[0])).toBe('skip')
  })

  it('possível duplicada não é ignorada em silêncio: fica para a pessoa decidir', () => {
    const { data: after } = importInto(data(), analyzeText(`Fecha;Concepto;Importe\n15/10/2026;MERCADONA VALENCIA;-45,30\n`))
    const a = analyzeText(`Fecha;Concepto;Importe\n16/10/2026;MERCADONA 22 VALENCIA;-45,30\n`, after)
    expect(a.lines[0].status).toBe('possible')
    expect(a.lines[0].note).toContain('Parecida')
    expect(a.counts.attention).toBe(1)
    // The person decides to import it anyway.
    const { data: kept } = importInto(after, a, new Map([[0, { action: 'import' }]]), 'import-2')
    expect(kept.transactions).toHaveLength(2)
  })

  it('duas transações iguais legítimas no mesmo dia continuam duas', () => {
    const two = `Fecha;Concepto;Importe\n15/10/2026;CAFE;-2,00\n15/10/2026;CAFE;-2,00\n`
    const a = analyzeText(two)
    expect(a.counts.new).toBe(2)
    expect(new Set(a.lines.map((l) => l.id)).size).toBe(2)
    const { data: after } = importInto(data(), a)
    expect(after.transactions).toHaveLength(2)
    expect(analyzeText(two, after).counts.duplicate).toBe(2)
    // A later statement with three coffees that day: the third is new.
    expect(analyzeText(two + '15/10/2026;CAFE;-2,00\n', after).lines.map((l) => l.status)).toEqual(['duplicate', 'duplicate', 'new'])
  })

  it('banco que reutiliza o identificador em outra transação: nunca some como duplicada', () => {
    // Same id in the file for two different lines: both are new.
    let a = analyzeText(`Id;Fecha;Concepto;Importe\nA1;15/10/2026;X;-1,00\nA1;16/10/2026;Y;-9,00\n`)
    expect(a.lines.map((l) => l.status)).toEqual(['new', 'new'])
    expect(new Set(a.lines.map((l) => l.id)).size).toBe(2)
    // Imported before; next month the bank uses A1 again for something else: possible, never a silent duplicate.
    const { data: after } = importInto(data(), analyzeText(`Id;Fecha;Concepto;Importe\nA1;15/10/2026;X;-1,00\n`))
    a = analyzeText(`Id;Fecha;Concepto;Importe\nA1;15/11/2026;Z;-50,00\n`, after)
    expect(a.lines[0].status).toBe('possible')
    const { data: both } = importInto(after, a, new Map([[0, { action: 'import' }]]), 'import-2')
    expect(both.transactions).toHaveLength(2)
    // And that one is then known: importing it again is a duplicate.
    expect(analyzeText(`Id;Fecha;Concepto;Importe\nA1;15/11/2026;Z;-50,00\n`, both).lines[0].status).toBe('duplicate')
  })

  it('FITID repetido no mesmo arquivo: a segunda é duplicada', () => {
    const a = analyzeText(`Id;Fecha;Concepto;Importe\nA1;15/10/2026;X;-1,00\nA1;15/10/2026;X;-1,00\n`)
    expect(a.lines.map((l) => l.status)).toEqual(['new', 'duplicate'])
  })
})

describe('Conciliação com o que já existe', () => {
  const projectTx = (over: Partial<Transaction> = {}) => tx('rcv-project-pay1', { reason: 'Site · Pagamento de projeto', amount: 20000, baseAmount: 20000, source: { kind: 'project', parentId: 'p1', paymentId: 'pay1' }, createdAt: '2026-10-15T10:00:00.000Z', ...over })
  const base = () =>
    data({
      clients: [client('c1', { name: 'Perfect Clean' })],
      projects: [project('p1', { name: 'Perfect Clean BCN', payments: [{ id: 'pay1', date: '2026-10-15', amount: 20000, currency: 'EUR', note: '' }] })],
      transactions: [projectTx()],
    })
  const line = (desc: string, day = '16/10/2026', value = '200,00') => `Fecha;Concepto;Importe\n${day};${desc};${value}\n`

  it('pagamento de projeto: concilia sozinho quando a confiança é muito alta', () => {
    const a = analyzeText(line('PERFECT CLEAN BCN'), base())
    expect(a.lines[0].status).toBe('reconciled')
    expect(a.lines[0].match?.label).toBe('Pagamento de projeto — Perfect Clean BCN')
    const { data: after, plan } = importInto(base(), a)
    expect(after.transactions).toHaveLength(1)
    expect(after.transactions[0]).toMatchObject({ id: 'rcv-project-pay1', amount: 20000, bank: { reconciled: true, importId: 'import-1' } })
    expect(plan.run.bankImport).toMatchObject({ created: 0, reconciled: 1, autoReconciled: 1 })
    // The same statement again: already reconciled → duplicate, nothing new.
    expect(analyzeText(line('PERFECT CLEAN BCN'), after).lines[0].status).toBe('duplicate')
  })

  it('venda', () => {
    const d = data({ sales: [sale('s1', { product: 'Tênis', clientName: 'Maria Souza', payments: [{ id: 'sp1', date: '2026-10-14', amount: 30000, note: '', finance: true }] })], transactions: [tx('rcv-sale-sp1', { reason: 'Venda · Tênis', amount: 30000, baseAmount: 30000, source: { kind: 'sale', parentId: 's1', paymentId: 'sp1' }, createdAt: '2026-10-14T10:00:00.000Z' })] })
    const a = analyzeText(line('TRANSFERENCIA MARIA SOUZA', '15/10/2026', '300,00'), d)
    expect(a.lines[0].status).toBe('reconciled')
    expect(a.lines[0].match?.label).toContain('Pagamento de venda')
  })

  it('assinante', () => {
    const d = data({
      subscribers: [{ id: 'sub1', createdAt: '', updatedAt: '', offeringId: 'o', planId: 'pl', name: 'João Lima', clientId: null, email: '', startDate: '2026-01-01', nextCharge: '', status: 'active', cancelledAt: '', payments: [{ id: 'run1', date: '2026-10-10', amount: 5000, note: '', currency: 'EUR' }], notes: '' }],
      transactions: [tx('rcv-sub-run1', { reason: 'Assinatura · João Lima', amount: 5000, baseAmount: 5000, source: { kind: 'subscriber', parentId: 'sub1', paymentId: 'run1' }, createdAt: '2026-10-10T10:00:00.000Z' })],
    })
    expect(analyzeText(line('BIZUM JOAO LIMA', '11/10/2026', '50,00'), d).lines[0].status).toBe('reconciled')
  })

  it('ferramenta', () => {
    const d = data({ tools: [{ id: 't1', createdAt: '', updatedAt: '', name: 'Figma', link: '', plan: '', price: 1500, currency: 'EUR', billing: 'monthly', nextCharge: '', notes: '', status: 'active' }], transactions: [tx('tool-t1-1', { type: 'out', reason: 'Figma', amount: 1500, baseAmount: -1500, source: { kind: 'tool', parentId: 't1', paymentId: 'x' }, createdAt: '2026-10-05T10:00:00.000Z' })] })
    const a = analyzeText(line('FIGMA.COM SAN FRANCISCO', '06/10/2026', '-15,00'), d)
    expect(a.lines[0].status).toBe('reconciled')
    expect(a.lines[0].match?.label).toBe('Ferramenta — Figma')
  })

  it('movimentação lançada à mão', () => {
    const d = data({ transactions: [tx('m1', { type: 'out', reason: 'Mercadona', amount: 4530, baseAmount: -4530, createdAt: '2026-10-15T18:00:00.000Z' })] })
    expect(analyzeText(line('COMPRA MERCADONA 1234', '15/10/2026', '-45,30'), d).lines[0].status).toBe('reconciled')
  })

  it('confiança baixa: só sugere (Precisa revisar), nunca concilia sozinho', () => {
    // Same value and day, but the text has nothing in common.
    const d = data({ transactions: [tx('m1', { type: 'out', reason: 'Almoço', amount: 1200, baseAmount: -1200, createdAt: '2026-10-15T13:00:00.000Z' })] })
    const a = analyzeText(line('REST XPTO 12', '15/10/2026', '-12,00'), d)
    expect(a.lines[0].status).toBe('review')
    expect(a.lines[0].note).toContain('Parece corresponder a Almoço')
    expect(defaultAction(a.lines[0])).toBe('skip')
    // Text matches but too far apart (6 days): suggestion only.
    expect(analyzeText(line('PERFECT CLEAN', '21/10/2026'), base()).lines[0].status).toBe('review')
    // Different value: nothing.
    expect(analyzeText(line('PERFECT CLEAN', '16/10/2026', '199,00'), base()).lines[0].status).toBe('new')
  })

  it('dois candidatos possíveis: não escolhe sozinho', () => {
    const d = data({
      transactions: [
        tx('m1', { type: 'out', reason: 'Mercadona', amount: 4530, baseAmount: -4530, createdAt: '2026-10-15T10:00:00.000Z' }),
        tx('m2', { type: 'out', reason: 'Mercadona', amount: 4530, baseAmount: -4530, createdAt: '2026-10-16T10:00:00.000Z' }),
      ],
    })
    expect(analyzeText(line('MERCADONA', '15/10/2026', '-45,30'), d).lines[0].status).toBe('review')
  })

  it('a pessoa concilia uma sugestão: continua uma movimentação só', () => {
    const d = data({ transactions: [tx('m1', { type: 'out', reason: 'Almoço', amount: 1200, baseAmount: -1200, createdAt: '2026-10-15T13:00:00.000Z' })] })
    const a = analyzeText(line('REST XPTO 12', '15/10/2026', '-12,00'), d)
    const { data: after } = importInto(d, a, new Map([[0, { action: 'reconcile' }]]))
    expect(after.transactions).toHaveLength(1)
    expect(after.transactions[0]).toMatchObject({ amount: 1200, baseAmount: -1200, bank: { reconciled: true } })
  })

  it('antes do início do Núcleo: fica para revisar (o saldo inicial já conta)', () => {
    const a = analyzeText(line('ALGO', '15/12/2025', '-10,00'))
    expect(a.lines[0]).toMatchObject({ status: 'review', beforeStart: true })
  })
})

describe('Categoria automática e aprendizado', () => {
  const out = (id: string, reason: string, category: string, extra: Partial<Transaction> = {}) => tx(id, { type: 'out', reason, amount: 1000, baseAmount: -1000, category, ...extra })

  it('nomes conhecidos', () => {
    const a = analyzeText(csvSemicolon)
    expect(a.lines.map((l) => l.category?.id)).toEqual(['food', 'salary', 'transport'])
    expect(a.counts.categorized).toBe(3)
  })

  it('nome conhecido com domínio e códigos (NETFLIX.COM, AMAZON.ES*1234)', () => {
    const a = analyzeText(`Fecha;Concepto;Importe\n15/10/2026;NETFLIX.COM;-15,99\n16/10/2026;AMAZON.ES*AB12CD;-20,00\n17/10/2026;BOOKING.COM HOTEL;-90,00\n`)
    expect(a.lines.map((l) => l.category?.id)).toEqual(['subscriptions', 'shopping', 'travel'])
  })

  it('decimal com vírgula reconhecido mesmo quando a coluna de valor ainda não foi escolhida', () => {
    const r = readFile(enc(`Quando|O que|Quanto|Codigo\n15/10/2026|LIDL|-30,00|12345\n`), 'x.csv')
    expect(r.kind === 'csv' && r.mapping.decimal).toBe(',')
  })

  it('regra explícita vem primeiro', () => {
    const d = data({ rules: [rule('moneyOut', [{ kind: 'setCategory', category: 'shopping' }], [{ field: 'text', contains: 'mercadona' }], { name: 'Mercadona é compras' })] })
    const a = analyzeText(csvSemicolon, d)
    expect(a.lines[0].category).toMatchObject({ id: 'shopping', source: 'rule', why: 'pela regra “Mercadona é compras”' })
  })

  it('uma correção vira só dica; duas consistentes passam a ser aplicadas', () => {
    const one = data({ transactions: [out('a', 'Loja X', 'leisure', { bank: { importId: 'i0', day: '2026-10-01', date: '', raw: 'LOJA X 11', autoCategory: 'shopping' } })] })
    let a = analyzeText(`Fecha;Concepto;Importe\n15/10/2026;LOJA X 22;-10,00\n`, one)
    expect(a.lines[0].category).toBeNull()
    expect(a.lines[0].hint).toMatchObject({ id: 'leisure', source: 'learned', apply: false })
    const two = data({ transactions: [...one.transactions, out('b', 'Loja X', 'leisure', { bank: { importId: 'i0', day: '2026-10-02', date: '', raw: 'LOJA X 33' } })] })
    a = analyzeText(`Fecha;Concepto;Importe\n15/10/2026;LOJA X 22;-10,00\n`, two)
    expect(a.lines[0].category).toMatchObject({ id: 'leisure', source: 'learned', apply: true })
  })

  it('correção da pessoa vence o nome conhecido (Mercadona → Lazer, não Alimentação)', () => {
    const d = data({ transactions: [out('a', 'Mercadona', 'leisure')] })
    const a = analyzeText(csvSemicolon, d)
    expect(a.lines[0].category).toBeNull()
    expect(a.lines[0].hint?.id).toBe('leisure')
  })

  it('conflito reduz a confiança', () => {
    const l = learnFrom([out('a', 'Loja Y', 'leisure'), out('b', 'Loja Y', 'leisure'), out('c', 'Loja Y', 'shopping')])
    expect(learnedGuess(l, 'out', 'LOJA Y', settings)?.apply).toBe(false)
    const l2 = learnFrom([out('a', 'Loja Y', 'leisure'), out('b', 'Loja Y', 'shopping')])
    expect(learnedGuess(l2, 'out', 'LOJA Y', settings)).toMatchObject({ apply: false })
  })

  it('o que o Núcleo aplicou sozinho e ninguém mexeu não conta como aprendizado', () => {
    const l = learnFrom([out('a', 'Loja Z', 'other', { bank: { importId: 'i', day: '2026-10-01', date: '', raw: 'LOJA Z', autoCategory: 'other' } })])
    expect(l.size).toBe(0)
  })

  it('a descrição normalizada junta as variações', () => {
    const d = data({ transactions: [out('a', 'Carrefour', 'leisure'), out('b', 'Carrefour', 'leisure')] })
    const a = analyzeText(`Fecha;Concepto;Importe\n15/10/2026;CARREFOUR 1234 DUBAI;-10,00\n16/10/2026;POS CARREFOUR UAE 0192;-11,00\n`, d)
    expect(a.lines.map((x) => x.category?.id)).toEqual(['leisure', 'leisure'])
  })

  it('categoria em lote: a escolha da pessoa é gravada e passa a ensinar', () => {
    const a = analyzeText(csvSemicolon)
    const { data: after } = importInto(data(), a, new Map([[0, { action: 'import', category: 'shopping' }]]))
    const m = after.transactions.find((t) => t.reason.startsWith('Mercadona'))!
    expect(m.category).toBe('shopping')
    expect(m.bank?.autoCategory).toBeUndefined()
    const auto = after.transactions.find((t) => t.reason.startsWith('Uber'))!
    expect(auto.bank?.autoCategory).toBe('transport')
  })
})

describe('Desfazer importação', () => {
  it('remove o que a importação criou e só desliga as conciliadas', () => {
    const d = data({ transactions: [tx('m1', { type: 'out', reason: 'Mercadona', amount: 4530, baseAmount: -4530, createdAt: '2026-10-15T18:00:00.000Z' })] })
    const a = analyzeText(csvSemicolon, d)
    expect(a.lines[0].status).toBe('reconciled')
    const { data: after, plan } = importInto(d, a)
    expect(after.transactions).toHaveLength(3)
    const run = after.automationRuns.find((r) => r.id === plan.run.id)!
    const u = undoImport(run, after, TODAY)!
    expect(u).toMatchObject({ removed: 2, unlinked: 1, kept: [] })
    const back = (await_(after, u.ops))
    expect(back.transactions).toHaveLength(1)
    expect(back.transactions[0].id).toBe('m1')
    expect(back.transactions[0].bank).toBeUndefined()
    expect(back.automationRuns.find((r) => r.id === plan.run.id)?.status).toBe('undone')
  })

  it('preserva movimentação editada depois', () => {
    const { data: after, plan } = importInto(data(), analyzeText(csvSemicolon))
    const edited = after.transactions.map((t) => (t.reason.startsWith('Uber') ? { ...t, reason: 'Uber para o cliente' } : t))
    const state = { ...after, transactions: edited }
    const run = state.automationRuns.find((r) => r.id === plan.run.id)!
    const u = undoImport(run, state, TODAY)!
    expect(u.removed).toBe(2)
    expect(u.kept).toEqual([{ id: expect.any(String), label: 'Uber para o cliente', why: 'editada depois da importação' }])
    expect(await_(state, u.ops).transactions.map((t) => t.reason)).toEqual(['Uber para o cliente'])
  })

  it('nunca toca em movimentação de outra importação ou lançada à mão', () => {
    const d = data({ transactions: [tx('manual', { reason: 'Outra coisa' })] })
    const first = importInto(d, analyzeText(csvSemicolon, d))
    const second = importInto(first.data, analyzeText(`Fecha;Concepto;Importe\n18/10/2026;LIDL;-30,00\n`, first.data), undefined, 'import-2')
    const run = second.data.automationRuns.find((r) => r.id === 'import-1')!
    const back = await_(second.data, undoImport(run, second.data, TODAY)!.ops)
    expect(back.transactions.map((t) => t.reason).sort()).toEqual(['Lidl', 'Outra coisa'])
  })
})

describe('Regras da Parte 2', () => {
  const reserve = () => rule('moneyIn', [{ kind: 'reservePercent', goalId: 'g1', percent: 20 }], [{ field: 'category', values: ['salary'] }], { name: 'Guardar 20%' })
  const start = () => data({ rules: [reserve()], financeGoals: [goal('g1')], transactions: [tx('saldo', { amount: 500000, baseAmount: 500000, reason: 'Saldo' })] })

  it('movimentação nova importada dispara a regra', () => {
    const { data: after, ops } = importInto(start(), analyzeText(csvSemicolon, start()))
    const runs = after.automationRuns.filter((r) => r.automation === 'rule')
    expect(runs).toHaveLength(1)
    expect(runs[0].summary).toContain('reservou')
    expect(after.financeGoals[0].saved).toBe(40000)
    expect(ops.length).toBeGreaterThan(0)
  })

  it('reimportar (duplicada) não dispara de novo', () => {
    const first = importInto(start(), analyzeText(csvSemicolon, start()))
    const again = importInto(first.data, analyzeText(csvSemicolon, first.data), undefined, 'import-2')
    expect(again.ops).toHaveLength(0)
    expect(again.data.financeGoals[0].saved).toBe(40000)
  })

  it('conciliada com movimentação antiga não dispara o mesmo evento', () => {
    const d = { ...start(), transactions: [...start().transactions, tx('sal', { reason: 'Nomina', amount: 200000, baseAmount: 200000, category: 'salary', createdAt: '2026-10-16T08:00:00.000Z' })] }
    const a = analyzeText(csvSemicolon, d)
    expect(a.lines[1].status).toBe('reconciled')
    const { data: after } = importInto(d, a)
    expect(after.automationRuns.filter((r) => r.automation === 'rule')).toHaveLength(0)
  })

  it('regra só de categoria não roda de novo (a importação já aplicou a categoria dela)', () => {
    const d = data({ rules: [rule('moneyOut', [{ kind: 'setCategory', category: 'shopping' }], [{ field: 'text', contains: 'mercadona' }])] })
    const { data: after } = importInto(d, analyzeText(csvSemicolon, d))
    expect(after.transactions.find((t) => t.reason.startsWith('Mercadona'))?.category).toBe('shopping')
    expect(after.automationRuns.filter((r) => r.automation === 'rule')).toHaveLength(0)
  })

  it('desfazer a importação desfaz o que a regra fez por causa dela', () => {
    const { data: after, plan } = importInto(start(), analyzeText(csvSemicolon, start()))
    const run = after.automationRuns.find((r) => r.id === plan.run.id)!
    const u = undoImport(run, after, TODAY)!
    expect(u.rules).toBe(1)
    const back = await_(after, u.ops)
    expect(back.financeGoals[0].saved).toBe(0)
    expect(back.automationRuns.find((r) => r.automation === 'rule')?.status).toBe('undone')
  })

  it('muitas linhas: não para no limite de 20 execuções por gravação', () => {
    const rows = Array.from({ length: 25 }, (_, i) => `${String((i % 19) + 1).padStart(2, '0')}/10/2026;NOMINA ${i};100,00`).join('\n')
    const d = { ...start(), rules: [{ ...reserve(), since: '2026-01-01' }] }
    const { data: after } = importInto(d, analyzeText(`Fecha;Concepto;Importe\n${rows}\n`, d))
    expect(after.automationRuns.filter((r) => r.automation === 'rule' && r.status === 'done')).toHaveLength(25)
    expect(after.automationRuns.some((r) => r.summary.startsWith('Cadeia interrompida'))).toBe(false)
  })
})

import { applyOps } from '../src/core/rules/work'
function await_(d: Parameters<typeof applyOps>[0], ops: Parameters<typeof applyOps>[1]) {
  return applyOps(d, ops)
}

describe('Desempenho', () => {
  const big = (n: number) => {
    const rows: string[] = []
    for (let i = 0; i < n; i++) rows.push(`${String((i % 28) + 1).padStart(2, '0')}/${String((i % 9) + 1).padStart(2, '0')}/2026;COMPRA ${['MERCADONA', 'LIDL', 'UBER', 'NETFLIX', 'CAFE'][i % 5]} ${i};-${(i % 90) + 1},${String(i % 100).padStart(2, '0')}`)
    return `Fecha;Concepto;Importe\n${rows.join('\n')}\n`
  }
  for (const n of [100, 1000, 5000]) {
    it(`${n} linhas: ler, analisar, gravar e reimportar em tempo razoável`, () => {
      const existing = data({ transactions: Array.from({ length: 3000 }, (_, i) => tx(`old${i}`, { type: 'out', reason: `Coisa ${i}`, amount: 777 + i, baseAmount: -(777 + i), createdAt: '2026-05-01T10:00:00.000Z' })) })
      const t0 = performance.now()
      const a = analyzeText(big(n), existing)
      const t1 = performance.now()
      const { data: after } = importInto(existing, a)
      const t2 = performance.now()
      const again = analyzeText(big(n), after)
      const t3 = performance.now()
      expect(a.counts.read).toBe(n)
      // Lines left to review the first time (same value and day as an old movement) are still to review.
      expect(again.counts.duplicate).toBe(a.counts.new)
      expect(after.transactions.length).toBe(3000 + a.counts.new)
      // Generous limits for a slow machine; the real numbers are printed.
      console.log(`${n} linhas: analisar ${Math.round(t1 - t0)} ms · gravar ${Math.round(t2 - t1)} ms · reimportar ${Math.round(t3 - t2)} ms`)
      expect(t1 - t0).toBeLessThan(n * 2 + 1500)
      expect(t2 - t1).toBeLessThan(n * 2 + 1500)
    })
  }
})

describe('guessMapping', () => {
  it('ignora coluna “F. Valor” como valor (é data)', () => {
    const sheet = readSheet(`F. Operativa;Concepto;F. Valor;Importe\n16/10/2026;X;16/10/2026;20,00\n`)!
    expect(guessMapping(sheet).mapping.columns).toMatchObject({ date: 0, description: 1, amount: 3 })
  })
})
