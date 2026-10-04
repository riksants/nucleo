/**
 * Opening animation. The motion itself is CSS in index.html (it starts on the
 * first frame, before any script, and stays smooth while the app loads):
 *   still logo → a narrow purple capsule rises, its head carrying a mini logo →
 *   it widens to the whole screen.
 * Here we only decide when to leave: once the screen is fully purple AND the app
 * has rendered underneath, the purple slides up and away, revealing the real app.
 *
 * The app is never changed or blocked: the intro is an overlay that is removed
 * at the end, it runs once per page load (switching sections never reloads the
 * page), it never waits for or touches the account, a tap skips it, and CSS
 * removes it by itself after 8 s if this script never runs.
 */

/** Still logo + rise/hold/widen (must match index.html). */
const SEQUENCE_END_MS = 1040 + 1060
/** The full-screen purple stays at least this long before leaving. */
const PURPLE_HOLD_MS = 120
/** If the first screen takes longer than this, reveal anyway (ms since load). */
const READY_MAX = 4000

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

/** Resolves when the named CSS animation ends on `el` (or after `fallbackMs`, whichever comes first). */
function animationEnd(el: Element | null, name: string, fallbackMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, fallbackMs))
    el?.addEventListener('animationend', (e) => {
      if ((e as AnimationEvent).animationName !== name) return
      clearTimeout(timer)
      resolve()
    })
  })
}

export async function playOpening() {
  const splash = document.getElementById('splash')
  if (!splash) return
  const root = document.getElementById('root')
  const shownAt = (window as Window & { __splashAt?: number }).__splashAt ?? 0
  const sinceShown = () => performance.now() - shownAt
  let finished = false
  const finish = () => {
    finished = true
    splash.remove()
  }
  /** Short fade straight into the app (reduced motion, or a tap to skip). */
  const fadeOut = async () => {
    if (typeof splash.animate === 'function') await splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease', fill: 'forwards' }).finished
    finish()
  }

  try {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reduced) {
      await firstScreen(root)
      await wait(300 - sinceShown())
      await fadeOut()
      return
    }

    // A tap skips the rest (as soon as there is an app to show).
    let skipped = false
    splash.addEventListener(
      'pointerdown',
      () => {
        skipped = true
        void firstScreen(root).then(() => {
          if (!finished) void fadeOut()
        })
      },
      { once: true },
    )

    await Promise.all([animationEnd(splash.querySelector('.nl-sheet'), 'nl-rise', SEQUENCE_END_MS + 300 - sinceShown()), firstScreen(root)])
    if (skipped) return
    await wait(PURPLE_HOLD_MS)
    await nextFrame()
    if (skipped) return

    // The purple slides up and away (CSS: .nl-leave), revealing the real app.
    const leaving = animationEnd(splash.querySelector('.nl-sheet'), 'nl-out', 900)
    splash.classList.add('nl-leave')
    await leaving
    if (!finished) finish()
  } catch {
    finish()
  }
}
