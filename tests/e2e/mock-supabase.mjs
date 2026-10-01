// Test double of the Supabase endpoints the app uses (Auth + PostgREST subset + one function).
// Data is partitioned by the JWT "sub", like RLS would. Only for local browser tests.
import { createServer } from 'node:http'

const PORT = 54399
const users = new Map() // email -> { id, password, confirmed }
const records = new Map() // `${uid}|${collection}|${id}` -> row
const settings = new Map() // uid -> { data, client_updated_at }
const requests = []
let clock = Date.UTC(2026, 9, 1, 12)
const stamp = () => new Date((clock += 1000)).toISOString()
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
const sub = (req) => {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '')
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub ?? null
  } catch {
    return null
  }
}
const session = (u) => ({ access_token: jwt(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + u.id, user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } })

function filters(url) {
  const out = []
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'limit', 'on_conflict', 'columns'].includes(k)) continue
    const [op, ...rest] = v.split('.')
    out.push({ k, op, val: rest.join('.') })
  }
  return out
}
const match = (row, f) =>
  f.every(({ k, op, val }) => {
    const x = row[k]
    if (op === 'eq') return String(x) === val
    if (op === 'neq') return String(x) !== val
    if (op === 'gt') return x > val
    if (op === 'gte') return x >= val
    if (op === 'is') return val === 'null' ? x == null : String(x) === val
    if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(x))
    return true
  })

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  let body = ''
  for await (const chunk of req) body += chunk
  const json = body ? JSON.parse(body) : null
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS,PUT')
  res.setHeader('Access-Control-Expose-Headers', '*')
  if (req.method === 'OPTIONS') return res.end()
  const send = (status, data, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(data === undefined ? '' : JSON.stringify(data))
  }
  requests.push(`${req.method} ${url.pathname}${url.search}`)

  // ---- test control
  if (url.pathname === '/__state') return send(200, { users: [...users.values()], records: [...records.values()], settings: [...settings.entries()], requests: requests.slice(-60) })
  if (url.pathname === '/__offline') {
    server.offline = url.searchParams.get('v') === '1'
    return send(200, { offline: server.offline })
  }
  if (server.offline && url.pathname.startsWith('/rest')) return res.destroy()

  // ---- auth
  if (url.pathname === '/auth/v1/signup') {
    if (users.has(json.email)) return send(400, { code: 400, error_code: 'user_already_exists', msg: 'User already registered' })
    const u = { id: crypto.randomUUID(), email: json.email, password: json.password, confirmed: false }
    users.set(json.email, u)
    return send(200, { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', confirmation_sent_at: new Date().toISOString() })
  }
  if (url.pathname === '/auth/v1/verify') {
    const u = users.get(json.email)
    if (!u || json.token !== '123456') return send(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' })
    u.confirmed = true
    return send(200, session(u))
  }
  if (url.pathname === '/auth/v1/token') {
    const u = users.get(json.email)
    if (!u || u.password !== json.password) return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
    if (!u.confirmed) return send(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' })
    return send(200, session(u))
  }
  if (url.pathname === '/auth/v1/user') {
    const id = sub(req)
    const u = [...users.values()].find((x) => x.id === id)
    return u ? send(200, session(u).user) : send(401, { msg: 'invalid' })
  }
  if (url.pathname === '/auth/v1/logout') return send(204)
  if (url.pathname === '/auth/v1/recover') return send(200, {})

  // ---- rest
  const uid = sub(req)
  if (url.pathname.startsWith('/rest/v1/') && !uid) return send(401, { message: 'JWT required' })
  if (url.pathname === '/rest/v1/records') {
    if (req.method === 'POST') {
      for (const r of json) {
        if (r.user_id !== uid) return send(403, { message: 'new row violates row-level security policy' })
        if (r.collection === 'accounts' && r.data?.password) return send(400, { message: 'violates check constraint "records_no_plain_password"' })
        const key = `${uid}|${r.collection}|${r.id}`
        const old = records.get(key)
        if (old && r.client_updated_at < old.client_updated_at) continue
        records.set(key, { ...r, server_updated_at: stamp() })
      }
      return send(201, [])
    }
    const f = filters(url)
    let rows = [...records.values()].filter((r) => r.user_id === uid && match(r, f))
    rows.sort((a, b) => (a.server_updated_at < b.server_updated_at ? -1 : 1))
    const limit = Number(url.searchParams.get('limit') ?? 1000)
    return send(200, rows.slice(0, limit))
  }
  if (url.pathname === '/rest/v1/user_settings') {
    if (req.method === 'POST') {
      const r = Array.isArray(json) ? json[0] : json
      if (r.user_id !== uid) return send(403, { message: 'rls' })
      const old = settings.get(uid)
      if (!old || old.client_updated_at <= r.client_updated_at) settings.set(uid, { data: r.data, client_updated_at: r.client_updated_at })
      return send(201, [])
    }
    const s = settings.get(uid)
    const rows = s ? [{ data: s.data, client_updated_at: s.client_updated_at }] : []
    if ((req.headers.accept ?? '').includes('vnd.pgrst.object')) return rows.length ? send(200, rows[0]) : send(406, { code: 'PGRST116', message: 'no rows' })
    return send(200, rows)
  }
  if (url.pathname === '/rest/v1/scheduled_notifications') return send(200, [])
  if (url.pathname === '/functions/v1/planner') {
    // Deliberately bad answer: one overlapping block + one allergen, to check the app's own validation.
    return send(200, {
      model: 'mock',
      generatedAt: new Date().toISOString(),
      routine: { blocks: [{ id: 'x1', day: 1, start: '10:00', end: '10:30', title: 'Leitura', kind: 'activity', fixed: false }, { id: 'x2', day: 1, start: '20:00', end: '20:30', title: 'Leitura', kind: 'activity', fixed: false }], rejected: [], unplaced: [], missing: [], notes: 'Proposta de teste' },
    })
  }
  send(404, { message: 'not mocked: ' + url.pathname })
})
server.listen(PORT, () => console.log('mock on', PORT))
