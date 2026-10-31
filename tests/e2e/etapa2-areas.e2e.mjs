// Etapa 2: Rotina, Alimentação, Caixa de entrada, Assinaturas e Portfólio num iPhone (390/375/320).
// Rotina preserva o que existe; refeições coladas são conferidas antes; compras separadas e confirmadas;
// assinatura pausada não cobra e retoma sem cobrança retroativa; portfólio preenchido por frase.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9372)
const TZ = 'America/Sao_Paulo'
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'agenda', 'life', 'week']
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const dateIn = (plus = 0) => b.eval(`(() => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:${JSON.stringify(TZ)},year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(Date.now() + ${plus} * 864e5)).map(x=>[x.type,x.value])); return p.year+'-'+p.month+'-'+p.day })()`)
const dialog = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText).join('\\n')`)
const top = (text) => b.eval(`[...[...document.querySelectorAll('[role=dialog]')].pop().querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)})?.click()`)
const width = (w) => b.send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 2, mobile: true })

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await b.goto(BASE + 'favicon.svg')
  const today = await dateIn()
  const wd = await b.eval(`new Date(${JSON.stringify(today)} + 'T12:00:00Z').getUTCDay()`)
  const old = ['Ler notícias', 'Trabalho'].map((title, i) => ({ id: `old${i}`, day: (wd + i) % 7, start: i ? '09:00' : '06:00', end: i ? '17:00' : '06:30', title, kind: i ? 'work' : 'activity', fixed: i === 1 }))
  await seedExistingUser(
    b,
    {
      routinePlans: [{ id: 'routine-current', status: 'approved', source: 'manual', notes: '', done: {}, blocks: old }],
      tools: [{ id: 'fig', name: 'Figma', link: '', plan: 'Pro', price: 1500, currency: 'EUR', billing: 'monthly', nextCharge: await dateIn(2), notes: '', status: 'active' }],
      projects: [{ id: 'p1', name: 'Site da Lavanderia', kind: 'site', clientId: null, status: 'done', dueDate: '', notes: '', link: '', value: 0, currency: 'EUR', payments: [] }],
      inbox: [{ id: 'in1', text: 'Comprar arroz, ovos e leite', status: 'open', convertedTo: null, processedAt: null }],
    },
    { modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL, timeZone: TZ },
  )

  // Meals live in a store created by the app itself: added once it opened the database.
  await b.goto(BASE + '#/')
  await sleep(800)
  const past = await dateIn(-3)
  await b.eval(`new Promise(r => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const tx = q.result.transaction('meals','readwrite'); const now = new Date().toISOString(); tx.objectStore('meals').put({ id: 'm0', createdAt: now, updatedAt: now, date: ${JSON.stringify(past)}, type: 'lunch', name: 'Marmita de frango', time: '12:30', description: '', ingredients: ['arroz', 'frango'], notes: '', done: true, doneAt: null }); tx.oncomplete = () => { q.result.close(); r(true) } } })`)
  await b.eval('location.reload()')
  await sleep(1500)

  // ---------- Rotina: adicionar em vários dias sem mexer no que existe
  await b.goto(BASE + '#/routine')
  let text = await b.text()
  r.check('Rotina: Manhã/Tarde/Noite e sem lista de confirmação', !text.includes('Aguardando confirmação') && (await b.eval(`!!document.querySelector('section[aria-label="Manhã"]')`)))
  await b.click('Atividade', 'main button')
  await setValue(b, 'input[aria-label="Descrever em uma frase"]', 'Academia segunda, quarta e sexta das 7h às 8h')
  await b.click('Preencher', '[role=dialog] button')
  await sleep(300)
  const vals = await b.eval(`[...document.querySelectorAll('[role=dialog] input')].map(i => i.value)`)
  r.check('frase preenche nome e horários', vals.includes('Academia') && vals.includes('07:00') && vals.includes('08:00'))
  await b.click('Adicionar', '[role=dialog] button[type=submit]')
  await sleep(600)
  let rp = await idb(b, 'routinePlans', 'routine-current')
  const academia = rp.blocks.filter((x) => x.title === 'Academia')
  r.check('adicionada em 3 dias, tipo treino', academia.length === 3 && academia.every((x) => x.kind === 'training') && [1, 3, 5].every((d) => academia.some((x) => x.day === d)))
  r.check('blocos antigos intactos (inclusive o fixo)', old.every((o) => JSON.stringify(rp.blocks.find((x) => x.id === o.id)) === JSON.stringify(o)))

  // Editar "todos os dias" muda as 3 Academias e mais nada.
  const target = academia[0]
  // Open the sheet of one Academia through the week strip day.
  const dayIndex = (target.day + 6) % 7
  await b.eval(`document.querySelectorAll('[role=tablist][aria-label="Dias da semana"] [role=tab]')[${dayIndex}]?.click()`)
  await sleep(400)
  // A past day folds its parts of the day: open them.
  await b.eval(`[...document.querySelectorAll('main button[aria-expanded=false]')].filter((x) => x.textContent.trim().startsWith('Ver')).forEach((x) => x.click())`)
  await sleep(300)
  await b.eval(`[...document.querySelectorAll('main button')].find((x) => x.innerText.includes('Academia'))?.click()`)
  await sleep(500)
  r.check('editar pergunta: só este dia ou todos', (await dialog()).includes('Todos os 3 dias'))
  await b.click('Todos os 3 dias', '[role=dialog] [role=radio]')
  await b.fill('Início', '06:30')
  await b.fill('Fim', '07:30')
  await b.click('Salvar', '[role=dialog] button[type=submit]')
  await sleep(600)
  rp = await idb(b, 'routinePlans', 'routine-current')
  r.check('"todos": as 3 mudaram, ids e dias mantidos; o resto igual', rp.blocks.filter((x) => x.title === 'Academia').every((x) => x.start === '06:30' && academia.some((a) => a.id === x.id && a.day === x.day)) && old.every((o) => JSON.stringify(rp.blocks.find((x) => x.id === o.id)) === JSON.stringify(o)))
  await b.shot('e2-rotina')

  // ---------- Alimentação: colar várias (conferidas antes), repetir anterior
  await b.goto(BASE + '#/meals')
  text = await b.text()
  r.check('abas Semana · Compras · Modelo', text.includes('Compras') && text.includes('Modelo') && !text.includes('Plano com IA'))
  await b.click('Colar várias', 'main button')
  await setValue(b, 'textarea[aria-label="Refeições, uma por linha"]', '07:00 Café da manhã: pão, 2 ovos e café\n12:30 Almoço: arroz, feijão e frango')
  await b.click('Conferir', '[role=dialog] button')
  await sleep(300)
  r.check('mostra as refeições antes de criar', (await dialog()).includes('Adicionar 2 refeições') && (await idb(b, 'meals')).length === 1)
  await b.click('Adicionar 2 refeições', '[role=dialog] button')
  await sleep(700)
  let meals = await idb(b, 'meals')
  r.check('2 refeições criadas como planejadas, com alimentos', meals.length === 3 && meals.filter((m) => m.date === today).every((m) => !m.done) && meals.some((m) => m.type === 'breakfast' && m.ingredients.join('|') === 'pão|2 ovos|café'))
  text = await b.text()
  r.check('planejada e feita são distintas na tela', text.includes('Planejada'))
  await b.click('Repetir anterior', 'main button')
  await b.click('Marmita de frango', '[role=dialog] button')
  await sleep(500)
  const form = await b.eval(`[...document.querySelectorAll('[role=dialog] input, [role=dialog] textarea')].map(i => i.value).join('|')`)
  r.check('repetir abre o formulário preenchido (confere antes)', form.includes('Marmita de frango') && form.includes(today) && (await idb(b, 'meals')).length === 3)
  await b.click('Adicionar', '[role=dialog] button[type=submit]')
  await sleep(600)
  meals = await idb(b, 'meals')
  r.check('repetida no dia, sem "feita"', meals.length === 4 && meals.some((m) => m.name === 'Marmita de frango' && m.date === today && !m.done))
  await b.click('Modelo', '[role=radio]')
  await sleep(400)
  text = await b.text()
  r.check('Modelo da semana: montar à mão, sem prometer IA', text.includes('Montar modelo') && !/gerad[oa] (por|com) IA/i.test(text))
  await b.click('Montar modelo', 'main button')
  await sleep(500)
  r.check('cria um rascunho para revisar e aprovar', (await idb(b, 'mealPlans', 'meals-draft'))?.status === 'draft' && (await b.text()).includes('Aprovar'))

  // ---------- Caixa de entrada: compras separadas e confirmadas, duplicata, desfazer
  await b.goto(BASE + '#/inbox')
  await b.click('Comprar arroz, ovos e leite', 'main button')
  await b.click('Lista de compras', '[role=dialog] button')
  await sleep(400)
  r.check('compras: 3 itens para conferir, nada criado ainda', (await dialog()).includes('Adicionar 3 itens') && (await idb(b, 'shoppingItems')).length === 0)
  await b.eval(`[...document.querySelectorAll('[role=dialog] input[type=checkbox]')][2].click()`)
  await sleep(200)
  await b.click('Adicionar 2 itens', '[role=dialog] button')
  await sleep(600)
  const shop = await idb(b, 'shoppingItems')
  r.check('só os marcados entram (Arroz, Ovos); original guardado e ligado', shop.map((s) => s.name).sort().join(',') === 'Arroz,Ovos' && (await idb(b, 'inbox', 'in1')).convertedTo?.collection === 'shoppingItems')
  await setValue(b, 'textarea[aria-label="Capturar"]', 'Ligar para João amanhã')
  await b.click('Guardar', 'button')
  await sleep(400)
  await setValue(b, 'textarea[aria-label="Capturar"]', 'ligar para joão amanhã')
  await b.click('Guardar', 'button')
  await sleep(400)
  r.check('duplicata: pergunta antes de guardar de novo', (await dialog()).includes('Já está na caixa de entrada'))
  await top('Cancelar')
  await sleep(400)
  r.check('cancelar não duplica', (await idb(b, 'inbox')).filter((i) => /jo[aã]o/i.test(i.text)).length === 1)
  await b.click('Ligar para João amanhã', 'main button')
  await b.click('Tarefa', '[role=dialog] button')
  await sleep(500)
  const title = await b.eval(`[...document.querySelectorAll('[role=dialog] label')].find(l => l.textContent.trim().startsWith('Título'))?.querySelector('input')?.value`)
  const due = await b.eval(`[...document.querySelectorAll('[role=dialog] input[type=date]')][0]?.value`)
  r.check('tarefa: título limpo e data entendida (conferir antes)', title === 'Ligar para João' && due === (await dateIn(1)), `${title} / ${due}`)
  await b.eval(`document.querySelector('[role=dialog] button[aria-label="Fechar"]')?.click()`)
  await sleep(500)
  await b.click('Ligar para João amanhã', 'main button')
  await b.click('Excluir', '[role=dialog] button')
  await sleep(300)
  await top('Excluir')
  await sleep(500)
  r.check('excluir oferece Desfazer', await b.eval(`[...document.querySelectorAll('[role=status] button')].some((x) => x.textContent === 'Desfazer')`))
  await b.eval(`[...document.querySelectorAll('[role=status] button')].find((x) => x.textContent === 'Desfazer')?.click()`)
  await sleep(600)
  r.check('desfazer devolve o item', (await idb(b, 'inbox')).some((i) => i.text === 'Ligar para João amanhã' && i.status === 'open'))

  // ---------- Assinaturas: pausar (sem cobranças), retomar (sem retroativo), grupos, marcar como pago
  await b.goto(BASE + '#/tools')
  text = await b.text()
  r.check('grupos e "Marcar como pago" na lista', text.includes('Ativas · 1') && text.includes('Marcar como pago'))
  await b.click('Figma', 'main button')
  await b.click('Pausar', '[role=dialog] button')
  await sleep(600)
  let fig = await idb(b, 'tools', 'fig')
  r.check('pausada: status e data guardados', fig.status === 'paused' && fig.pausedAt === today)
  text = await b.text()
  r.check('aparece em Pausadas e some dos próximos pagamentos', text.includes('Pausadas · 1') && !text.includes('Marcar como pago'))
  // Simulate a long pause: the stored charge date is now in the past.
  await b.eval(`new Promise(r => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const tx = q.result.transaction('tools','readwrite'); const s = tx.objectStore('tools'); const g = s.get('fig'); g.onsuccess = () => { s.put({ ...g.result, nextCharge: '2026-01-10', chargeDay: 10 }); }; tx.oncomplete = () => { q.result.close(); r(true) } } })`)
  await b.eval('location.reload()')
  await sleep(2000)
  await b.goto(BASE + '#/tools')
  await b.click('Figma', 'main button')
  await b.click('Retomar', '[role=dialog] button')
  await sleep(400)
  await top('Retomar')
  await sleep(1500)
  fig = await idb(b, 'tools', 'fig')
  const runs = (await idb(b, 'automationRuns')).filter((x) => x.origin?.id === 'fig')
  r.check('retomar: próximo vencimento no ciclo (dia 10), sem cobrança retroativa', fig.status === 'active' && fig.nextCharge >= today && fig.nextCharge.endsWith('-10') && runs.length === 0, `${fig.nextCharge} runs=${runs.length}`)
  await b.shot('e2-assinaturas')

  // ---------- Portfólio: frase → formulário, ligação com projeto, lista compacta
  await b.goto(BASE + '#/portfolio')
  await b.click('Adicionar trabalho', 'main button')
  await setValue(b, 'input[aria-label="Descrever em uma frase"]', 'Adicionar meu projeto de site para uma lavanderia em Barcelona, com link lavanderiabcn.es, categoria desenvolvimento web e status concluído')
  await b.click('Preencher', '[role=dialog] button')
  await sleep(300)
  const pv = await b.eval(`[...document.querySelectorAll('[role=dialog] input, [role=dialog] select')].map(i => i.value)`)
  r.check('frase preenche nome, link, categoria e situação (nada inventado)', pv.includes('Site para uma lavanderia em Barcelona') && pv.includes('lavanderiabcn.es') && pv.includes('Desenvolvimento web') && pv.includes('done'))
  await b.click('Mais opções', '[role=dialog] button')
  await b.fill('Projeto do Núcleo', 'p1')
  await b.click('Adicionar', '[role=dialog] button[type=submit]')
  await sleep(600)
  const port = (await idb(b, 'portfolio'))[0]
  r.check('salvo com projeto ligado; o projeto não muda', port?.projectId === 'p1' && port.category === 'Desenvolvimento web' && (await idb(b, 'projects', 'p1')).status === 'done' && !port.image)
  await b.click('Site para uma lavanderia em Barcelona', 'main button')
  r.check('detalhe abre o projeto do Núcleo', (await dialog()).includes('Site da Lavanderia'))
  await b.shot('e2-portfolio')
  await b.eval(`document.querySelector('[role=dialog] button[aria-label="Fechar"]')?.click()`)

  // ---------- Persistência e larguras
  await b.eval('location.reload()')
  await sleep(2000)
  r.check('depois de recarregar, tudo continua', (await idb(b, 'portfolio')).length === 1 && (await idb(b, 'routinePlans', 'routine-current')).blocks.length === 5)
  const bad = []
  for (const w of [320, 375, 390]) {
    await width(w)
    for (const path of ['#/routine', '#/meals', '#/meals?view=shopping', '#/meals?view=plan', '#/inbox', '#/tools', '#/portfolio']) {
      await b.goto(BASE + path)
      if (!(await noHorizontalScroll(b))) bad.push(`${w}${path}`)
    }
  }
  r.check('320, 375 e 390 px: nenhuma das cinco telas rola para o lado', bad.length === 0, bad.join(' '))
  await width(320)
  await b.goto(BASE + '#/meals')
  await b.shot('e2-meals-320')
  await b.goto(BASE + '#/tools')
  await b.shot('e2-tools-320')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('e2-erro')
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
