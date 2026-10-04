/**
 * Opening animation. The splash (logo on the app background) is plain HTML in
 * index.html, so it shows before any script runs. Here, once the first screen
 * has rendered behind it, the app itself rises from the bottom as a rounded
 * panel and expands to full screen — a continuous reveal, not a screen swap.
 *
 * Nothing in the app is replaced: #root only gets temporary styles (a clip and
 * a background) that are removed as soon as the animation ends.
 */

/** The logo gets at least this long on screen (ms since the splash appeared). */
const LOGO_MIN = 560
/** If the first screen takes longer than this, reveal anyway (never block the app). */
const READY_MAX = 4000
const RISE = 780
const RISE_EASE = 'cubic-bezier(0.7, 0, 0.2, 1)'
const CORNER = 32

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))

/** Resolves once #root shows something (Home, onboarding, sign-in…), or after READY_MAX. */
function firstScreen(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const visible = () => [...root.children].some((c) => c.getBoundingClientRect().height > 0)
    if (visible()) return resolve()
    const done = () => {
      observer.disconnect()
      clearTimeout(timer)
      resolve()
    }
    const observer = new MutationObserver(() => visible() && done())
    observer.observe(root, { childList: true, subtree: true })
    const timer = setTimeout(done, READY_MAX - performance.now())
  })
}

export async function playOpening() {
  const splash = document.getElementById('splash')
  const root = document.getElementById('root')
  if (!splash || !root) return
  const logo = splash.querySelector('img')
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const canAnimate = typeof root.animate === 'function'

  // Root above the splash, opaque, and hidden until it rises.
  const h = window.innerHeight
  Object.assign(root.style, { position: 'relative', zIndex: '1', background: 'var(--color-bg)', minHeight: '100dvh' })
  if (!reduced && canAnimate) root.style.clipPath = `inset(${h}px 0 0 0 round ${CORNER}px ${CORNER}px 0 0)`
  else root.style.opacity = '0'

  let edge: HTMLDivElement | null = null
  const running: Animation[] = []
  // Leaves #root exactly as it was: temporary styles and finished animations removed.
  const cleanup = () => {
    for (const a of running) a.cancel()
    splash.remove()
    edge?.remove()
    for (const prop of ['position', 'zIndex', 'background', 'minHeight', 'clipPath', 'opacity'] as const) root.style[prop] = ''
  }

  await firstScreen(root)
  // Two frames so the first screen is painted (and laid out) before it is revealed.
  await nextFrame()
  await nextFrame()
  // Time the logo has been on screen (index.html marks when the splash was painted).
  const shownAt = (window as Window & { __splashAt?: number }).__splashAt ?? 0
  await wait(LOGO_MIN - (performance.now() - shownAt))

  if (reduced || !canAnimate) {
    // Simple, motion-free reveal.
    if (canAnimate) {
      running.push(root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out', fill: 'forwards' }))
      running.push(splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' }))
    }
    setTimeout(cleanup, canAnimate ? 240 : 0)
    return
  }

  // A thin rounded edge with a soft accent glow marks the top of the rising panel.
  edge = document.createElement('div')
  edge.setAttribute('aria-hidden', 'true')
  Object.assign(edge.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    top: '0',
    height: `${h}px`,
    zIndex: '2',
    pointerEvents: 'none',
    borderTop: '1px solid rgb(255 255 255 / 0.10)',
    borderRadius: `${CORNER}px ${CORNER}px 0 0`,
    boxShadow: '0 -18px 60px -14px rgb(91 108 255 / 0.32)',
    transform: `translateY(${h}px)`,
  })
  document.body.appendChild(edge)

  const timing = { duration: RISE, easing: RISE_EASE, fill: 'forwards' as const }
  const reveal = root.animate(
    [{ clipPath: `inset(${h}px 0 0 0 round ${CORNER}px ${CORNER}px 0 0)` }, { clipPath: `inset(0px 0 0 0 round ${CORNER}px ${CORNER}px 0 0)`, offset: 0.85 }, { clipPath: 'inset(0px 0 0 0 round 0px 0px 0 0)' }],
    timing,
  )
  running.push(reveal)
  running.push(edge.animate(
    [
      { transform: `translateY(${h}px)`, opacity: 1 },
      { transform: 'translateY(0px)', opacity: 1, offset: 0.85 },
      { transform: 'translateY(0px)', opacity: 0 },
    ],
    timing,
  ))
  // The logo steps back as the panel passes it.
  if (logo) {
    logo.style.animation = 'none'
    logo.animate([{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(-5vh) scale(0.9)' }], { duration: RISE * 0.6, easing: 'cubic-bezier(0.4, 0, 1, 1)', delay: RISE * 0.12, fill: 'forwards' })
  }
  // Clean up even if the animation never reports back (e.g. the tab is hidden).
  const fallback = setTimeout(cleanup, RISE + 400)
  reveal.finished.then(
    () => {
      clearTimeout(fallback)
      cleanup()
    },
    () => {},
  )
}
