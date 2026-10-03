// Conta: ver o e-mail conectado, sair (com confirmação), entrar de novo e trocar de conta sem misturar dados. Mock local.
// offline and a second account — against the LOCAL mock of Supabase (tests/e2e/mock-supabase.mjs), never the real project.
// Needs a build made with VITE_SUPABASE_URL=http://localhost:54399 in dist-e2e-cloud.
import { spawn } from 'node:child_process'
import { launch } from './cdp.mjs'
import { reporter, setValue } from './helpers.mjs'

const BASE = 'http://localhost:4318/nucleo/'
const MOCK = 'http://localhost:54399'
const r = reporter()
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const procs = [spawn(process.execPath, ['tests/e2e/mock-supabase.mjs'], { stdio: 'ignore' }), spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist-e2e-cloud', '--port', '4318', '--strictPort'], { stdio: 'ignore' })]
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(BASE)).ok && (await fetch(MOCK + '/__state')).ok) break
  } catch {}
  await sleep(500)
}
const state = async () => (await fetch(MOCK + '/__state')).json()

async function signUp(b, email) {
  await b.goto(BASE)
  await b.click('Entrar ou criar conta')
  await b.click('Criar conta')
  await b.fill('E-mail', email)
  await b.fill('Senha', 'senha1234')
  await b.fill('Repita a senha', 'senha1234')
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

async function signIn(b, email) {
  await b.goto(BASE)
  await b.click('Entrar ou criar conta')
  await b.fill('E-mail', email)
  await b.fill('Senha', 'senha1234')
  await b.click('Entrar', 'button[type=submit]')
  await b.sleep(3000)
}

async function syncNow(b) {
  await b.goto(BASE + '#/account')
  await b.click('Agora')
  await b.sleep(1500)
}

const choose = (b, selector, value) =>
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
const fillIn = (b, labelText, value) =>
  b.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.trim().startsWith(${JSON.stringify(labelText)})); const el = l && l.querySelector('input, textarea'); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)

const typeIn = (b, selector, value) =>
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
async function addTask(b, title) {
  await b.goto(BASE + '#/tasks')
  await b.sleep(700)
  await typeIn(b, 'input[placeholder="Adicionar tarefa rápida…"]', title)
  await b.eval(`document.querySelector('input[placeholder="Adicionar tarefa rápida…"]').closest('form').requestSubmit()`)
  await b.sleep(500)
}
async function signOutFromSettings(b) {
  await b.goto(BASE + '#/settings')
  await b.sleep(600)
  await b.click('Sair da conta', 'button')
  await b.sleep(800)
  await b.click('Sair', '[role=dialog] button')
  await b.sleep(1800)
}
async function signInHere(b, email) {
  await b.fill('E-mail', email)
  await b.fill('Senha', 'senha1234')
  await b.click('Entrar', 'button[type=submit]')
  await b.sleep(3000)
}

