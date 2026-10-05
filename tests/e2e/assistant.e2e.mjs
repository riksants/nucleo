// Etapa 6 — Inteligência: sugestões (atenção), "Por quê?", descartar, Assistente com comandos determinísticos,
// propostas (Criar / Aplicar / Ajustar / Cancelar / Desfazer), replanejamento, exclusão com confirmação,
// "Alterado pelo Assistente", navegação sem nova aba. Pessoa que já usava o app, modo local (sem rede).
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9393)
const TZ = 'America/Sao_Paulo'
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'agenda', 'week', 'life']
const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10)
const weekday = (d) => new Date(`${d}T12:00:00Z`).getUTCDay()
const ask = async (text) => {
  await b.eval(`(() => { const el = document.querySelector('input[aria-label="Pergunte ao NÚCLEO"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await b.click('Enviar')
  await b.sleep(500)
}
const lastProposal = (sel) => b.eval(`(() => { const cards = [...document.querySelectorAll('[data-proposal]')]; const c = cards[cards.length - 1]; if (!c) return false; const btn = [...c.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(sel)}); if (!btn) return false; btn.click(); return true })()`)

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await b.goto(BASE + 'favicon.svg')
  const now = await b.eval(`(() => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:${JSON.stringify(TZ)},year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value])); return { date: p.year+'-'+p.month+'-'+p.day, hour: Number(p.hour) } })()`)
  const today = now.date
  const tomorrow = addDays(today, 1)
  // A meeting tomorrow 18:00 and a flexible task at the same time → conflict suggestion with a new time.
  await seedExistingUser(
    b,
    {
      tasks: [
        { id: 'late', title: 'Enviar orçamento', projectId: null, dueDate: addDays(today, -3), priority: 'none', status: 'todo', completedAt: null },
        { id: 'call', title: 'Ligar pro contador', projectId: null, dueDate: tomorrow, dueTime: '18:30', priority: 'none', status: 'todo', completedAt: null },
        { id: 'old', title: 'Comprar pão', projectId: null, dueDate: '', priority: 'none', status: 'todo', completedAt: null },
      ],
      events: [{ id: 'meet', title: 'Reunião', date: tomorrow, start: '18:00', end: '19:00', notes: '' }],
      transactions: [{ id: 'tx', type: 'out', amount: 4200, currency: 'BRL', baseAmount: -4200, reason: 'Mercado' }],
    },
    { baseCurrency: 'BRL', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL, startedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() },
  )

  // Navigation: no new bottom tab; reachable from Início, Hoje and Mais
  await b.goto(BASE + '#/')
  await b.sleep(1500)
  const tabs = await b.eval(`[...document.querySelectorAll('nav[aria-label="Navegação principal"] a')].map(a => a.textContent.trim())`)
  let text = await b.text()
  r.check('sem aba nova: barra inferior igual', tabs.length === 5 && !tabs.includes('Assistente'), tabs.join(','))
  r.check('Início mostra até 3 sugestões ("podem precisar da sua atenção") e o botão Assistente', /coisas? pode(m)? precisar da sua atenção/.test(text) && (await b.eval(`[...document.querySelectorAll('main button')].some((x) => x.textContent.trim() === 'Assistente')`)))
  await b.goto(BASE + '#/today')
  await b.sleep(1200)
  r.check('Hoje tem o acesso ao Assistente', (await b.text()).includes('Assistente'))
  await b.goto(BASE + '#/more')
  await b.sleep(500)
  r.check('Mais tem o Assistente', (await b.text()).includes('Assistente'))

  await b.goto(BASE + '#/assistant')
  await b.sleep(1200)
  text = await b.text()
  r.check('Assistente abre com sugestões e atalhos, sem chamar a rede', text.toUpperCase().includes('PRECISA DE ATENÇÃO') && text.includes('Organizar meu dia') && text.includes('nada é enviado para fora'))
  r.check('sugestão de conflito e de tarefa atrasada vêm dos registros reais', text.includes('Dois itens no mesmo horário amanhã') && text.includes('1 tarefa ficou com data passada'))
  r.check('o botão "+" de captura não cobre o campo do Assistente', !(await b.eval(`!!document.querySelector('[aria-label="Capturar na caixa de entrada"]')`)))
  const layout = await b.eval(`(() => { const i = document.querySelector('input[aria-label="Pergunte ao NÚCLEO"]').getBoundingClientRect(); const n = document.querySelector('nav[aria-label="Navegação principal"]').getBoundingClientRect(); return [Math.round(i.bottom), Math.round(n.top), Math.round(i.height)] })()`)
  r.check('campo "Pergunte ao NÚCLEO…" fica acima da barra inferior', layout[0] <= layout[1] && layout[2] >= 44, JSON.stringify(layout))

  // "Por quê?"
  await b.eval(`[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Por quê?').click()`)
  await b.sleep(200)
  r.check('"Por quê?" explica com os números reais', /se sobrepõem|a data já passou/.test(await b.text()))

  // Replan from the conflict suggestion → proposal → Aplicar
  await b.click('Sugerir novo horário')
  await b.sleep(500)
  text = await b.text()
  r.check('replanejamento propõe horário livre e não mexe sem confirmar', /Existe espaço amanhã às \d\d:\d\d/.test(text) && (await idb(b, 'tasks', 'call')).dueTime === '18:30')
  await lastProposal('Aplicar')
  await b.sleep(500)
  const call = await idb(b, 'tasks', 'call')
  r.check('ao aplicar: muda a tarefa original para horário livre e marca "Alterado pelo Assistente"', call.dueTime !== '18:30' && call.dueTime >= '19:00' && call.changedBy === 'assistant' && (await idb(b, 'events', 'meet')).start === '18:00')

  // AI interpreter is OFF by default: an unknown sentence gets the local answer and no request goes out
  await ask('empurra aquilo lá pra depois do almoço')
  const aiCalls = await b.eval(`performance.getEntriesByType('resource').filter((e) => /functions\\/v1\\/assistant|anthropic/.test(e.name)).length`)
  r.check('IA desligada por padrão: frase livre recebe "não entendi" e nenhuma requisição sai', (await b.text()).includes('Não entendi esse pedido') && aiCalls === 0, String(aiCalls))

  // Reads
  await ask('O que tenho hoje?')
  r.check('"O que tenho hoje?" responde com o dia', /Hoje você tem|Hoje está livre/.test(await b.text()))
  await ask('Quanto gastei esta semana?')
  r.check('"Quanto gastei esta semana?" usa as movimentações', (await b.text()).includes('Você gastou R$ 42,00 esta semana') || weekday(today) === 1)

  // Create → proposal → Criar → Desfazer
  await ask('Coloca comprar passagem nas minhas tarefas')
  r.check('criar tarefa mostra a prévia antes', (await b.text()).includes('Vou criar a tarefa “Comprar passagem”') && !(await idb(b, 'tasks')).some((t) => t.title === 'Comprar passagem'))
  await lastProposal('Criar')
  await b.sleep(500)
  let created = (await idb(b, 'tasks')).find((t) => t.title === 'Comprar passagem')
  r.check('"Criar" grava a tarefa pelo mesmo caminho do app, marcada como do Assistente', created?.changedBy === 'assistant' && created.status === 'todo')
  await b.goto(BASE + '#/tasks')
  await b.sleep(600)
  r.check('Tarefas mostra "Alterado pelo Assistente"', (await b.text()).includes('Alterado pelo Assistente'))
  await b.goto(BASE + '#/assistant')
  await b.sleep(800)
  await lastProposal('Desfazer')
  await b.sleep(500)
  r.check('Desfazer remove o que foi criado', !(await idb(b, 'tasks')).some((t) => t.title === 'Comprar passagem'))

  // Reorganize week: Ajustar (untick one) → Aplicar → Desfazer
  for (let i = 0; i < 5; i++) await b.eval(`new Promise(r => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const tx = q.result.transaction('tasks','readwrite'); tx.objectStore('tasks').put({ id: 'w${i}', title: 'Semana ${i}', projectId: null, dueDate: ${JSON.stringify(addDays(today, Math.max(0, 6 - ((weekday(today) + 6) % 7)) ))}, priority: 'none', status: 'todo', completedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }); tx.oncomplete = () => { q.result.close(); r(true) } } })`)
  await b.send('Page.reload', { ignoreCache: true })
  await b.sleep(1500)
  await b.click('Organizar minha semana')
  await b.sleep(600)
  text = await b.text()
  const hasProposal = /proposta para a semana/i.test(text)
  if (hasProposal) {
    await lastProposal('Ajustar')
    await b.sleep(200)
    const total = await b.eval(`document.querySelectorAll('[role=checkbox][aria-label^="Incluir"]').length`)
    await b.eval(`document.querySelector('[role=checkbox][aria-label^="Incluir"]').click()`)
    await lastProposal('Aplicar')
    await b.sleep(600)
    const marked = (await idb(b, 'tasks')).filter((t) => t.changedBy === 'assistant' && t.id.startsWith('w')).length
    r.check('organizar semana: "Ajustar" tira uma mudança e "Aplicar" aplica só o resto', total >= 1 && marked === total - 1, `${marked}/${total}`)
    await lastProposal('Desfazer')
    await b.sleep(600)
    r.check('Desfazer da reorganização volta as datas', (await idb(b, 'tasks')).filter((t) => t.id.startsWith('w')).every((t) => !t.changedBy))
  } else r.check('organizar semana responde mesmo sem mudanças (fim de semana)', /equilibrada|proposta/i.test(text))

  // Delete needs explicit confirmation; cancel keeps it
  await ask('apaga a tarefa comprar pão')
  await lastProposal('Excluir')
  await b.sleep(300)
  r.check('excluir pede confirmação explícita', (await b.eval(`!![...document.querySelectorAll('[role=dialog] button')].find(x => x.textContent.trim() === 'Excluir')`)))
  await b.eval(`[...document.querySelectorAll('[role=dialog] button')].find(x => x.textContent.trim() === 'Cancelar').click()`)
  await b.sleep(400)
  r.check('cancelar a confirmação não apaga', !!(await idb(b, 'tasks', 'old')))

  // Dismiss a suggestion → stays dismissed after reload
  const before = await b.eval(`document.querySelectorAll('button').length`)
  void before
  const firstTitle = await b.eval(`document.querySelector('.card.divide-y p')?.textContent ?? ''`)
  await b.eval(`[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Descartar').click()`)
  await b.sleep(400)
  await b.send('Page.reload', { ignoreCache: true })
  await b.sleep(1500)
  const meta = await b.eval(`new Promise(r => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const g = q.result.transaction('meta').objectStore('meta').get('settings'); g.onsuccess = () => { q.result.close(); r(g.result.insightState) } } })`)
  r.check('sugestão descartada não volta ao abrir de novo', Object.values(meta ?? {}).some((m) => m.s === 'dismissed') && !(await b.text()).includes(firstTitle), firstTitle)
  r.check('Assistente sem rolagem horizontal (390px)', await noHorizontalScroll(b))
  await b.shot('assistente')

  await b.desktop()
  await b.goto(BASE + '#/assistant')
  await b.sleep(900)
  r.check('menu lateral tem o Assistente (desktop)', (await b.eval(`[...document.querySelectorAll('aside a')].some(a => a.textContent.trim() === 'Assistente')`)))
  r.check('Assistente sem rolagem horizontal (1366px)', await noHorizontalScroll(b))
  await b.click('Organizar meu dia')
  await b.sleep(500)
  await b.shot('assistente-desktop')
  await b.goto(BASE + '#/settings')
  await b.sleep(500)
  r.check('faixa de horário configurável em Configurações', (await b.eval(`!!document.querySelector('input[aria-label="Início da faixa de horário"]')`)))
  r.check('interruptor da IA existe e vem desligado', (await b.eval(`[...document.querySelectorAll('[role=switch]')].find((x) => x.textContent.includes('Entender frases livres com IA'))?.getAttribute('aria-checked')`)) === 'false')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('assistente-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
