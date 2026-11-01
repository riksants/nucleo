// NÚCLEO IA (Etapa 1) in the browser, against the LOCAL mock (tests/e2e/mock-supabase.mjs), which runs
// the real server logic (engine, signed turn, router, prompt, tools) with a scripted model.
// Build: MSYS2_ENV_CONV_EXCL='NUCLEO_BASE' NUCLEO_BASE=/nucleo/ VITE_NUCLEO_IA=on npx vite build --mode e2e-cloud --outDir dist-e2e-ia
import { spawn } from 'node:child_process'
import { launch } from './cdp.mjs'
import { reporter } from './helpers.mjs'

const BASE = 'http://localhost:4319/nucleo/'
const MOCK = 'http://localhost:54399'
const r = reporter()
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const procs = [
  spawn(process.execPath, ['tests/e2e/mock-supabase.mjs'], { stdio: 'ignore' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist-e2e-ia', '--port', '4319', '--strictPort'], { stdio: 'ignore', env: { ...process.env, NUCLEO_BASE: '/nucleo/' } }),
]
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE)).ok && (await fetch(MOCK + '/__state')).ok) break
  } catch {}
  await sleep(500)
}
const ia = async () => (await fetch(MOCK + '/__ia')).json()

async function signUp(b, email) {
  await b.goto(BASE)
  for (let i = 0; i < 60 && !/Esqueci minha senha|Entrar ou criar conta/.test(await b.text()); i++) await b.sleep(250)
  if (!(await b.text()).includes('Esqueci minha senha')) await b.click('Entrar ou criar conta')
  await b.click('Criar conta')
  await b.fill('E-mail', email)
  await b.fill('Senha', 'Nucleo-teste-42')
  await b.fill('Repita a senha', 'Nucleo-teste-42')
  await b.click('Criar conta', 'button[type=submit]')
  await b.sleep(800)
  await b.fill('Código do e-mail', '123456')
  await b.click('Confirmar', 'button[type=submit]')
  await b.sleep(2500)
  await b.click('Configurar minha conta')
  await b.click('Continuar')
  await b.click('Continuar')
  await b.click('Entrar')
  await b.sleep(1500)
}

