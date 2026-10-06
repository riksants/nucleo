// Tema claro/escuro: "Automático" segue o aparelho (também quando ele muda com o app aberto); Configurações →
// Aparência fixa Claro ou Escuro e a escolha vale ao reabrir, já no primeiro quadro (sem piscar o outro tema);
// a cor da barra do navegador acompanha; textos principais com contraste AA nos dois temas. Modo local.
import { launch } from './cdp.mjs'
import { BASE, noHorizontalScroll, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9481)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const scheme = (value) => b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] })
const state = () =>
  b.eval(`(() => {
    const cs = getComputedStyle(document.body)
    return { theme: document.documentElement.dataset.theme, bg: cs.backgroundColor, ink: cs.color, chrome: document.querySelector('meta[name=theme-color]').content }
  })()`)

/** WCAG contrast of two "rgb(r, g, b)" strings. */
function contrast(a, c) {
  const lum = (s) => {
    const [r1, g1, b1] = s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r1 + 0.7152 * g1 + 0.0722 * b1
  }
  const [x, y] = [lum(a), lum(c)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

try {
  await b.mobile()
  await seedExistingUser(b, {}, { baseCurrency: 'EUR', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL })
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  // Automático: follows the device, also live
  await scheme('light')
  await b.goto(BASE + '#/')
  await sleep(1200)
  let s = await state()
  r.check('automático + aparelho claro → tema claro (fundo e barra do navegador claros)', s.theme === 'light' && s.bg === 'rgb(243, 244, 239)' && s.chrome === '#f3f4ef', JSON.stringify(s))
  r.check('claro: texto principal com contraste alto', contrast(s.ink, s.bg) >= 7, contrast(s.ink, s.bg).toFixed(1))
  await scheme('dark')
  await sleep(300)
  s = await state()
  r.check('aparelho muda para escuro com o app aberto → app acompanha', s.theme === 'dark' && s.bg === 'rgb(11, 16, 13)' && s.chrome === '#0b100d', JSON.stringify(s))
  r.check('escuro: texto principal com contraste alto', contrast(s.ink, s.bg) >= 7, contrast(s.ink, s.bg).toFixed(1))

  // Secondary text (soft / faint) on both themes
  for (const value of ['light', 'dark']) {
    await scheme(value)
    await sleep(200)
    const c = await b.eval(`(() => { const probe = (cls) => { const el = document.createElement('span'); el.className = cls; document.body.appendChild(el); const v = getComputedStyle(el).color; el.remove(); return v }; return { soft: probe('text-soft'), faint: probe('text-faint'), bg: getComputedStyle(document.body).backgroundColor } })()`)
    r.check(`${value}: textos secundários (soft/faint) com contraste AA`, contrast(c.soft, c.bg) >= 4.5 && contrast(c.faint, c.bg) >= 4.5, `${contrast(c.soft, c.bg).toFixed(1)} / ${contrast(c.faint, c.bg).toFixed(1)}`)
  }

  // Configurações → Aparência → Claro (device stays dark)
  await scheme('dark')
  await b.goto(BASE + '#/settings')
  await sleep(1200)
  r.check('Configurações tem "Aparência" com Automático, Claro e Escuro', await b.eval(`(() => { const g = document.querySelector('[role=radiogroup][aria-label="Tema"]'); return !!g && ['Automático', 'Claro', 'Escuro'].every((l) => g.textContent.includes(l)) })()`))
  await b.click('Claro', '[role=radiogroup][aria-label="Tema"] [role=radio]')
  await sleep(300)
  s = await state()
  r.check('escolher "Claro" muda na hora, mesmo com o aparelho escuro', s.theme === 'light' && s.bg === 'rgb(243, 244, 239)', JSON.stringify(s))
  await b.goto(BASE + 'favicon.svg')
  await b.goto(BASE + '#/')
  const first = await b.eval(`document.documentElement.dataset.theme`)
  await sleep(1000)
  r.check('ao reabrir, já começa claro (sem piscar o escuro)', first === 'light' && (await state()).theme === 'light')
  r.check('sem rolagem horizontal no claro', await noHorizontalScroll(b))

  // Escuro fixed while the device is light
  await scheme('light')
  await b.goto(BASE + '#/settings')
  await sleep(1000)
  await b.click('Escuro', '[role=radiogroup][aria-label="Tema"] [role=radio]')
  await sleep(300)
  r.check('escolher "Escuro" com o aparelho claro', (await state()).theme === 'dark')
  await b.click('Automático', '[role=radiogroup][aria-label="Tema"] [role=radio]')
  await sleep(300)
  r.check('voltar para "Automático" segue o aparelho de novo', (await state()).theme === 'light')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('theme-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
