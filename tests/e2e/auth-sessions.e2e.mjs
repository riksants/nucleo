// Etapa 2 da auditoria: login, senha, tentativas, recuperação, troca de senha, "Sair de todos os
// aparelhos", duas abas e reabrir o app — e a limpeza da Etapa 1 em cada fim de sessão.
// Against the LOCAL mock of Supabase (tests/e2e/mock-supabase.mjs), never the real project. The mock
// follows Supabase Auth: sessions by session_id, logout scopes, a new password ends the other
// sessions, one e-mail per address per minute, made-up answer for a sign-up of an existing address.
// Needs a build made with VITE_SUPABASE_URL=http://localhost:54399 in dist-e2e-cloud.
import { spawn } from 'node:child_process'
import { launch } from './cdp.mjs'
import { reporter } from './helpers.mjs'

const BASE = 'http://localhost:4318/nucleo/'
const MOCK = 'http://localhost:54399'
const EMAIL = 'carla@conta.com'
const PASS = 'Nucleo-teste-42'
const NEW_PASS = 'Outra-senha-77'
const TASK = 'Tarefa privada da Carla'
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
const mock = async (path) => (await fetch(MOCK + path)).json()
const sessionsOf = (email) => mock('/__sessions?email=' + encodeURIComponent(email))

async function waitFor(check, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await check().catch(() => false)) return true
    await sleep(500)
  }
  return false
}
const onSignIn = (b) => waitFor(async () => (await b.text()).includes('Esqueci minha senha'))
const caches = (b) => b.eval(`indexedDB.databases().then((l) => l.map((d) => d.name).filter((n) => n.startsWith('nucleo-u-')))`)
const hasSession = (b) => b.eval(`Boolean(localStorage.getItem('nucleo:auth'))`)
const showsTask = (b) => waitFor(async () => (await b.text()).includes(TASK), 16)
const errorText = (b) => b.eval(`document.querySelector('[role=alert]')?.textContent ?? ''`)
const tokenCalls = async () => (await state()).requests.filter((x) => x.startsWith('POST /auth/v1/token?grant_type=password')).length

async function signInHere(b, email, password) {
  await b.fill('E-mail', email)
  await b.fill('Senha', password)
  await b.click('Entrar', 'button[type=submit]')
  await b.sleep(1500)
}
async function openSignIn(b) {
  await b.goto(BASE)
  if (!(await b.text()).includes('Esqueci minha senha')) await b.click('Entrar ou criar conta')
}
const typeIn = (b, selector, value) =>
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
/** Closes the app and opens it again (a fresh page, not just a hash change). */
async function reopen(b, hash = '') {
  await b.goto('about:blank')
  await b.goto(BASE + hash)
}
async function syncNow(b) {
  await b.goto(BASE + '#/account')
  await b.click('Agora')
  await b.sleep(1500)
}

