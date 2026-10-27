// Etapa 3 (cotas): o que passa do limite da conta fica no aparelho, com aviso claro, e sobe sozinho
// quando se apaga algo. Two accounts — against the LOCAL mock of Supabase (tests/e2e/mock-supabase.mjs), never the real project.
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
  await b.click('Entrar ou criar conta')
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

const choose = (b, selector, value) =>
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
const fillIn = (b, labelText, value) =>
  b.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.trim().startsWith(${JSON.stringify(labelText)})); const el = l && l.querySelector('input, textarea'); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)

const typeIn = (b, selector, value) =>
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)

const quota = (collection, limit) => fetch(`${MOCK}/__quota?collection=${collection}${limit === null ? '' : `&limit=${limit}`}`)

async function newNote(b, title) {
  await b.goto(BASE + '#/notes')
  await b.sleep(600)
  if ((await b.text()).includes('Nenhuma nota ainda')) await b.click('Criar nota')
  else await b.click('Nova anotação')
  await typeIn(b, 'input[placeholder="Título"]', title)
  await typeIn(b, 'textarea[placeholder="Escreva aqui…"]', 'texto de ' + title)
  await b.click('Salvar', '[role=dialog] button[type=submit]')
  await b.sleep(500)
}

const A = await launch(9397)
const B = await launch(9398)
try {
  for (const b of [A, B]) {
    await b.mobile()
    await b.send('Network.enable')
    await b.send('Network.setBypassServiceWorker', { bypass: true })
  }
  await quota('notes', 2)
  await signUp(A, 'cota-a@teste.com')
  await signUp(B, 'cota-b@teste.com')
  let s = await state()
  const uidA = s.users.find((u) => u.email === 'cota-a@teste.com').id
  const uidB = s.users.find((u) => u.email === 'cota-b@teste.com').id

  for (const t of ['Nota 1', 'Nota 2', 'Nota 3']) await newNote(A, t)
  await syncNow(A)
  await A.sleep(1000)
  s = await state()
  const notesOf = (uid) => s.records.filter((x) => x.user_id === uid && x.collection === 'notes' && !x.deleted).map((x) => x.data.title).sort()
  r.check('o servidor fica no limite (2 notas) e recusa só a terceira', notesOf(uidA).length === 2)
  const text = await A.text()
  r.check('aviso claro com o limite e a seção', text.includes('Limite de 2 itens em “Anotações” atingido nesta conta.') && text.includes('1 item continua salvo só neste aparelho'), text.split('\n').filter((l) => /Limite|aparelho/.test(l)).join(' | '))
  await A.goto(BASE + '#/notes')
  await A.sleep(700)
  const local = await A.text()
  r.check('as 3 notas continuam no aparelho (nada se perde)', ['Nota 1', 'Nota 2', 'Nota 3'].every((t) => local.includes(t)))

  // Another account is not affected by A's usage
  for (const t of ['B1', 'B2']) await newNote(B, t)
  await syncNow(B)
  s = await state()
  r.check('outra conta usa o próprio limite, sem interferência', notesOf(uidB).length === 2 && !(await B.text()).includes('Limite de'))

  // Deleting one note frees space: the waiting one goes up by itself
  const waiting = ['Nota 1', 'Nota 2', 'Nota 3'].find((t) => !notesOf(uidA).includes(t))
  const victim = notesOf(uidA)[0]
  await A.goto(BASE + '#/notes')
  await A.sleep(600)
  await A.click(victim, 'button')
  await A.sleep(400)
  await A.click('Excluir')
  // The confirmation's button (the last "Excluir" on screen, above the note's sheet).
  await A.eval(`[...document.querySelectorAll('button')].filter((e) => e.textContent.trim() === 'Excluir' && e.getClientRects().length).at(-1).click()`)
  await A.sleep(600)
  await syncNow(A)
  await A.sleep(1000)
  s = await state()
  r.check('apagar uma nota libera a vaga e a que esperava sobe sozinha', notesOf(uidA).includes(waiting) && !notesOf(uidA).includes(victim) && notesOf(uidA).length === 2, notesOf(uidA).join(', '))
  r.check('o aviso some', !(await A.text()).includes('Limite de'))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('quota-erro-a').catch(() => {})
} finally {
  await quota('notes', null).catch(() => {})
  const failed = r.print(A)
  A.close()
  B.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
