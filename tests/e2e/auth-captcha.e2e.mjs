// Cloudflare Turnstile nas telas de entrada (Etapa 2): Entrar, Criar conta, Recuperar senha e
// Reenviar e-mail mandam um token novo a cada pedido; o resto (código do e-mail, nova senha,
// sincronização) não usa CAPTCHA. Against the LOCAL mock of Supabase, never the real project.
// Browser A swaps Cloudflare's script for a stand-in (one distinct token per check, can fail or be
// blocked). Browser B loads the real script with Cloudflare's official test site key (needs internet).
// Needs a build with the test site key in dist-e2e-captcha:
//   npm run build:e2e-captcha
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { launch } from './cdp.mjs'
import { reporter } from './helpers.mjs'

const BASE = 'http://localhost:4319/nucleo/'
const MOCK = 'http://localhost:54399'
const SITE_KEY = '1x00000000000000000000AA'
const TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const EMAIL = 'bia@conta.com'
const PASS = 'Nucleo-teste-42'
const r = reporter()
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const procs = [spawn(process.execPath, ['tests/e2e/mock-supabase.mjs'], { stdio: 'ignore' }), spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist-e2e-captcha', '--port', '4319', '--strictPort'], { stdio: 'ignore', env: { ...process.env, NUCLEO_BASE: '/nucleo/' } })]
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(BASE)).ok && (await fetch(MOCK + '/__state')).ok) break
  } catch {}
  await sleep(500)
}
const mock = async (path) => (await fetch(MOCK + path)).json()
const captchaLog = async () => (await mock('/__state')).captcha

async function waitFor(check, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await check().catch(() => false)) return true
    await sleep(500)
  }
  return false
}
const onSignIn = (b) => waitFor(async () => (await b.text()).includes('Esqueci minha senha'))
const errorText = (b) => b.eval(`document.querySelector('[role=alert]')?.textContent ?? ''`)
const enabled = (b, label) => b.eval(`(() => { const el = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === ${JSON.stringify(label)}); return Boolean(el && !el.disabled) })()`)
const ready = (b, label) => waitFor(() => enabled(b, label), 30)
/** The last token the stand-in handed out (unique across page loads, like Cloudflare's). */
const lastToken = (b) => b.eval('window.__ts?.last ?? null')
async function signOut(b) {
  await b.goto(BASE + '#/account')
  await b.click('Sair desta conta')
  await b.click('Sair', 'button')
  return onSignIn(b)
}
async function signInHere(b, email, password) {
  await ready(b, 'Entrar')
  await b.fill('E-mail', email)
  await b.fill('Senha', password)
  await b.click('Entrar', 'button[type=submit]')
  await b.sleep(1500)
}

// Stand-in for https://challenges.cloudflare.com/turnstile/v0/api.js: same API (render/remove), a new
// token per check. `__ts.manual` holds the answer until `__ts.pass()`; `__ts.fail` makes it fail.
const FAKE = `window.__ts = { n: 0, page: Math.random().toString(36).slice(2, 8), last: null, renders: 0, removed: 0, options: null, manual: false, fail: false, waiting: [],
  pass() { for (const f of this.waiting.splice(0)) f() } };
window.turnstile = {
  render(el, o) {
    const ts = window.__ts; const id = 'w' + (++ts.renders); ts.options = { sitekey: o.sitekey, appearance: o.appearance }
    const answer = () => ts.fail ? o['error-callback']?.('600010') : o.callback((ts.last = 'fake-token-' + ts.page + '-' + (++ts.n)))
    if (ts.manual) ts.waiting.push(answer); else setTimeout(answer, 300)
    return id
  },
  remove() { window.__ts.removed++ },
}`

