// Abertura: logo no fundo do app, painel arredondado que sobe revelando a Home, tempos, nada sobrando
// depois (#root volta ao normal), "reduzir movimento" e sem flash branco. Modo local.
import { writeFileSync } from 'node:fs'
import { launch, OUT } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9388)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const shot = async (name) => {
  const res = await b.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(res.result.data, 'base64'))
}
/** Records inside the page: when the first screen exists, when the reveal starts and when the splash is gone. */
const RECORDER = `(() => {
  window.__open = { ready: null, start: null, end: null, white: false, sawEdge: false, seen: false };
  const look = () => {
    const o = window.__open;
    try {
    if (getComputedStyle(document.documentElement).backgroundColor === 'rgb(255, 255, 255)' && document.body) o.white = true;
    const root = document.getElementById('root');
    if (root && o.ready === null && [...root.children].some((c) => c.getBoundingClientRect().height > 0)) o.ready = performance.now();
    if (root && o.start === null && root.getAnimations().length) o.start = performance.now();
    if ([...(document.body?.children ?? [])].some((e) => e.style && e.style.borderTop && e.style.position === 'fixed')) o.sawEdge = true;
    if (document.getElementById('splash')) o.seen = true;
    if (o.seen && !document.getElementById('splash') && o.end === null) o.end = performance.now();
    } catch (e) { o.error = String(e) }
    if (o.end === null) requestAnimationFrame(look);
  };
  look();
})()`
let recorder = null
async function open(path) {
  if (!recorder) recorder = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER })
  await b.send('Page.navigate', { url: BASE + path })
}
async function until(expr, timeout = 6000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try {
      if (await b.eval(expr)) return true
    } catch {}
    await sleep(30)
  }
  return false
}
const times = () => b.eval(`({ ...window.__open, splashAt: window.__splashAt })`)

try {
  await b.mobile()
  await b.send('Page.enable')
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(b, { notes: [{ id: 'n1', title: 'Nota', body: '', pinned: false }] }, { baseCurrency: 'BRL', modulesSeen: ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits'] })

  // ---------- First (cold) load
  await open('')
  await until(`!!document.querySelector('#splash img')`)
  await sleep(200)
  await shot('abertura-1-logo')
  const early = await b.eval(`({ bg: getComputedStyle(document.body).backgroundColor, logo: !!document.querySelector('#splash img').naturalWidth })`)
  r.check('abre com o logo sobre o fundo escuro do app', early.bg === 'rgb(9, 9, 11)' && early.logo, JSON.stringify(early))
  r.check('painel começa assim que a Home estiver pronta', await until(`window.__open.start !== null`))
  await sleep(300)
  const mid = await b.eval(`({ clip: document.getElementById('root').style.clipPath, home: document.getElementById('root').innerText.length })`)
  await shot('abertura-2-subindo')
  r.check('no meio: painel arredondado subindo com a Home já carregada por trás', mid.home > 0 && mid.clip.includes('round'), JSON.stringify(mid).slice(0, 120))
  await until(`window.__open.end !== null`)
  await sleep(150)
  await shot('abertura-3-home')
  let t = await times()
  r.check('logo fica pelo menos ~0,56 s antes de subir', t.start - t.splashAt >= 540, `${Math.round(t.start - t.splashAt)} ms`)
  // Only the frames needed for the first screen to be painted (the app is still finishing its first render).
  r.check('não atrasa: sobe logo depois que a Home ficou pronta (ou do tempo mínimo do logo)', t.start - Math.max(t.ready, t.splashAt + 560) < 300, `pronta ${Math.round(t.ready - t.splashAt)} ms, subiu ${Math.round(t.start - t.splashAt)} ms`)
  r.check('subida dura ~0,78 s', t.end - t.start >= 700 && t.end - t.start <= 1000, `${Math.round(t.end - t.start)} ms`)
  r.check('borda arredondada do painel apareceu', t.sawEdge)
  r.check('sem flash branco', !t.white)
  const after = await b.eval(`(() => { const root = document.getElementById('root'); return { splash: !!document.getElementById('splash'), style: root.getAttribute('style') || '', anims: root.getAnimations().length, extra: [...document.body.children].filter(e => e.style && e.style.borderTop).length } })()`)
  r.check('depois: splash removido e #root exatamente como antes (sem estilos nem animações)', !after.splash && after.style === '' && after.anims === 0 && after.extra === 0, JSON.stringify(after))
  r.check('Home funcionando normalmente depois da abertura', /Início|Financeiro/.test(await b.text()))
  const clickable = await b.eval(`(() => { const a = document.querySelector('nav[aria-label="Navegação principal"] a'); const rect = a.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('a') === a })()`)
  r.check('navegação clicável (nada cobrindo a tela)', clickable)

  // ---------- Warm load (installed app / cache): total time from the logo
  await open('#/notes')
  await until(`window.__open && window.__open.end !== null`)
  t = await times()
  const total = t.end - t.splashAt
  r.check('com cache (app instalado): abertura completa entre 1,3 e 1,8 s', total >= 1300 && total <= 1800, `${Math.round(total)} ms (Home pronta em ${Math.round(t.ready - t.splashAt)} ms)`)
  await sleep(200)
  r.check('abrindo direto numa seção: mesma abertura e depois a seção', (await b.text()).includes('Nota'))

  // ---------- Reduced motion: simple fade, no rising panel
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await open('')
  await until(`window.__open && window.__open.end !== null`)
  t = await times()
  r.check('reduzir movimento: sem painel nem borda, só um fade curto', !t.sawEdge && t.end - (t.start ?? t.end) < 400, `fade ${Math.round(t.end - (t.start ?? t.end))} ms`)
  await b.send('Emulation.setEmulatedMedia', { features: [] })

  // ---------- Desktop browser
  await b.desktop()
  await open('')
  await until(`window.__open && window.__open.start !== null`)
  await sleep(380)
  await shot('abertura-desktop-subindo')
  await until(`window.__open.end !== null`)
  await sleep(100)
  const d = await b.eval(`({ splash: !!document.getElementById('splash'), style: document.getElementById('root').getAttribute('style') || '' })`)
  r.check('navegador comum (1366px): termina limpo', !d.splash && d.style === '')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('abertura-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
