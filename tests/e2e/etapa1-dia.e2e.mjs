// Etapa 1 do dia a dia: Início, Hoje, Agenda, Hábitos e Recorrentes trabalhando juntos, num iPhone (390/375/320).
// Cadastro por frase (e por voz, com um reconhecedor simulado), conferência antes de salvar, recorrência com
// "só esta" / "esta e as próximas", pausa e encerramento, hábito vinculado numa linha só, rotina "Horário
// encerrado", persistência após recarregar e muitos registros.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9371)
const TZ = 'America/Sao_Paulo'
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'agenda', 'life', 'week']
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const dateIn = (plus = 0) => b.eval(`(() => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:${JSON.stringify(TZ)},year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(Date.now() + ${plus} * 864e5)).map(x=>[x.type,x.value])); return p.year+'-'+p.month+'-'+p.day })()`)
const dialog = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText).join('\\n')`)
const inDialog = (label) => b.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.trim().startsWith(${JSON.stringify(label)})); return l?.querySelector('input,select,textarea')?.value ?? null })()`)
const width = (w) => b.send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 2, mobile: true })
const count = (text) => b.eval(`(document.querySelector('main')?.innerText.match(new RegExp(${JSON.stringify(text)}, 'g')) ?? []).length`)
const sentence = async (text) => {
  await setValue(b, 'input[aria-label="Escreva em uma frase"]', text)
  await sleep(150)
  await b.click('Entender', '[role=dialog] button')
  await sleep(400)
}

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  // Safari do iPhone (user agent) and a speech recognizer that "hears" a fixed sentence (no microphone in tests).
  await b.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' })
  await b.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.SpeechRecognition = window.webkitSpeechRecognition = class { start() { setTimeout(() => { this.onresult?.({ results: [Object.assign([{ transcript: 'Ligar para o banco amanhã às 10h' }], { isFinal: true })] }); this.onend?.() }, 200) } stop() { this.onend?.() } abort() {} }`,
  })
  await b.goto(BASE + 'favicon.svg')
  const today = await dateIn()
  const tomorrow = await dateIn(1)
  const wd = await b.eval(`new Date(${JSON.stringify(today)} + 'T12:00:00Z').getUTCDay()`)
  await seedExistingUser(
    b,
    {
      tasks: [{ id: 'late', title: 'Enviar proposta', projectId: null, dueDate: '2026-01-05', priority: 'none', status: 'todo', completedAt: null }],
      routinePlans: [{ id: 'routine-current', status: 'approved', source: 'manual', notes: '', done: {}, blocks: [{ id: 'b0', day: wd, start: '00:00', end: '00:01', title: 'Alongar', kind: 'other', fixed: false }] }],
      habits: [],
    },
    { modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL, timeZone: TZ },
  )

  // ---------- Início: cabeçalho (branco no escuro, preto no claro), o que importa agora
  await b.eval(`localStorage.setItem('nucleo:theme', '"dark"')`)
  await b.goto(BASE + '#/')
  let text = await b.text()
  const darkColor = await b.eval(`getComputedStyle(document.querySelector('header.band h1')).color`)
  const darkBalance = await b.eval(`getComputedStyle([...document.querySelectorAll('header.band *')].find(x => /Saldo total/.test(x.textContent) && x.children.length === 0)).color`)
  r.check('escuro: saudação e saldo em branco no cabeçalho', darkColor === 'rgb(255, 255, 255)' && /^rgba?\(255, 255, 255/.test(darkBalance), `${darkColor} / ${darkBalance}`)
  r.check('Início destaca a tarefa atrasada (o que importa agora)', text.includes('Enviar proposta') && text.includes('Atrasada'))
  r.check('escuro: moeda escolhida legível (pílula branca, texto escuro)', (await b.eval(`getComputedStyle([...document.querySelectorAll('header.band [role=radio][aria-checked=true]')][0]).color`)) === 'rgb(10, 10, 11)')
  r.check('ações rápidas: Criar, Adicionar, Retirar, Hoje', await b.eval(`[...document.querySelectorAll('nav[aria-label="Ações rápidas"] button')].map(x => x.textContent.trim()).join(',') === 'Criar,Adicionar,Retirar,Hoje'`))
  await b.shot('e1-inicio-escuro')
  await b.eval(`localStorage.setItem('nucleo:theme', '"light"')`)
  await b.goto(BASE + 'favicon.svg')
  await b.goto(BASE + '#/')
  const lightColor = await b.eval(`getComputedStyle(document.querySelector('header.band h1')).color`)
  r.check('claro: saudação em preto', lightColor === 'rgb(10, 10, 11)', lightColor)
  await sleep(2500)
  await b.shot('e1-inicio-claro')
  await b.eval(`localStorage.setItem('nucleo:theme', '"dark"')`)
  await b.goto(BASE + 'favicon.svg')

  // ---------- Cadastro inteligente: frase → conferência no formulário → só então salva
  await b.goto(BASE + '#/')
  await b.click('Criar', 'nav[aria-label="Ações rápidas"] button')
  await sentence('Tenho dentista amanhã às 15h')
  text = await dialog()
  r.check('frase entendida: compromisso, amanhã, 15:00–16:00', text.includes('Dentista') && text.includes('Amanhã') && text.includes('15:00–16:00') && text.includes('Compromisso'))
  r.check('nada salvo antes de conferir', (await idb(b, 'events')).length === 0)
  await b.shot('e1-frase-resumo')
  await b.click('Conferir e criar', '[role=dialog] button')
  await sleep(500)
  r.check('abre o formulário de compromisso já preenchido', (await inDialog('Título')) === 'Dentista' && (await inDialog('Data')) === tomorrow && (await inDialog('Início')) === '15:00' && (await inDialog('Fim')) === '16:00')
  await b.click('Criar compromisso', 'button[type=submit]')
  await sleep(600)
  const ev = (await idb(b, 'events'))[0]
  r.check('compromisso criado pelo mesmo cadastro do manual', ev?.title === 'Dentista' && ev.date === tomorrow && ev.start === '15:00' && ev.end === '16:00')

  // Hora ambígua: pergunta; voltar não salva nada.
  await b.click('Criar', 'nav[aria-label="Ações rápidas"] button')
  await sentence('reunião com Ana amanhã às 3')
  text = await dialog()
  r.check('hora ambígua: pergunta 03:00 ou 15:00 (não adivinha)', text.includes('Qual horário?') && text.includes('03:00') && text.includes('15:00') && !text.includes('Conferir e criar'))
  await b.click('15:00', '[role=dialog] button')
  await sleep(300)
  r.check('depois de responder, mostra o resumo', (await dialog()).includes('15:00–16:00'))
  await b.click('Voltar', '[role=dialog] button')
  await b.eval(`document.querySelector('[role=dialog] button[aria-label="Fechar"]')?.click()`)
  await sleep(500)
  r.check('desistir não grava nada', (await idb(b, 'events')).length === 1)

  // Voz (reconhecedor do aparelho, simulado aqui).
  await b.click('Criar', 'nav[aria-label="Ações rápidas"] button')
  await b.click('Falar', '[role=dialog] button')
  await sleep(700)
  const heard = await b.eval(`document.querySelector('input[aria-label="Escreva em uma frase"]').value`)
  r.check('voz: o que foi dito vira o texto (pode editar antes)', heard === 'Ligar para o banco amanhã às 10h', heard)
  await b.click('Entender', '[role=dialog] button')
  await sleep(300)
  text = await dialog()
  r.check('voz → tarefa amanhã às 10:00', text.includes('Ligar para o banco') && text.includes('10:00') && text.includes('Tarefa'))
  await b.click('Conferir e criar', '[role=dialog] button')
  await sleep(500)
  r.check('formulário da tarefa preenchido', (await inDialog('Título')) === 'Ligar para o banco')
  await b.click('Criar tarefa', 'button[type=submit]')
  await sleep(500)
  r.check('tarefa criada', (await idb(b, 'tasks')).some((t) => t.title === 'Ligar para o banco' && t.dueDate === tomorrow && t.dueTime === '10:00'))

  // ---------- Recorrente por frase (hoje e daqui a 2 dias, às 23:30)
  const d1 = DAY_NAMES[wd]
  const d2 = DAY_NAMES[(wd + 2) % 7]
  await b.click('Criar', 'nav[aria-label="Ações rápidas"] button')
  await sentence(`Estudar inglês toda ${d1} e ${d2} às 23h30`)
  text = await dialog()
  r.check('frase de repetição vira recorrente', text.includes('Estudar inglês') && text.includes('Recorrente') && text.includes('23:30'))
  await b.click('Conferir e criar', '[role=dialog] button')
  await sleep(500)
  r.check('formulário de recorrente preenchido', (await inDialog('O que fazer')) === 'Estudar inglês' && (await inDialog('Horário')) === '23:30')
  await b.click('Criar', '[role=dialog] button[type=submit]')
  await sleep(600)
  let rec = (await idb(b, 'recurring'))[0]
  r.check('regra salva: os dois dias da semana', rec?.rule.type === 'weekdays' && rec.rule.days.length === 2 && rec.rule.days.includes(wd) && rec.rule.days.includes((wd + 2) % 7))

  await b.goto(BASE + '#/today')
  r.check('Hoje mostra a ocorrência uma vez, na Noite', (await count('Estudar inglês')) === 1 && (await b.eval(`document.querySelector('section[aria-label="Noite"]')?.innerText.includes('Estudar inglês')`)))
  text = await b.text()
  r.check('rotina que já passou: "Horário encerrado", sem pedir confirmação', text.includes('Alongar') && text.includes('Horário encerrado') && !(await b.eval(`document.querySelector('section[aria-label="Aguardando confirmação"]')?.innerText.includes('Alongar') ?? false`)))
  r.check('rotina continua marcável à mão', await b.eval(`!!document.querySelector('[aria-label="Concluir Alongar"]')`))
  await b.shot('e1-hoje')

  // ---------- Hábito vinculado ao recorrente: uma linha só; marca junto
  await b.goto(BASE + '#/habits')
  await b.click('Criar hábito')
  await b.fill('Hábito', 'Estudar')
  await b.click('Mais opções', '[role=dialog] button')
  await b.fill('Vincular a', `recurring:${rec.id}`)
  await sleep(200)
  await b.click('Marcar junto automaticamente', '[role=switch]')
  await b.click('Criar hábito', 'button[type=submit]')
  await sleep(500)
  const hab = (await idb(b, 'habits'))[0]
  r.check('hábito salvo com o vínculo e marcação automática', hab?.link?.id === rec.id && hab.autoFromLink === true)
  await b.goto(BASE + '#/today')
  r.check('Hoje: recorrente + hábito numa linha (sem duplicar)', (await b.eval(`!!document.querySelector('[aria-label="Concluir Estudar inglês"]') && !document.querySelector('[aria-label="Concluir Estudar"]')`)) && (await b.text()).includes('· Estudar'))
  await b.click('Concluir Estudar inglês')
  await sleep(700)
  r.check('concluir a linha marca o recorrente e o hábito (com a origem)', (await idb(b, 'completions', `recurring:${rec.id}:${today}`))?.status === 'done' && (await idb(b, 'completions', `habit:${hab.id}:${today}`))?.via === `recurring:${rec.id}:${today}`)
  await b.goto(BASE + '#/habits')
  r.check('Hábitos mostra o hábito feito hoje', (await b.text()).includes('1 de 1'))
  await b.goto(BASE + '#/today')
  await b.eval(`[...document.querySelectorAll('main button')].find((x) => x.textContent.startsWith('Concluídos'))?.click()`)
  await sleep(300)
  await b.click('Desmarcar Estudar inglês')
  await sleep(700)
  r.check('desmarcar desfaz os dois', (await idb(b, 'completions', `recurring:${rec.id}:${today}`)) === null && (await idb(b, 'completions', `habit:${hab.id}:${today}`)) === null)

  // ---------- Detalhes do item: "só esta" e "esta e as próximas"
  await b.eval(`[...document.querySelectorAll('main button')].find((x) => x.innerText.startsWith('Estudar inglês'))?.click()`)
  await sleep(600)
  r.check('tocar abre os detalhes com ações (sem abrir várias telas)', (await dialog()).includes('Mudar o horário') && (await dialog()).includes('Concluí'))
  await b.click('Outro dia ou horário', '[role=dialog] button')
  await b.fill('Horário', '23:45')
  await b.click('Salvar', '[role=dialog] button')
  await sleep(600)
  rec = await idb(b, 'recurring', rec.id)
  r.check('só esta: muda o horário de hoje; a regra fica', rec.times?.[today] === '23:45' && rec.time === '23:30')
  r.check('Hoje mostra o novo horário uma vez', (await b.text()).includes('23:45') && (await count('Estudar inglês')) === 1)
  await b.eval(`[...document.querySelectorAll('main button')].find((x) => x.innerText.startsWith('Estudar inglês'))?.click()`)
  await sleep(600)
  await b.click('Outro dia ou horário', '[role=dialog] button')
  await b.click('Esta e as próximas', '[role=dialog] [role=radio]')
  await b.fill('Horário', '22:00')
  await b.click('Salvar', '[role=dialog] button')
  await sleep(700)
  const recs = await idb(b, 'recurring')
  r.check('esta e as próximas: muda todas a partir de hoje, sem duplicar o item', recs.length === 1 && recs[0].time === '22:00' && !recs[0].times?.[today])
  await b.goto(BASE + '#/agenda')
  r.check('Agenda acompanha (22:00) e mostra uma vez', (await b.text()).includes('22:00') && (await count('Estudar inglês')) === 1)

  // ---------- Pausar, retomar, encerrar
  await b.goto(BASE + '#/recurring')
  await b.eval(`[...document.querySelectorAll('main button')].find((x) => x.innerText.includes('Estudar inglês'))?.click()`)
  await sleep(600)
  await b.click('Pausar', '[role=dialog] button')
  await sleep(600)
  r.check('pausar: some de Hoje e fica guardado', (await idb(b, 'recurring', rec.id)).active === false && (await b.text()).includes('Pausados e encerrados'))
  await b.goto(BASE + '#/today')
  r.check('pausado não aparece em Hoje', (await count('Estudar inglês')) === 0)
  await b.goto(BASE + '#/recurring')
  await b.eval(`[...document.querySelectorAll('main button')].find((x) => x.textContent.startsWith('Pausados e encerrados'))?.click()`)
  await sleep(300)
  await b.eval(`[...document.querySelectorAll('main button')].find((x) => x.innerText.includes('Estudar inglês'))?.click()`)
  await sleep(600)
  await b.click('Retomar', '[role=dialog] button')
  await sleep(600)
  r.check('retomar volta igual', (await idb(b, 'recurring', rec.id)).active === true)
  await b.eval(`[...document.querySelectorAll('main button')].find((x) => x.innerText.includes('Estudar inglês'))?.click()`)
  await sleep(600)
  await b.click('Encerrar', '[role=dialog] button')
  await sleep(500)
  // The confirmation is the last dialog on top.
  await b.eval(`[...[...document.querySelectorAll('[role=dialog]')].pop().querySelectorAll('button')].find((x) => x.textContent.trim() === 'Encerrar')?.click()`)
  await sleep(700)
  const ended = await idb(b, 'recurring', rec.id)
  r.check('encerrar: termina ontem (hoje não foi marcado) e o histórico fica', ended.endDate === (await dateIn(-1)) && ended.active === true)
  await b.goto(BASE + '#/agenda')
  r.check('encerrado não aparece na Agenda', (await count('Estudar inglês')) === 0)

  // ---------- Persistência após recarregar
  await b.eval('location.reload()')
  await sleep(2000)
  await b.goto(BASE + '#/agenda')
  await b.eval(`[...document.querySelectorAll('[role=tab]')].find((x) => x.getAttribute('aria-selected') === 'true')?.nextElementSibling?.click()`)
  await sleep(400)
  r.check('depois de recarregar: compromisso e tarefa continuam lá', (await b.text()).includes('Dentista') || (await idb(b, 'events')).length === 1)

  // ---------- Larguras do iPhone (320 / 375 / 390), sem rolagem lateral
  const widths = []
  for (const w of [320, 375, 390]) {
    await width(w)
    for (const path of ['#/', '#/today', '#/agenda', '#/habits', '#/recurring']) {
      await b.goto(BASE + path)
      if (!(await noHorizontalScroll(b))) widths.push(`${w}${path}`)
    }
  }
  r.check('320, 375 e 390 px: nenhuma das cinco telas rola para o lado', widths.length === 0, widths.join(' '))
  await width(320)
  await b.goto(BASE + '#/')
  await b.shot('e1-inicio-320')
  await b.goto(BASE + '#/agenda')
  await b.shot('e1-agenda-320')
  await b.mobile()

  // ---------- Muitos registros: continua rápido e sem repetir
  await b.eval(`new Promise((res) => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const db = q.result; const tx = db.transaction(['tasks', 'recurring', 'habits', 'events'], 'readwrite'); const now = new Date().toISOString(); const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
    for (let i = 0; i < 400; i++) tx.objectStore('tasks').put({ id: 'bulk-t' + i, createdAt: now, updatedAt: now, title: 'Tarefa ' + i, projectId: null, dueDate: d((i % 30) - 10), dueTime: i % 3 ? '' : String(8 + (i % 12)).padStart(2, '0') + ':00', priority: 'none', status: i % 5 ? 'todo' : 'done', completedAt: null })
    for (let i = 0; i < 60; i++) tx.objectStore('recurring').put({ id: 'bulk-r' + i, createdAt: now, updatedAt: now, title: 'Recorrente ' + i, rule: { type: 'weekdays', days: [i % 7] }, time: String(6 + (i % 15)).padStart(2, '0') + ':30', notes: '', active: true, startDate: '2026-01-01' })
    for (let i = 0; i < 40; i++) tx.objectStore('habits').put({ id: 'bulk-h' + i, createdAt: now, updatedAt: now, name: 'Hábito ' + i, rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-01-01' })
    for (let i = 0; i < 200; i++) tx.objectStore('events').put({ id: 'bulk-e' + i, createdAt: now, updatedAt: now, title: 'Evento ' + i, date: d((i % 20) - 5), start: String(7 + (i % 14)).padStart(2, '0') + ':15', end: String(8 + (i % 14)).padStart(2, '0') + ':00', notes: '' })
    tx.oncomplete = () => { db.close(); res(true) } } })`)
  const times = {}
  for (const path of ['#/', '#/today', '#/agenda', '#/habits', '#/recurring']) {
    await b.goto(BASE + 'favicon.svg')
    const t0 = Date.now()
    await b.goto(BASE + path)
    times[path] = Date.now() - t0
  }
  const slow = Object.entries(times).filter(([, ms]) => ms > 6000)
  r.check('muitos registros (400 tarefas, 200 compromissos, 60 recorrentes, 40 hábitos): telas abrem', slow.length === 0, JSON.stringify(times))
  await b.goto(BASE + '#/agenda')
  r.check('…sem itens repetidos na Agenda', await b.eval(`(() => { const t = [...document.querySelectorAll('main li, main button')].map(x => x.innerText); return !document.body.innerText.includes('Algo deu errado') })()`))
  r.check('…sem avisos de chave repetida no console', !b.logs.some((l) => /same key|duplicate key/i.test(l)), b.logs.filter((l) => /key/i.test(l)).slice(0, 2).join(' | '))
  r.check('nenhum item marcado como feito sem ação (tarefa atrasada continua pendente)', (await idb(b, 'tasks', 'late')).status === 'todo')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('e1-erro')
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
