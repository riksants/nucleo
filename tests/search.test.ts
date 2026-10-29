import { describe, expect, it } from 'vitest'
import { distance, fold, parseQuery, stem, wordScore } from '../src/features/search/engine'
import { makeEntry, rankPlaces, RecordIndex, searchRecords } from '../src/features/search/search'
import type { ModuleId } from '../src/data/types'

const ALL_ON = { enabled: () => true, hasSubPlans: true }
const places = (q: string, ctx = ALL_ON) => rankPlaces(parseQuery(q), ctx).map((h) => h.dest.id)
const top = (q: string, ctx = ALL_ON) => places(q, ctx)[0]

describe('engine', () => {
  it('ignores accents, case and punctuation', () => {
    expect(fold('  Portfólio, Anotações! ')).toBe('portfolio anotacoes')
  })
  it('turns common plurals into the singular', () => {
    expect(['contas', 'clientes', 'anotacoes', 'valores', 'refeicoes', 'acessos', 'tarefas'].map(stem)).toEqual(['conta', 'cliente', 'anotacao', 'valor', 'refeicao', 'acesso', 'tarefa'])
  })
  it('forgives small typos', () => {
    expect(distance('clinte', 'cliente', 1)).toBe(1)
    expect(distance('portifolio', 'portfolio', 1)).toBe(1)
    expect(distance('tarfea', 'tarefa', 1)).toBe(1) // swapped letters
    expect(wordScore('cli', 'cliente')).toBeGreaterThan(0.8)
    expect(wordScore('xyz', 'cliente')).toBe(0)
  })
  it('separates intent from content', () => {
    const q = parseQuery('Quero adicionar um cliente')
    expect(q.create).toBe(true)
    expect(q.content).toEqual(['cliente'])
    expect(parseQuery('Quanto tenho para receber?').question).toBe(true)
    expect(parseQuery('Minhas tarefas').content).toEqual(['tarefa'])
  })
})

describe('places and actions', () => {
  it('finds sections by name, plural, accent and typo', () => {
    expect(top('clientes')).toBe('section:clients')
    expect(top('Portfólio')).toBe('section:portfolio')
    expect(top('portifolio')).toBe('section:portfolio')
    expect(top('alimentacao')).toBe('section:meals')
    expect(top('Minhas tarefas')).toBe('section:tasks')
    expect(top('clinte')).toBe('section:clients')
  })
  it('shows the related places for "contas"', () => {
    const ids = places('contas')
    expect(ids).toEqual(expect.arrayContaining(['section:accounts', 'account', 'section:recurring']))
  })
  it('finds "assinaturas" and its actions', () => {
    const ids = places('assinaturas')
    expect(ids[0]).toBe('section:tools')
    expect(ids).toContain('new:tool')
  })
  it('understands what the person wants to do', () => {
    expect(top('Quero adicionar um cliente')).toBe('new:client')
    expect(top('cadastrar cliente')).toBe('new:client')
    expect(top('Registrar pagamento')).toBe('new:expense')
    expect(top('Criar meta')).toBe('new:goal')
    expect(places('Criar meta')).toContain('new:objective')
    expect(top('nova tarefa')).toBe('new:task')
    expect(top('anotar uma ideia')).toBe('new:note')
  })
  it('answers questions', () => {
    const ids = places('Quanto tenho para receber?')
    expect(ids.slice(0, 2).sort()).toEqual(['answer:receivable-projects', 'answer:receivable-sales'])
    expect(top('qual meu saldo?')).toBe('answer:balance')
  })
  it('"pagamento" finds finance and the action to register one', () => {
    const ids = places('pagamento')
    expect(ids).toEqual(expect.arrayContaining(['section:finance', 'new:expense']))
  })
  it('updates while typing', () => {
    expect(top('cli')).toBe('section:clients')
    expect(top('portf')).toBe('section:portfolio')
  })
  it('a hidden section offers to show it; its actions stay out', () => {
    const ctx = { enabled: (id: ModuleId) => id !== 'clients', hasSubPlans: false }
    const hits = rankPlaces(parseQuery('adicionar cliente'), ctx)
    expect(hits.find((h) => h.dest.id === 'section:clients')?.hidden).toBe(true)
    expect(hits.some((h) => h.dest.id === 'new:client')).toBe(false)
    expect(places('novo assinante', ctx)).not.toContain('new:subscriber')
  })
  it('gibberish finds nothing', () => {
    expect(places('qwrtzxv')).toEqual([])
  })
})

describe('records', () => {
  const index = new RecordIndex([
    makeEntry({ group: 'Clientes', path: '/clients', openId: 'c1', title: 'João Pereira', subtitle: 'Padaria Sol' }, ['Padaria Sol', 'joao@exemplo.com', '+351 912 345 678']),
    makeEntry({ group: 'Movimentações', path: '/finance', openId: 't1', title: 'Pagamento do aluguel' }, ['Moradia', '850 850,00', 'saida pagamento']),
    makeEntry({ group: 'Tarefas', path: '/tasks', openId: 'k1', title: 'Enviar orçamento' }, ['Site da padaria']),
  ])
  const find = (q: string) => searchRecords(index, parseQuery(q)).flatMap((g) => g.hits.map((h) => h.openId))

  it('finds by name without accents and with typos', () => {
    expect(find('joao')).toEqual(['c1'])
    expect(find('pereria')).toEqual(['c1'])
    expect(find('orcamento')).toEqual(['k1'])
  })
  it('finds by other fields (company, e-mail, amount, category)', () => {
    expect(find('padaria')).toEqual(['c1', 'k1'])
    expect(find('joao@exemplo')).toEqual(['c1'])
    expect(find('850')).toEqual(['t1'])
    expect(find('moradia')).toEqual(['t1'])
  })
  it('needs every meaningful word, ignoring the verbs', () => {
    expect(find('registrar pagamento')).toEqual(['t1'])
    expect(find('pagamento padaria')).toEqual([])
  })
})