const A = await launch(9399)
try {
  await A.mobile()
  await A.send('Network.enable')
  await A.send('Network.setBypassServiceWorker', { bypass: true })
  await signUp(A, 'ana@conta.com')
  await addTask(A, 'Tarefa da Ana')
  await syncNow(A)

  await A.goto(BASE + '#/more')
  await A.sleep(600)
  r.check('Mais mostra a linha "Conta" com o e-mail conectado', (await A.text()).includes('Conta') && (await A.text()).includes('ana@conta.com'))
  await A.goto(BASE + '#/settings')
  await A.sleep(600)
  let text = await A.text()
  r.check('Configurações tem a seção Conta com o e-mail e "Sair da conta"', text.toUpperCase().includes('CONTA') && text.includes('Conectado como') && text.includes('ana@conta.com') && text.includes('Sair da conta'))

  // Confirmation: cancel keeps the session
  await A.click('Sair da conta', 'button')
  await A.sleep(800)
  r.check('sair pede confirmação', (await A.text()).includes('Sair da conta?'))
  await A.click('Cancelar', '[role=dialog] button')
  await A.sleep(500)
  r.check('cancelar mantém conectado', (await A.text()).includes('ana@conta.com'))

  // Sign out → sign-in screen
  await A.click('Sair da conta', 'button')
  await A.sleep(800)
  await A.click('Sair', '[role=dialog] button')
  await A.sleep(1800)
  text = await A.text()
  r.check('depois de sair, aparece a tela de entrada', text.includes('Esqueci minha senha') && !text.includes('Tarefa da Ana'))

  // Same account again: data comes back
  await signInHere(A, 'ana@conta.com')
  await A.goto(BASE + '#/tasks')
  for (let i = 0; i < 16 && !(await A.text()).includes('Tarefa da Ana'); i++) await A.sleep(500)
  r.check('entrar de novo na mesma conta traz os dados', (await A.text()).includes('Tarefa da Ana'))

  // Another account: nothing from Ana
  await signOutFromSettings(A)
  await A.click('Criar conta')
  await A.fill('E-mail', 'bruno@conta.com')
  await A.fill('Senha', 'senha1234')
  await A.fill('Repita a senha', 'senha1234')
  await A.click('Criar conta', 'button[type=submit]')
  await A.sleep(800)
  await A.fill('Código do e-mail', '123456')
  await A.click('Confirmar', 'button[type=submit]')
  await A.sleep(2500)
  await A.click('Configurar minha conta').catch(() => {})
  await A.click('Continuar').catch(() => {})
  await A.click('Continuar').catch(() => {})
  await A.click('Entrar').catch(() => {})
  await A.sleep(1500)
  await A.goto(BASE + '#/tasks')
  await A.sleep(1200)
  r.check('outra conta não mostra os dados da primeira', !(await A.text()).includes('Tarefa da Ana'))
  await addTask(A, 'Tarefa do Bruno')
  await syncNow(A)
  await A.goto(BASE + '#/settings')
  await A.sleep(600)
  r.check('Configurações mostra o e-mail da conta atual', (await A.text()).includes('bruno@conta.com') && !(await A.text()).includes('ana@conta.com'))

  // Back to the first account: only its own data
  await signOutFromSettings(A)
  await signInHere(A, 'ana@conta.com')
  await A.goto(BASE + '#/tasks')
  for (let i = 0; i < 16 && !(await A.text()).includes('Tarefa da Ana'); i++) await A.sleep(500)
  text = await A.text()
  r.check('voltando à primeira conta: só os dados dela', text.includes('Tarefa da Ana') && !text.includes('Tarefa do Bruno'))
  const s = await state()
  const ana = s.users.find((u) => u.email === 'ana@conta.com').id
  const bruno = s.users.find((u) => u.email === 'bruno@conta.com').id
  r.check('no servidor, cada tarefa ficou na própria conta', s.records.some((x) => x.user_id === ana && x.data?.title === 'Tarefa da Ana') && s.records.some((x) => x.user_id === bruno && x.data?.title === 'Tarefa do Bruno') && !s.records.some((x) => x.user_id === ana && x.data?.title === 'Tarefa do Bruno'))

  // Without an account
  await signOutFromSettings(A)
  await A.click('Voltar')
  await A.sleep(1000)
  // This test device never used the app without an account: the welcome flow comes first (existing behaviour).
  await A.click('Começar sem conta')
  await A.click('Continuar')
  await A.click('Continuar')
  await A.click('Entrar')
  await A.sleep(1200)
  await A.goto(BASE + '#/settings')
  await A.sleep(800)
  text = await A.text()
  r.check('sem conta: "Usando somente neste aparelho" e "Entrar ou criar conta"', text.includes('Usando somente neste aparelho') && text.includes('Entrar ou criar conta'))
  r.check('sem rolagem horizontal (390px)', !(await A.eval(`document.documentElement.scrollWidth > document.documentElement.clientWidth + 1`)))
  await A.shot('conta-sem-login')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('conta-erro').catch(() => {})
} finally {
  const failed = r.print(A)
  A.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
