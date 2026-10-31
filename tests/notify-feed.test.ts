// Central de notificações: estados ditos só como se sabem (enviado ≠ visto), marcas da pessoa,
// histórico do servidor + o que apareceu no app, separação por conta no aparelho.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rows: Record<string, unknown>[] = []
const marks: { keys: string[] | null; action: string }[] = []
const fake = {
  from: () => {
    const q = {
      select: () => q,
      gt: () => q,
      lte: () => q,
      order: () => q,
      limit: async () => ({ data: rows, error: null }),
    }
    return q
  },
  rpc: async (_name: string, a: { p_keys: string[] | null; p_action: string }) => (marks.push({ keys: a.p_keys, action: a.p_action }), { data: 1, error: null }),
}
vi.mock('../src/lib/supabase', () => ({ supabase: fake }))
const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })

const feed = await import('../src/features/notifications/feed')
const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString()
const occ = (key: string, min: number, over = {}) => ({ key, kind: 'tasks' as const, fireAt: new Date(Date.now() + min * 60_000), title: 'Entregar site', body: 'Entregar site — hoje às 15:00', detail: 'Entregar site — hoje às 15:00', plain: 'Entregar site — hoje às 15:00', url: '#/tasks?open=t1', custom: false, ...over })
const server = (key: string, status: string, over = {}) => ({ key, fire_at: at(-30), title: 'Pagar: Spotify', body: 'A assinatura Spotify vence hoje', detail: 'A assinatura Spotify de € 10,99 vence hoje', url: '#/tools?open=x', kind: 'payments', custom: false, origin: 'app', status, sent_at: at(-30), grouped: false, dismissed_at: null, seen_at: null, last_error: null, ...over })

beforeEach(() => {
  rows.length = 0
  marks.length = 0
  store.clear()
  feed.setFeedOwner(null)
  feed.setUpcoming([])
})

describe('central de notificações', () => {
  it('sem conta: o que apareceu no app e o que vem; marcas ficam no aparelho', async () => {
    await feed.refreshHistory(false)
    feed.logShown([occ('a', -5)])
    feed.setUpcoming([occ('b', 60), occ('old', -1)])
    const { past, upcoming } = feed.feedEntries()
    expect(past.map((e) => [e.key, e.state, e.origin])).toEqual([['a', 'inApp', 'auto']])
    expect(upcoming.map((e) => [e.key, e.state])).toEqual([['b', 'scheduled']])
    expect(feed.unreadCount()).toBe(1)
    await feed.markSeen(null)
    expect(feed.unreadCount()).toBe(0)
    expect(marks).toEqual([]) // nada vai ao servidor sem conta
  })

  it('com conta: histórico do servidor com o resultado real; "enviado" não vira "lido"', async () => {
    rows.push(server('s1', 'sent'), server('s2', 'failed', { last_error: '410' }), server('s3', 'nodevice'), server('s4', 'expired', { sent_at: null }), server('s5', 'scheduled'), server('mine', 'sent', { custom: true }))
    await feed.refreshHistory(true)
    const { past } = feed.feedEntries()
    const by = Object.fromEntries(past.map((e) => [e.key, e]))
    expect(by.s1).toMatchObject({ state: 'sent', seen: false, text: 'A assinatura Spotify de € 10,99 vence hoje' })
    expect(by.s2).toMatchObject({ state: 'failed', error: '410' })
    expect(by.s3.state).toBe('nodevice')
    expect(by.s4.state).toBe('expired')
    expect(by.s5.state).toBe('processed') // enviado antes do histórico: sem afirmar o resultado
    expect(by.mine.origin).toBe('mine')
    expect(feed.unreadCount()).toBe(6)
    await feed.dismiss(['s2'])
    await feed.markSeen(['s1'])
    expect(marks).toEqual([{ keys: ['s2'], action: 'dismiss' }, { keys: ['s1'], action: 'seen' }])
    const after = Object.fromEntries(feed.feedEntries().past.map((e) => [e.key, e]))
    expect(after.s2.dismissed).toBe(true)
    expect(after.s1.seen).toBe(true)
    expect(feed.unreadCount()).toBe(4)
  })

  it('o registro local de uma conta não aparece para outra no mesmo aparelho', async () => {
    feed.setFeedOwner('u1')
    feed.logShown([occ('de-u1', -1)])
    feed.setFeedOwner('u2')
    await feed.refreshHistory(false)
    expect(feed.feedEntries().past).toEqual([])
    feed.setFeedOwner('u1')
    expect(feed.feedEntries().past.map((e) => e.key)).toEqual(['de-u1'])
  })
})