const A = await launch(9413)
let B = null
try {
  await A.mobile()
  await A.send('Network.enable')
  await A.send('Fetch.enable', { patterns: [{ urlPattern: 'https://challenges.cloudflare.com/*' }] })
  const scriptUrls = []
  let blockScript = false
  A.on('Fetch.requestPaused', ({ requestId, request }) => {
    scriptUrls.push(request.url)
    if (blockScript) A.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
    else A.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }], body: Buffer.from(FAKE).toString('base64') })
  })
  await mock('/__captcha?on=1')
  await mock('/__limits?email=0')

  // ------------------------------------------------ Tela de entrada
  await A.goto(BASE)
  r.check('a tela inicial (sem entrar) não carrega o script da Cloudflare', scriptUrls.length === 0, scriptUrls.join(' '))
  await A.click('Entrar ou criar conta')
  await waitFor(() => A.eval('Boolean(window.__ts)'), 20)
  await A.eval('window.__ts.manual = true')
  // The first check may already have answered before `manual` was set: start a fresh one.
  await A.click('Criar conta')
  await A.click('Voltar')
  await sleep(500)
  r.check('script carregado de challenges.cloudflare.com em modo explícito', scriptUrls.some((u) => u.startsWith('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')), scriptUrls.join(' '))
  r.check('widget com a Site Key de teste e só aparece se precisar', await A.eval(`window.__ts.options.sitekey === ${JSON.stringify(SITE_KEY)} && window.__ts.options.appearance === 'interaction-only'`), JSON.stringify(await A.eval('window.__ts.options')))
  r.check('antes da verificação: "Entrar" desligado e aviso na tela', !(await enabled(A, 'Entrar')) && (await A.text()).includes('Verificação de segurança em andamento'))
  await A.eval('window.__ts.manual = false; window.__ts.pass()')
  r.check('depois da verificação: "Entrar" liberado', await ready(A, 'Entrar'))

  // ------------------------------------------------ Criar conta
  await A.click('Criar conta')
  await ready(A, 'Criar conta')
  const signUpToken = await lastToken(A)
  await A.fill('E-mail', EMAIL)
  await A.fill('Senha', PASS)
  await A.fill('Repita a senha', PASS)
  await A.click('Criar conta', 'button[type=submit]')
  await waitFor(async () => (await A.text()).includes('Confirme seu e-mail'), 20)
  let log = await captchaLog()
  r.check('Criar conta envia o token ao servidor', log.at(-1)?.path === '/auth/v1/signup' && log.at(-1)?.token === signUpToken, JSON.stringify(log.at(-1)))

  // ------------------------------------------------ Reenviar e-mail
  await ready(A, 'Reenviar e-mail')
  await A.click('Reenviar e-mail')
  await waitFor(async () => (await A.text()).includes('E-mail reenviado.'), 20)
  log = await captchaLog()
  r.check('Reenviar e-mail envia um token novo (não o do cadastro)', log.at(-1)?.path === '/auth/v1/resend' && log.at(-1)?.token?.startsWith('fake-token-') && log.at(-1)?.token !== signUpToken, JSON.stringify(log.slice(-2)))
  r.check('e-mail reenviado com o CAPTCHA exigido pelo servidor', (await A.text()).includes('E-mail reenviado.'), await errorText(A))

  // ------------------------------------------------ Código do e-mail: sem CAPTCHA
  const before = (await captchaLog()).length
  await A.fill('Código do e-mail', '123456')
  await A.click('Confirmar', 'button[type=submit]')
  await A.sleep(2500)
  for (const step of ['Configurar minha conta', 'Continuar', 'Continuar', 'Entrar']) await A.click(step).catch(() => {})
  await A.sleep(1500)
  r.check('confirmar o código não pede CAPTCHA e entra na conta', (await captchaLog()).length === before && (await A.eval(`Boolean(localStorage.getItem('nucleo:auth'))`)))
  r.check('sair da conta continua funcionando', await signOut(A))

  // ------------------------------------------------ Entrar: senha errada, depois certa
  await signInHere(A, EMAIL, 'errada-123')
  r.check('Entrar com senha errada: "E-mail ou senha incorretos."', (await errorText(A)).includes('E-mail ou senha incorretos.'), await errorText(A))
  const wrongToken = (await captchaLog()).at(-1)?.token
  r.check('a tentativa errada levou um token', wrongToken?.startsWith('fake-token-'), String(wrongToken))
  r.check('depois da tentativa, uma verificação nova libera "Entrar" de novo', await ready(A, 'Entrar'))
  await signInHere(A, EMAIL, PASS)
  log = await captchaLog()
  r.check('Entrar com a senha certa usa outro token e entra', log.at(-1)?.path === '/auth/v1/token' && log.at(-1)?.token !== wrongToken && (await A.eval(`Boolean(localStorage.getItem('nucleo:auth'))`)), JSON.stringify(log.slice(-2)))
  r.check('nenhum token foi usado duas vezes', new Set(log.map((x) => x.token)).size === log.length)
  r.check('sair de novo', await signOut(A))

  // ------------------------------------------------ Recuperar senha
  await A.click('Esqueci minha senha')
  await ready(A, 'Enviar código')
  await A.fill('E-mail', EMAIL)
  await A.click('Enviar código', 'button[type=submit]')
  await waitFor(async () => (await A.text()).includes('Digite o código'), 20)
  log = await captchaLog()
  r.check('Recuperar senha envia o token ao servidor', log.at(-1)?.path === '/auth/v1/recover' && log.at(-1)?.token?.startsWith('fake-token-') && (await A.text()).includes('Digite o código'), JSON.stringify(log.at(-1)))
  r.check('todas as chamadas protegidas levaram token', log.every((x) => x.token))

  // ------------------------------------------------ O servidor recusa o CAPTCHA
  await A.click('Voltar')
  await A.click('Voltar')
  await onSignIn(A)
  await mock('/__captcha?on=1&reject=1')
  await signInHere(A, EMAIL, PASS)
  r.check('CAPTCHA recusado pelo servidor: mensagem clara e não entra', (await errorText(A)).includes('verificação de segurança falhou') && !(await A.eval(`Boolean(localStorage.getItem('nucleo:auth'))`)), await errorText(A))
  await mock('/__captcha?on=1')
  await signInHere(A, EMAIL, PASS)
  r.check('com uma verificação nova, entra normalmente', await A.eval(`Boolean(localStorage.getItem('nucleo:auth'))`), await errorText(A))
  await signOut(A)

  // ------------------------------------------------ Script bloqueado / sem conexão com a Cloudflare
  blockScript = true
  await A.goto('about:blank')
  await A.goto(BASE)
  if (!(await A.text()).includes('Esqueci minha senha')) await A.click('Entrar ou criar conta')
  r.check('script bloqueado: aviso claro e "Entrar" desligado', await waitFor(async () => (await A.text()).includes('Não foi possível fazer a verificação de segurança') && !(await enabled(A, 'Entrar')), 20), JSON.stringify({ urls: scriptUrls.length, ts: await A.eval('Boolean(window.turnstile)'), text: (await A.text()).slice(0, 300) }))
  blockScript = false
  await A.click('Tentar de novo')
  r.check('"Tentar de novo" carrega o script e libera "Entrar"', await ready(A, 'Entrar'))

  // ------------------------------------------------ Verificação que falha no aparelho
  await A.eval('window.__ts.fail = true')
  await A.click('Criar conta')
  r.check('verificação que falha: aviso e botão desligado', await waitFor(async () => (await A.text()).includes('Não foi possível fazer a verificação de segurança') && !(await enabled(A, 'Criar conta')), 10))
  await A.eval('window.__ts.fail = false')
  await A.click('Tentar de novo')
  r.check('depois de "Tentar de novo", "Criar conta" é liberado', await ready(A, 'Criar conta'))
  r.check('o widget antigo é removido a cada troca', (await A.eval('window.__ts.removed')) > 0)

  // ------------------------------------------------ Cache offline
  const sw = await A.eval(`navigator.serviceWorker.getRegistration().then((reg) => Boolean(reg?.active))`)
  const cached = await A.eval(`caches.keys().then((keys) => Promise.all(keys.map((k) => caches.open(k).then((c) => c.keys())))).then((all) => all.flat().map((q) => q.url))`)
  r.check('service worker ativo (o teste de cache vale)', sw)
  r.check('o cache offline não guarda nada da Cloudflare', cached.length > 0 && !cached.some((u) => u.includes('cloudflare')), `${cached.length} itens`)
  const swFiles = readdirSync('dist-e2e-captcha').filter((f) => /^(sw|workbox-.*)\.js$/.test(f))
  r.check('o service worker publicado não tem regra para a Cloudflare', swFiles.length > 0 && swFiles.every((f) => !readFileSync(`dist-e2e-captcha/${f}`, 'utf8').includes('challenges.cloudflare.com')), swFiles.join(','))
  r.check('sem erros de JavaScript (A)', !A.logs.some((l) => l.startsWith('EXC')), A.logs.filter((l) => l.startsWith('EXC')).join(' | '))

  // ------------------------------------------------ Script real da Cloudflare (chave de teste)
  B = await launch(9414)
  await B.mobile()
  await B.goto(BASE)
  await B.click('Entrar ou criar conta')
  const real = await ready(B, 'Entrar')
  r.check('script real da Cloudflare com a chave de teste libera "Entrar"', real, real ? '' : 'sem acesso a challenges.cloudflare.com?')
  if (real) {
    await signInHere(B, EMAIL, PASS)
    log = await captchaLog()
    r.check('o token da Cloudflare chega ao servidor e a pessoa entra', log.at(-1)?.token === TEST_TOKEN && (await B.eval(`Boolean(localStorage.getItem('nucleo:auth'))`)), JSON.stringify(log.at(-1)))
  }
  r.check('sem erros de JavaScript (B)', !B.logs.some((l) => l.startsWith('EXC')), B.logs.filter((l) => l.startsWith('EXC')).join(' | '))
} catch (err) {
  r.check('ERROR', false, err.stack)
} finally {
  const failed = r.print(A)
  A.close()
  B?.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
