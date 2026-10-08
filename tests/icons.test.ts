// One icon rule (Lucide line icons only):
//   size   14 inside text / metadata · 16 chips and small controls · 18 default (rows, buttons)
//          20 bars and back/close · 24 big actions (floating "+", Início actions, tab bar)
//   stroke 2 default · 2.4 action glyphs on a solid fill · 2.6 small check marks
// Hand-drawn animated check marks (TaskRow, CheckButton) keep their own 3.2 stroke.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SIZES = new Set([14, 16, 18, 20, 24])
const STROKES = new Set(['2', '2.4', '2.6'])
const SVG_CHECK_STROKE = '3.2'

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tsxFiles(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []))
}

const files = tsxFiles(join(__dirname, '..', 'src')).map((f) => ({ f, s: readFileSync(f, 'utf8') }))

describe('icon rule', () => {
  it('uses only Lucide for icons', () => {
    const others = files.filter(({ s }) => /from '(react-icons|@heroicons|@phosphor-icons|@tabler\/icons)/.test(s)).map(({ f }) => f)
    expect(others).toEqual([])
  })

  it('icon sizes stay on the scale 14/16/18/20/24', () => {
    const off = files.flatMap(({ f, s }) => [...s.matchAll(/size=\{(\d+)\}/g)].filter((m) => !SIZES.has(Number(m[1]))).map((m) => `${f}: ${m[0]}`))
    expect(off).toEqual([])
  })

  it('strokes stay on 2/2.4/2.6 (3.2 only in the hand-drawn check marks)', () => {
    const off = files.flatMap(({ f, s }) =>
      [...s.matchAll(/strokeWidth=\{([^}]+)\}/g)]
        .flatMap((m) => m[1].match(/\d+(\.\d+)?/g) ?? [])
        .filter((v) => !STROKES.has(v) && !(v === SVG_CHECK_STROKE && /<svg viewBox="0 0 24 24"[^>]*strokeWidth=\{3\.2\}/.test(s)))
        .map((v) => `${f}: ${v}`),
    )
    expect(off).toEqual([])
  })
})
