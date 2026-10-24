// Test double of the Supabase endpoints the app uses (Auth + PostgREST subset + one function).
// Data is partitioned by the JWT "sub", like RLS would. Only for local browser tests.
import { createServer } from 'node:http'

const PORT = 54399
const users = new Map() // email -> { id, password, confirmed, recoveryPending, recoverySentAt, confirmationSentAt }
// Like Supabase Auth: every sign-in is a session (session_id claim in the JWT); revoking one makes
// /auth/v1/user answer 403 session_not_found. The data API keeps accepting a signed JWT until it
// expires, as PostgREST does (it never looks at sessions).
const sessions = new Map() // session id -> { uid, revoked }
// Server-side limit for password sign-ins (Supabase: "sign ups and sign ins" per IP). Off unless a test sets it.
let signInLimit = Infinity
let signInAttempts = 0
let EMAIL_EVERY_MS = 60_000 // Supabase: one e-mail per address per minute
const records = new Map() // `${uid}|${collection}|${id}` -> row
const settings = new Map() // uid -> { data, client_updated_at }
const requests = []
let clock = Date.UTC(2026, 9, 1, 12)
const stamp = () => new Date((clock += 1000)).toISOString()
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (u, sid) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, session_id: sid, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
const claims = (req) => {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '')
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  } catch {
    return {}
  }
}
const sub = (req) => claims(req).sub ?? null
const revokeAll = (uid, except = null) => {
  for (const [sid, x] of sessions) if (x.uid === uid && sid !== except) x.revoked = true
}
const userOf = (u) => ({ id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() })
const session = (u) => {
  const sid = crypto.randomUUID()
  sessions.set(sid, { uid: u.id, revoked: false })
  return { access_token: jwt(u, sid), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + sid, user: userOf(u) }
}

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
  // The server stops accepting this person's session (revoked elsewhere, user removed…).
  if (url.pathname === '/__revoke') {
    const u = users.get(url.searchParams.get('email'))
    if (u) revokeAll(u.id)
    return send(200, { revoked: Boolean(u) })
  }
  if (url.pathname === '/__limits') {
    signInLimit = Number(url.searchParams.get('signin') ?? Infinity)
    signInAttempts = 0
    EMAIL_EVERY_MS = Number(url.searchParams.get('email') ?? 60_000)
    return send(200, { signInLimit, EMAIL_EVERY_MS })
  }
  if (url.pathname === '/__sessions') {
    const u = users.get(url.searchParams.get('email'))
    return send(200, [...sessions.entries()].filter(([, x]) => x.uid === u?.id).map(([id, x]) => ({ id, revoked: x.revoked })))
  }
  if (url.pathname === '/__offline') {
    server.offline = url.searchParams.get('v') === '1'
    return send(200, { offline: server.offline })
  }
  if (server.offline && url.pathname.startsWith('/rest')) return res.destroy()

  // ---- auth
  const tooSoon = (sentAt) => sentAt && Date.now() - sentAt < EMAIL_EVERY_MS
  const waitEmail = () => send(429, { code: 429, error_code: 'over_email_send_rate_limit', msg: 'For security purposes, you can only request this after 59 seconds.' })
  if (url.pathname === '/auth/v1/signup') {
    const known = users.get(json.email)
    // With e-mail confirmation on, Supabase answers an address that already has an account with a
    // made-up user (no session, no e-mail sent), the same as a new sign-up.
    if (known?.confirmed) return send(200, { id: crypto.randomUUID(), email: json.email, aud: 'authenticated', role: 'authenticated', identities: [] })
    if (known && tooSoon(known.confirmationSentAt)) return waitEmail()
    const u = known ?? { id: crypto.randomUUID(), email: json.email, password: json.password, confirmed: false }
    u.confirmationSentAt = Date.now()
    users.set(json.email, u)
    return send(200, { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', confirmation_sent_at: new Date().toISOString() })
  }
  if (url.pathname === '/auth/v1/verify') {
    const u = users.get(json.email)
    const bad = () => send(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' })
    if (!u || json.token !== '123456') return bad()
    // A recovery code works once, and only after it was asked for.
    if (json.type === 'recovery') {
      if (!u.recoveryPending) return bad()
      u.recoveryPending = false
    }
    u.confirmed = true
    return send(200, session(u))
  }
  if (url.pathname === '/auth/v1/token') {
    // Refreshing a session is never accepted here: a stored session that expired cannot be renewed.
    if (url.searchParams.get('grant_type') === 'refresh_token') return send(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' })
    if (++signInAttempts > signInLimit) return send(429, { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' })
    const u = users.get(json.email)
    if (!u || u.password !== json.password) return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
    if (!u.confirmed) return send(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' })
    return send(200, session(u))
  }
  // Endpoints that need a live session (Supabase looks the session_id claim up).
  const { sub: who, session_id: sid } = claims(req)
  const live = sessions.get(sid)
  const me = [...users.values()].find((x) => x.id === who)
  if (url.pathname === '/auth/v1/user' || url.pathname === '/auth/v1/logout') {
    if (!me) return send(401, { msg: 'invalid' })
    if (!live || live.revoked) return send(403, { code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' })
  }
  if (url.pathname === '/auth/v1/user') {
    if (req.method === 'PUT' && json?.password) {
      if (json.password === me.password) return send(422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' })
      me.password = json.password
      // Supabase: a new password ends every other session and voids pending e-mail codes.
      revokeAll(me.id, sid)
      me.recoveryPending = false
    }
    return send(200, userOf(me))
  }
  if (url.pathname === '/auth/v1/logout') {
    const scope = url.searchParams.get('scope') || 'global'
    if (scope === 'local') live.revoked = true
    else revokeAll(me.id, scope === 'others' ? sid : null)
    return send(204)
  }
  if (url.pathname === '/auth/v1/recover') {
    const u = users.get(json.email)
    // Unknown address: the same empty success. A known one asked again too soon: "wait".
    if (!u) return send(200, {})
    if (tooSoon(u.recoverySentAt)) return waitEmail()
    u.recoverySentAt = Date.now()
    u.recoveryPending = true
    return send(200, {})
  }

  // ---- rest
  const uid = sub(req)
  if (url.pathname.startsWith('/rest/v1/') && !uid) return send(401, { message: 'JWT required' })
  if (url.pathname === '/rest/v1/records') {
    if (req.method === 'POST') {
      // Like Postgres: one bad row fails the whole statement (records_data_size; 200 KB stands in for 3 MB here).
      if (json.some((r) => JSON.stringify(r.data ?? {}).length > 200_000)) return send(400, { code: '23514', message: 'new row for relation "records" violates check constraint "records_data_size"', details: null, hint: null })
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
