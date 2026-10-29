// Etapa 1 data through the real sync code, two devices, offline — against the LOCAL mock
// of Supabase (tests/e2e/mock-supabase.mjs), never the real project.
// Needs the mock build in dist-e2e-cloud: npm run build:e2e-cloud
import { spawn } from 'node:child_process'
import { launch } from './cdp.mjs'
import { reporter, setValue } from './helpers.mjs'

const BASE = 'http://localhost:4318/nucleo/'
const MOCK = 'http://localhost:54399'
const r = reporter()
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const procs = [spawn(process.execPath, ['tests/e2e/mock-supabase.mjs'], { stdio: 'ignore' }), spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist-e2e-cloud', '--port', '4318', '--strictPort'], { stdio: 'ignore', env: { ...process.env, NUCLEO_BASE: '/nucleo/' } })]
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(BASE)).ok && (await fetch(MOCK + '/__state')).ok) break
  } catch {}
  await sleep(500)
}
const state = async () => (await fetch(MOCK + '/__state')).json()

async function signUp(b, email) {
  await b.goto(BASE)
  // After "Sair" the app restarts on the sign-in screen (same helper as assistant-sync).
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
  // new account onboarding: defaults (BRL, suggested sections incl. Caixa de entrada, Hábitos, Agenda)
  await b.click('Configurar minha conta')
  await b.click('Continuar')
  await b.click('Continuar')
  await b.click('Entrar')
  await b.sleep(1500)
}

async function signIn(b, email) {
  await b.goto(BASE)
  await b.click('Entrar ou criar conta')
  await b.fill('E-mail', email)
  await b.fill('Senha', 'Nucleo-teste-42')
  await b.click('Entrar', 'button[type=submit]')
  await b.sleep(3000)
}

async function syncNow(b) {
  await b.goto(BASE + '#/account')
  await b.click('Agora')
  await b.sleep(1500)
}

const A = await launch(9361)
const B = await launch(9362)
try {
  for (const b of [A, B]) {
    await b.mobile()
    await b.send('Network.enable')
    await b.send('Network.setBypassServiceWorker', { bypass: true })
  }
  await signUp(A, 'rita@teste.com')
  let text = await A.text()
  // The inbox "+" lives on the inbox screen since "um '+' por tela" (20d69b3).
  await A.goto(BASE + '#/inbox')
  await A.sleep(800)
  r.check('conta nova: seções sugeridas incluem Caixa de entrada (botão +)', await A.eval(`!!document.querySelector('[aria-label="Capturar na caixa de entrada"]')`))

  // A: habit + mark today
  await A.goto(BASE + '#/habits')
  await A.click('Criar hábito')
  await A.click('Beber água', 'button')
  await A.click('Criar hábito', 'button[type=submit]')
  await A.sleep(400)
  await A.click('Concluir Beber água')
  await A.sleep(400)
  await syncNow(A)
  let s = await state()
  const rita = s.users.find((u) => u.email === 'rita@teste.com').id
  const mine = s.records.filter((x) => x.user_id === rita)
  r.check('hábito e conclusão do dia chegam ao servidor', mine.some((x) => x.collection === 'habits') && mine.some((x) => x.collection === 'completions' && x.data.status === 'done'))

  // B: same account sees the same day state
  await signIn(B, 'rita@teste.com')
  await B.goto(BASE + '#/habits')
  text = await B.text()
  r.check('outro aparelho vê o hábito concluído hoje', text.includes('1 de 1'))

  // B offline: capture + undo habit; nothing reaches the server until online
  await fetch(MOCK + '/__offline?v=1')
  await B.click('Desmarcar Beber água')
  await B.sleep(300)
  await B.goto(BASE + '#/inbox')
  await B.sleep(800)
  // On the inbox screen the capture field is on the page itself.
  await setValue(B, 'textarea[aria-label="Capturar"]', 'Ideia offline')
  await B.click('Guardar', 'button')
  await B.sleep(2500)
  s = await state()
  r.check('offline: alterações ficam na fila do aparelho', !s.records.some((x) => x.collection === 'inbox') && s.records.some((x) => x.collection === 'completions' && !x.deleted))
  await fetch(MOCK + '/__offline?v=0')
  await syncNow(B)
  s = await state()
  r.check('voltando a conexão, a fila sobe (captura e desmarcação)', s.records.some((x) => x.collection === 'inbox' && x.data.text === 'Ideia offline') && s.records.some((x) => x.collection === 'completions' && x.deleted))

  // A receives B's changes
  await syncNow(A)
  await A.goto(BASE + '#/habits')
  text = await A.text()
  r.check('aparelho A recebe a desmarcação feita no B', text.includes('0 de 1'))
  await A.goto(BASE + '#/inbox')
  r.check('aparelho A recebe a captura feita offline no B', (await A.text()).includes('Ideia offline'))

  // Another person: nothing from Rita
  await A.goto(BASE + '#/account')
  await A.click('Sair desta conta')
  await A.click('Sair', 'button')
  await A.sleep(1500)
  await signUp(A, 'teo@teste.com')
  await A.goto(BASE + '#/habits')
  r.check('outra conta não vê hábitos de Rita', (await A.text()).includes('Nenhum hábito ainda'))
  const token = await A.eval(`JSON.parse(localStorage.getItem('nucleo:auth')).access_token`)
  const direct = await (await fetch(`${MOCK}/rest/v1/records?select=*&collection=eq.completions`, { headers: { Authorization: `Bearer ${token}` } })).json()
  r.check('requisição direta de outra conta não traz conclusões de Rita (mock)', Array.isArray(direct) && direct.length === 0)
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('sync-erro-a').catch(() => {})
  await B.shot('sync-erro-b').catch(() => {})
} finally {
  const failed = r.print(A)
  A.close()
  B.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