const ask = async (b, text) => {
  await b.eval(`(() => { const el = document.querySelector('input[aria-label="Pergunte ao NÚCLEO"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await b.click('Enviar')
}
const answers = (b) => b.eval(`[...document.querySelectorAll('[data-ia-answer]')].map(a => ({ text: a.innerText, route: a.dataset.route, seals: [...a.querySelectorAll('[data-seal]')].map(x => x.dataset.seal), blocked: a.querySelectorAll('[data-blocked]').length, suggestion: !!a.querySelector('[aria-label="sugestão"]') }))`)
async function waitAnswers(b, n) {
  for (let i = 0; i < 80; i++) {
    const a = await answers(b)
    if (a.length >= n) return a
    await b.sleep(250)
  }
  return answers(b)
}

const B = await launch(9396)
try {
  await B.mobile()
  await B.send('Network.enable')
  await B.send('Network.setBypassServiceWorker', { bypass: true })
  const email = `ia${Date.now()}@teste.com`
  await signUp(B, email)
  const auth = JSON.parse(await B.eval(`localStorage.getItem('nucleo:auth')`))
  const token = auth.access_token
  const uid = auth.user.id
  r.check('conta criada e conectada', Boolean(token && uid))

  // Real records of this account on the (mock) server: two food expenses this month, one last month, a goal.
  const now = new Date()
  const iso = (d) => d.toISOString()
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10, 15))
  const row = (collection, id, data, at) => ({ user_id: uid, collection, id, data: { id, createdAt: at, updatedAt: at, ...data }, deleted: false, client_updated_at: at })
  const seed = [
    row('transactions', 'tx1', { type: 'out', amount: 14890, currency: 'EUR', baseAmount: -14890, reason: 'Continente', category: 'food' }, iso(now)),
    row('transactions', 'tx2', { type: 'out', amount: 6000, currency: 'EUR', baseAmount: -6000, reason: 'Pingo Doce', category: 'food' }, iso(now)),
    row('transactions', 'tx3', { type: 'out', amount: 10000, currency: 'EUR', baseAmount: -10000, reason: 'Mercado', category: 'food' }, iso(lastMonth)),
    row('financeGoals', 'g1', { name: 'Viagem Lisboa', target: 600000, saved: 385000, deadline: `${now.getUTCFullYear() + 1}-06-30`, currency: 'EUR', note: '', status: 'active', history: [] }, iso(now)),
  ]
  const res = await fetch(MOCK + '/rest/v1/records', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(seed) })
  r.check('registros de teste gravados no servidor', res.status === 201)

  // Turn the AI on (old switch in Settings), then the Assistant asks for the NEW consent.
  await B.goto(BASE + '#/settings')
  await B.sleep(1500)
  await B.click('Entender frases livres com IA')
  await B.click('Concordo, ligar')
  await B.sleep(800)
  await B.goto(BASE + '?r=1#/assistant')
  await B.sleep(2500)
  r.check('Assistente pede o consentimento novo (dados vão à IA durante a pergunta)', await B.eval(`!!document.querySelector('[data-ia-consent]')`))
  r.check('texto do consentimento explica o envio e o que nunca vai', /trechos necessários.*Anthropic[\s\S]*Senhas e cofre nunca/.test(await B.eval(`document.querySelector('[data-ia-consent]').innerText`)))
  const before = (await ia()).requests.length
  await ask(B, 'quanto gastei com mercado este mês?')
  r.check('sem o consentimento novo, nada vai para a IA', (await ia()).requests.length === before)
  await B.click('Concordo, usar a IA')
  await B.sleep(500)
  r.check('consentimento aceito: cartão some', !(await B.eval(`!!document.querySelector('[data-ia-consent]')`)))

  // 1) A lookup with a fact, an invented number blocked, a suggestion.
  await ask(B, 'quanto gastei com mercado este mês?')
  let a = await waitAnswers(B, 1)
  r.check('resposta da IA aparece', a.length === 1, JSON.stringify(a))
  r.check('valor vem do cálculo do app (€ 208,90) com selo confirmado', /208,90/.test(a[0]?.text) && a[0]?.seals.includes('confirmado'), a[0]?.text)
  r.check('valor inventado pela IA ("R$ 999,99") fica escondido', a[0]?.blocked === 1 && !/999,99/.test(a[0]?.text))
  r.check('sugestão marcada como sugestão', a[0]?.suggestion === true)
  r.check('rota rápida (Haiku) e botão "Analisar a fundo"', a[0]?.route === 'rapida' && /Analisar a fundo/.test(a[0]?.text))
  let log = await ia()
  r.check('servidor: Haiku 5.5, esforço baixo, 5 ferramentas', log.calls[0]?.model === 'claude-haiku-5-5' && log.calls[0]?.effort === 'low' && log.calls[0]?.tools.length === 5)
  r.check('o app enviou só a pergunta, histórico e foco — nenhum registro no início', !JSON.stringify(log.requests.at(-2) ?? {}).includes('Continente'))

  // 2) Follow-up without repeating the subject.
  await ask(B, 'e no mês anterior?')
  a = await waitAnswers(B, 2)
  log = await ia()
  const start2 = log.requests.filter((x) => x.kind === 'start').at(-1)
  r.check('acompanhamento leva o histórico e a consulta em foco', start2?.history?.length === 1 && start2?.focus?.[0]?.tool === 'resumo_financeiro')
  r.check('resposta do mês anterior (€ 100,00), sem repetir a categoria', /100,00/.test(a[1]?.text), a[1]?.text)

  // 3) A local command does not go to the AI (free, offline) but enters the conversation.
  const n3 = (await ia()).requests.length
  await ask(B, 'O que tenho hoje?')
  await B.sleep(1200)
  r.check('comando local responde sem chamar a IA', (await ia()).requests.length === n3)

  // 4) Change of subject.
  await ask(B, 'quanto falta pra minha meta da viagem?')
  a = await waitAnswers(B, 3)
  r.check('mudança de assunto: meta com valor que falta (€ 2.150,00)', /2\.150,00/.test(a[2]?.text), a[2]?.text)
  r.check('histórico inclui o comando local', (await ia()).requests.filter((x) => x.kind === 'start').at(-1)?.history?.length === 3)

  // 5) Isolation: a turn of this account cannot be continued with another account's login.
  const start = await fetch(MOCK + '/functions/v1/nucleo-ia', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'start', turnId: 'turno-iso-0001', text: 'quanto gastei com mercado?', today: now.toISOString().slice(0, 10), timeZone: 'Europe/Lisbon', deep: false, consentVersion: 2, history: [], topics: '', focus: [], areasOff: [] }),
  }).then((x) => x.json())
  const other = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '99999999-9999-4999-8999-999999999999' })).toString('base64url')}.sig`
  const cont = await fetch(MOCK + '/functions/v1/nucleo-ia', { method: 'POST', headers: { Authorization: `Bearer ${other}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'continue', envelope: start.envelope, results: [{ id: start.calls[0].id, content: '{}', isError: false }] }) })
  r.check('turno de uma conta não continua com o login de outra (409)', start.kind === 'tools' && cont.status === 409)
  const anon = await fetch(MOCK + '/functions/v1/nucleo-ia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'start' }) })
  r.check('sem login: 401', anon.status === 401)

  const st = await (await fetch(MOCK + '/__state')).json()
  r.check('o interpretador antigo não foi chamado', !st.requests.some((x) => x.includes('/functions/v1/assistant')))
  r.check('custo contabilizado', (await ia()).spentMicros > 0)
  await B.shot('nucleo-ia-conversa')
} catch (e) {
  r.results.push('ERROR ' + e.message)
  await B.shot('nucleo-ia-erro').catch(() => {})
} finally {
  const failed = r.print(B)
  B.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
