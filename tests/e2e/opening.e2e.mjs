// Abertura (referência em vídeo): logo parada → cápsula roxa estreita sobe (cabeça com mini logo) → coluna →
// alarga até a tela inteira → o roxo sobe e sai revelando o app real. App carrega por baixo, nada sobra depois,
// não repete ao trocar de seção, toque pula, "reduzir movimento" e sem flash branco. Modo local.
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
  const o = window.__open = { seen: false, end: null, leave: null, white: false, appUnder: false, canvas: false, narrowWhileRising: null, logoMoves: false };
  const look = () => {
    try {
      if (document.documentElement && getComputedStyle(document.documentElement).backgroundColor === 'rgb(255, 255, 255)' && document.body) o.white = true;
      const splash = document.getElementById('splash');
      if (splash) o.seen = true;
      if (document.querySelector('canvas')) o.canvas = true;
      const logo = splash && splash.querySelector('.nl-logo');
      if (logo && logo.getBoundingClientRect().width > 0) {
        const r = logo.getBoundingClientRect();
        const key = Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width);
        if (o.logoAt === undefined) o.logoAt = key;
        else if (o.logoAt !== key) o.logoMoves = true;
      }
      const sheet = splash && splash.querySelector('.nl-sheet');
      const head = splash && splash.querySelector('.nl-head');
      if (sheet && head && o.narrowWhileRising === null) {
        const hb = head.getBoundingClientRect();
        if (hb.top > innerHeight * 0.3 && hb.top < innerHeight * 0.7) o.narrowWhileRising = { head: Math.round(hb.width), screen: innerWidth, clip: getComputedStyle(sheet).clipPath };
      }
      if (splash && splash.classList.contains('nl-leave') && o.leave === null) o.leave = performance.now();
      const root = document.getElementById('root');
      if (root && o.readyAt === undefined && [...root.children].some((c) => c.getBoundingClientRect().height > 0)) o.readyAt = performance.now();
      if (splash && o.readyAt !== undefined) o.appUnder = true;
      if (o.seen && !splash && o.end === null) o.end = performance.now();
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
const overlays = () => b.eval(`document.querySelectorAll('#splash').length`)
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']

try {
  await b.mobile()
  await b.send('Page.enable')
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(b, { notes: [{ id: 'n1', title: 'Nota guardada', body: '', pinned: false }] }, { baseCurrency: 'BRL', modulesSeen: ALL })

  // ---------- First (cold) load
  await open('')
  await until(`!!document.querySelector('#splash .nl-logo')`)
  await sleep(350)
  await shot('intro-1-logo')
  const early = await b.eval(`(() => { const l = document.querySelector('#splash .nl-logo'); const r = l.getBoundingClientRect(); return { bg: getComputedStyle(document.body).backgroundColor, logo: Math.round(r.width), pieces: document.querySelectorAll('#nl-mark path').length, vw: innerWidth } })()`)
  r.check('abre com a logo inteira (4 peças) parada sobre o fundo escuro', early.bg === 'rgb(11, 16, 13)' && early.pieces === 4 && early.logo > early.vw * 0.18 && early.logo < early.vw * 0.27, JSON.stringify(early))
  await until(`window.__open.end !== null`)
  await sleep(150)
  await shot('intro-2-app')
  let t = await times()
  const n = t.narrowWhileRising
  r.check('a faixa sobe estreita (≈25% da largura, cabeça do mesmo tamanho) antes de alargar', !!n && n.head >= n.screen * 0.2 && n.head <= n.screen * 0.3 && /inset\(/.test(n.clip), JSON.stringify(n))
  r.check('sem fitas nem peças se soltando (nenhum canvas) e logo sem movimento', !t.canvas && !t.logoMoves)
  r.check('o app carregou por baixo durante a animação', t.appUnder)
  r.check('sem flash branco', !t.white)
  r.check('revelação só depois de alargar e com o app pronto (≥ 2,1 s, sem espera extra)', t.leave - t.splashAt >= 2050 && t.leave - Math.max(t.splashAt + 2100, t.readyAt) < 400, `revelou em ${Math.round(t.leave - t.splashAt)} ms (app pronto em ${Math.round(t.readyAt - t.splashAt)} ms)`)
  r.check('o roxo sai pelo topo em ~0,56 s', t.end - t.leave >= 400 && t.end - t.leave <= 950, `${Math.round(t.end - t.leave)} ms`)
  const after = await b.eval(`(() => { const root = document.getElementById('root'); return { splash: !!document.getElementById('splash'), rootStyle: root.getAttribute('style') || '' } })()`)
  r.check('no fim: nenhuma logo ou camada sobrando e o app intacto', !after.splash && after.rootStyle === '', JSON.stringify(after))
  r.check('revela direto a tela principal real (Início)', /Início/.test(await b.text()) && /SALDO|Saldo/.test(await b.text()))
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
  r.check('com cache: abertura completa em ~2,8 s', t.end - t.splashAt >= 2500 && t.end - t.splashAt <= 3400, `${Math.round(t.end - t.splashAt)} ms`)

  // A tap skips the rest
  await open('')
  await until(`!!document.querySelector('#splash .nl-logo')`)
  await sleep(500)
  await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 400 }] })
  await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await until(`window.__open && window.__open.end !== null`)
  t = await times()
  r.check('um toque pula a abertura', t.end - t.splashAt < 1700 && t.leave === null, `${Math.round(t.end - t.splashAt)} ms`)

  // Reduced motion
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await open('')
  await until(`window.__open && window.__open.end !== null`)
  t = await times()
  r.check('reduzir movimento: logo parada e fade, sem cápsula', t.narrowWhileRising === null && t.leave === null && t.end - t.splashAt < 1500, `${Math.round(t.end - t.splashAt)} ms`)
  await b.send('Emulation.setEmulatedMedia', { features: [] })

  // Desktop
  await b.desktop()
  await open('')
  await until(`window.__open && window.__open.end !== null`)
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
