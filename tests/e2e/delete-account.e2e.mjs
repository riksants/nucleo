// Etapa 9: Conta → Excluir conta. Pede a palavra EXCLUIR e a senha de novo; senha errada não apaga
// nada; certo, a conta e os dados somem do servidor e do aparelho, e a outra conta não é tocada.
// Against the LOCAL mock of Supabase (tests/e2e/mock-supabase.mjs), never the real project.
// Needs the mock build in dist-e2e-cloud: npm run build:e2e-cloud
import { spawn } from 'node:child_process'
import { launch } from './cdp.mjs'
import { reporter } from './helpers.mjs'

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
  // The first paint can take a while on a slow machine: wait for the start screen before tapping.
  for (let i = 0; i < 40 && !(await b.text()).includes('Entrar ou criar conta'); i++) await sleep(500)
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

const typeIn = (b, selector, value) =>
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
const fillDialog = (b, labelText, value) =>
  b.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.trim().startsWith(${JSON.stringify(labelText)})); const el = l && l.querySelector('input'); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
const submit = (b) => b.click('Excluir conta e dados', '[role=dialog] button[type=submit]')

async function newNote(b, title) {
  await b.goto(BASE + '#/notes')
  await b.sleep(600)
  if ((await b.text()).includes('Nenhuma nota ainda')) await b.click('Criar nota')
  else await b.click('Nova anotação')
  await typeIn(b, 'input[placeholder="Título"]', title)
  await b.click('Salvar', '[role=dialog] button[type=submit]')
  await b.sleep(500)
}

const A = await launch(9461)
const B = await launch(9462)
try {
  for (const b of [A, B]) await b.mobile()
  await signUp(A, 'apagar@teste.com')
  await newNote(A, 'Nota que vai sumir')
  await signUp(B, 'fica@teste.com')
  await newNote(B, 'Nota da outra conta')
  await A.goto(BASE + '#/account')
  await A.click('Agora')
  await A.sleep(1500)
  await B.goto(BASE + '#/account')
  await B.click('Agora')
  await B.sleep(1500)
  let s = await state()
  const aId = s.users.find((u) => u.email === 'apagar@teste.com').id
  r.check('as duas contas sincronizaram', s.records.some((x) => x.user_id === aId) && s.records.some((x) => x.user_id !== aId))

  await A.goto(BASE + '#/account')
  await A.sleep(600)
  r.check('Conta mostra "Excluir conta" e a política de privacidade', (await A.text()).includes('Excluir conta') && (await A.text()).includes('Política de privacidade'))
  await A.click('Excluir conta', 'button')
  await A.sleep(500)
  r.check('a tela explica o que será apagado', (await A.text()).includes('Não dá para desfazer'))

  // Without the word: nothing happens.
  await fillDialog(A, 'Senha da conta', 'Nucleo-teste-42')
  await submit(A)
  await A.sleep(800)
  r.check('sem digitar EXCLUIR, nada é apagado', (await A.text()).includes('Digite EXCLUIR') && (await state()).users.some((u) => u.id === aId))

  // Wrong password: nothing is deleted — and nothing on this device changes either (notifications stay on).
  await A.eval(`localStorage.setItem('nucleo:pushWanted', 'true')`)
  await fillDialog(A, 'Digite EXCLUIR', 'excluir')
  await fillDialog(A, 'Senha da conta', 'senha-errada-1')
  await submit(A)
  await A.sleep(1500)
  s = await state()
  r.check('senha errada: aviso e nada apagado', (await A.text()).includes('Nada foi apagado') && s.users.some((u) => u.id === aId) && s.records.some((x) => x.user_id === aId))
  r.check('senha errada: as notificações deste aparelho continuam ligadas', (await A.eval(`localStorage.getItem('nucleo:pushWanted')`)) === 'true')

  await fillDialog(A, 'Senha da conta', 'Nucleo-teste-42')
  await submit(A)
  await A.sleep(4000)
  s = await state()
  r.check('senha certa: conta e dados apagados no servidor', !s.users.some((u) => u.id === aId) && !s.records.some((x) => x.user_id === aId))
  r.check('a outra conta continua com tudo', s.users.some((u) => u.email === 'fica@teste.com') && s.records.some((x) => x.user_id !== aId))
  r.check('o aparelho volta para a entrada dizendo que a conta foi excluída', (await A.text()).includes('Sua conta foi excluída'))
  const dbs = await A.eval(`indexedDB.databases().then((l) => l.map((d) => d.name))`)
  r.check('a cópia da conta saiu deste aparelho', !dbs.includes(`nucleo-u-${aId}`), JSON.stringify(dbs))
  r.check('pediu a exclusão só depois de confirmar a senha', s.requests.filter((q) => q.includes('delete_my_account')).length === 1)

  // Reopening the app: no session left; the old password doesn't get in nor bring anything back.
  await A.goto('about:blank')
  await A.goto(BASE + '#/notes')
  await A.sleep(2500)
  r.check('reabrindo o app: sem sessão e nada da conta excluída', !(await A.eval(`Boolean(localStorage.getItem('nucleo:auth'))`)) && !(await A.text()).includes('Nota que vai sumir'))
  if (!(await A.text()).includes('Esqueci minha senha')) await A.click('Entrar ou criar conta').catch(() => {})
  await A.fill('E-mail', 'apagar@teste.com')
  await A.fill('Senha', 'Nucleo-teste-42')
  await A.click('Entrar', 'button[type=submit]')
  await A.sleep(2000)
  const err = await A.eval(`document.querySelector('[role=alert]')?.textContent ?? ''`)
  r.check('a senha antiga não entra mais (mesma mensagem de senha errada)', err.includes('E-mail ou senha incorretos.') && !(await A.eval(`Boolean(localStorage.getItem('nucleo:auth'))`)), err)
  s = await state()
  r.check('nenhum dado da conta excluída volta ao servidor', !s.records.some((x) => x.user_id === aId) && !(await A.text()).includes('Nota que vai sumir'))
} catch (err) {
  r.check('ERRO', false, err.message)
} finally {
  const failed = r.print(A)
  A.close()
  B.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
