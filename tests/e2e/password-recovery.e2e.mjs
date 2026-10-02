// Auditoria: recuperação de senha completa (código por e-mail → nova senha) contra o mock local do Supabase.
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

async function signOut(b) {
  await b.goto(BASE + '#/account')
  await b.click('Sair desta conta')
  await b.click('Sair', 'button')
  await b.sleep(1500)
}

const A = await launch(9396)
try {
  await A.mobile()
  await A.send('Network.enable')
  await A.send('Network.setBypassServiceWorker', { bypass: true })
  await signUp(A, 'rec@teste.com')
  await signOut(A)

  await A.goto(BASE)
  await A.click('Entrar ou criar conta')
  await A.click('Esqueci minha senha')
  await A.fill('E-mail', 'rec@teste.com')
  await A.click('Enviar código', 'button[type=submit]')
  await A.sleep(800)
  const s1 = await state()
  r.check('pedido de recuperação vai para o servidor (POST /auth/v1/recover)', s1.requests.some((x) => x.startsWith('POST /auth/v1/recover')))
  r.check('tela orienta a digitar o código de 6 dígitos (sem precisar do link)', (await A.text()).includes('código de 6 dígitos do e-mail'))
  await A.fill('Código do e-mail', '000000')
  await A.click('Continuar', 'button[type=submit]')
  await A.sleep(800)
  r.check('código errado é recusado com mensagem clara', (await A.text()).includes('Código inválido ou expirado.'))
  await A.fill('Código do e-mail', '123456')
  await A.click('Continuar', 'button[type=submit]')
  await A.sleep(1200)
  r.check('código certo abre "Nova senha"', (await A.text()).includes('Nova senha'))
  await A.fill('Nova senha', 'curta')
  await A.fill('Repita a senha', 'curta')
  await A.click('Salvar senha', 'button[type=submit]')
  await A.sleep(500)
  r.check('senha fraca é recusada no app', (await A.text()).includes('Nova senha'))
  await A.fill('Nova senha', 'novaSenha99')
  await A.fill('Repita a senha', 'novaSenha99')
  await A.click('Salvar senha', 'button[type=submit]')
  await A.sleep(1500)
  r.check('nova senha salva e a pessoa entra no app', !(await A.text()).includes('Salvar senha'))
  await signOut(A)

  await A.goto(BASE)
  await A.click('Entrar ou criar conta')
  await A.fill('E-mail', 'rec@teste.com')
  await A.fill('Senha', 'senha1234')
  await A.click('Entrar', 'button[type=submit]')
  await A.sleep(1500)
  r.check('senha antiga não entra mais', /credenciais|senha|incorret|inválid/i.test(await A.text()) && (await A.text()).includes('Entrar'))
  await A.fill('Senha', 'novaSenha99')
  await A.click('Entrar', 'button[type=submit]')
  await A.sleep(2500)
  r.check('nova senha entra', !(await A.eval(`!!document.querySelector('button[type=submit]') && document.body.innerText.includes('Esqueci minha senha')`)))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('recovery-erro').catch(() => {})
} finally {
  const failed = r.print(A)
  A.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
