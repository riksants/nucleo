// Etapa 1 da auditoria (A1/A2): quando a sessão termina — "Sair", token revogado com o app aberto,
// sessão expirada com o app fechado — nada da conta fica no aparelho nem aparece para a próxima pessoa.
// Against the LOCAL mock of Supabase (tests/e2e/mock-supabase.mjs), never the real project.
// Needs the mock build in dist-e2e-cloud: npm run build:e2e-cloud
import { spawn } from 'node:child_process'
import { launch } from './cdp.mjs'
import { reporter } from './helpers.mjs'

const BASE = 'http://localhost:4318/nucleo/'
const MOCK = 'http://localhost:54399'
const ANA = 'Tarefa secreta da Ana'
const BRUNO = 'Tarefa do Bruno'
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
const mock = (path) => fetch(MOCK + path)

// Runs in every page, from the first byte: notes each moment a private text (or the sign-in
// screen) is on screen. sessionStorage keeps the notes across the restarts of the page.
const OBSERVER = `(() => {
  const marks = [${JSON.stringify(ANA)}, ${JSON.stringify(BRUNO)}, 'Esqueci minha senha']
  let last = ''
  const scan = () => {
    const text = document.body ? document.body.innerText : ''
    const now = marks.filter((m) => text.includes(m)).join('|')
    if (now === last) return
    last = now
    try {
      const list = JSON.parse(sessionStorage.getItem('e2e:seen') || '[]')
      list.push({ t: Date.now(), on: now })
      sessionStorage.setItem('e2e:seen', JSON.stringify(list.slice(-500)))
    } catch {}
  }
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true })
})()`

/** True when `text` was on screen after `since` (ms) — once the sign-in screen showed, or at all. */
async function shownAfter(b, text, since) {
  const seen = JSON.parse((await b.eval(`sessionStorage.getItem('e2e:seen') || '[]'`)) || '[]')
  return seen.some((e) => e.t > since && e.on.split('|').includes(text))
}

/** Every database on the device, every store, searched for a text. */
const deviceHas = (b, text) =>
  b.eval(`(async () => {
    const names = (await indexedDB.databases()).map((d) => d.name)
    for (const name of names) {
      const db = await new Promise((ok, ko) => { const q = indexedDB.open(name); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error) })
      for (const store of db.objectStoreNames) {
        const all = await new Promise((ok) => { const g = db.transaction(store).objectStore(store).getAll(); g.onsuccess = () => ok(g.result) })
        if (JSON.stringify(all).includes(${JSON.stringify(text)})) { db.close(); return name + '/' + store }
      }
      db.close()
    }
    for (const k of Object.keys(localStorage)) if ((localStorage.getItem(k) || '').includes(${JSON.stringify(text)})) return 'localStorage/' + k
    return null
  })()`)
const caches = (b) => b.eval(`indexedDB.databases().then((l) => l.map((d) => d.name).filter((n) => n.startsWith('nucleo-u-')))`)
const keys = (b) => b.eval(`Object.keys(localStorage).sort()`)

async function waitFor(b, check, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await check().catch(() => false)) return true
    await sleep(500)
  }
  return false
}
const onSignIn = (b) => waitFor(b, async () => (await b.text()).includes('Esqueci minha senha'))

async function createAccount(b, email) {
  await b.click('Criar conta')
  await b.fill('E-mail', email)
  await b.fill('Senha', 'Nucleo-teste-42')
  await b.fill('Repita a senha', 'Nucleo-teste-42')
  await b.click('Criar conta', 'button[type=submit]')
  await b.sleep(800)
  await b.fill('Código do e-mail', '123456')
  await b.click('Confirmar', 'button[type=submit]')
  await b.sleep(2500)
  await b.click('Configurar minha conta').catch(() => {})
  await b.click('Continuar').catch(() => {})
  await b.click('Continuar').catch(() => {})
  await b.click('Entrar').catch(() => {})
  await b.sleep(1500)
}
async function signInHere(b, email) {
  await b.fill('E-mail', email)
  await b.fill('Senha', 'Nucleo-teste-42')
  await b.click('Entrar', 'button[type=submit]')
  await b.sleep(3000)
}
const typeIn = (b, selector, value) =>
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
async function addTask(b, title) {
  await b.goto(BASE + '#/tasks')
  await b.sleep(700)
  await typeIn(b, 'input[aria-label="Adicionar tarefa rápida"]', title)
  await b.eval(`document.querySelector('input[aria-label="Adicionar tarefa rápida"]').closest('form').requestSubmit()`)
  await b.sleep(500)
}
async function syncNow(b) {
  await b.goto(BASE + '#/account')
  await b.click('Agora')
  await b.sleep(1500)
}
const showsTask = (b, title) => waitFor(b, async () => (await b.text()).includes(title), 16)

