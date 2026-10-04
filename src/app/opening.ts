/**
 * Opening animation:
 *  1. the NÚCLEO logo, still (already painted by index.html, before any script);
 *  2. a rounded purple band rises from the bottom and expands until it covers the screen;
 *  3. the band keeps rising and leaves through the top, revealing the real app.
 *
 * The app loads underneath the whole time and is never changed: the intro is an
 * overlay that is removed at the end. It runs once per page load (switching
 * sections never reloads the page), never waits for or touches the account,
 * and if anything fails the overlay is simply removed.
 */

/** The still logo stays at least this long (ms since it was painted). */
const LOGO_MS = 700
const BAND_MS = 760
const EXIT_MS = 680
/** Never keep the app covered longer than this, whatever happens (ms). */
const SAFETY_MS = 8000
/** If the first screen takes longer than this, reveal anyway (ms since load). */
const READY_MAX = 4000
const BAND_BG = 'linear-gradient(160deg, #7565ff 0%, #5c50ff 50%, #4d41ed 100%)'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/** Resolves once #root shows something (Home, onboarding, sign-in…), or after READY_MAX. */
function firstScreen(root: HTMLElement | null): Promise<void> {
  return new Promise((resolve) => {
    if (!root) return resolve()
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
  if (!splash) return
  const root = document.getElementById('root')
  const shownAt = (window as Window & { __splashAt?: number }).__splashAt ?? 0
  let band: HTMLDivElement | null = null
  const finish = () => {
    splash.remove()
    band?.remove()
    clearTimeout(safety)
  }
  const safety = setTimeout(finish, SAFETY_MS)

  try {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reduced || typeof splash.animate !== 'function') {
      // Still logo for a moment, then a short fade straight into the app.
      await firstScreen(root)
      await wait(300 - (performance.now() - shownAt))
      if (typeof splash.animate === 'function') await splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: 'ease-out', fill: 'forwards' }).finished
      finish()
      return
    }

    // 1. Still logo.
    await wait(LOGO_MS - (performance.now() - shownAt))

    // 2. The rounded purple band rises from the bottom and expands to full screen.
    const w = window.innerWidth
    const h = window.innerHeight
    band = document.createElement('div')
    band.setAttribute('aria-hidden', 'true')
    Object.assign(band.style, { position: 'fixed', inset: '0', zIndex: '2147483001', background: BAND_BG, pointerEvents: 'none', clipPath: `inset(${h}px ${w * 0.22}px 0px ${w * 0.22}px round 40px)` })
    document.body.appendChild(band)
    await band.animate(
      [
        { clipPath: `inset(${h}px ${w * 0.22}px 0px ${w * 0.22}px round 40px)` },
        { clipPath: `inset(${h * 0.56}px ${w * 0.1}px ${h * 0.2}px ${w * 0.1}px round 40px)`, offset: 0.42 },
        { clipPath: 'inset(0px 0px 0px 0px round 0px)' },
      ],
      { duration: BAND_MS, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' },
    ).finished

    // Screen fully purple: the logo goes; the app has been loading underneath.
    splash.remove()
    await firstScreen(root)
    await nextFrame()

    // 3. The band keeps rising and leaves through the top, revealing the real app.
    await band.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px 0px 0px 0px)' }, { clipPath: `inset(0px 0px ${h}px 0px round 0px 0px 44px 44px)` }], {
      duration: EXIT_MS,
      easing: 'cubic-bezier(0.7, 0, 0.2, 1)',
      fill: 'forwards',
    }).finished
    finish()
  } catch {
    finish()
  }
}
