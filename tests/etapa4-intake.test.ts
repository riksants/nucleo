/**
 * Etapa 4.6 — Importação inteligente: extrair (texto, Word, Excel, PDF com texto; PDF digitalizado e foto são
 * recusados com motivo), reconhecer (dieta, treino, agenda, finanças, projeto, compras), nunca descartar em
 * silêncio, gravar só o escolhido, não duplicar ao importar de novo e desfazer com segurança.
 */
import { describe, expect, it } from 'vitest'
import { planIntake, previousImport, undoIntake } from '../src/core/intake/commit'
import { detect, type IntakeItem, type Proposal } from '../src/core/intake/detect'
import { docxText, extractFile, extractText } from '../src/core/intake/extract'
import { applyOps } from '../src/core/rules/work'
import { mealTypes } from '../src/core/meals'
import { settings } from './rules-helpers'
import { data } from './rules-helpers'
import { makePdf, makeZip } from './zip-helpers'

const TODAY = '2026-10-29'
const NOW = new Date(`${TODAY}T10:00:00.000Z`)
const types = mealTypes(settings)
const typeOf = (label: string) => types.find((t) => t.label === label)?.id
const ctx = { today: TODAY, mealTypes: types, title: 'documento.txt' }
const lines = (s: string) => s.split('\n').filter((l) => l.trim())
const best = (s: string): Proposal => detect({ lines: lines(s) }, ctx)[0]
const meta = (hash = 'h1') => ({ source: 'documento.txt', hash, today: TODAY, now: NOW, baseCurrency: 'EUR' })

describe('extrair', () => {
  it('texto colado', () => {
    const r = extractText('linha 1\n\nlinha 2  ')
    expect(r).toMatchObject({ kind: 'text', lines: ['linha 1', 'linha 2'] })
  })

  it('Word (.docx): parágrafos, tabulações e tabelas', async () => {
    expect(docxText('<w:p><w:r><w:t>Treino A</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Supino</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>4x10</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')).toEqual(['Treino A', 'Supino', '4x10'])
    const zip = await makeZip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Lista de compras</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">2 kg arroz &amp; feijão</w:t></w:r></w:p></w:body></w:document>' })
    const r = await extractFile(zip, 'compras.docx')
    expect(r).toMatchObject({ kind: 'text', lines: ['Lista de compras', '2 kg arroz & feijão'] })
  })

  it('PDF com texto é lido pelas linhas; PDF sem texto (digitalizado) é recusado com motivo', async () => {
    const r = await extractFile(makePdf(['Treino A - segunda e quinta 7h', 'Supino reto 4x10 60kg', 'Remada 3x12']), 'treino.pdf')
    expect(r.kind).toBe('text')
    if (r.kind === 'text') expect(r.lines).toEqual(['Treino A - segunda e quinta 7h', 'Supino reto 4x10 60kg', 'Remada 3x12'])
    const scan = await extractFile(makePdf([]), 'scan.pdf')
    expect(scan).toMatchObject({ kind: 'error' })
    if (scan.kind === 'error') expect(scan.message).toMatch(/digitalizado/)
  }, 60_000)

  it('foto e formatos antigos: recusados com motivo (sem fingir que leu)', async () => {
    expect(await extractFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]), 'dieta.jpg')).toMatchObject({ kind: 'error', message: expect.stringMatching(/imagem/) })
    expect(await extractFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1]), 'treino.doc')).toMatchObject({ kind: 'error', message: expect.stringMatching(/formato antigo/) })
    expect(await extractFile(new Uint8Array(11 * 1024 * 1024), 'grande.txt')).toMatchObject({ kind: 'error', message: expect.stringMatching(/grande demais/) })
  })
})

