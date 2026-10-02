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

const stillThere = await a.from('records').select('data').eq('id', id).single()
check('registro de A continua intacto', stillThere.data?.data?.title === 'privado de A')
await a.from('records').delete().eq('id', id)

console.log(failed ? `\n${failed} verificação(ões) falharam.` : '\nTudo certo: isolamento confirmado no servidor.')
process.exit(failed ? 1 : 0)
