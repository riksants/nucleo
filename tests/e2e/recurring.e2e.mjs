import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9354)
const TZ = 'America/Sao_Paulo'
try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(b, {}, { modules: { recurring: true }, modulesSeen: ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring'] })
  const today = await b.eval(`(() => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:${JSON.stringify(TZ)},year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value])); return p.year+'-'+p.month+'-'+p.day })()`)
  const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10)
  await b.goto(BASE + '#/recurring')

  // Weekly on today's weekday (default)
  await b.click('Criar item')
  await b.fill('O que fazer', 'Lavar roupa')
  await b.click('Semanal', '[role=radio]')
  await b.click('Criar', 'button[type=submit]')
  // Monthly on today's day of month
  await b.click('Novo recorrente', 'button')
  await b.fill('O que fazer', 'Pagar aluguel')
  await b.click('Mensal', '[role=radio]')
  await b.fill('Dia do mês', String(Number(today.slice(8, 10))))
  await b.shot('recorrente-form-mensal')
  await b.click('Criar', 'button[type=submit]')
  // Weekly on another day → not today
  const wd = await b.eval(`new Date(${JSON.stringify(today)} + 'T12:00:00Z').getUTCDay()`)
  const other = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][(wd + 3) % 7]
  await b.click('Novo recorrente', 'button')
  await b.fill('O que fazer', 'Revisar finanças')
  await b.click('Semanal', '[role=radio]')
  await b.click(other, 'button[aria-pressed=false]')
  await b.click('Criar', 'button[type=submit]')
  await b.sleep(400)

  const items = await idb(b, 'recurring')
  r.check('três recorrentes criados (semanal, mensal, outro dia)', items.length === 3 && items.find((i) => i.title === 'Pagar aluguel')?.rule.type === 'monthly')
  let text = await b.text()
  const hojeSection = await b.eval(`[...document.querySelectorAll('section')][0]?.innerText ?? ''`)
  r.check('"Hoje" mostra semanal e mensal de hoje, não o de outro dia', hojeSection.includes('Lavar roupa') && hojeSection.includes('Pagar aluguel') && !hojeSection.includes('Revisar finanças'))
  r.check('"Próximos" mostra a próxima data calculada', text.includes('Revisar finanças'))
  r.check('nenhuma ocorrência futura gravada no banco', (await idb(b, 'completions')).length === 0)

  const lavar = items.find((i) => i.title === 'Lavar roupa')
  await b.click('Concluir Lavar roupa')
  await b.sleep(400)
  const c1 = await idb(b, 'completions', `recurring:${lavar.id}:${today}`)
  const c2 = await idb(b, 'completions', `recurring:${lavar.id}:${addDays(today, 7)}`)
  r.check('concluir esta semana não marca a próxima', c1?.status === 'done' && c2 === null)
  const aluguel = items.find((i) => i.title === 'Pagar aluguel')
  await b.click('Pular hoje')
  await b.sleep(400)
  r.check('"Pular hoje" registra pulado', (await idb(b, 'completions', `recurring:${aluguel.id}:${today}`))?.status === 'skipped')
  text = await b.text()
  r.check('próxima data do aluguel é no mês seguinte', /\d+ \w{3}/.test(text) && text.includes('Pagar aluguel'))
  await b.shot('recorrentes')
  r.check('sem rolagem horizontal (390px)', await noHorizontalScroll(b))
  await b.desktop()
  await b.goto(BASE + '#/recurring')
  r.check('sem rolagem horizontal (1366px)', await noHorizontalScroll(b))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('recorrentes-erro')
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
