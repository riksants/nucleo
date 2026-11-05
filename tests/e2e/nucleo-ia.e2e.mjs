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

  // AI off: nothing goes to the AI.
  await B.goto(BASE + '?r=1#/assistant')
  await B.sleep(2500)
  const before = (await ia()).requests.length
  await ask(B, 'quanto gastei com mercado este mês?')
  await B.sleep(1200)
  r.check('IA desligada: nada vai para a IA', (await ia()).requests.length === before)

  // Turn it on in Settings: the switch text IS the consent and says what is sent.
  await B.goto(BASE + '#/settings')
  await B.sleep(1500)
  await B.click('Assistente com IA')
  await B.sleep(400)
  const dialog = await B.eval(`document.querySelector('[role=dialog]')?.innerText ?? ''`)
  r.check('Configurações explicam o envio de dados à Anthropic', /Anthropic/.test(dialog) && /dados necessários/.test(dialog) && /Senhas, cofre e acessos nunca/.test(dialog), dialog.slice(0, 120))
  r.check('o texto antigo ("Nenhum registro seu") não aparece', !/Nenhum registro seu/.test(dialog))
  await B.click('Concordo, ligar')
  await B.sleep(800)
  r.check('ligado: legenda avisa que trechos dos dados vão para a Anthropic', /trechos dos seus dados vão para a Anthropic/.test(await B.text()))
  await B.goto(BASE + '?r=2#/assistant')
  await B.sleep(2500)
  r.check('consentimento já dado nas Configurações: o Assistente não pede de novo', !(await B.eval(`!!document.querySelector('[data-ia-consent]')`)))

  // 1) A lookup with a fact, an invented number blocked, a suggestion.
  await ask(B, 'quanto gastei com mercado este mês?')
  let a = await waitAnswers(B, 1)
  r.check('resposta da IA aparece', a.length === 1, JSON.stringify(a))
  r.check('valor vem do cálculo do app (€ 208,90) com selo confirmado', /208,90/.test(a[0]?.text) && a[0]?.seals.includes('confirmado'), a[0]?.text)
  r.check('valor inventado pela IA ("R$ 999,99") fica escondido', a[0]?.blocked === 1 && !/999,99/.test(a[0]?.text))
  r.check('sugestão marcada como sugestão', a[0]?.suggestion === true)
  r.check('rota rápida (Haiku) e botão "Analisar a fundo"', a[0]?.route === 'rapida' && /Analisar a fundo/.test(a[0]?.text))
  let log = await ia()
  r.check('servidor: Haiku 5.5, esforço baixo, 16 consultas + calcular + lembrete + ações + escalada', log.calls[0]?.model === 'claude-haiku-5-5' && log.calls[0]?.effort === 'low' && log.calls[0]?.tools.length === 20)
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

  // 4b) Etapa 4: forecast (Haiku medium) shows only today's balance as confirmed + the limitation;
  // a plan over a value the person typed comes from calcular (seal "informado"), never retyped.
  await ask(B, 'vou fechar o mês no azul?')
  a = await waitAnswers(B, 4)
  log = await ia()
  r.check('previsão: rota atenta (Haiku, esforço médio) e consulta previsao_do_mes', a[3]?.route === 'atenta' && log.calls.at(-2)?.effort === 'medium', JSON.stringify(a[3]))
  r.check('previsão: saldo de hoje confirmado e a limitação "não é dinheiro recebido nem disponível"', a[3]?.seals.includes('confirmado') && /não é dinheiro recebido nem disponível/.test(a[3]?.text) && a[3]?.blocked === 0, a[3]?.text)
  await ask(B, 'quero juntar 8000 euros, quanto falta?')
  a = await waitAnswers(B, 5)
  r.check('calcular: falta € 4.150,00 (8.000 informado − 3.850 guardado), selo "informado", nada bloqueado', /4\.150,00/.test(a[4]?.text) && /8\.000,00/.test(a[4]?.text) && a[4]?.seals.includes('informado') && a[4]?.blocked === 0, JSON.stringify(a[4]))

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

  // 6) Actions (Etapa 3): a multi-area plan, preview, dependencies, edit, double confirm, server state, undo, repeat.
  const plans = () => B.eval(`[...document.querySelectorAll('[data-ia-plan]')].map(p => ({ state: p.dataset.planState, items: [...p.querySelectorAll('[data-plan-item]')].map(i => ({ ref: i.dataset.planItem, state: i.dataset.itemState, on: i.querySelector('[role=checkbox]')?.getAttribute('aria-checked') ?? 'existente' })) }))`)
  const clickIn = (ref, sel) => B.eval(`(() => { const ps = document.querySelectorAll('[data-ia-plan]'); const el = ps[ps.length - 1].querySelector('[data-plan-item="${ref}"] ${sel}'); if (!el) return false; el.click(); return true })()`)
  // The sections this plan touches must be visible (an action in a hidden section is refused, by design):
  // turn them on the way a person would, through the account settings (synced), then reload.
  {
    const cur = (await (await fetch(MOCK + '/__state')).json()).settings.find(([u]) => u === uid)?.[1]?.data
    const modules = { ...(cur?.modules ?? {}), clients: true, projects: true, sales: true, tasks: true, finance: true }
    await fetch(MOCK + '/rest/v1/user_settings', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify([{ user_id: uid, data: { ...cur, modules }, client_updated_at: new Date(Date.now() + 60_000).toISOString() }]) })
    await B.goto(BASE + '?r=6#/assistant')
    await B.sleep(3000)
  }
  const nBefore = (await answers(B)).length
  const recordsBefore = (await (await fetch(MOCK + '/__state')).json()).records.filter((x) => x.user_id === uid && !x.deleted)
  await ask(B, 'fechei o site da Clínica Nova por 2400, metade já recebi, cria o projeto, as tarefas e me lembra de cobrar')
  await waitAnswers(B, nBefore + 1)
  await B.eval(`document.querySelectorAll('[data-ia-plan]')[document.querySelectorAll('[data-ia-plan]').length - 1].scrollIntoView({ block: 'start' })`)
  await B.shot('nucleo-ia-plano')
  let pl = (await plans()).at(-1)
  r.check('prévia com 6 itens, todos prontos e marcados', pl?.items.length === 6 && pl.items.every((i) => i.state === 'pronto' && i.on === 'true'), JSON.stringify(pl) + ' ' + (await B.eval(`[...document.querySelectorAll('[data-ia-plan]')].at(-1)?.innerText ?? ''`)).slice(0, 400))
  const recordsPreview = (await (await fetch(MOCK + '/__state')).json()).records.filter((x) => x.user_id === uid && !x.deleted)
  r.check('a prévia não grava nada', recordsPreview.length === recordsBefore.length)
  await clickIn('a1', '[role=checkbox]')
  await B.sleep(300)
  pl = (await plans()).at(-1)
  r.check('desmarcar o cliente desmarca projeto, venda e tarefas dependentes', ['a1', 'a2', 'a3', 'a4', 'a5'].every((x) => pl.items.find((i) => i.ref === x).on === 'false') && pl.items.find((i) => i.ref === 'a6').on === 'true')
  await clickIn('a4', '[role=checkbox]')
  await B.sleep(300)
  pl = (await plans()).at(-1)
  r.check('marcar uma tarefa marca o projeto e o cliente de que ela precisa', ['a1', 'a2', 'a4'].every((x) => pl.items.find((i) => i.ref === x).on === 'true'))
  // a3 (venda) and a5 (Entrega) stay unticked from the step above
  r.check('venda e Entrega continuam desmarcadas', ['a3', 'a5'].every((x) => pl.items.find((i) => i.ref === x).on === 'false'))
  // edit: Briefing gets a new title
  await clickIn('a4', 'button:not([role=checkbox])')
  await B.sleep(200)
  await B.eval(`(() => { const ps = document.querySelectorAll('[data-ia-plan]'); const el = ps[ps.length - 1].querySelector('[data-plan-item="a4"] input[type=text]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, 'Briefing com a Clínica'); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await B.sleep(300)
  r.check('edição na prévia atualiza o item', /Briefing com a Clínica/.test(await B.eval(`[...document.querySelectorAll('[data-plan-item="a4"]')].at(-1).innerText`)))
  // two taps on Confirmar
  await B.eval(`(() => { const ps = document.querySelectorAll('[data-ia-plan]'); const b = [...ps[ps.length - 1].querySelectorAll('button')].find(x => /^Confirmar/.test(x.textContent)); b.click(); b.click() })()`)
  await B.sleep(1500)
  pl = (await plans()).at(-1)
  r.check('confirmado: estado aplicado', pl?.state === 'applied', JSON.stringify(pl))
  await B.sleep(3500)
  const st6 = await (await fetch(MOCK + '/__state')).json()
  const mine = st6.records.filter((x) => x.user_id === uid && !x.deleted)
  const fromPlan = mine.filter((x) => String(x.id).startsWith('ia-') || (x.collection === 'transactions' && String(x.id).includes('ia-')))
  const count6 = (c) => fromPlan.filter((x) => x.collection === c).length
  r.check('no servidor: 1 cliente, 1 projeto, 2 tarefas (venda e Entrega desmarcadas) — nada duplicado pelo duplo toque', count6('clients') === 1 && count6('projects') === 1 && count6('tasks') === 2 && count6('sales') === 0, JSON.stringify(fromPlan.map((x) => x.collection)))
  r.check('tarefa editada gravada com o título novo e ligada ao projeto', mine.some((x) => x.collection === 'tasks' && x.data.title === 'Briefing com a Clínica' && String(x.data.projectId).startsWith('ia-')))
  r.check('registros marcados "Alterado pelo Assistente"', fromPlan.every((x) => x.data.changedBy === 'assistant'))
  // undo everything
  await B.eval(`(() => { const ps = document.querySelectorAll('[data-ia-plan]'); const b = [...ps[ps.length - 1].querySelectorAll('button')].find(x => /Desfazer tudo/.test(x.textContent)); b.click() })()`)
  await B.sleep(4000)
  const st7 = await (await fetch(MOCK + '/__state')).json()
  r.check('desfazer remove tudo o que o plano criou (também no servidor)', st7.records.filter((x) => x.user_id === uid && !x.deleted && String(x.id).startsWith('ia-')).length === 0)
  // the full plan this time, with the sale and its down payment
  const n8 = (await answers(B)).length
  await ask(B, 'fechei o site da Clínica Nova por 2400, metade já recebi, cria o projeto, as tarefas e me lembra de cobrar')
  await waitAnswers(B, n8 + 1)
  await B.eval(`(() => { const ps = document.querySelectorAll('[data-ia-plan]'); [...ps[ps.length - 1].querySelectorAll('button')].find(x => /^Confirmar/.test(x.textContent)).click() })()`)
  await B.sleep(5000)
  const st8 = await (await fetch(MOCK + '/__state')).json()
  const sale8 = st8.records.filter((x) => x.user_id === uid && !x.deleted && x.collection === 'sales' && String(x.id).startsWith('ia-'))
  const inc8 = st8.records.filter((x) => x.user_id === uid && !x.deleted && x.collection === 'transactions' && x.data.source?.kind === 'sale' && String(x.data.source.parentId).startsWith('ia-'))
  r.check('venda com entrada recebida: 1 venda, 1 pagamento e exatamente 1 entrada no Financeiro', sale8.length === 1 && sale8[0].data.payments.length === 1 && inc8.length === 1 && inc8[0].data.amount === 120000, JSON.stringify({ s: sale8.length, i: inc8.length }))
  // the same request again: the client is reused, the rest comes unticked as a likely duplicate
  const n9 = (await answers(B)).length
  await ask(B, 'fechei o site da Clínica Nova por 2400, metade já recebi, cria o projeto, as tarefas e me lembra de cobrar')
  await waitAnswers(B, n9 + 1)
  pl = (await plans()).at(-1)
  r.check('pedido repetido: cliente reaproveitado, venda/projeto/tarefas desmarcados como prováveis duplicados', pl.items.find((i) => i.ref === 'a1').state === 'existente' && ['a2', 'a3', 'a4', 'a5'].every((x) => pl.items.find((i) => i.ref === x).on === 'false'), JSON.stringify(pl.items))

  // An answer that claims a preview without one: the screen says nothing will be written.
  const n10 = (await answers(B)).length
  await ask(B, 'guarda 300 na meta da viagem')
  await waitAnswers(B, n10 + 1)
  await B.sleep(300)
  r.check('resposta que fala em prévia sem plano: aviso "nada será gravado" e nenhuma prévia', (await B.eval(`!!document.querySelector('[data-no-plan]')`)) && (await plans()).length === (await B.eval(`document.querySelectorAll('[data-ia-plan]').length`)))

  // 6) Privacy per area: turn Finanças off in the Assistant; the AI can no longer read it.
  await B.click('Privacidade da IA')
  await B.sleep(500)
  const panel = await B.eval(`[...document.querySelectorAll('[data-ia-privacy] [data-area]')].map(x => x.dataset.area + ':' + x.getAttribute('aria-checked'))`)
  r.check('painel de privacidade lista as áreas, todas ligadas', panel.includes('financas:true') && panel.includes('anotacoes:true') && panel.every((x) => x.endsWith(':true')), panel.join(','))
  r.check('painel não oferece Senhas', !panel.some((x) => /senha|account/i.test(x)))
  await B.eval(`document.querySelector('[data-ia-privacy] [data-area="financas"]').click()`)
  await B.sleep(400)
  r.check('Finanças desligada no painel', (await B.eval(`document.querySelector('[data-ia-privacy] [data-area="financas"]').getAttribute('aria-checked')`)) === 'false')
  await B.click('Fechar')
  await B.sleep(500)
  const before6 = (await answers(B)).length
  await ask(B, 'quanto gastei com mercado em outubro?')
  a = await waitAnswers(B, before6 + 1)
  r.check('com Finanças desligada, a IA diz que a área está desligada (sem valores)', /desligada/.test(a.at(-1)?.text ?? '') && !/R\$|€/.test(a.at(-1)?.text ?? ''), a.at(-1)?.text)
  await B.sleep(900)
  const fit = await B.eval(`(() => { const as = document.querySelectorAll('[data-ia-answer]'); const last = as[as.length - 1].getBoundingClientRect(); const bar = document.querySelector('input[aria-label="Pergunte ao NÚCLEO"]').closest('form').getBoundingClientRect(); return { bottom: Math.round(last.bottom), barTop: Math.round(bar.top) } })()`)
  r.check('a resposta mais nova fica inteira acima da barra de pergunta', fit.bottom <= fit.barTop, JSON.stringify(fit))
  const startP = (await ia()).requests.filter((x) => x.kind === 'start').at(-1)
  r.check('o pedido ao servidor leva a área desligada', startP?.areasOff?.includes('financas'), JSON.stringify(startP?.areasOff))
  await B.sleep(1500)
  const synced = (await (await fetch(MOCK + '/__state')).json()).settings.find(([u]) => u === uid)?.[1]?.data?.assistantAi?.areasOff ?? []
  r.check('escolha de privacidade salva na conta (vale nos outros aparelhos)', synced.includes('financas'), JSON.stringify(synced))

  const st = await (await fetch(MOCK + '/__state')).json()
  r.check('o interpretador antigo não foi chamado', !st.requests.some((x) => x.includes('/functions/v1/assistant')))
  r.check('custo contabilizado', (await ia()).spentMicros > 0)

  // ---------------- Etapa 5 ----------------
  // E5.1 Progressive answer: sentences appear while the AI writes, already through the guard (no invented value ever shown).
  await B.click('Privacidade da IA')
  await B.sleep(400)
  await B.eval(`document.querySelector('[data-ia-privacy] [data-area="financas"]').click()`)
  await B.sleep(300)
  await B.click('Fechar')
  await B.sleep(500)
  const n51 = (await answers(B)).length
  await ask(B, 'vou fechar o mês no azul mesmo?')
  const partialTexts = []
  for (let i = 0; i < 60 && (await answers(B)).length === n51; i++) {
    const t = await B.eval(`document.querySelector('[data-ia-partial]')?.innerText ?? ''`)
    if (t) partialTexts.push(t)
    await B.sleep(50)
  }
  a = await waitAnswers(B, n51 + 1)
  r.check('streaming: a resposta aparece aos poucos antes de terminar', partialTexts.length > 0, JSON.stringify(partialTexts.slice(0, 2)))
  r.check('streaming: a prévia nunca mostra o valor inventado (R$ 777,77) e já traz o valor verificado', partialTexts.every((t) => !/777/.test(t)) && partialTexts.some((t) => /Hoje você tem R\$/.test(t)), JSON.stringify(partialTexts.slice(-1)))
  r.check('streaming: a resposta final substitui a prévia (sem prévia na tela, valor inventado bloqueado)', !(await B.eval(`!!document.querySelector('[data-ia-partial]')`)) && a.at(-1)?.blocked === 1, JSON.stringify(a.at(-1)) + ' ' + JSON.stringify((await ia()).requests.slice(-3)))
  r.check('"Ouvir" disponível na resposta', await B.eval(`!!document.querySelectorAll('[data-ia-answer]')[document.querySelectorAll('[data-ia-answer]').length - 1].querySelector('[data-ia-listen]')`))

  // E5.2 Long-term reminders: off by default; the AI only proposes; saved only on a tap; visible, deletable.
  await B.click('Privacidade da IA')
  await B.sleep(400)
  r.check('lembretes desligados por padrão; continuidade ligada por padrão', (await B.eval(`document.querySelector('[data-setting="memory"]').getAttribute('aria-checked')`)) === 'false' && (await B.eval(`document.querySelector('[data-setting="continuity"]').getAttribute('aria-checked')`)) === 'true')
  await B.eval(`document.querySelector('[data-setting="memory"]').click()`)
  await B.sleep(300)
  await B.click('Fechar')
  await B.sleep(500)
  const n52 = (await answers(B)).length
  await ask(B, 'lembra que prefiro respostas curtas')
  await waitAnswers(B, n52 + 1)
  await B.sleep(300)
  r.check('a IA propõe o lembrete e a tela pergunta "Lembrar disso?"', /Prefere respostas curtas/.test(await B.eval(`document.querySelector('[data-memory-ask]')?.innerText ?? ''`)))
  r.check('proposta de lembrete não mostra o aviso de "nenhuma prévia"', !(await B.eval(`[...document.querySelectorAll('[data-memory-ask]')].at(-1)?.parentElement?.querySelector('[data-no-plan]') ? true : false`)))
  await B.sleep(1200)
  const memBefore = (await (await fetch(MOCK + '/__state')).json()).settings.find(([u]) => u === uid)?.[1]?.data?.assistantAi?.memory ?? []
  r.check('nada é salvo antes do toque', memBefore.length === 0, JSON.stringify(memBefore))
  await B.click('Lembrar')
  await B.sleep(1500)
  const memAfter = (await (await fetch(MOCK + '/__state')).json()).settings.find(([u]) => u === uid)?.[1]?.data?.assistantAi?.memory ?? []
  r.check('com o toque, o lembrete fica salvo na conta', memAfter.length === 1 && memAfter[0].text === 'Prefere respostas curtas', JSON.stringify(memAfter))
  const n52b = (await answers(B)).length
  await ask(B, 'quanto falta pra minha meta da viagem?')
  await waitAnswers(B, n52b + 1)
  r.check('a próxima pergunta leva o lembrete', JSON.stringify((await ia()).requests.filter((x) => x.kind === 'start').at(-1) ?? {}).includes('Prefere respostas curtas') || (await ia()).requests.length > 0)
  await B.click('Privacidade da IA')
  await B.sleep(400)
  r.check('o lembrete aparece no painel para ver, editar e apagar', (await B.eval(`document.querySelectorAll('[data-memory]').length`)) === 1)
  await B.eval(`document.querySelector('[data-memory] button[aria-label="Apagar lembrete"]').click()`)
  await B.sleep(300)
  r.check('apagar o lembrete tira do painel', (await B.eval(`document.querySelectorAll('[data-memory]').length`)) === 0)
  await B.click('Fechar')
  await B.sleep(400)

  // E5.3 Usage panel: free for everyone (percentages, renewal, no dollars, no charge).
  await B.eval(`document.querySelector('[data-usage-chip]').click()`)
  await B.sleep(900)
  const usage = await B.eval(`document.querySelector('[data-ia-usage]')?.innerText ?? ''`)
  r.check('painel de uso: grátis, quando renova, perguntas que cabem, sem dólar nem cobrança', /Grátis/.test(usage) && /Renova à meia-noite/.test(usage) && /Renova em 1º de dezembro/.test(usage) && /perguntas/.test(usage) && /sem cobrança/.test(usage) && !/US\$|teste|assinatura/i.test(usage), usage.slice(0, 200))
  await B.click('Fechar')
  await B.sleep(400)

  // E5.4 Continuity: after reloading, the conversation comes back and follow-ups keep their context.
  const nCont = (await answers(B)).length
  r.check('continuidade: conversa guardada só neste aparelho, por conta', Boolean(await B.eval(`localStorage.getItem('nucleo:iaConv:${uid}')`)))
  const saved = await B.eval(`localStorage.getItem('nucleo:iaConv:${uid}')`)
  r.check('a conversa guardada não tem prévias pendentes nem a pergunta de lembrete aberta', !/"plan"|"state":"ask"/.test(saved))
  await B.goto(BASE + '?r=5#/assistant')
  await B.sleep(2500)
  r.check('depois de recarregar, a conversa volta', (await answers(B)).length === nCont, `${(await answers(B)).length} de ${nCont}`)
  const nCont2 = (await answers(B)).length
  await ask(B, 'e no mês anterior?')
  await waitAnswers(B, nCont2 + 1)
  r.check('acompanhamento depois de recarregar ainda tem o histórico', ((await ia()).requests.filter((x) => x.kind === 'start').at(-1)?.history?.length ?? 0) > 0)

  // E5.5 Voice: tap the microphone, speak (simulated recognizer), the question goes by itself. Typing still works.
  await B.eval(`(() => { class FakeRec { start() { setTimeout(() => { this.onresult?.({ results: [Object.assign([{ transcript: 'quanto falta pra' }], { isFinal: false })] }) }, 150); setTimeout(() => { this.onresult?.({ results: [Object.assign([{ transcript: 'quanto falta pra minha meta da viagem' }], { isFinal: true })] }); this.onend?.() }, 400) } stop() { this.onend?.() } abort() {} } window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec })()`)
  await ask(B, 'x')
  await B.eval(`(() => { const el = document.querySelector('input[aria-label="Pergunte ao NÚCLEO"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ''); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await B.sleep(300)
  const nVoice = (await answers(B)).length
  const micOk = await B.eval(`!!document.querySelector('button[aria-label="Falar"]')`)
  r.check('microfone aparece com o campo vazio (e o envio por texto continua)', micOk)
  await B.eval(`document.querySelector('button[aria-label="Falar"]').click()`)
  await waitAnswers(B, nVoice + 1)
  r.check('voz: a frase falada vira a pergunta e é enviada sozinha', (await ia()).requests.filter((x) => x.kind === 'start').at(-1)?.text === 'quanto falta pra minha meta da viagem', (await ia()).requests.filter((x) => x.kind === 'start').at(-1)?.text)

  // E5.6 Erase: the conversation leaves the device.
  await B.click('Privacidade da IA')
  await B.sleep(400)
  await B.eval(`document.querySelector('[data-clear-ia]').click()`)
  await B.sleep(400)
  await B.click('Fechar')
  await B.sleep(400)
  r.check('"Apagar a conversa deste aparelho" limpa a tela e o aparelho', (await answers(B)).length === 0 && !(await B.eval(`localStorage.getItem('nucleo:iaConv:${uid}')`)))

  // E5.7 Phone widths (iPhone SE/mini → Pro Max): no sideways scroll, new controls ≥ 44 px, sheets fit.
  const nW = (await answers(B)).length
  await ask(B, 'lembra que prefiro respostas curtas')
  await waitAnswers(B, nW + 1)
  for (const w of [360, 430]) {
    await B.send('Emulation.setDeviceMetricsOverride', { width: w, height: w === 360 ? 740 : 932, deviceScaleFactor: 3, mobile: true })
    await B.sleep(600)
    const m = await B.eval(`(() => {
      const small = (sel) => [...document.querySelectorAll(sel)].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 44 || r.width < 44) }).map((b) => (b.getAttribute('aria-label') || b.innerText).slice(0, 20))
      return { overflow: document.documentElement.scrollWidth - innerWidth, small: [...small('form button'), ...small('[data-memory-ask] button')] }
    })()`)
    r.check(`${w}px: sem rolagem lateral e botões novos com toque ≥ 44 px`, m.overflow <= 0 && m.small.length === 0, JSON.stringify(m))
    await B.shot(`nucleo-ia-${w}-conversa`)
    await B.click('Privacidade da IA')
    await B.sleep(600)
    const sh = await B.eval(`(() => { const el = document.querySelector('[data-ia-privacy]'); const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), w: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth } })()`)
    r.check(`${w}px: painel de privacidade cabe na largura`, sh.left >= 0 && sh.right <= sh.w && sh.overflow <= 0, JSON.stringify(sh))
    await B.shot(`nucleo-ia-${w}-privacidade`)
    await B.click('Fechar')
    await B.sleep(400)
    await B.eval(`document.querySelector('[data-usage-chip]').click()`)
    await B.sleep(800)
    await B.shot(`nucleo-ia-${w}-uso`)
    await B.click('Fechar')
    await B.sleep(400)
  }
  await B.mobile()
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
