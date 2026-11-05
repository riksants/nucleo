/**
 * NÚCLEO IA — Etapa 3, consistency of the fast model on action requests (REAL API, needs authorization).
 *
 * Each request is repeated in a NEW conversation (no history influence). For every repetition:
 * - did the model CALL propor_acoes, or only say it prepared something? (claim without plan = failure)
 * - the store is compared before/after the turn: nothing may be written before a confirmation;
 * - the preview values (after-reserve amount, new time range, duration) and the answer text are checked.
 * IA_REPS (default 3) repetitions; IA_FORCE_EFFORT=medium compares the same requests at medium effort.
 *
 *   IA_KEY_FILE=… IA_MAX_USD=0.05 IA_REPORT=… npx vitest run tests/nucleo-ia-real-etapa3-rep.test.ts
 */
import Anthropic from '@anthropic-ai/sdk'
import { PGlite } from '@electric-sql/pglite'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { continueTurn, startTurn, type Block, type Deps, type Reservation } from '../supabase/functions/_shared/ia/engine'
import { FactBook, plainAnswer, renderAnswer } from '../supabase/functions/_shared/ia/facts'
import { costMicros, type ModelKey } from '../supabase/functions/_shared/ia/models'
import type { StartRequest, TurnResponse } from '../supabase/functions/_shared/ia/protocol'
import { ACTION_TOOL } from '../supabase/functions/_shared/ia/actions'
import { newConversation, topicsOf } from '../src/core/assistant/ia/conversation'
import { runLookup } from '../src/core/assistant/ia/lookups'
import { runActionsTool } from '../src/core/assistant/ia/actions/tool'
import { previewValues, type Plan } from '../src/core/assistant/ia/actions/plan'
import { claimsPlan } from '../src/core/assistant/ia/client'
import { account, NOW, settings } from './ia-fixtures'

function readKey(): string | undefined {
  const file = process.env.IA_KEY_FILE
  if (file && existsSync(file)) return readFileSync(file, 'utf8').replace(/^﻿/, '').trim() || undefined
  return process.env.ANTHROPIC_API_KEY || undefined
}
const KEY = readKey()
const A = '11111111-1111-4111-8111-111111111111'
const TODAY = '2026-11-04'
const SECRET = 'segredo-local-de-medicao-com-mais-de-32-caracteres'

type Outcome = 'propôs' | 'perguntou' | 'disse que preparou SEM prévia'
interface Row { req: string; rep: number; effort: string; outcome: Outcome; plan: string; ms: number; cost: number; calls: number; checks: { name: string; ok: boolean }[]; answer: string }

