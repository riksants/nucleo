// Integration of Etapa 1: Morning, Night, Focus, Inbox, Agenda and Habits share the same records.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9356)
const TZ = 'America/Sao_Paulo'
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'agenda']
const dateIn = (tz, plusDays = 0) => b.eval(`(() => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:${JSON.stringify(tz)},year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(Date.now() + ${plusDays} * 86400000)).map(x=>[x.type,x.value])); return p.year+'-'+p.month+'-'+p.day })()`)
const dialogText = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText).join('\\n')`)

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await b.goto(BASE + 'favicon.svg')
  const today = await dateIn(TZ)
  const tomorrow = await dateIn(TZ, 1)
  const wd = await b.eval(`new Date(${JSON.stringify(today)} + 'T12:00:00Z').getUTCDay()`)
  await seedExistingUser(
    b,
    {
      tasks: [
        { id: 'rel', title: 'Relatório', projectId: null, dueDate: today, priority: 'high', status: 'todo', completedAt: null, notes: 'Enviar até o fim do dia' },
        { id: 'mer', title: 'Mercado', projectId: null, dueDate: today, priority: 'none', status: 'todo', completedAt: null },
        { id: 'atr', title: 'Atrasada', projectId: null, dueDate: '2026-01-05', priority: 'none', status: 'todo', completedAt: null },
      ],
      events: [
        { id: 'ev1', title: 'Reunião', date: today, start: '23:30', end: '23:50', notes: '' },
        { id: 'ev2', title: 'Dentista', date: tomorrow, start: '09:00', end: '10:00', notes: '' },
      ],
      habits: [
        { id: 'agua', name: 'Água', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-01-01' },
        { id: 'ler', name: 'Ler', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-01-01' },
      ],
      recurring: [{ id: 'lav', title: 'Lavar roupa', rule: { type: 'weekdays', days: [wd] }, time: '', notes: '', active: true, startDate: '2026-01-01' }],
      tools: [{ id: 'fig', name: 'Figma', link: '', plan: 'Pro', price: 1500, currency: 'USD', billing: 'monthly', nextCharge: today, notes: '', status: 'active' }],
    },
    { modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )

  // ---------- Hoje: "Dia" stays the default
  await b.goto(BASE + '#/today')
  let text = await b.text()
  r.check('Hoje abre no "Dia" (tela de antes) com o seletor Manhã · Dia · Noite', text.includes('Manhã') && text.includes('Noite') && (await b.eval(`document.querySelector('[role=radio][aria-checked=true]')?.textContent`)) === 'Dia')

  // ---------- Manhã
  await b.click('Manhã', '[role=radio]')
  await b.sleep(800)
  text = await b.text()
  r.check('Manhã: frase-resumo do dia', /Hoje você tem 2 tarefas, 1 compromisso às 23h30 e 2 hábitos para concluir\./.test(text), text.match(/Hoje você tem[^\n]*/)?.[0])
  r.check('Manhã: prioridade, agenda, para fazer, atrasadas e conta do dia', text.includes('Relatório') && text.includes('Reunião') && text.includes('Lavar roupa') && text.includes('Atrasada') && text.includes('Figma'))
  await b.shot('manha')
  await b.click('Concluir Água')
  await b.sleep(500)
  r.check('hábito marcado na Manhã grava a conclusão do dia', (await idb(b, 'completions', `habit:agua:${today}`))?.status === 'done')
  await b.goto(BASE + '#/habits')
  r.check('…e aparece concluído em Hábitos', (await b.text()).includes('1 de 2 hoje'))
  await b.goto(BASE + '#/agenda')
  r.check('…e na Agenda', await b.eval(`!!document.querySelector('[aria-label="Desmarcar Água"]')`))

  // ---------- Foco
  await b.goto(BASE + '#/today?mode=morning')
  await b.sleep(800)
  await b.click('Focar em Relatório')
  await b.sleep(800)
  text = await b.text()
  r.check('Foco mostra só a tarefa, prazo e observação, sem abas', text.includes('Relatório') && text.includes('Enviar até o fim do dia') && text.includes('Prazo') && !(await b.eval(`!!document.querySelector('nav[aria-label="Navegação principal"]')`)))
  await b.click('Iniciar')
  await b.sleep(2200)
  const t1 = await b.eval(`JSON.parse(localStorage.getItem('nucleo:focusTimer'))`)
  r.check('cronômetro roda e fica salvo no aparelho', t1?.taskId === 'rel' && t1.runningSince !== null)
  await b.shot('foco')
  await b.click('Sair do modo foco')
  await b.click('Sair', 'button')
  await b.sleep(600)
  await b.goto(BASE + '#/focus?task=rel')
  await b.sleep(600)
  const clock = await b.eval(`document.querySelector('p.num')?.textContent`)
  r.check('sair e voltar não perde o tempo (pausado, continua de onde parou)', clock !== '00:00' && (await b.text()).includes('Continuar'), clock)
  await b.click('Concluir tarefa')
  await b.sleep(1200)
  r.check('concluir no Foco atualiza a tarefa original', (await idb(b, 'tasks', 'rel')).status === 'done')
  r.check('cronômetro curto (< 1 min) é zerado sem criar sessão', (await idb(b, 'focusSessions')).length === 0 && (await b.eval(`localStorage.getItem('nucleo:focusTimer')`)) === 'null')

  // ---------- Noite
  await b.goto(BASE + '#/today?mode=night')
  await b.sleep(900)
  text = await b.text()
  r.check('Noite: tarefa do foco aparece em "Concluído hoje"', text.toUpperCase().includes('CONCLUÍDO HOJE') && text.includes('Relatório'))
  r.check('Noite: compromisso de hoje fica neutro, sem contar como concluído', text.includes('Reunião') && !/Concluído hoje[\s\S]*Reunião[\s\S]*Compromissos/i.test(text))
  // marcáveis de hoje: 2 tarefas + 2 hábitos + 1 recorrente = 5 (a atrasada é de outro dia); feitos: Relatório e Água
  r.check('Noite: frase final sem julgamento', /Seu dia terminou com 2 de 5 itens concluídos\./.test(text), text.match(/Seu dia terminou[^\n]*/)?.[0])
  r.check('Noite: mostra o que vem amanhã', text.includes('Dentista'))
  await b.shot('noite')
  // Mercado → amanhã
  await b.eval(`[...document.querySelectorAll('main .border-b')].find(el => el.innerText.includes('Mercado')).querySelector('button:not([aria-label])')`)
  await b.eval(`(() => { const row = [...document.querySelectorAll('main .border-b')].find(el => el.innerText.includes('Mercado')); [...row.querySelectorAll('button')].find(x => x.textContent.trim() === 'Amanhã').click() })()`)
  await b.sleep(600)
  r.check('"Amanhã" muda só a data da tarefa original', (await idb(b, 'tasks', 'mer')).dueDate === tomorrow && (await idb(b, 'tasks', 'mer')).status === 'todo')
  // Ler → pular hoje
  await b.eval(`(() => { const row = [...document.querySelectorAll('main .border-b')].find(el => el.innerText.includes('Ler')); [...row.querySelectorAll('button')].find(x => x.textContent.trim() === 'Pular hoje').click() })()`)
  await b.sleep(600)
  r.check('"Pular hoje" registra pulado, não concluído', (await idb(b, 'completions', `habit:ler:${today}`))?.status === 'skipped')
  // Atrasada → reagendar
  await b.eval(`(() => { const row = [...document.querySelectorAll('main .border-b')].find(el => el.innerText.includes('Atrasada')); [...row.querySelectorAll('button')].find(x => x.textContent.trim() === 'Reagendar').click() })()`)
  await b.sleep(500)
  const in3 = await dateIn(TZ, 3)
  await b.fill('Nova data', in3)
  await b.click('Salvar nova data')
  await b.sleep(500)
  r.check('reagendar muda a data da tarefa original', (await idb(b, 'tasks', 'atr')).dueDate === in3)
  // Lavar roupa → tirar da data não existe para recorrente; tarefa "tirar da data"
  const pendingNow = await b.eval(`[...document.querySelectorAll('main section')].find(sec => /FICOU PARA DEPOIS/i.test(sec.innerText))?.innerText ?? ''`)
  r.check('pendências atualizam na hora (Mercado saiu dos pendentes de hoje)', !pendingNow.includes('Mercado') && pendingNow.includes('Lavar roupa'))

  // ---------- Caixa de entrada → compromisso → agenda
  await b.goto(BASE + '#/inbox')
  await b.click('Capturar na caixa de entrada', 'button')
  await setValue(b, 'textarea[aria-label="O que você quer guardar?"]', 'Consulta amanhã')
  await b.click('Guardar para organizar depois')
  await b.click('Organizar')
  await b.click('Compromisso', 'button')
  await b.fill('Início', '15:00')
  await b.click('Criar compromisso', 'button[type=submit]')
  await b.sleep(600)
  const consult = (await idb(b, 'events')).find((x) => x.title === 'Consulta amanhã')
  r.check('item da caixa vira compromisso amanhã (data sugerida)', consult?.date === tomorrow && consult.start === '15:00')
  await b.goto(BASE + '#/agenda')
  await b.click('Próximo')
  r.check('…e aparece na Agenda de amanhã', (await b.text()).includes('Consulta amanhã'))

  r.check('sem rolagem horizontal (390px)', await noHorizontalScroll(b))

  // ---------- Manhã automática (opcional, 1x por dia, antes do meio-dia no fuso)
  const zone = await b.eval(`['Pacific/Kiritimati','Pacific/Auckland','Asia/Tokyo','Asia/Kolkata','Asia/Dubai','Europe/Moscow','Europe/Lisbon','Atlantic/Azores','America/Sao_Paulo','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Pacific/Honolulu'].find(z => { const h = Number(new Intl.DateTimeFormat('en-US',{timeZone:z,hour:'2-digit',hourCycle:'h23'}).format(new Date())); return h >= 6 && h <= 10 })`)
  await b.eval(`new Promise(res => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const db = q.result; const tx = db.transaction('meta','readwrite'); const s = tx.objectStore('meta'); const g = s.get('settings'); g.onsuccess = () => s.put({ ...g.result, timeZone: ${JSON.stringify(zone)} }, 'settings'); tx.oncomplete = () => { db.close(); res(1) } } })`)
  await b.goto(BASE + '#/')
  await b.send('Page.reload', { ignoreCache: true })
  await b.sleep(2500)
  r.check('desligada por padrão: não abre sozinha', (await b.eval('location.hash')) === '#/')
  await b.goto(BASE + '#/settings')
  await b.click('Abrir o Modo Manhã sozinho', '[role=switch]')
  await b.sleep(400)
  await b.goto(BASE + '#/')
  await b.send('Page.reload', { ignoreCache: true })
  await b.sleep(2500)
  r.check(`ligada: abre a Manhã antes do meio-dia (${zone})`, (await b.eval('location.hash')) === '#/today?mode=morning')
  await b.goto(BASE + '#/')
  await b.send('Page.reload', { ignoreCache: true })
  await b.sleep(2500)
  r.check('no máximo uma vez por dia', (await b.eval('location.hash')) === '#/')

  await b.desktop()
  await b.goto(BASE + '#/today?mode=night')
  await b.sleep(800)
  r.check('sem rolagem horizontal (1366px)', await noHorizontalScroll(b))
  await b.shot('noite-desktop')
  await b.goto(BASE + '#/today?mode=morning')
  await b.sleep(800)
  await b.shot('manha-desktop')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('daily-erro').catch(() => {})
  console.log((await dialogText().catch(() => '')).slice(0, 300))
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
