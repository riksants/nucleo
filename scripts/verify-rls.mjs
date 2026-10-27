// Verifies, against the REAL Supabase project, that one account cannot read or
// change another account's rows — using the same public anon key the app uses.
//
// Usage (two test accounts already confirmed):
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   A_EMAIL=... A_PASSWORD=... B_EMAIL=... B_PASSWORD=... node scripts/verify-rls.mjs
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_ANON_KEY, A_EMAIL, A_PASSWORD, B_EMAIL, B_PASSWORD } = process.env
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !A_EMAIL || !B_EMAIL) {
  console.error('Defina SUPABASE_URL, SUPABASE_ANON_KEY, A_EMAIL, A_PASSWORD, B_EMAIL, B_PASSWORD.')
  process.exit(2)
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const a = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, opts)
const b = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, opts)
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, opts)
let failed = 0
const check = (name, ok, extra = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}

const { data: sa, error: ea } = await a.auth.signInWithPassword({ email: A_EMAIL, password: A_PASSWORD })
const { data: sb, error: eb } = await b.auth.signInWithPassword({ email: B_EMAIL, password: B_PASSWORD })
if (ea || eb) {
  console.error('Falha ao entrar:', ea?.message ?? eb?.message)
  process.exit(2)
}
const aId = sa.user.id
const id = `rls-check-${Date.now()}`
const now = new Date().toISOString()

const ins = await a.from('records').insert({ user_id: aId, collection: 'notes', id, data: { id, title: 'privado de A' }, client_updated_at: now })
check('A grava o próprio registro', !ins.error, ins.error?.message)

const read = await b.from('records').select('*').eq('id', id)
check('B não lê o registro de A', !read.error && read.data.length === 0)
const readAll = await b.from('records').select('user_id').eq('user_id', aId)
check('B não lista nada de A filtrando pelo user_id', !readAll.error && readAll.data.length === 0)

const upd = await b.from('records').update({ data: { title: 'hack' } }).eq('id', id).select()
check('B não altera o registro de A', (upd.data ?? []).length === 0)
const del = await b.from('records').delete().eq('id', id).select()
check('B não apaga o registro de A', (del.data ?? []).length === 0)
const forge = await b.from('records').insert({ user_id: aId, collection: 'notes', id: id + '-forge', data: {}, client_updated_at: now })
check('B não cria registro em nome de A', Boolean(forge.error))

const plain = await a.from('records').insert({ user_id: aId, collection: 'accounts', id: id + '-pw', data: { password: '123' }, client_updated_at: now })
check('servidor recusa senha em texto aberto', Boolean(plain.error))

const settings = await b.from('user_settings').select('*').eq('user_id', aId)
check('B não lê as configurações de A', !settings.error && settings.data.length === 0)
const usage = await b.from('ai_usage').insert({ user_id: sb.user.id, kind: 'routine', request_id: 'abcdefgh' })
check('usuário não escreve em ai_usage', Boolean(usage.error))
const claim = await b.rpc('claim_due_notifications', { p_limit: 1 })
check('usuário não aciona o envio de notificações', Boolean(claim.error))

const anonRead = await anon.from('records').select('*').limit(1)
check('sem login nada é lido', Boolean(anonRead.error) || anonRead.data.length === 0)

// Etapa 1: coleções novas (exige a migração 20261002000000_etapa1_uso_diario.sql)
const cid = `habit:${id}:2026-10-01`
const newIns = await a.from('records').insert({ user_id: aId, collection: 'completions', id: cid, data: { status: 'done' }, client_updated_at: now })
check('servidor aceita as coleções da Etapa 1 (migração executada)', !newIns.error, newIns.error?.message)
const newRead = await b.from('records').select('*').eq('id', cid)
check('B não lê conclusões de A', !newRead.error && newRead.data.length === 0)
const newDel = await b.from('records').delete().eq('id', cid).select()
check('B não apaga conclusões de A', (newDel.data ?? []).length === 0)
await a.from('records').delete().eq('id', cid)

// Etapa 2: coleções novas (exige a migração 20261003000000_etapa2_uso_semanal.sql)
const wid = `rls-week-${Date.now()}`
const wIns = await a.from('records').insert({ user_id: aId, collection: 'weekCheckins', id: wid, data: { note: 'privado' }, client_updated_at: now })
check('servidor aceita as coleções da Etapa 2 (migração executada)', !wIns.error, wIns.error?.message)
const wRead = await b.from('records').select('*').eq('id', wid)
check('B não lê check-ins de A', !wRead.error && wRead.data.length === 0)
await a.from('records').delete().eq('id', wid)

// Etapa 3: metas financeiras (exige a migração 20261004000000_etapa3_financas.sql)
const fid = `rls-fg-${Date.now()}`
const fIns = await a.from('records').insert({ user_id: aId, collection: 'financeGoals', id: fid, data: { name: 'privado' }, client_updated_at: now })
check('servidor aceita as metas financeiras da Etapa 3 (migração executada)', !fIns.error, fIns.error?.message)
const fRead = await b.from('records').select('*').eq('id', fid)
check('B não lê metas financeiras de A', !fRead.error && fRead.data.length === 0)
const fUpd = await b.from('records').update({ data: { name: 'invadido' } }).eq('id', fid).select()
check('B não altera metas financeiras de A', (fUpd.data ?? []).length === 0)
await a.from('records').delete().eq('id', fid)

