// Auditoria: um registro recusado pelo servidor não trava a sincronização (caminho real: supabase-js + classificação do erro).
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
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)

const A = await launch(9397)
const B = await launch(9398)
try {
  for (const b of [A, B]) {
    await b.mobile()
    await b.send('Network.enable')
    await b.send('Network.setBypassServiceWorker', { bypass: true })
  }
  await signUp(A, 'fila@teste.com')
  let s = await state()
  const uid = s.users.find((u) => u.email === 'fila@teste.com').id

  // A note too large for the server, then a normal task
  await A.goto(BASE + '#/notes')
  await A.sleep(700)
  await A.click('Criar nota')
  await typeIn(A, 'input[placeholder="Título"]', 'Nota enorme')
  await typeIn(A, 'textarea[placeholder="Escreva aqui…"]', 'x'.repeat(260_000))
  await A.click('Salvar', '[role=dialog] button[type=submit]')
  await A.sleep(500)
  await A.goto(BASE + '#/tasks')
  await A.sleep(600)
  await typeIn(A, 'input[placeholder="Adicionar tarefa rápida…"]', 'Tarefa normal')
  await A.eval(`document.querySelector('input[placeholder="Adicionar tarefa rápida…"]').closest('form').requestSubmit()`)
  await A.sleep(500)
  await syncNow(A)
  await A.sleep(1500)
  s = await state()
  const mine = s.records.filter((x) => x.user_id === uid)
  r.check('a tarefa sobe mesmo com a nota recusada no mesmo envio', mine.some((x) => x.collection === 'tasks' && x.data.title === 'Tarefa normal') && !mine.some((x) => x.collection === 'notes'))
  const text = await A.text()
  r.check('o app avisa "1 item não enviado" e explica que ele continua salvo no aparelho', text.includes('1 item não enviado') && text.includes('continua salvo neste aparelho'))

  // The other device gets everything else
  await signIn(B, 'fila@teste.com')
  await B.goto(BASE + '#/tasks')
  for (let i = 0; i < 16 && !(await B.text()).includes('Tarefa normal'); i++) await B.sleep(500)
  r.check('outro aparelho recebe o resto normalmente', (await B.text()).includes('Tarefa normal'))

  // The note is still on device A; making it smaller sends it
  await A.goto(BASE + '#/notes')
  await A.sleep(700)
  r.check('a nota recusada não sumiu do aparelho', (await A.text()).includes('Nota enorme'))
  await A.click('Nota enorme', 'button')
  await A.sleep(400)
  await typeIn(A, 'textarea[placeholder="Escreva aqui…"]', 'agora curta')
  await A.click('Salvar', '[role=dialog] button[type=submit]')
  await A.sleep(500)
  await syncNow(A)
  s = await state()
  r.check('depois de reduzida, a nota sobe e o aviso some', s.records.some((x) => x.user_id === uid && x.collection === 'notes' && x.data.body === 'agora curta') && !(await A.text()).includes('item não enviado'))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('rejected-erro-a').catch(() => {})
} finally {
  const failed = r.print(A)
  A.close()
  B.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
