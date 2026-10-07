import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9352)
const todayIn = (tz) => b.eval(`(() => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:${JSON.stringify(tz)},year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value])); return p.year+'-'+p.month+'-'+p.day })()`)
const setZone = (tz) => b.eval(`new Promise(r => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const db = q.result; const tx = db.transaction('meta','readwrite'); const s = tx.objectStore('meta'); const g = s.get('settings'); g.onsuccess = () => { s.put({ ...g.result, timeZone: ${JSON.stringify(tz)} }, 'settings') }; tx.oncomplete = () => { db.close(); r(true) } } })`)

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(b, {}, { modules: { habits: true }, modulesSeen: ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits'] })
  await b.goto(BASE + '#/habits')
  let text = await b.text()
  r.check('página de hábitos vazia com convite', text.includes('Nenhum hábito ainda'))

  // Create from preset (daily)
  await b.click('Criar hábito')
  await b.click('Beber água', 'button')
  await b.fill('Meta', '2 litros')
  await b.shot('habitos-form')
  await b.click('Criar hábito', 'button[type=submit]')
  // Create specific days habit that does NOT include today
  const tz = 'America/Sao_Paulo'
  const today = await todayIn(tz)
  const todayWd = await b.eval(`new Date(${JSON.stringify(today)} + 'T12:00:00Z').getUTCDay()`)
  const otherDay = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][(todayWd + 2) % 7]
  await b.click('Novo hábito', 'button')
  await b.fill('Hábito', 'Treinar')
  await b.click('Dias', '[role=radio]')
  // clear default Seg–Sex and choose one other day
  for (const d of ['Seg', 'Ter', 'Qua', 'Qui', 'Sex']) await b.click(d, 'button[aria-pressed=true]')
  await b.click(otherDay, 'button[aria-pressed=false]')
  await b.click('Criar hábito', 'button[type=submit]')
  await b.sleep(400)
  const habits = await idb(b, 'habits')
  r.check('dois hábitos criados (todo dia e dias específicos)', habits.length === 2 && habits.some((h) => h.rule.type === 'daily' && h.goal === '2 litros') && habits.some((h) => h.rule.type === 'weekdays' && h.rule.days.length === 1))
  text = await b.text()
  r.check('"Hoje" mostra só o hábito programado para hoje', text.includes('Beber água') && text.toUpperCase().includes('0 DE 1 HOJE'))

  // Complete today
  await b.click('Concluir Beber água')
  await b.sleep(400)
  const water = habits.find((h) => h.name === 'Beber água')
  let comp = await idb(b, 'completions', `habit:${water.id}:${today}`)
  r.check('concluir grava um registro do dia (id fixo)', comp?.status === 'done' && comp.date === today)
  r.check('o hábito em si não guarda booleano de concluído', !('done' in (await idb(b, 'habits', water.id))))
  text = await b.text()
  r.check('contador do dia atualiza', text.includes('1 de 1 hoje'))
  await b.shot('habitos-concluido')

  // Undo then skip: skipped is never done
  await b.click('Desmarcar Beber água')
  await b.sleep(300)
  r.check('desmarcar remove a conclusão do dia', (await idb(b, 'completions', `habit:${water.id}:${today}`)) === null)
  await b.click('Pular hoje')
  await b.sleep(300)
  comp = await idb(b, 'completions', `habit:${water.id}:${today}`)
  text = await b.text()
  r.check('"Pular hoje" fica registrado como pulado (não concluído)', comp?.status === 'skipped' && text.includes('0 de 1 hoje') && text.includes('Pulado hoje'))
  await b.click('Desfazer')
  await b.click('Concluir Beber água')
  await b.sleep(300)

  // Day change via time zone: in Kiritimati (UTC+14) it is already a different day for most of the day
  const kiri = await todayIn('Pacific/Kiritimati')
  if (kiri !== today) {
    await setZone('Pacific/Kiritimati')
    await b.send('Page.reload', { ignoreCache: true })
    await b.sleep(2500)
    text = await b.text()
    r.check('outro fuso/dia: hábito volta a ficar pendente, ontem continua concluído', text.includes('0 de 1 hoje') && (await idb(b, 'completions', `habit:${water.id}:${today}`))?.status === 'done')
    await setZone(tz)
    await b.send('Page.reload', { ignoreCache: true })
    await b.sleep(2500)
  } else {
    r.check('outro fuso/dia (pulado: mesma data nos dois fusos agora)', true)
  }

  // Deactivate keeps history
  await b.goto(BASE + '#/habits')
  await b.click('Beber água', 'section:last-of-type button')
  await b.click('Ativo', '[role=switch]')
  await b.click('Salvar', 'button[type=submit]')
  await b.sleep(400)
  text = await b.text()
  r.check('desativar tira do dia e mantém o histórico', text.toUpperCase().includes('DESATIVADOS') && (await idb(b, 'completions', `habit:${water.id}:${today}`))?.status === 'done')
  r.check('sem rolagem horizontal (390px)', await noHorizontalScroll(b))
  await b.desktop()
  await b.goto(BASE + '#/habits')
  r.check('sem rolagem horizontal (1366px)', await noHorizontalScroll(b))
  await b.shot('habitos-desktop')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('habitos-erro')
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
