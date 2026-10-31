// Etapa 5: Central de notificações (sino, não lidas, marcar, dispensar, silenciar), privacidade da tela
// bloqueada (padrão Sem valores), lembretes por registro no formulário e larguras de iPhone.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9375)
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'life', 'week', 'agenda']
const settings = async () => (await idb(b, 'meta', 'settings')).reminders
const dialog = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].pop()?.innerText ?? ''`)
const clickIn = (text) =>
  b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].pop(); const el = [...d.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.click(); return true })()`)
const row = async (t) => {
  await b.eval(`[...document.querySelectorAll('main button, button')].find(x => !x.closest('[role=dialog]') && x.innerText.trim().startsWith(${JSON.stringify(t)}))?.click()`)
  await b.sleep(650)
}
const waitFor = async (fn, ms = 8000) => {
  for (let t = 0; t < ms; t += 250) {
    if (await fn()) return true
    await b.sleep(250)
  }
  return false
}

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await b.goto(BASE + 'favicon.svg')
  const [today, hhmm] = await b.eval(
    `(() => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value])); return [p.year+'-'+p.month+'-'+p.day, p.hour+':'+p.minute] })()`,
  )
  const plus = (n) => b.eval(`new Date(Date.parse(${JSON.stringify(today)} + 'T12:00:00Z') + ${n} * 864e5).toISOString().slice(0, 10)`)
  const tomorrow = await plus(1)
  await seedExistingUser(
    b,
    {
      tasks: [
        { id: 'agora', title: 'Ligar para o contador', projectId: null, dueDate: today, dueTime: hhmm, priority: 'none', status: 'todo', completedAt: null, updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'amanha', title: 'Entregar o site da Perfect Clean', projectId: null, dueDate: tomorrow, dueTime: '15:00', priority: 'none', status: 'todo', completedAt: null },
      ],
      tools: [{ id: 'sp', name: 'Spotify', link: '', plan: '', price: 2190, currency: 'BRL', billing: 'monthly', nextCharge: await plus(3), notes: '', status: 'active' }],
    },
    { modules: { tasks: true, tools: true }, modulesSeen: ALL, reminders: { on: true, when: 'at', showDetails: false, rules: {} } },
  )

  // The task due now shows inside the app → it goes to the center as "Mostrado no app".
  await b.goto(BASE + '#/')
  const shown = await waitFor(async () => (await b.eval(`[...document.querySelectorAll('[role=status]')].map(x => x.innerText).join('|')`)).includes('Ligar para o contador'))
  r.check('aviso do horário aparece no app', shown)
  const bell = await b.eval(`[...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').startsWith('Notificações'))?.getAttribute('aria-label') ?? ''`)
  r.check('sino do Início com 1 não lida', bell === 'Notificações: 1 não lida', bell)
  await b.shot('e5-inicio-sino')

  await b.click('Notificações: 1 não lida', 'button')
  await b.sleep(900)
  let text = await b.text()
  r.check('central abre pelo sino', text.includes('Central de notificações') && text.includes('1 não lida'))
  r.check('não lidas com origem e situação reais', text.includes('Não lidas') && text.includes('Ligar para o contador') && text.includes('Automático') && text.includes('Mostrado no app'))
  r.check('próximos: assinatura com nome, sem inventar nada', text.includes('Próximos') && text.includes('A assinatura Spotify vence') === false && text.includes('A assinatura Spotify') && text.includes('Agendado'))
  for (const w of [320, 375, 390]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: 760, deviceScaleFactor: 2, mobile: true })
    await b.sleep(300)
    r.check(`central sem rolagem horizontal em ${w}px`, await noHorizontalScroll(b))
    await b.shot(`e5-central-${w}`)
  }
  await b.mobile()

  await row('Agora: Ligar para o contador')
  let d = await dialog()
  r.check('detalhe: quando, origem, situação e explicação', d.includes('Quando') && d.includes('Origem') && d.includes('Situação') && d.includes('Apareceu dentro do Núcleo'))
  r.check('detalhe oferece abrir, ajustar, marcar, dispensar e silenciar', ['Abrir', 'Ajustar lembrete', 'Marcar como lida', 'Dispensar', 'Silenciar'].every((x) => d.includes(x)))
  await clickIn('Marcar como lida')
  await b.sleep(600)
  text = await b.text()
  r.check('marcar como lida zera as não lidas', text.includes('Tudo lido') && text.includes('Anteriores'))

  await row('Agora: Ligar para o contador')
  await clickIn('Dispensar')
  await b.sleep(600)
  text = await b.text()
  r.check('dispensar guarda em Dispensadas', text.includes('Dispensadas (1)'))

  await row('A assinatura Spotify')
  d = await dialog()
  r.check('agendado não pode ser "dispensado" (ainda não aconteceu)', !d.includes('Dispensar') && d.includes('Vai ser enviado no horário'))
  await clickIn('Silenciar')
  await b.sleep(700)
  r.check('silenciar a categoria vale só para ela', (await settings()).kinds?.payments?.enabled === false && (await settings()).on === true)

  // Privacy of the lock screen: default "Sem valores", example from a real reminder.
  await b.goto(BASE + '#/reminders')
  await b.sleep(900)
  text = await b.text()
  const checked = await b.eval(`[...document.querySelectorAll('[role=radio][aria-checked=true]')].map(x => x.textContent.trim())`)
  r.check('tela bloqueada: "Sem valores" é o padrão', text.includes('Na tela bloqueada') && checked.includes('Sem valores'), checked.join(','))
  r.check('explica que senhas e cofre nunca aparecem', text.includes('Senhas e dados do cofre nunca aparecem'))
  await b.click('Completo', '[role=radio]')
  await b.sleep(500)
  r.check('"Completo" fica salvo', (await settings()).privacy === 'complete')
  await b.click('Sem valores', '[role=radio]')
  await b.sleep(400)
  r.check('sem rolagem horizontal em Notificações', await noHorizontalScroll(b))
  await b.shot('e5-notificacoes')

  // A reminder on the record itself.
  await b.goto(BASE + '#/tasks?open=amanha')
  await b.sleep(1200)
  await b.click('Escolher quando avisar', 'button')
  await b.click('30 min antes', 'button')
  await b.click('1 dia antes às 09:00', 'button').catch(async () => {
    await b.click('Adicionar outro aviso', 'button')
    await b.click('1 dia antes às 09:00', 'button')
  })
  d = await dialog()
  r.check('vários avisos no mesmo item', d.includes('30 min antes') && d.includes('1 dia antes às 09:00'))
  await b.shot('e5-tarefa-avisos')
  r.check('formulário sem rolagem horizontal', await noHorizontalScroll(b))
  await b.click('Salvar', 'button')
  await b.sleep(900)
  const task = await idb(b, 'tasks', 'amanha')
  r.check(
    'avisos salvos no registro',
    JSON.stringify((task.alerts ?? []).map((a) => [a.type, a.minutes ?? a.days, a.at ?? null])) === JSON.stringify([['min', 30, null], ['day', 1, '09:00']]),
    JSON.stringify(task.alerts),
  )
  await b.goto(BASE + '#/notifications')
  await b.sleep(900)
  text = await b.text()
  r.check('central mostra como "Seu lembrete"', text.includes('Seu lembrete') && text.includes('Entregar o site da Perfect Clean'))
  r.check('nenhum dado foi marcado como feito', (await idb(b, 'tasks', 'agora')).status === 'todo')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('e5-erro')
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