describe('reconhecer, preservando detalhes', () => {
  it('treino: ficha com séries, repetições, carga e observações + recorrente nos dias certos', () => {
    const p = best('Treino A — segunda e quinta às 7h\nSupino reto 4x10 60kg\nRemada curvada 3 séries de 12\nObs: descanso de 60s\nTreino B: quarta\nAgachamento 4x8-10 80 kg')
    expect(p.target).toBe('training')
    const notes = p.items.filter((x) => x.kind === 'note') as Extract<IntakeItem, { kind: 'note' }>[]
    expect(notes[0].body).toContain('- [ ] Supino reto 4x10 60kg')
    expect(notes[0].body).toContain('- [ ] Remada curvada 3 séries de 12')
    expect(notes[0].body).toContain('Obs: descanso de 60s')
    const rec = p.items.filter((x) => x.kind === 'recurring') as Extract<IntakeItem, { kind: 'recurring' }>[]
    expect(rec.map((r) => [r.title, r.rule, r.time])).toEqual([
      ['Treino A — segunda e quinta às 7h', { type: 'weekdays', days: [1, 4] }, '07:00'],
      ['Treino B: quarta', { type: 'weekdays', days: [3] }, ''],
    ])
    expect(p.unrecognised).toEqual([])
  })

  it('dieta: refeições com horários e quantidades como escritos; o que não é refeição fica visível', () => {
    const p = best('Plano alimentar da nutricionista\n07:00 Café da manhã: 2 ovos, 1 fatia de pão integral, café sem açúcar\n12:30 Almoço: 150 g de frango, arroz, salada\n16:00 Lanche: iogurte natural\n20:00 Jantar: sopa de legumes')
    expect(p.target).toBe('meals')
    const meals = p.items as Extract<IntakeItem, { kind: 'meal' }>[]
    expect(meals.map((m) => m.time)).toEqual(['07:00', '12:30', '16:00', '20:00'])
    expect(meals[0].type).toBe(typeOf('Café da manhã'))
    expect(meals[1].type).toBe(typeOf('Almoço'))
    expect(meals[3].type).toBe(typeOf('Jantar'))
    expect(meals[1].ingredients).toContain('150 g de frango')
    expect(p.unrecognised.map((u) => u.line)).toEqual(['Plano alimentar da nutricionista'])
  })

  it('cronograma de estudos: recorrentes e compromissos', () => {
    const p = best('Matemática segunda e quarta às 19h\nInglês toda terça 18h30\nProva de física dia 15/11 às 9h')
    expect(p.target).toBe('schedule')
    expect(p.items.map((x) => x.kind)).toEqual(['recurring', 'recurring', 'event'])
  })

  it('lista de compras: quantidade e unidade preservadas', () => {
    const p = best('Lista de compras:\n2 kg arroz\n1 l leite\npão\n6 ovos')
    expect(p.target).toBe('shopping')
    expect((p.items as Extract<IntakeItem, { kind: 'shopping' }>[]).map((x) => [x.qty, x.unit, x.name])).toEqual([
      ['2', 'kg', 'Arroz'],
      ['1', 'l', 'Leite'],
      ['', '', 'Pão'],
      ['6', '', 'Ovos'],
    ])
  })

  it('planejamento: projeto com tarefas e prazos', () => {
    const p = best('Site da Ana\n1. Briefing até 05/11\n2. Layout até 12/11\n3. Desenvolvimento até 30/11')
    expect(p.target).toBe('project')
    expect(p.items[0]).toMatchObject({ kind: 'project', name: 'Site da Ana', dueDate: '2026-11-30' })
    expect(p.items.slice(1).map((x) => (x as Extract<IntakeItem, { kind: 'task' }>).dueDate)).toEqual(['2026-11-05', '2026-11-12', '2026-11-30'])
  })

  it('movimentações vão para Importar extrato (sem atalho)', () => {
    const p = best('05/10 Mercadona -45,20\n06/10 Salário +2.500,00\n07/10 Uber -12,90')
    expect(p.target).toBe('finance')
    expect(p.items).toEqual([])
  })

  it('sempre há a opção de guardar tudo como anotação, exatamente como está', () => {
    const all = detect({ lines: ['qualquer coisa', 'sem padrão'] }, ctx)
    expect(all.at(-1)).toMatchObject({ target: 'note', items: [{ body: 'qualquer coisa\nsem padrão' }] })
  })
})

describe('gravar, não duplicar e desfazer', () => {
  const text = 'Lista de compras:\n2 kg arroz\n1 l leite\nobservação longa que não é um item de compra porque tem muitas palavras mesmo'
  it('só o escolhido; o não reconhecido vira anotação; importar de novo não repete', () => {
    const p = best(text)
    const items = p.items.map((x, i) => (i === 1 ? { ...x, include: false } : x))
    const plan = planIntake(p, items, { unrecognised: true }, data(), meta())
    if (typeof plan === 'string') throw new Error(plan)
    let d = applyOps(data(), plan.ops)
    expect(d.shoppingItems.map((x) => x.name)).toEqual(['Arroz'])
    expect(d.notes[0].body).toContain('observação longa')
    expect(plan.run.smartImport).toMatchObject({ created: 2, skipped: 1, unrecognised: 1, duplicates: 0 })
    expect(previousImport(d, 'h1', 'shopping')?.id).toBe(plan.run.id)
    const again = planIntake(p, items, { unrecognised: true }, d, { ...meta(), now: new Date(NOW.getTime() + 1000) })
    if (typeof again === 'string') throw new Error(again)
    expect(again).toMatchObject({ created: 0, duplicates: 2 })
    d = applyOps(d, again.ops)
    expect(d.shoppingItems).toHaveLength(1)
  })

  it('desfazer remove o que está como foi importado e mantém o que a pessoa editou', () => {
    const p = best(text)
    const plan = planIntake(p, p.items, { unrecognised: false }, data(), meta('h2'))
    if (typeof plan === 'string') throw new Error(plan)
    let d = applyOps(data(), plan.ops)
    d = { ...d, shoppingItems: d.shoppingItems.map((x) => (x.name === 'Leite' ? { ...x, checked: true } : x)) }
    const u = undoIntake(plan.run, d, TODAY)!
    expect(u.partial).toBe(true)
    d = applyOps(d, u.ops)
    expect(d.shoppingItems.map((x) => x.name)).toEqual(['Leite'])
    expect(d.automationRuns[0]).toMatchObject({ status: 'undone', smartImport: { undone: true } })
  })

  it('nada escolhido e nada para guardar: não grava', () => {
    const p = best(text)
    expect(planIntake(p, p.items.map((x) => ({ ...x, include: false })), { unrecognised: false }, data(), meta())).toMatch(/Escolha/)
  })
})

describe('treino curto não vira lista de compras', () => {
  it('quatro linhas de ficha são treino', () => {
    const p = detect({ lines: ['Treino A - segunda e quinta 7h', 'Supino reto 4x10 60kg', 'Remada curvada 3x12', 'Obs: descanso 60s'] }, { today: '2026-10-29', mealTypes: [], title: 'x' })[0]
    expect(p.target).toBe('training')
  })
})
