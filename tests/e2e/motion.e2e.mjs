// Movimento (5 melhorias): transição de páginas e abas, micro-interações dos botões, card → detalhe
// (Projetos, Metas, Clientes), valores/indicadores/gráficos animados e seletores com indicador deslizante.
// Também: nada se move com "Reduzir movimento"; barras fixas não são levadas pela transição. Modo local.
//   E2E_SHOTS=<pasta> grava quadros no meio das animações.
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9411)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString()
const OUTER = '[role=dialog] > div:nth-child(2)'
/** Keyframe properties of the running animations of an element. */
const animProps = (sel) =>
  `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.getAnimations().map((a) => Object.keys((a.effect.getKeyframes?.() ?? [])[0] || {}).filter((k) => !['offset','easing','composite','computedOffset'].includes(k)).join('+') || a.animationName || a.transitionProperty || 'css') : null })()`
const clickText = (text, scope = 'main') => b.eval(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); el?.click(); return !!el })()`)

try {
  await b.mobile()
  await b.send('Page.enable')
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(
    b,
    {
      projects: [{ id: 'p1', name: 'Site Clínica Nova', kind: 'site', status: 'inProgress', clientId: null, startDate: '', dueDate: '', endDate: '', charged: 240000, received: 60000, currency: 'BRL', link: '', notes: '', payments: [] }],
      goals: [{ id: 'g1', name: 'Notebook novo', price: 400000, currency: 'BRL', note: '', purchasedAt: null }],
      clients: [{ id: 'c1', name: 'Ana Souza', company: 'Clínica Nova', status: 'active', email: '', phone: '', whatsapp: '', location: '', notes: '' }],
      transactions: [
        { id: 't1', type: 'out', amount: 4500, currency: 'BRL', baseAmount: -4500, reason: 'Mercado', category: null, createdAt: ago(0) },
        { id: 't2', type: 'out', amount: 12000, currency: 'BRL', baseAmount: -12000, reason: 'Farmácia', category: null, createdAt: ago(2) },
        { id: 't3', type: 'in', amount: 300000, currency: 'BRL', baseAmount: 300000, reason: 'Salário', category: null, createdAt: ago(20) },
      ],
    },
    { baseCurrency: 'BRL', displayCurrency: 'BRL', initialBalance: 100000, modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  // ---------- 1) Page transitions: content rises in; fixed bars are never carried along
  await b.goto(BASE + '#/projects')
  await sleep(1200)
  const page = await b.eval(`new Promise((res) => { location.hash = '/goals'; requestAnimationFrame(() => requestAnimationFrame(() => {
    const w = document.querySelector('.page-in'); const kids = w ? [...w.children] : []
    res({ wrapper: w ? w.getAnimations().map((a) => a.animationName) : null, rising: kids.filter((k) => k.getAnimations().some((a) => a.animationName === 'page-rise')).length, kids: kids.length })
  })) })`)
  r.check('página nova entra (fade + subida)', page.wrapper?.includes('page-fade') && page.rising > 0, JSON.stringify(page))
  await b.goto(BASE + '#/finance')
  await sleep(300)
  await b.eval(`location.hash = '/assistant'`)
  await sleep(60)
  const fixedBar = await b.eval(`(() => { const f = [...document.querySelectorAll('.page-in *')].find((el) => getComputedStyle(el).position === 'fixed'); if (!f) return 'sem barra'; let n = f; while (n && !n.classList?.contains('page-in')) { if (n.getAnimations().some((a) => a.animationName === 'page-rise')) return 'levada'; n = n.parentElement } return 'parada' })()`)
  r.check('barra fixa do Assistente não é levada pela transição', fixedBar !== 'levada', fixedBar)
  const rule = await b.eval(`(() => { const w = document.querySelector('.page-in'); const sel = ".page-in > :not(.fixed, [class~='fixed!'], :has(.fixed, [class~='fixed!']))"; const a = document.createElement('div'); a.innerHTML = '<div class="fixed!"></div>'; const c = document.createElement('div'); c.className = 'fixed'; const d = document.createElement('div'); w.append(a, c, d); const out = [a.matches(sel), c.matches(sel), d.matches(sel)]; a.remove(); c.remove(); d.remove(); return out })()`)
  r.check('regra: só sobe o que não é nem contém barra fixa', JSON.stringify(rule) === '[false,false,true]', JSON.stringify(rule))

  // ---------- 2) Buttons: spring release, deeper press on round icon buttons, icon nudge wrapper
  await b.goto(BASE + '#/finance')
  await sleep(900)
  const btn = await b.eval(`(() => { const p = document.querySelector('button.press'); const i = document.querySelector('button[class*="--press-scale"]'); const cs = getComputedStyle(p); return { tr: cs.transitionTimingFunction, dur: cs.transitionDuration, icon: i ? getComputedStyle(i).getPropertyValue('--press-scale').trim() : null } })()`)
  r.check('botões voltam com mola (cubic-bezier com overshoot)', /cubic-bezier\(0\.34, 1\.56/.test(btn.tr) && btn.dur.startsWith('0.42s'), JSON.stringify(btn))

  // ---------- 3) Card → detail: the sheet grows out of the tapped card (FLIP + clip-path, WAAPI) and returns to it
  for (const [route, sel, label] of [
    ['#/projects', 'main [data-expand]', 'Projetos'],
    ['#/goals', 'main [data-expand]', 'Metas'],
    ['#/clients', 'main [data-expand]', 'Clientes'],
  ]) {
    await b.goto(BASE + route)
    await sleep(1000)
    const open = await b.eval(`new Promise((res) => { document.querySelector(${JSON.stringify(sel)}).click(); requestAnimationFrame(() => res(${animProps(OUTER)})) })`)
    r.check(`${label}: detalhe abre a partir do card (transform + clip-path)`, Array.isArray(open) && open.some((k) => k.includes('clipPath') && k.includes('transform')), JSON.stringify(open))
    await sleep(200)
    const title = await b.eval(`(() => { const t = document.querySelector('[role=dialog] [data-sheet-title]'); return t ? t.getAnimations().map((a) => a.animationName) : null })()`)
    if (label === 'Projetos') await b.shot('motion-card-detalhe-meio')
    r.check(`${label}: título sobe pela máscara`, title?.includes('line-rise'), JSON.stringify(title))
    await sleep(700)
    const settled = await b.eval(`(() => { const o = document.querySelector(${JSON.stringify(OUTER)}); const cs = getComputedStyle(o); return { clip: cs.clipPath, tr: cs.transform, anims: o.getAnimations().length } })()`)
    r.check(`${label}: termina aberto e inteiro`, settled.anims === 0 && /inset\(0px( 0px){0,3}\)|none/.test(settled.clip) && /none|matrix\(1, 0, 0, 1, 0, 0\)/.test(settled.tr), JSON.stringify(settled))
    if (label === 'Projetos') {
      await b.shot('motion-card-detalhe-aberto')
      const icon = await b.eval(`getComputedStyle(document.querySelector('[role=dialog] button[aria-label=Fechar]')).getPropertyValue('--press-scale')`)
      r.check('botões redondos afundam mais (0.9)', parseFloat(icon) === 0.9, icon)
    }
    await b.eval(`document.querySelector('[role=dialog] button[aria-label=Fechar]').click()`)
    await sleep(120)
    const closing = await b.eval(`(() => { const o = document.querySelector(${JSON.stringify(OUTER)}); return o ? getComputedStyle(o).clipPath : 'fechado' })()`)
    r.check(`${label}: fecha voltando para o card`, closing === 'fechado' || /inset\(/.test(closing), closing)
    await sleep(600)
    r.check(`${label}: fechado`, !(await b.eval(`!!document.querySelector('[role=dialog]')`)))
  }
  // a sheet NOT opened from a card keeps its usual slide
  await b.goto(BASE + '#/finance')
  await sleep(900)
  const plain = await b.eval(`new Promise((res) => { [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Adicionar').click(); requestAnimationFrame(() => requestAnimationFrame(() => res(${animProps(OUTER)}))) })`)
  r.check('folha comum continua subindo de baixo (sem clip)', Array.isArray(plain) && plain.some((k) => k.includes('transform')) && !plain.some((k) => k.includes('clipPath')), JSON.stringify(plain))
  await b.eval(`document.querySelector('[role=dialog] button[aria-label=Fechar]').click()`)
  await sleep(600)

  // ---------- 4) Values, indicators, charts
  const bars = await b.eval(`[...document.querySelectorAll('.bar-grow')].map((x) => getComputedStyle(x).animationName + ':' + getComputedStyle(x).animationDelay).slice(0, 3)`)
  r.check('barras do gráfico crescem da base, uma após a outra', bars.length === 3 && bars[0].startsWith('bar-grow') && bars[1].endsWith('0.045s'), JSON.stringify(bars))
  const before = await b.eval(`document.querySelector('main .roll')?.textContent`)
  await b.eval(`[...document.querySelectorAll('[role=radiogroup][aria-label=Período] button')].find((x) => x.getAttribute('aria-checked') === 'false').click()`)
  await sleep(120)
  const rolling = await b.eval(`[...document.querySelectorAll('main .roll')].map((x) => x.children.length + ':' + [...x.children].map((c) => c.className).join(','))`)
  r.check('valor troca rolando (sai para cima, entra por baixo)', rolling.some((x) => x.includes('roll-out') && x.includes('roll-in')), JSON.stringify(rolling))
  await b.shot('motion-valor-rolando')
  await sleep(1000)
  const after = await b.eval(`[...document.querySelectorAll('main .roll')].every((x) => x.children.length === 1)`)
  r.check('depois sobra só o valor novo (sem texto duplicado)', after, before)
  const fill = await b.eval(`new Promise((res) => { location.hash = '/goals'; const t0 = performance.now(); const tick = () => { const f = document.querySelector('[role=progressbar] > div'); const a = f?.getAnimations().find((x) => x.transitionProperty === 'clip-path'); if (a) return res({ ms: Math.round(performance.now() - t0), mid: getComputedStyle(f).clipPath, end: f.style.clipPath }); if (performance.now() - t0 > 3000) return res(null); requestAnimationFrame(tick) }; tick() })`)
  r.check('barra de progresso preenche ao aparecer (transição de clip-path)', !!fill && fill.mid !== fill.end, JSON.stringify(fill))

  // ---------- 5) Selectors: chips with a sliding indicator; tabs slide content from the chosen side
  await b.goto(BASE + '#/projects')
  await sleep(900)
  const chip0 = await b.eval(`(() => { const s = document.querySelector('main [aria-pressed=true] > span.absolute'); return s ? Math.round(s.getBoundingClientRect().left) : null })()`)
  await clickText('Todos')
  await sleep(40)
  const chipMid = await b.eval(`(() => { const s = document.querySelectorAll('main [aria-pressed] > span.absolute'); const t = s[0]; return { count: s.length, left: t ? Math.round(t.getBoundingClientRect().left) : null, final: Math.round(document.querySelector('main [aria-pressed=true]').getBoundingClientRect().left) } })()`)
  r.check('chips: um indicador só, deslizando até o escolhido', chipMid.count === 1 && chip0 !== null && chipMid.left !== chipMid.final, JSON.stringify({ chip0, ...chipMid }))
  await b.shot('motion-chips-deslizando')
  await sleep(500)
  const chipEnd = await b.eval(`(() => { const s = document.querySelector('main [aria-pressed=true] > span.absolute'); return s ? Math.abs(Math.round(s.getBoundingClientRect().left) - Math.round(s.parentElement.getBoundingClientRect().left)) : null })()`)
  r.check('chips: indicador assenta no chip escolhido', chipEnd !== null && chipEnd <= 1, String(chipEnd))
  // the bars of the cards that reappear show their value right away (no refill from empty on a filter switch)
  await clickText('Pausados')
  await sleep(400)
  await clickText('Ativos')
  await sleep(120)
  const reBars = await b.eval(`[...document.querySelectorAll('main [role=progressbar] > div')].map((f) => ({ clip: getComputedStyle(f).clipPath, now: f.parentElement.getAttribute('aria-valuenow'), filling: f.getAnimations().some((a) => a.transitionProperty === 'clip-path') }))`)
  r.check('trocar filtro: barras que reaparecem já mostram o valor (não enchem do zero)', reBars.length > 0 && reBars.every((x) => !x.filling), JSON.stringify(reBars))
  await b.goto(BASE + '#/agenda')
  await sleep(900)
  await b.eval(`[...document.querySelectorAll('[role=radiogroup][aria-label=Visualização] button')].find((x) => x.textContent.trim() === 'Semana').click()`)
  await sleep(60)
  const swapFwd = await b.eval(`(() => { const s = document.querySelector('main .swap-in'); return s ? s.dataset.dir + ':' + s.getAnimations().map((a) => a.animationName) : null })()`)
  await sleep(500)
  await b.eval(`[...document.querySelectorAll('[role=radiogroup][aria-label=Visualização] button')].find((x) => x.textContent.trim() === 'Dia').click()`)
  await sleep(60)
  const swapBack = await b.eval(`document.querySelector('main .swap-in')?.dataset.dir`)
  r.check('abas: conteúdo entra pelo lado da opção (avançar → direita, voltar → esquerda)', swapFwd === 'fwd:swap-in' && swapBack === 'back', `${swapFwd} / ${swapBack}`)

  // ---------- Reduced motion: none of it moves
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await b.goto(BASE + '#/projects')
  await sleep(900)
  const rmPage = await b.eval(`new Promise((res) => { location.hash = '/goals'; requestAnimationFrame(() => requestAnimationFrame(() => res(document.querySelector('.page-in')?.getAnimations().length ?? -1))) })`)
  r.check('reduzir movimento: página sem animação', rmPage === 0, String(rmPage))
  await sleep(600)
  const rmBar = await b.eval(`document.querySelector('[role=progressbar] > div').style.clipPath`)
  r.check('reduzir movimento: barra já no valor', !rmBar.startsWith('inset(0px 100%') && !rmBar.startsWith('inset(0 100%'), rmBar)
  const rmOpen = await b.eval(`new Promise((res) => { document.querySelector('main [data-expand]').click(); requestAnimationFrame(() => res(${animProps(OUTER)})) })`)
  r.check('reduzir movimento: detalhe só aparece (sem crescer do card)', Array.isArray(rmOpen) && !rmOpen.some((k) => k.includes('clipPath') || k.includes('transform')), JSON.stringify(rmOpen))
} catch (e) {
  r.check('sem erro inesperado', false, e.stack)
} finally {
  b.close()
  const failed = r.print(b)
  process.exit(failed ? 1 : 0)
}