const A = await launch(9401)
try {
  await A.mobile()
  await A.send('Network.enable')
  await A.send('Network.setBypassServiceWorker', { bypass: true })
  await A.send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVER })

  // ---------------------------------------------------------------- Teste 1: Ana entra, cria dados e sai
  await A.goto(BASE)
  await A.click('Entrar ou criar conta')
  await createAccount(A, 'ana@conta.com')
  await addTask(A, ANA)
  await syncNow(A)
  // Small account preferences, next to device choices that must survive.
  await A.eval(`localStorage.setItem('nucleo:focusTimer', JSON.stringify({ taskId: 'x', startedAt: new Date().toISOString(), elapsedMs: 0, runningSince: null, note: ${JSON.stringify(ANA)} })); localStorage.setItem('nucleo:displayCurrency', '"AED"'); localStorage.setItem('nucleo:theme', '"dark"'); true`)
  const anaId = (await state()).users.find((u) => u.email === 'ana@conta.com').id
  r.check('pré-condição: a conta da Ana tem cópia no aparelho com a tarefa', (await caches(A)).includes('nucleo-u-' + anaId) && Boolean(await deviceHas(A, ANA)))

  await A.goto(BASE + '#/settings')
  await A.sleep(600)
  await A.click('Sair da conta', 'button')
  await A.sleep(800)
  const t1 = Date.now()
  await A.click('Sair', '[role=dialog] button')
  r.check('T1: depois de "Sair", aparece a tela de entrada', await onSignIn(A))
  await A.sleep(800)
  r.check('T1: nenhum banco de conta fica no aparelho', (await caches(A)).length === 0, JSON.stringify(await caches(A)))
  r.check('T1: a tarefa da Ana não existe em nenhum armazenamento do aparelho', (await deviceHas(A, ANA)) === null, String(await deviceHas(A, ANA)))
  let k = await keys(A)
  r.check('T1: sessão e preferências da conta removidas (auth, foco, moeda)', !k.some((x) => x.startsWith('nucleo:auth') && x !== 'nucleo:auth-code-verifier') && !k.includes('nucleo:focusTimer') && !k.includes('nucleo:displayCurrency'), k.join(','))
  r.check('T1: preferência do aparelho (tema) continua', k.includes('nucleo:theme'))
  r.check('T1: nada da Ana aparece na tela depois de sair', !(await shownAfter(A, ANA, t1 + 1500)) && !(await A.text()).includes(ANA))

  // ---------------------------------------------------------------- Teste 4: fechar e abrir o app de novo
  const t4 = Date.now()
  await A.goto('about:blank')
  await A.goto(BASE)
  await A.goto(BASE + '#/tasks')
  await A.sleep(1500)
  r.check('T4: reabrindo o app, nada da Ana na tela (nem por um instante)', !(await shownAfter(A, ANA, t4)) && !(await A.text()).includes(ANA))
  r.check('T4: reabrindo o app, nada da Ana no aparelho', (await deviceHas(A, ANA)) === null && (await caches(A)).length === 0)

  // ---------------------------------------------------------------- Teste 2: Bruno entra depois da Ana
  await A.goto(BASE)
  if (!(await A.text()).includes('Esqueci minha senha')) await A.click('Entrar ou criar conta')
  await createAccount(A, 'bruno@conta.com')
  await A.goto(BASE + '#/tasks')
  await A.sleep(1500)
  const brunoId = (await state()).users.find((u) => u.email === 'bruno@conta.com').id
  r.check('T2: a conta do Bruno não mostra nada da Ana', !(await A.text()).includes(ANA) && !(await shownAfter(A, ANA, t1 + 1500)))
  r.check('T2: no aparelho só existe o banco do Bruno, sem nada da Ana', JSON.stringify(await caches(A)) === JSON.stringify(['nucleo-u-' + brunoId]) && (await deviceHas(A, ANA)) === null)
  // Bruno's own setup writes his currency; Ana's (AED) and her focus timer must not be there.
  const brunoPrefs = await A.eval(`({ focus: localStorage.getItem('nucleo:focusTimer'), currency: localStorage.getItem('nucleo:displayCurrency') })`)
  r.check('T2: o Bruno não herda as preferências da Ana', brunoPrefs.focus === null && brunoPrefs.currency !== '"AED"', JSON.stringify(brunoPrefs))
  await addTask(A, BRUNO)
  await syncNow(A)
  r.check('T2: a tarefa do Bruno chegou ao servidor, na conta dele', (await state()).records.some((x) => x.user_id === brunoId && x.data?.title === BRUNO))

  // ---------------------------------------------------------------- Teste 3a: token revogado com o app aberto (sem "Sair")
  await A.goto(BASE + '#/tasks')
  r.check('pré-condição: a tarefa do Bruno está na tela', await showsTask(A, BRUNO))
  await mock('/__offline?v=1')
  await addTask(A, 'Pendente do Bruno') // stays queued on the device: the server is unreachable
  await mock('/__revoke?email=bruno@conta.com')
  await A.sleep(31_000) // the server is asked again at most every 30 s
  const t3 = Date.now()
  await A.eval(`document.dispatchEvent(new Event('visibilitychange')); true`) // the app comes back to the front
  r.check('T3a: sessão recusada pelo servidor → tela de entrada sozinha', await onSignIn(A))
  await A.sleep(800)
  let text = await A.text()
  r.check('T3a: explica que a sessão terminou e que 1 alteração não enviada foi descartada', text.includes('Sua sessão terminou') && text.includes('1 alteração'), text.slice(0, 300))
  r.check('T3a: nenhum banco de conta fica no aparelho', (await caches(A)).length === 0)
  r.check('T3a: nada do Bruno no aparelho', (await deviceHas(A, BRUNO)) === null && (await deviceHas(A, 'Pendente do Bruno')) === null)
  const seenT3 = JSON.parse(await A.eval(`sessionStorage.getItem('e2e:seen') || '[]'`))
  const firstAuth = seenT3.find((e) => e.t > t3 && e.on.includes('Esqueci minha senha'))?.t ?? Infinity
  r.check('T3a: depois que a tela de entrada aparece, nada do Bruno volta à tela', !seenT3.some((e) => e.t > firstAuth && e.on.split('|').includes(BRUNO)))
  r.check('T3a: sessão removida do localStorage', !(await keys(A)).some((x) => x === 'nucleo:auth' || x === 'nucleo:auth-user'))
  await mock('/__offline?v=0')

  // ---------------------------------------------------------------- Teste 3b: sessão expirou com o app fechado
  await signInHere(A, 'ana@conta.com')
  await A.goto(BASE + '#/tasks')
  r.check('T5: entrar de novo na conta da Ana traz os dados do servidor (sincronização)', await showsTask(A, ANA))
  r.check('pré-condição: banco da Ana voltou ao aparelho', (await caches(A)).includes('nucleo-u-' + anaId))
  await A.goto('about:blank')
  await A.goto(BASE + 'favicon.svg')
  // Hours later: the stored session is past its expiry and can no longer be renewed.
  await A.eval(`(() => { const s = JSON.parse(localStorage.getItem('nucleo:auth')); s.expires_at = Math.floor(Date.now() / 1000) - 3600; localStorage.setItem('nucleo:auth', JSON.stringify(s)); return true })()`)
  const t3b = Date.now()
  await A.goto(BASE + '#/tasks')
  r.check('T3b: ao abrir com a sessão expirada → tela de entrada', await onSignIn(A))
  await A.sleep(800)
  text = await A.text()
  r.check('T3b: explica que a sessão terminou', text.includes('Sua sessão terminou'))
  r.check('T3b: nada da Ana aparece na tela ao abrir (nem por um instante)', !(await shownAfter(A, ANA, t3b)))
  r.check('T3b: nada da Ana no aparelho e nenhum banco de conta', (await deviceHas(A, ANA)) === null && (await caches(A)).length === 0)

  // ---------------------------------------------------------------- Teste 5: o resto continua funcionando
  await signInHere(A, 'ana@conta.com')
  await A.goto(BASE + '#/tasks')
  r.check('T5: login normal depois da expiração traz os dados', await showsTask(A, ANA))
  await addTask(A, 'Nova da Ana')
  await syncNow(A)
  const s = await state()
  r.check('T5: sincronização envia o que é novo para a conta certa', s.records.some((x) => x.user_id === anaId && x.data?.title === 'Nova da Ana'))
  r.check('T5: dados do Bruno continuam no servidor, só na conta dele', s.records.some((x) => x.user_id === brunoId && x.data?.title === BRUNO) && !s.records.some((x) => x.user_id === anaId && x.data?.title === BRUNO))
  await A.goto(BASE + '#/settings')
  await A.sleep(600)
  r.check('T5: Configurações mostram a conta atual', (await A.text()).includes('ana@conta.com'))
  r.check('sem erros de JavaScript na página', !A.logs.some((l) => l.startsWith('EXC')), A.logs.filter((l) => l.startsWith('EXC')).join(' | '))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('session-cleanup-erro').catch(() => {})
} finally {
  const failed = r.print(A)
  A.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