describe.skipIf(!KEY)('NÚCLEO IA etapa 3 — consistência do Haiku em pedidos de ação (gasta dinheiro)', () => {
  it('repetições: chama a ferramenta, nada gravado antes de confirmar, valores certos', async () => {
    const client = new Anthropic({ apiKey: KEY, maxRetries: 0, timeout: 120_000 })
    const db = new PGlite()
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
      grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;`)
    await db.query('insert into auth.users (id) values ($1)', [A])
    for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'))
    const maxUsd = Number(process.env.IA_MAX_USD ?? '0.05')
    await db.query(`update ai_tiers set period_micros = $1::bigint, daily_micros = $1::bigint, sonnet_period_micros = least($1::bigint, 120000) where tier = 'free'`, [Math.floor(maxUsd * 1e6)])
    const force = process.env.IA_FORCE_EFFORT as 'low' | 'medium' | undefined
    const reps = Number(process.env.IA_REPS ?? '3')

    const data = account() // never written: the test does not confirm anything
    const snapshot = JSON.stringify(data)

    async function ask(q: string) {
      const calls: { model: ModelKey; ms: number; cost: number }[] = []
      const deps: Deps = {
        uid: A,
        secret: SECRET,
        now: () => Date.now(),
        async reserve(a) {
          const r = (await db.query<{ outcome: Reservation['outcome']; usage_id: number | null; granted: number }>('select outcome, usage_id::int, granted::int from ia_reserve($1,$2,$3,$4,$5,$6,$7)', [A, a.turnId, a.step, a.model, a.route, a.wantedMicros, a.minMicros])).rows[0]
          return { outcome: r.outcome, usageId: r.usage_id, grantedMicros: Number(r.granted) }
        },
        async settle(id, a) {
          await db.query('select ia_settle($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, a.ok, a.costMicros, a.usage?.input_tokens ?? 0, a.usage?.output_tokens ?? 0, a.usage?.cache_read_input_tokens ?? 0, a.usage?.cache_creation_input_tokens ?? 0, a.tools, a.stop])
        },
        async callModel(p) {
          // comparison only: the same request at another effort (the app itself is not changed)
          const params = force && String(p.model).includes('haiku') ? { ...p, output_config: { ...(p.output_config as object), effort: force } } : p
          const t0 = Date.now()
          const msg = await client.messages.stream(params as unknown as Anthropic.MessageStreamParams).finalMessage()
          const key: ModelKey = String(p.model).includes('sonnet') ? 'sonnet' : 'haiku'
          calls.push({ model: key, ms: Date.now() - t0, cost: costMicros(key, msg.usage) })
          return { content: msg.content as unknown as Block[], stop_reason: msg.stop_reason, usage: msg.usage, model: msg.model }
        },
      }
      const conv = newConversation(A)
      const book = new FactBook()
      let plan: Plan | null = null
      let n = 0
      const turn = `rep-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const req: StartRequest = { kind: 'start', turnId: turn, text: q, today: TODAY, timeZone: 'America/Sao_Paulo', deep: false, consentVersion: 2, history: conv.history, topics: topicsOf(conv), focus: conv.focus, areasOff: [] }
      const t0 = Date.now()
      let out = await startTurn(req, deps)
      while (out.status === 200 && (out.body as TurnResponse).kind === 'tools') {
        const body = out.body as Extract<TurnResponse, { kind: 'tools' }>
        const results = body.calls.map((c) => {
          if (c.name === ACTION_TOOL) {
            const r = runActionsTool(c.input, { data, settings, now: NOW, areasOff: [], uid: A, planId: `${turn}${++n}`, book })
            if (r.plan) plan = r.plan
            return { id: c.id, content: r.content, isError: r.isError }
          }
          const r = runLookup(c.name, c.input, { data, settings, now: NOW, book, areasOff: [] })
          return { id: c.id, content: r.content, isError: r.isError }
        })
        out = await continueTurn({ kind: 'continue', envelope: body.envelope, results }, deps)
      }
      expect(out.status, `${q}: ${JSON.stringify(out.body)}`).toBe(200)
      const body = out.body as Extract<TurnResponse, { kind: 'answer' }>
      const rendered = renderAnswer(body.text, book.all)
      const p = plan as Plan | null
      const outcome: Outcome = p ? 'propôs' : claimsPlan(body.text) ? 'disse que preparou SEM prévia' : 'perguntou'
      return { plan: p, outcome, answer: plainAnswer(rendered.segments), blocked: [...rendered.blocked, ...rendered.missing], ms: Date.now() - t0, calls }
    }

    const REQUESTS: { key: string; q: string; checks: (r: Awaited<ReturnType<typeof ask>>) => [string, boolean][] }[] = [
      {
        key: 'Meta',
        q: 'Guarda 300 na meta da viagem.',
        checks: (r) => {
          const item = r.plan?.items.find((i) => i.action.tipo === 'reservar_meta')
          const pv = r.plan && item ? Object.fromEntries(previewValues(r.plan, item.ref, { data, settings }).map((v) => [v.label, v.display])) : {}
          return [
            ['chamou a ferramenta (prévia de reserva pronta)', item?.state === 'pronto'],
            ['prévia: guardado DEPOIS R$ 4.150,00 e falta R$ 1.850,00', pv['Guardado DEPOIS da reserva'] === 'R$ 4.150,00' && pv['Falta para a meta DEPOIS da reserva'] === 'R$ 1.850,00'],
            // wrong = a sentence that gives R$ 3.850,00 as the value AFTER the reserve without the right one (4.150,00);
            // "sobe de R$ 3.850,00 para R$ 4.150,00" is correct
            ['resposta não chama o guardado de antes (R$ 3.850,00) de valor depois', !r.answer.split(/(?<=[.!?])\s+|\n+/).some((x) => /(passa|passará|ficará|fica|depois|com isso)[^.]*3\.850,00/i.test(x) && !/4\.150,00/.test(x))],
          ]
        },
      },
      {
        key: 'Reunião',
        q: 'Muda a reunião com a Vânia de amanhã para as 16h.',
        checks: (r) => {
          const item = r.plan?.items.find((i) => i.action.tipo === 'mover_compromisso')
          const pv = r.plan && item ? Object.fromEntries(previewValues(r.plan, item.ref, { data, settings }).map((v) => [v.label, v.display])) : {}
          return [
            ['chamou a ferramenta (mover compromisso pronto)', item?.state === 'pronto'],
            ['prévia: 16:00–17:00, mesmo dia, duração 1 hora', pv['Novo horário (a duração é mantida)'] === '16:00–17:00' && pv['Novo dia'] === 'qui, 05/11' && pv['Duração'] === '1 hora'],
            ['resposta não diz que a duração precisa ser ajustada', !/dura[çc][ãa]o[^.]*(ajust|precis|defin)/i.test(r.answer)],
          ]
        },
      },
      {
        key: 'Vânia (futuro)',
        q: 'A Vânia vai me pagar a parcela de 300 na semana que vem, me lembra.',
        checks: (r) => {
          const items = r.plan?.items ?? []
          return [
            ['chamou a ferramenta com um lembrete (tarefa)', items.some((i) => i.action.tipo === 'criar_tarefa' && i.state !== 'erro')],
            ['nunca registra o recebimento como feito', !items.some((i) => i.action.tipo === 'registrar_recebimento' && i.action.ja_recebido_ou_pago === true)],
            ['lembrete na semana que vem (09/11 a 15/11)', items.some((i) => i.action.tipo === 'criar_tarefa' && (i.action.data ?? '') >= '2026-11-09' && (i.action.data ?? '') <= '2026-11-15')],
          ]
        },
      },
    ]

    const rows: Row[] = []
    for (let rep = 1; rep <= reps; rep++) {
      for (const R of REQUESTS) {
        const r = await ask(R.q)
        const written = JSON.stringify(data) !== snapshot
        rows.push({
          req: R.key,
          rep,
          effort: force ?? 'padrão do app (baixo)',
          outcome: r.outcome,
          plan: r.plan ? r.plan.items.map((i) => `${i.action.tipo}:${i.state}`).join(', ') : '—',
          ms: r.ms,
          cost: r.calls.reduce((s, c) => s + c.cost, 0),
          calls: r.calls.length,
          answer: r.answer,
          checks: [
            ['nunca diz que preparou sem ter montado a prévia', r.outcome !== 'disse que preparou SEM prévia'] as [string, boolean],
            ['nada gravado antes da confirmação', !written] as [string, boolean],
            ...R.checks(r),
            ['resposta sem valor/data/horário não confirmado', r.blocked.length === 0] as [string, boolean],
          ].map(([name, ok]) => ({ name, ok })),
        })
      }
    }

    const usd = (m: number) => `US$ ${(m / 1e6).toFixed(5)}`
    const total = rows.reduce((s, r) => s + r.cost, 0)
    const dbTotal = Number((await db.query<{ t: number }>(`select coalesce(sum(cost_micros),0)::int as t from ai_usage where kind = 'ia'`)).rows[0].t)
    const byReq = REQUESTS.map((R) => {
      const list = rows.filter((r) => r.req === R.key)
      const ok = list.filter((r) => r.checks.every((c) => c.ok)).length
      return `| ${R.key} | ${list.map((r) => r.outcome).join(' · ')} | ${ok}/${list.length} | ${usd(list.reduce((s, r) => s + r.cost, 0) / Math.max(1, list.length))} | ${(list.reduce((s, r) => s + r.ms, 0) / Math.max(1, list.length) / 1000).toFixed(1)} s |`
    })
    const report = [
      `Esforço: ${rows[0]?.effort} · repetições: ${reps}`,
      '',
      '| Pedido | Desfecho de cada repetição | Tudo certo | Custo médio | Tempo médio |',
      '|---|---|---|---|---|',
      ...byReq,
      '',
      '| Pedido | # | Desfecho | Plano | Chamadas | Custo | Tempo | Verificações |',
      '|---|---|---|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.req} | ${r.rep} | ${r.outcome} | ${r.plan} | ${r.calls} | ${usd(r.cost)} | ${(r.ms / 1000).toFixed(1)} s | ${r.checks.map((c) => `${c.ok ? '✅' : '❌'} ${c.name}`).join('<br>')} |`),
      '',
      `**Total:** ${usd(total)} (teto ${usd(maxUsd * 1e6)}) · banco contou ${usd(dbTotal)}`,
      '',
      '## Respostas',
      ...rows.map((r) => `**${r.req} #${r.rep}** (${r.outcome})\n> ${r.answer.replace(/\n+/g, '\n> ')}\n`),
    ].join('\n')
    if (process.env.IA_REPORT) writeFileSync(process.env.IA_REPORT, report)
    console.log(report)
    expect(dbTotal).toBe(total)
    expect(rows.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => `${r.req} #${r.rep}: ${c.name}`)), 'qualidade').toEqual([])
  }, 1_800_000)
})