// Etapa 4: projetos pessoais, objetivos e etapas (exige a migração 20261005000000_etapa4_vida.sql)
const lid = `rls-life-${Date.now()}`
const lIns = await a.from('records').insert({ user_id: aId, collection: 'planSteps', id: lid, data: { title: 'privado' }, client_updated_at: now })
check('servidor aceita as coleções da Etapa 4 (migração executada)', !lIns.error, lIns.error?.message)
const lRead = await b.from('records').select('*').eq('id', lid)
check('B não lê etapas de A', !lRead.error && lRead.data.length === 0)
await a.from('records').delete().eq('id', lid)

// Etapa 5: refeições e lista de compras (exige a migração 20261006000000_etapa5_alimentacao.sql)
const mid = `rls-meal-${Date.now()}`
const mIns = await a.from('records').insert({ user_id: aId, collection: 'meals', id: mid, data: { name: 'privado' }, client_updated_at: now })
check('servidor aceita as coleções da Etapa 5 (migração executada)', !mIns.error, mIns.error?.message)
const mRead = await b.from('records').select('*').eq('id', mid)
check('B não lê refeições de A', !mRead.error && mRead.data.length === 0)
await a.from('records').delete().eq('id', mid)

// Automações e regras (20261012000000_automacoes.sql, 20261019000000_regras.sql)
for (const collection of ['automationRuns', 'rules']) {
  const xid = `rls-${collection}-${Date.now()}`
  const xIns = await a.from('records').insert({ user_id: aId, collection, id: xid, data: { id: xid }, client_updated_at: now })
  check(`servidor aceita ${collection} (migração executada)`, !xIns.error, xIns.error?.message)
  const xRead = await b.from('records').select('*').eq('id', xid)
  check(`B não lê ${collection} de A`, !xRead.error && xRead.data.length === 0)
  await a.from('records').delete().eq('id', xid)
}

// Cotas (20261024000000_cotas.sql): cada conta lê só o próprio uso; ninguém do app altera.
const qa = await a.from('quota_usage').select('user_id')
check('cotas: A lê só o próprio uso', !qa.error && qa.data.every((r) => r.user_id === aId), qa.error?.message)
const qUpd = await a.from('quota_usage').update({ live: 0 }).eq('user_id', aId).select()
check('cotas: o app não altera o uso', Boolean(qUpd.error) || (qUpd.data ?? []).length === 0)
const qLim = await a.from('quota_limits').update({ max_value: 999999999 }).eq('key', 'records.notes').select()
check('cotas: o app não altera os limites', Boolean(qLim.error) || (qLim.data ?? []).length === 0)

// Etapas 4–10 (20261027000000_auditoria_etapas_4_10.sql)
const hid = `rls-hist-${Date.now()}`
await a.from('records').insert({ user_id: aId, collection: 'notes', id: hid, data: { id: hid, v: 1 }, client_updated_at: now })
await a.from('records').update({ data: { id: hid, v: 2 }, client_updated_at: new Date().toISOString() }).eq('id', hid)
for (const [table, who] of [['records_history', a], ['records_history_usage', a], ['schema_version', a], ['records_history', anon]]) {
  const r = await who.from(table).select('*').limit(1)
  check(`${table} não é acessível pelo app`, Boolean(r.error) || r.data.length === 0, r.error ? '' : `${r.data.length} linha(s)`)
}
const future = await a.from('records').upsert({ user_id: aId, collection: 'notes', id: hid, data: { id: hid, v: 3 }, client_updated_at: '2099-01-01T00:00:00Z' }, { onConflict: 'user_id,collection,id' }).select('client_updated_at').single()
check('data no futuro fica no máximo 5 min à frente', !future.error && new Date(future.data.client_updated_at).getTime() < Date.now() + 6 * 60_000, future.error?.message)
const move = await a.from('records').update({ collection: 'tasks' }).eq('id', hid).select()
check('collection de uma linha não pode ser trocada', Boolean(move.error))
await a.from('records').delete().eq('id', hid)
for (const [fn, args] of [['backup_accounts', {}], ['ai_reserve', { p_user: aId, p_kind: 'routine', p_request_id: 'rls-check-1', p_daily_limit: 99, p_busy_seconds: 1 }], ['records_history_restore', { p_version_id: 1 }], ['records_history_cleanup', {}]]) {
  const r = await a.rpc(fn, args)
  check(`o app não chama ${fn}`, Boolean(r.error))
}
const anonDelete = await anon.rpc('delete_my_account')
check('sem login não exclui conta', Boolean(anonDelete.error))

const stillThere = await a.from('records').select('data').eq('id', id).single()
check('registro de A continua intacto', stillThere.data?.data?.title === 'privado de A')
await a.from('records').delete().eq('id', id)

console.log(failed ? `\n${failed} verificação(ões) falharam.` : '\nTudo certo: isolamento confirmado no servidor.')
process.exit(failed ? 1 : 0)
