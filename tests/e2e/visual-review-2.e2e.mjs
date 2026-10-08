// Revisão visual (itens 7–9): prioridade dita em palavras (não só pela cor); Configurações com ícones coloridos
// por grupo e valores longos embaixo do rótulo (nada espremido); tema escuro com profundidade clara
// (fundo < cartão < folha) e borda de luz no topo dos cartões. Modo local.
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9522)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const T = (id, title, priority) => ({ id, title, projectId: null, dueDate: '', priority, status: 'todo', completedAt: null })

/** WCAG contrast of two "rgb(r, g, b)" strings. */
function contrast(a, c) {
  const lum = (s) => {
    const [r, g, bl] = s.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => Number(v) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(c)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

try {
  await b.mobile()
  await seedExistingUser(
    b,
    { tasks: [T('t1', 'Urgente', 'high'), T('t2', 'Normal', 'medium'), T('t3', 'Tranquila', 'low'), T('t4', 'Sem prioridade', 'none')] },
    { baseCurrency: 'EUR', timeZone: 'Europe/Madrid', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('nucleo:theme', '"dark"'); document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  // ---------- 7) Priority in words
  await b.goto(BASE + '#/tasks')
  await sleep(1300)
  const rows = await b.eval(`(() => Object.fromEntries(['Urgente', 'Normal', 'Tranquila', 'Sem prioridade'].map((t) => {
    const row = [...document.querySelectorAll('main button')].find((x) => x.querySelector('span')?.textContent.startsWith(t))
    const p = row?.querySelector('[data-priority]')
    return [t, p ? { text: p.textContent.trim(), flag: !!p.querySelector('svg'), color: getComputedStyle(p).color } : null]
  })))()`)
  r.check('Alta: escrito "Alta" com bandeira', rows.Urgente?.text === 'Prioridade Alta' && rows.Urgente.flag, JSON.stringify(rows.Urgente))
  r.check('Média e Baixa também escritas', rows.Normal?.text === 'Prioridade Média' && rows.Tranquila?.text === 'Prioridade Baixa', JSON.stringify([rows.Normal, rows.Tranquila]))
  r.check('sem prioridade: nada aparece', rows['Sem prioridade'] === null)
  r.check('a palavra "Prioridade" é só para leitor de tela (visível: só "Alta")', await b.eval(`(() => { const s = document.querySelector('[data-priority] .sr-only'); return !!s && s.getBoundingClientRect().width <= 1 })()`))
  r.check('nenhuma bolinha colorida sozinha indicando prioridade', await b.eval(`![...document.querySelectorAll('main span.size-2.rounded-full')].length`))

  // ---------- 9) Dark depth
  const depth = await b.eval(`(() => {
    const card = document.querySelector('main .card') || (() => { const el = document.createElement('div'); el.className = 'card'; document.querySelector('main').appendChild(el); return el })()
    const cs = getComputedStyle(card)
    const probe = (cls) => { const el = document.createElement('span'); el.className = cls; document.body.appendChild(el); const c = getComputedStyle(el); const v = { bg: c.backgroundColor, color: c.color }; el.remove(); return v }
    return { theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, card: cs.backgroundColor, shadow: cs.boxShadow, faint: probe('text-faint').color, soft: probe('text-soft').color, sheet: probe('bg-sheet').bg }
  })()`)
  r.check('tema escuro ativo', depth.theme === 'dark', depth.theme)
  r.check('cartão se destaca do fundo (contraste ≥ 1.15; antes 1.06)', contrast(depth.card, depth.bg) >= 1.15, contrast(depth.card, depth.bg).toFixed(2))
  r.check('folha (sheet) mais clara que o cartão', contrast(depth.sheet, depth.bg) > contrast(depth.card, depth.bg), JSON.stringify(depth))
  r.check('cartão tem borda de luz no topo', /inset/.test(depth.shadow), depth.shadow)
  r.check('texto fraco/secundário seguem AA em cartões e folhas', [depth.card, depth.sheet].every((s) => contrast(depth.faint, s) >= 4.5 && contrast(depth.soft, s) >= 4.5), [depth.card, depth.sheet].map((s) => contrast(depth.faint, s).toFixed(2)).join(' / '))

  // ---------- 8) Settings
  await b.goto(BASE + '#/settings')
  await sleep(1200)
  const tiles = await b.eval(`(() => [...document.querySelectorAll('main [data-tile]')].map((t) => ({ tone: t.dataset.tile, bg: getComputedStyle(t).backgroundColor, icon: getComputedStyle(t).color })))()`)
  const tones = new Set(tiles.map((t) => t.bg))
  r.check('ícones com cor por grupo (≥ 5 cores diferentes)', tones.size >= 5, [...tones].join(' '))
  r.check('glifo branco com contraste ≥ 3:1 em todos os ícones', tiles.every((t) => t.icon === 'rgb(255, 255, 255)' && contrast(t.icon, t.bg) >= 3), JSON.stringify(tiles.filter((t) => contrast(t.icon, t.bg) < 3)))
  const lineOf = (label) => b.eval(`(() => { const el = [...document.querySelectorAll('main span')].find((x) => x.textContent.trim() === ${JSON.stringify(label)} && !x.children.length); if (!el) return null; const r = el.getBoundingClientRect(); return { h: Math.round(r.height), bottom: r.bottom, lh: parseFloat(getComputedStyle(el).lineHeight) || 22 } })()`)
  const nav = await lineOf('Barra de navegação')
  r.check('"Barra de navegação" numa linha só', nav && nav.h <= nav.lh + 2, JSON.stringify(nav))
  r.check('as abas aparecem inteiras embaixo (sem reticências)', await b.eval(`(() => { const el = [...document.querySelectorAll('main span')].find((x) => x.textContent.trim() === 'Barra de navegação'); const d = el.nextElementSibling; return !!d && d.textContent.includes('·') && d.scrollWidth <= d.clientWidth && getComputedStyle(d).textOverflow !== 'ellipsis' })()`))
  const hours = await lineOf('Horários para sugestões')
  const inputs = await b.eval(`[...document.querySelectorAll('main input[type=time]')].map((i) => { const r = i.getBoundingClientRect(); return { top: r.top, h: Math.round(r.height), w: Math.round(r.width) } })`)
  r.check('"Horários para sugestões" numa linha só', hours && hours.h <= hours.lh + 2, JSON.stringify(hours))
  r.check('horários na linha de baixo, com 44 pt de toque', inputs.length === 2 && inputs.every((i) => i.top >= hours.bottom && i.h >= 44 && i.w >= 100), JSON.stringify(inputs))
  r.check('nenhum rótulo de Configurações quebra em 3 linhas', await b.eval(`![...document.querySelectorAll('main .card span.text-\\\\[15px\\\\]')].some((x) => x.getBoundingClientRect().height > 50)`))
  r.check('sem rolagem horizontal', await b.eval(`document.documentElement.scrollWidth <= innerWidth`))

  await b.click('Moeda principal', 'button')
  await sleep(700)
  const sheet = await b.eval(`(() => { const s = document.querySelector('[role=dialog] .bg-sheet'); return s ? getComputedStyle(s).backgroundColor : null })()`)
  r.check('folha aberta usa a camada mais clara', sheet === depth.sheet, sheet)
  await b.shot('visual-review-2-settings')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('visual-review-2-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
