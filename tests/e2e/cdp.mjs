// Headless Edge driver over raw CDP, for the browser tests in this folder (no Playwright needed).
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
export const OUT = process.env.E2E_SHOTS || join(tmpdir(), 'nucleo-e2e-shots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch(port = 9333) {
  const profile = mkdtempSync(join(tmpdir(), 'edge-nucleo-'))
  const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' })
  let targets
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      if (targets.some((t) => t.type === 'page')) break
    } catch {}
    await sleep(200)
  }
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  const logs = []
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.exceptionThrown') logs.push('EXC ' + msg.params.exceptionDetails.exception?.description)
    else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) logs.push(msg.params.type + ' ' + msg.params.args.map((a) => a.value ?? a.description).join(' '))
  }
  // Every command has a deadline: a stuck page fails the test instead of hanging it.
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id
      const timer = setTimeout(() => {
        pending.delete(n)
        reject(new Error(`CDP timeout: ${method}`))
      }, 45_000)
      pending.set(n, (msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.bringToFront')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })

  const api = {
    logs,
    send,
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval error')
      return r.result?.result?.value
    },
    async goto(url) {
      await send('Page.navigate', { url })
      await send('Page.bringToFront')
      await sleep(800)
      for (let i = 0; i < 30; i++) {
        const n = await api.eval('document.body.innerText.trim().length').catch(() => 0)
        if (n > 20) break
        await sleep(250)
      }
      await sleep(400)
    },
    async mobile() {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
      await send('Emulation.setTouchEmulationEnabled', { enabled: true })
    },
    async desktop() {
      await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false })
      await send('Emulation.setTouchEmulationEnabled', { enabled: false })
    },
    async shot(name) {
      mkdirSync(OUT, { recursive: true })
      await sleep(500)
      const r = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'))
    },
    /** Clicks the first visible element whose text (or aria-label) matches. */
    async click(text, selector = 'button, a, [role=switch], [role=radio], label') {
      const ok = await api.eval(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => e.offsetParent !== null || e.getClientRects().length)
        const t = ${JSON.stringify(text)}
        const el = els.find(e => (e.getAttribute('aria-label') || '').trim() === t) || els.find(e => e.textContent.trim() === t) || els.find(e => e.textContent.trim().includes(t))
        if (!el) return false
        el.scrollIntoView({ block: 'center' }); el.click(); return true
      })()`)
      if (!ok) throw new Error('click: not found ' + text)
      await sleep(450)
    },
    /** Types into an input found by its field label text (React-safe). */
    async fill(label, value, nth = 0) {
      const ok = await api.eval(`(() => {
        const labels = [...document.querySelectorAll('label')].filter(l => l.textContent.trim().startsWith(${JSON.stringify(label)}) && (l.offsetParent !== null))
        const l = labels[${nth}]; if (!l) return false
        const el = l.querySelector('input, textarea, select'); if (!el) return false
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      if (!ok) throw new Error('fill: not found ' + label)
      await sleep(150)
    },
    text: () => api.eval('document.body.innerText'),
    sleep,
    close() {
      ws.close()
      try {
        process.kill(proc.pid)
      } catch {}
    },
  }
  return api
}
