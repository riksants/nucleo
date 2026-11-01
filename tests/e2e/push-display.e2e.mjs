// What the service worker shows for a push (the same payloads the server sends): title "Núcleo", the
// specific message as the body, one notification per key, and a tap opens the right screen.
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9381)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
let registrationId = null
try {
  await b.mobile()
  await seedExistingUser(b, {}, { modulesSeen: ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'life', 'week', 'agenda'] })
  b.on('ServiceWorker.workerRegistrationUpdated', (p) => {
    const reg = p.registrations?.find((x) => !x.isDeleted && x.scopeURL.startsWith(BASE))
    if (reg) registrationId = reg.registrationId
  })
  await b.send('ServiceWorker.enable')
  await b.goto(BASE)
  await b.send('Browser.grantPermissions', { origin: new URL(BASE).origin, permissions: ['notifications'] })
  for (let i = 0; i < 40 && !registrationId; i++) await sleep(250)
  await b.eval(`navigator.serviceWorker.ready.then(() => true)`)
  r.check('service worker do app registrado', !!registrationId)

  // The app closed (a page of the same site without the app): like the phone with the Núcleo not open.
  await b.goto(BASE + 'favicon.svg')
  const deliver = async (payload) => {
    await b.send('ServiceWorker.deliverPushMessage', { origin: new URL(BASE).origin, registrationId, data: JSON.stringify(payload) })
    await sleep(900)
  }
  const shown = () => b.eval(`navigator.serviceWorker.getRegistration(${JSON.stringify(BASE)}).then(reg => reg.getNotifications()).then(l => l.map(n => ({ title: n.title, body: n.body, tag: n.tag, url: n.data && n.data.url })))`)

  // "Enviar teste" (as the server sends it after the fix).
  await deliver({ title: 'Núcleo', body: 'Teste', key: 'test:1', url: '#/notifications' })
  // A real reminder at its time, and a grouped one.
  await deliver({ title: 'Núcleo', body: 'Entregar o site da Perfect Clean às 15:00', key: 'task:t1:2026-11-02T15:00:0', url: '#/tasks?open=t1' })
  await deliver({ title: 'Núcleo', body: '2 lembretes\n• Ligar para o contador às 15:00\n• Mandar orçamento às 15:00', key: 'group:2026-11-02T14:00', url: '#/notifications?at=x' })
  // Same key again: replaced, never a second notification.
  await deliver({ title: 'Núcleo', body: 'Teste', key: 'test:1', url: '#/notifications' })
  const list = await shown()
  const by = Object.fromEntries(list.map((n) => [n.tag, n]))
  r.check('teste: "Núcleo" / "Teste"', by['test:1']?.title === 'Núcleo' && by['test:1']?.body === 'Teste', JSON.stringify(by['test:1']))
  r.check('lembrete real: título do app e mensagem com nome e horário', by['task:t1:2026-11-02T15:00:0']?.title === 'Núcleo' && by['task:t1:2026-11-02T15:00:0']?.body === 'Entregar o site da Perfect Clean às 15:00')
  r.check('agrupado: título do app, cada lembrete na mensagem', by['group:2026-11-02T14:00']?.title === 'Núcleo' && by['group:2026-11-02T14:00']?.body.includes('Mandar orçamento'))
  r.check('mesma chave não duplica', list.filter((n) => n.tag === 'test:1').length === 1 && list.length === 3, `${list.length} notificações`)
  r.check('nenhum título com "Agora:" ou repetido no corpo', list.every((n) => !/Agora:/.test(n.title + n.body) && !(n.title !== 'Núcleo' && n.body.includes(n.title))))
  r.check('cada notificação leva ao seu lugar', by['task:t1:2026-11-02T15:00:0']?.url === '#/tasks?open=t1' && by['test:1']?.url === '#/notifications')
} catch (err) {
  r.results.push('ERROR ' + err.message)
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
