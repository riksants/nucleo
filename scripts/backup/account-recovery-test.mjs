// PARTE 15 — prova ponta-a-ponta da recuperação de contas contra um GoTrue REAL (o mesmo servidor de
// auth do Supabase). Chamado pelo workflow account-recovery.yml depois que o GoTrue subiu e a conta foi
// recriada por SQL (com o UUID original, como manda docs/RECUPERACAO-DESASTRE.md) e SEM senha utilizável.
// Prova, nesta ordem:
//   1. antes do reset, o login por senha FALHA (não há acesso sem redefinir);
//   2. o "reset" (GoTrue grava a senha nova, via admin — mesmo caminho do resetPasswordForEmail) funciona;
//   3. depois do reset, o login FUNCIONA e o token emitido tem sub == UUID ORIGINAL e o e-mail certo.
// Sai !=0 em qualquer falha (o workflow fica vermelho).
import { createHmac } from 'node:crypto'

const URL = process.env.GOTRUE_URL || 'http://localhost:9999'
const SECRET = process.env.GOTRUE_JWT_SECRET
const UID = process.env.ACCOUNT_UID
const EMAIL = process.env.ACCOUNT_EMAIL
const NEWPASS = process.env.ACCOUNT_NEWPASS || 'Senha-Nova-Forte-123456'
if (!SECRET || !UID || !EMAIL) {
  console.error('faltam GOTRUE_JWT_SECRET / ACCOUNT_UID / ACCOUNT_EMAIL')
  process.exit(2)
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function serviceToken() {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const body = b64url(JSON.stringify({ role: 'service_role', aud: 'authenticated', iss: 'selftest', iat: now, exp: now + 3600 }))
  const sig = b64url(createHmac('sha256', SECRET).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}
const decode = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
const fail = (msg) => { console.error('FALHOU:', msg); process.exit(1) }

async function login(password) {
  const res = await fetch(`${URL}/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

// 1. Sem senha utilizável, o login tem de falhar.
const before = await login(NEWPASS)
if (before.status === 200) fail('login funcionou ANTES do reset (não deveria haver acesso sem redefinir)')
console.log(`1/3 ok: login antes do reset recusado (HTTP ${before.status})`)

// 2. O "reset": o GoTrue grava a senha nova (admin update — mesmo caminho interno do resetPasswordForEmail
//    -> updateUser). Isso exercita o hash bcrypt real do GoTrue sobre a conta recriada por SQL.
const admin = await fetch(`${URL}/admin/users/${UID}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceToken()}` },
  body: JSON.stringify({ password: NEWPASS }),
})
if (admin.status !== 200) fail(`admin não redefiniu a senha (HTTP ${admin.status}): ${JSON.stringify(await admin.json().catch(() => ({})))}`)
const adminUser = await admin.json()
if (adminUser.id !== UID) fail(`admin devolveu id ${adminUser.id}, esperado ${UID}`)
console.log('2/3 ok: senha redefinida pelo GoTrue, id preservado')

// 3. Depois do reset, o login funciona e o token carrega o UUID ORIGINAL.
const after = await login(NEWPASS)
if (after.status !== 200) fail(`login falhou DEPOIS do reset (HTTP ${after.status}): ${JSON.stringify(after.body)}`)
const token = after.body.access_token
if (!token) fail('sem access_token na resposta')
const claims = decode(token)
if (claims.sub !== UID) fail(`token.sub = ${claims.sub}, esperado o UUID original ${UID}`)
if (after.body.user?.id !== UID) fail(`user.id = ${after.body.user?.id}, esperado ${UID}`)
if (claims.email && claims.email !== EMAIL) fail(`token.email = ${claims.email}, esperado ${EMAIL}`)
console.log(`3/3 ok: login funcionou; token.sub = ${claims.sub} (UUID original), e-mail = ${claims.email ?? after.body.user?.email}`)
console.log('\nPROVA OK: conta recriada por SQL com o UUID original -> reset de senha -> login, mantendo o mesmo UUID.')
