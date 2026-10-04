// Abertura: logo parada → faixa roxa arredondada sobe e cobre a tela → sai pelo topo revelando o app real.
// Sem fitas/peças soltas e sem logo no final. App carrega por baixo, nada sobra depois, não repete ao trocar de seção,
// "reduzir movimento" e sem flash branco. Modo local.
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
/** Records inside the page what was on screen and when. */
const RECORDER = `(() => {
  const o = window.__open = { seen: false, canvas: null, band: null, bandFull: null, end: null, white: false, appUnder: false };
  const look = () => {
    try {
      if (document.documentElement && getComputedStyle(document.documentElement).backgroundColor === 'rgb(255, 255, 255)' && document.body) o.white = true;
      const splash = document.getElementById('splash');
      if (splash) o.seen = true;
      if (o.canvas === null && document.querySelector('canvas')) o.canvas = performance.now();
      const svg = splash && splash.querySelector('svg');
      if (svg) o.logoTransform = o.logoTransform || getComputedStyle(svg).transform;
      const band = [...(document.body ? document.body.children : [])].find((e) => e.style && e.style.zIndex === '2147483001');
      if (band && o.band === null) o.band = performance.now();
      if (band && o.bandFull === null && band.getAnimations().some((a) => a.effect.getTiming().duration === 680)) o.bandFull = performance.now();
      const root = document.getElementById('root');
      if (root && o.readyAt === undefined && [...root.children].some((c) => c.getBoundingClientRect().height > 0)) o.readyAt = performance.now();
      if (splash && root && [...root.children].some((c) => c.getBoundingClientRect().height > 0)) o.appUnder = true;
      if (o.seen && !splash && !band && o.end === null) o.end = performance.now();
    } catch (e) {}
    if (o.end === null) requestAnimationFrame(look);
  };
  look();
})()`
let added = false
async function open(path) {
  if (!added) await b.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER })
  added = true
  await b.send('Page.navigate', { url: BASE + path })
}
async function until(expr, timeout = 9000) {
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
const overlays = () => b.eval(`[...document.body.children].filter((e) => e.id === 'splash' || (e.style && e.style.zIndex === '2147483001')).length`)
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']

try {
  await b.mobile()
  await b.send('Page.enable')
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(b, { notes: [{ id: 'n1', title: 'Nota guardada', body: '', pinned: false }] }, { baseCurrency: 'BRL', modulesSeen: ALL })

  await open('')
  await until(`!!document.querySelector('#splash svg') || !!document.querySelector('#splash canvas')`)
  const early = await b.eval(`({ bg: getComputedStyle(document.body).backgroundColor, logo: !!document.querySelector('#splash svg, #splash canvas') })`)
  r.check('abre com a logo sobre o fundo escuro do app', early.bg === 'rgb(9, 9, 11)' && early.logo, JSON.stringify(early))
  await sleep(300)
  await shot('intro-1-logo')
  r.check('a faixa roxa sobe', await until(`window.__open.band !== null`))
  r.check('a faixa cobre a tela e então sai revelando o app', await until(`window.__open.bandFull !== null`))
  await until(`window.__open.end !== null`)
  await sleep(150)
  await shot('intro-2-app')
  let t = await times()
  r.check('o app carregou por baixo durante a animação', t.appUnder)
  r.check('sem flash branco', !t.white)
  r.check('sem fitas nem peças se soltando (nenhum canvas) e logo parada (sem escala/movimento)', t.canvas === null && (!t.logoTransform || t.logoTransform === 'none'), String(t.logoTransform))
  r.check('logo parada por ~0,7 s antes da faixa', t.band - t.splashAt >= 680 && t.band - t.splashAt <= 1100, `${Math.round(t.band - t.splashAt)} ms`)
// The band covers in ~0.76 s; it only leaves once the app is ready (no half-loaded reveal, no extra wait).
  const exitAt = Math.max(t.band + 760, t.readyAt)
  r.check('faixa cobre em ~0,76 s e sai assim que o app está pronto, em ~0,68 s', t.bandFull - t.band >= 650 && t.bandFull - exitAt < 250 && t.end - t.bandFull >= 550 && t.end - t.bandFull <= 1000, `cobre/espera ${Math.round(t.bandFull - t.band)} ms (app pronto ${Math.round(t.readyAt - t.band)} ms após a faixa), sai ${Math.round(t.end - t.bandFull)} ms`)
  const after = await b.eval(`(() => { const root = document.getElementById('root'); return { overlays: [...document.body.children].filter((e) => e.id === 'splash' || (e.style && e.style.zIndex === '2147483001')).length, canvas: document.querySelectorAll('canvas').length, rootStyle: root.getAttribute('style') || '' } })()`)
  r.check('no fim: nenhuma logo ou camada sobrando e o app intacto', after.overlays === 0 && after.canvas === 0 && after.rootStyle === '', JSON.stringify(after))
  const text = await b.text()
  r.check('revela direto a tela principal real (Início)', /Início/.test(text) && /SALDO|Saldo/.test(text))
  const clickable = await b.eval(`(() => { const a = document.querySelector('nav[aria-label="Navegação principal"] a'); const rect = a.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('a') === a })()`)
  r.check('navegação clicável', clickable)

  // Switching sections never replays the intro
  let replays = 0
  for (const path of ['#/finance', '#/notes', '#/settings', '#/']) {
    await b.eval(`location.hash = ${JSON.stringify(path.slice(1))}`)
    for (let i = 0; i < 12; i++) {
      replays += await overlays()
      await sleep(60)
    }
  }
  r.check('trocar de seção não repete a intro', replays === 0)
  await b.eval(`location.hash = '/notes'`)
  await sleep(500)
  r.check('seções funcionam normalmente depois da intro', (await b.text()).includes('Nota guardada'))

  // Warm load (installed app): total from the logo
  await open('')
  await until(`window.__open && window.__open.end !== null`)
  t = await times()
  r.check('com cache: abertura completa em ~2,2 s', t.end - t.splashAt >= 1900 && t.end - t.splashAt <= 2800, `${Math.round(t.end - t.splashAt)} ms`)

  // Reduced motion
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await open('')
  await until(`window.__open && window.__open.end !== null`)
  t = await times()
  r.check('reduzir movimento: logo parada e fade, sem faixa', t.canvas === null && t.band === null && t.end - t.splashAt < 1500, `${Math.round(t.end - t.splashAt)} ms`)
  await b.send('Emulation.setEmulatedMedia', { features: [] })

  // Desktop
  await b.desktop()
  await open('')
  await until(`window.__open && window.__open.band !== null`)
  await sleep(250)
  await shot('intro-desktop-faixa')
  await until(`window.__open.end !== null`)
  await sleep(100)
  r.check('navegador comum (1366px): termina limpo no app', (await overlays()) === 0 && /Início/.test(await b.text()))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('intro-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
