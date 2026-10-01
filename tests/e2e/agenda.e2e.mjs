import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9355)
const TZ = 'America/Sao_Paulo'
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'agenda']
try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  const today = await b.eval(`(() => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:${JSON.stringify(TZ)},year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value])); return p.year+'-'+p.month+'-'+p.day })()`)
  await seedExistingUser(
    b,
    {
      tasks: [{ id: 't1', title: 'Ligar para cliente', projectId: null, dueDate: today, dueTime: '23:30', priority: 'none', status: 'todo', completedAt: null }],
      habits: [{ id: 'h1', name: 'Ler 20 min', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-01-01' }],
      events: [{ id: 'e0', title: 'Café cedo', date: today, start: '00:00', end: '00:01', notes: '' }],
    },
    { modules: { agenda: true, habits: true }, modulesSeen: ALL },
  )
  await b.goto(BASE + '#/agenda')
  let text = await b.text()
  r.check('agenda de hoje junta tarefa com horário, hábito e compromisso', text.includes('Ligar para cliente') && text.includes('Tarefa com horário') && text.includes('Ler 20 min') && text.includes('Café cedo'))
  r.check('compromisso que já passou aparece como "horário encerrado"', text.includes('horário encerrado'))
  r.check('agenda não gravou nada (só visualiza)', (await idb(b, 'completions')).length === 0 && (await idb(b, 'events')).length === 1)

  // New appointment
  await b.click('Compromisso', 'button')
  await b.fill('Título', 'Reunião com Ana')
  await b.fill('Início', '22:00')
  await b.shot('agenda-novo-compromisso')
  await b.click('Criar compromisso', 'button[type=submit]')
  await b.sleep(400)
  const ev = (await idb(b, 'events')).find((x) => x.title === 'Reunião com Ana')
  r.check('compromisso salvo com data, início e fim (+1h)', ev?.date === today && ev.start === '22:00' && ev.end === '23:00')
  text = await b.text()
  r.check('aparece na agenda', text.includes('Reunião com Ana'))

  // Mark habit from the agenda → same record as the Habits screen
  await b.click('Concluir Ler 20 min')
  await b.sleep(400)
  r.check('marcar na agenda grava a conclusão do dia', (await idb(b, 'completions', `habit:h1:${today}`))?.status === 'done')
  await b.goto(BASE + '#/habits')
  text = await b.text()
  r.check('Hábitos mostra o mesmo hábito concluído', text.includes('1 de 1 hoje'))

  // Complete the task from the agenda → original task
  await b.goto(BASE + '#/agenda')
  await b.click('Concluir Ligar para cliente')
  await b.sleep(400)
  r.check('concluir na agenda atualiza a tarefa original', (await idb(b, 'tasks', 't1')).status === 'done')
  await b.shot('agenda-hoje')

  // Week view
  await b.click('Semana', '[role=radio]')
  text = await b.text()
  const sections = await b.eval(`document.querySelectorAll('main section').length`)
  r.check('semana mostra os 7 dias', sections === 7)
  r.check('hábito diário aparece em todos os dias da semana', (text.match(/Ler 20 min/g) ?? []).length === 7)
  await b.click('Próximo')
  text = await b.text()
  r.check('navega para a próxima semana', !text.includes('Reunião com Ana'))
  await b.shot('agenda-semana')
  r.check('sem rolagem horizontal (390px)', await noHorizontalScroll(b))
  await b.desktop()
  await b.goto(BASE + '#/agenda')
  await b.click('Semana', '[role=radio]')
  r.check('sem rolagem horizontal (1366px)', await noHorizontalScroll(b))
  await b.shot('agenda-desktop')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('agenda-erro')
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