const A = await launch(9411)
const B = await launch(9412)
let tab2 = null
try {
  for (const b of [A, B]) {
    await b.mobile()
    await b.send('Network.enable')
    await b.send('Network.setBypassServiceWorker', { bypass: true })
  }

  // One e-mail per address per 10 minutes here, so the "asked again too soon" case doesn't depend on speed.
  await mock('/__limits?email=600000')

  // ------------------------------------------------ Política de senha no cadastro
  await openSignIn(A)
  await A.click('Criar conta')
  await A.fill('E-mail', EMAIL)
  for (const [weak, expected] of [['', 'pelo menos 8'], ['abc1', 'pelo menos 8'], ['somenteletras', 'Misture letras e números'], ['Senha123', 'muito comum'], ['carla2024x', 'e-mail na senha']]) {
    await A.fill('Senha', weak)
    await A.fill('Repita a senha', weak)
    await A.click('Criar conta', 'button[type=submit]')
    await A.sleep(300)
    r.check(`cadastro recusa senha fraca "${weak}" com mensagem clara`, (await errorText(A)).includes(expected), await errorText(A))
  }
  r.check('senhas fracas nem chegam ao servidor', !(await state()).requests.some((x) => x.startsWith('POST /auth/v1/signup')))

  // ------------------------------------------------ Cadastro e login correto
  await A.fill('Senha', PASS)
  await A.fill('Repita a senha', PASS)
  await A.click('Criar conta', 'button[type=submit]')
  await A.sleep(800)
  await A.fill('Código do e-mail', '123456')
  await A.click('Confirmar', 'button[type=submit]')
  await A.sleep(2500)
  for (const step of ['Configurar minha conta', 'Continuar', 'Continuar', 'Entrar']) await A.click(step).catch(() => {})
  await A.sleep(1500)
  await A.goto(BASE + '#/tasks')
  await A.sleep(700)
  await typeIn(A, 'input[placeholder="Adicionar tarefa rápida…"]', TASK)
  await A.eval(`document.querySelector('input[placeholder="Adicionar tarefa rápida…"]').closest('form').requestSubmit()`)
  await A.sleep(500)
  await syncNow(A)
  r.check('pré-condição: a tarefa da Carla chegou ao servidor', (await state()).records.some((x) => x.data?.title === TASK))

  // ------------------------------------------------ 4. Logout normal
  await A.click('Sair desta conta')
  await A.click('Sair', 'button')
  r.check('logout normal: tela de entrada', await onSignIn(A))
  r.check('logout normal: nenhum dado da conta no aparelho (Etapa 1)', (await caches(A)).length === 0 && !(await hasSession(A)) && !(await A.text()).includes(TASK))

  // ------------------------------------------------ 2. Senha incorreta / e-mail inexistente: mesma resposta
  await signInHere(A, EMAIL, 'errada-123')
  const wrong = await errorText(A)
  r.check('senha incorreta: "E-mail ou senha incorretos."', wrong.includes('E-mail ou senha incorretos.'), wrong)
  await signInHere(A, 'ninguem@conta.com', 'errada-123')
  r.check('e-mail sem conta: exatamente a mesma mensagem (não revela quem tem conta)', (await errorText(A)) === wrong)
  r.check('senha incorreta não cria sessão', !(await hasSession(A)) && (await caches(A)).length === 0)

  // ------------------------------------------------ 3. Várias tentativas: o limite é do servidor
  await mock('/__limits?signin=5&email=600000')
  const before = await tokenCalls()
  for (let i = 0; i < 7; i++) await signInHere(A, EMAIL, 'errada-' + i)
  r.check('várias tentativas: depois do limite do servidor, "Muitas tentativas…"', (await errorText(A)).includes('Muitas tentativas'), await errorText(A))
  r.check('cada tentativa vai ao servidor (o app não finge um limite próprio)', (await tokenCalls()) - before === 7)
  await signInHere(A, EMAIL, PASS)
  r.check('com o limite ativo, nem a senha certa entra (bloqueio no servidor)', (await errorText(A)).includes('Muitas tentativas') && !(await hasSession(A)))
  await mock('/__limits?email=600000')

  // ------------------------------------------------ 1. Login correto
  await signInHere(A, EMAIL, PASS)
  r.check('login correto: entra e sincroniza os dados da conta', await showsTask(A))

  // ------------------------------------------------ 11. Fechar e reabrir o app
  await reopen(A, '#/tasks')
  r.check('reabrir o app: continua na conta, com os dados', await showsTask(A))
  tab2 = await A.newTab()
  await tab2.mobile()
  await tab2.goto(BASE + '#/tasks')
  r.check('nova aba (app aberto de novo): mesma sessão, mesmos dados', await waitFor(async () => (await tab2.text()).includes(TASK), 16))

  // ------------------------------------------------ 10. Duas abas: sair numa limpa a outra
  await A.send('Page.bringToFront')
  await A.goto(BASE + '#/account')
  await A.click('Sair desta conta')
  await A.click('Sair', 'button')
  r.check('duas abas: a aba onde saiu vai para a entrada', await onSignIn(A))
  r.check('duas abas: a outra aba também vai para a entrada, sozinha', await onSignIn(tab2), JSON.stringify({ text: (await tab2.text().catch((e) => 'ERR ' + e.message)).slice(0, 200), caches: await caches(tab2).catch(() => null), logs: tab2.logs.slice(-8), aText: (await A.text()).slice(0, 120) }))
  r.check('duas abas: nada da conta fica na outra aba nem no aparelho', !(await tab2.text()).includes(TASK) && (await caches(tab2)).length === 0)
  r.check('duas abas: a limpeza não falha em nenhuma das abas', ![...A.logs, ...tab2.logs].some((l) => l.includes('falha ao limpar')), [...A.logs, ...tab2.logs].join(' | '))
  tab2.close()
  tab2 = null

  // ------------------------------------------------ 8. Troca de senha (recuperação) encerra as outras sessões
  await openSignIn(B)
  await signInHere(B, EMAIL, PASS)
  r.check('pré-condição: o aparelho B está na conta com os dados', await showsTask(B))
  await openSignIn(A)
  await A.click('Esqueci minha senha')
  await A.fill('E-mail', EMAIL)
  await A.click('Enviar código', 'button[type=submit]')
  await A.sleep(800)
  const codeScreen = await A.text()
  await A.fill('Código do e-mail', '123456')
  await A.click('Continuar', 'button[type=submit]')
  await A.sleep(1500)
  r.check('recuperação: código certo abre "Nova senha"', (await A.text()).includes('Nova senha de login'))
  await A.fill('Nova senha', 'Senha123')
  await A.fill('Repita a senha', 'Senha123')
  await A.click('Salvar senha', 'button[type=submit]')
  await A.sleep(400)
  r.check('recuperação: nova senha comum é recusada', (await errorText(A)).includes('muito comum'))
  await A.fill('Nova senha', NEW_PASS)
  await A.fill('Repita a senha', NEW_PASS)
  await A.click('Salvar senha', 'button[type=submit]')
  await A.sleep(1500)
  r.check('recuperação: senha salva, este aparelho entra na conta', !(await A.text()).includes('Salvar senha') && (await showsTask(A)))
  const live = (await sessionsOf(EMAIL)).filter((x) => !x.revoked)
  r.check('troca de senha: no servidor só a sessão de quem trocou continua válida', live.length === 1)
  await reopen(B, '#/tasks')
  r.check('troca de senha: o outro aparelho, ao abrir, volta para a entrada', await onSignIn(B))
  r.check('troca de senha: o outro aparelho explica e limpa os dados da conta (Etapa 1)', (await B.text()).includes('Sua sessão terminou') && (await caches(B)).length === 0 && !(await B.text()).includes(TASK))
  await signInHere(B, EMAIL, PASS)
  r.check('troca de senha: a senha antiga não entra mais', (await errorText(B)).includes('E-mail ou senha incorretos.'))

  // ------------------------------------------------ 7. Recuperação sem revelar quem tem conta
  await B.click('Esqueci minha senha')
  await B.fill('E-mail', 'ninguem@conta.com')
  await B.click('Enviar código', 'button[type=submit]')
  await B.sleep(800)
  const unknown = await B.text()
  await B.click('Voltar')
  await B.fill('E-mail', EMAIL)
  await B.click('Enviar código', 'button[type=submit]')
  await B.sleep(800)
  const tooSoon = await B.text()
  const same = (t) => t.replace(/\S+@conta\.com/, '<e-mail>')
  r.check('recuperação: e-mail sem conta e conta pedida de novo em menos de 1 minuto mostram a mesma tela', same(unknown) === same(tooSoon) && same(tooSoon) === same(codeScreen), [same(unknown), same(tooSoon)].join(' || '))
  r.check('recuperação: o servidor recusou o 2º e-mail no mesmo minuto (limite do servidor, não do app)', (await state()).requests.filter((x) => x.startsWith('POST /auth/v1/recover')).length === 3)
  await B.fill('Código do e-mail', '123456')
  await B.click('Continuar', 'button[type=submit]')
  await B.sleep(1200)
  r.check('recuperação: o código já usado não vale de novo', (await errorText(B)).includes('Código inválido ou expirado.'))
  await B.click('Voltar')
  await B.click('Voltar')
  await B.click('Criar conta')
  await B.fill('E-mail', EMAIL)
  await B.fill('Senha', 'Mais-uma-senha-9')
  await B.fill('Repita a senha', 'Mais-uma-senha-9')
  await B.click('Criar conta', 'button[type=submit]')
  await B.sleep(1000)
  r.check('cadastro com e-mail que já tem conta: mesma tela de "confirme seu e-mail" (não revela)', (await B.text()).includes('Confirme seu e-mail') && !(await B.text()).includes('Já existe'))

  // ------------------------------------------------ "Sair de todos os aparelhos"
  await openSignIn(B)
  await signInHere(B, EMAIL, NEW_PASS)
  r.check('pré-condição: B entrou com a nova senha', await showsTask(B))
  await A.send('Page.bringToFront')
  await A.goto(BASE + '#/account')
  await A.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await A.click('Sair de todos os aparelhos')
  await A.click('Sair de todos', 'button')
  await A.sleep(1500)
  const offlineText = await A.text()
  r.check('sem internet: avisa que nenhum aparelho foi desconectado', offlineText.includes('Nenhum aparelho foi desconectado'), offlineText.slice(0, 300))
  r.check('sem internet: este aparelho continua na conta', (await hasSession(A)) && offlineText.includes(EMAIL))
  r.check('sem internet: nenhuma sessão foi encerrada no servidor', (await sessionsOf(EMAIL)).filter((x) => !x.revoked).length === 2)
  await A.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await A.click('Sair de todos os aparelhos')
  await A.click('Sair de todos', 'button')
  r.check('sair de todos: este aparelho vai para a entrada', await onSignIn(A))
  r.check('sair de todos: explica o que aconteceu', (await A.text()).includes('Você saiu da conta em todos os aparelhos'))
  r.check('sair de todos: nada da conta neste aparelho (Etapa 1)', (await caches(A)).length === 0 && !(await hasSession(A)))
  r.check('sair de todos: todas as sessões encerradas no servidor', (await sessionsOf(EMAIL)).every((x) => x.revoked))
  await reopen(B, '#/tasks')
  r.check('sair de todos: o outro aparelho, ao abrir, vai para a entrada', await onSignIn(B))
  r.check('sair de todos: o outro aparelho fica sem nada da conta (Etapa 1)', (await caches(B)).length === 0 && !(await hasSession(B)) && !(await B.text()).includes(TASK))

  for (const [name, b] of [['A', A], ['B', B]]) r.check(`sem erros de JavaScript (${name})`, !b.logs.some((l) => l.startsWith('EXC')), b.logs.filter((l) => l.startsWith('EXC')).join(' | '))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('auth-sessions-erro-a').catch(() => {})
  await B.shot('auth-sessions-erro-b').catch(() => {})
} finally {
  const failed = r.print(A)
  tab2?.close()
  A.close()
  B.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
