// Notificações: one tap turns everything on, "Quando avisar", quiet hours, advanced settings, in-app reminder.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9361)
const ALL = [
  'today',
  'finance',
  'projects',
  'tasks',
  'clients',
  'goals',
  'tools',
  'accounts',
  'notes',
  'portfolio',
  'sales',
  'subscribers',
  'routine',
  'meals',
  'inbox',
  'habits',
  'recurring',
  'life',
  'week',
  'agenda',
]
const settings = async () =>
  (
    await b.eval(
      `new Promise(r => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const g = q.result.transaction('meta').objectStore('meta').get('settings'); g.onsuccess = () => { q.result.close(); r(g.result) } } })`,
    )
  ).reminders

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  // "Now" in São Paulo, so the task below is due right now (an in-app reminder shows at once).
  await b.goto(BASE + 'favicon.svg')
  const [today, hhmm] = await b.eval(
    `(() => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value])); return [p.year+'-'+p.month+'-'+p.day, p.hour+':'+p.minute] })()`,
  )
  const tomorrow = await b.eval(`new Date(Date.parse(${JSON.stringify(today)} + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10)`)
  await seedExistingUser(
    b,
    {
      tasks: [
        {
          id: 'agora',
          title: 'Ligar para o contador',
          projectId: null,
          dueDate: today,
          dueTime: hhmm,
          priority: 'none',
          status: 'todo',
          completedAt: null,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'amanha',
          title: 'Enviar proposta',
          projectId: null,
          dueDate: tomorrow,
          dueTime: '10:00',
          priority: 'none',
          status: 'todo',
          completedAt: null,
        },
      ],
      events: [
        {
          id: 'ev',
          title: 'Reunião com Ana',
          date: tomorrow,
          start: '15:00',
          end: '16:00',
          notes: '',
        },
      ],
    },
    { modules: { tasks: true, agenda: true, habits: true }, modulesSeen: ALL },
  )

  await b.goto(BASE + '#/reminders')
  let text = await b.text()
  r.check('tela simples: só o botão de ativar (nada para configurar antes)', text.includes('Ativar notificações') && !text.includes('Quando avisar') && !text.includes('Minutos antes'))
  await b.shot('notificacoes-desligadas')

  await b.click('Ativar notificações', 'button')
  await b.sleep(800)
  let rem = await settings()
  text = await b.text()
  r.check('um toque liga tudo (chave geral salva)', rem?.on === true)
  r.check(
    'mostra só: chave, quando avisar, horário silencioso e ajustes avançados',
    text.includes('Quando avisar') && text.includes('Horário silencioso') && text.includes('Ajustes avançados') && !text.includes('Minutos antes'),
  )
  r.check('"Antes" é o padrão', (await b.eval(`[...document.querySelectorAll('[role=radio][aria-checked=true]')].map(x => x.textContent.trim())`)).includes('Antes'))
  r.check('próximos avisos já aparecem, sem ativar categoria nenhuma', text.includes('Próximos avisos') && text.includes('Enviar proposta') && text.includes('Reunião com Ana'))
  await b.shot('notificacoes-ligadas')

  await b.click('Na hora', '[role=radio]')
  await b.sleep(400)
  rem = await settings()
  r.check('"Na hora" fica salvo', rem.when === 'at')
  text = await b.text()
  r.check('o texto explica a escolha', text.includes('No horário de cada item'))

  await b.click('Não avisar à noite', '[role=switch]')
  await b.sleep(400)
  rem = await settings()
  r.check('horário silencioso 22:00 → 07:00', rem.quiet?.from === '22:00' && rem.quiet?.to === '07:00')
  // (Off again: the in-app check below must not depend on the hour the test runs.)
  await b.click('Não avisar à noite', '[role=switch]')
  await b.sleep(400)
  r.check('horário silencioso desliga', (await settings()).quiet === null)

  await b.click('Ajustes avançados', 'button')
  await b.sleep(700)
  const sheet = await b.eval(`[...document.querySelectorAll('[role=dialog]')].pop()?.innerText ?? ''`)
  r.check('ajustes avançados ficam à parte', sheet.includes('O que lembrar') && sheet.includes('Tarefas') && sheet.includes('Agenda') && sheet.includes('Avisar de novo se ficar pendente'))
  await b.shot('notificacoes-avancado')
  await b.eval(`[...[...document.querySelectorAll('[role=dialog]')].pop().querySelectorAll('[role=switch]')].find(x => x.textContent.startsWith('Agenda'))?.click()`)
  await b.sleep(400)
  rem = await settings()
  r.check('desligar uma categoria vale só para ela', rem.kinds?.events?.enabled === false && rem.on === true)
  await b.eval(`[...[...document.querySelectorAll('[role=dialog]')].pop().querySelectorAll('[role=switch]')].find(x => x.textContent.startsWith('Agenda'))?.click()`)
  await b.sleep(300)
  await b.eval(`[...document.querySelectorAll('[role=dialog] button')].find(x => x.getAttribute('aria-label') === 'Fechar')?.click()`)
  await b.sleep(600)

  // The task due now: with "Na hora", the app shows it right away (in the app, the full text).
  await b.goto(BASE + '#/today')
  await b.eval('location.reload()')
  await b.sleep(1500)
  const banner = await (async () => {
    for (let i = 0; i < 20; i++) {
      const t = await b.eval(`[...document.querySelectorAll('[role=status]')].map(x => x.innerText).join(' | ')`)
      if (t.includes('Ligar para o contador')) return t
      await b.sleep(500)
    }
    return ''
  })()
  r.check('lembrete do horário aparece no app', banner.includes('Ligar para o contador'), banner)
  await b.eval('location.reload()')
  await b.sleep(3000)
  const again = await b.eval(`[...document.querySelectorAll('[role=status]')].map(x => x.innerText).join(' | ')`)
  r.check('abrir de novo não repete o mesmo aviso', !again.includes('Ligar para o contador'), again)

  await b.goto(BASE + '#/reminders')
  await b.sleep(600)
  r.check('sem rolagem horizontal no iPhone', await noHorizontalScroll(b))
  await b.click('Notificações', '[role=switch]')
  await b.sleep(600)
  rem = await settings()
  text = await b.text()
  r.check('desativar: a chave geral desliga e as escolhas ficam guardadas', rem.on === false && rem.when === 'at' && text.includes('Ativar notificações'))
  await b.desktop()
  await b.goto(BASE + '#/reminders')
  r.check('sem rolagem horizontal (computador)', await noHorizontalScroll(b))
  r.check(
    'nenhum dado foi marcado como feito',
    (await idb(b, 'tasks')).every((t) => t.status === 'todo'),
  )
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('notificacoes-erro')
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
