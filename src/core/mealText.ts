/**
 * Refeições a partir de texto (colado agora; um PDF de dieta na Importação da Etapa 4 vai produzir o mesmo
 * rascunho). One meal per line, in the person's words:
 *   "07:00 Café da manhã: pão integral, 2 ovos, café"
 *   "Almoço 12h30 - arroz, feijão, 150 g de frango"
 *   "Segunda" (a heading: the next lines go to that day of the week)
 * Only what is written is used: no nutrition data, no amounts invented. Nothing is saved here: the screen shows
 * the drafts and creates the meals only after the person confirms.
 */
import type { MealType, WeekId } from '../data/types'
import { addDaysToDate } from './period'

/** What an importer (text now, PDF later) proposes for one meal. */
export interface MealDraft {
  date: string
  time: string
  /** Meal type id ('' = none recognised). */
  type: string
  name: string
  ingredients: string[]
  /** The line it came from, shown in the preview. */
  source: string
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

const WEEKDAY: Record<string, number> = { segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, domingo: 0 }

/** Default type words (custom types match by their own name). */
const TYPE_WORDS: [string, RegExp][] = [
  ['breakfast', /\b(cafe da manha|desjejum|cafe)\b/],
  ['morningSnack', /\b(lanche da manha|colacao)\b/],
  ['lunch', /\b(almoco)\b/],
  ['afternoonSnack', /\b(lanche da tarde|lanche)\b/],
  ['dinner', /\b(jantar|janta)\b/],
  ['supper', /\b(ceia)\b/],
]

const TIME = /\b([01]?\d|2[0-3])(?:[:h]([0-5]\d)|h)(?=\b|\s|$)/

function typeOf(label: string, types: MealType[]): string {
  const t = fold(label)
  const custom = types.find((x) => x.id.startsWith('c-') && fold(x.label) && t.startsWith(fold(x.label)))
  if (custom) return custom.id
  return TYPE_WORDS.find(([, re]) => re.test(t))?.[0] ?? ''
}

/** "pão, 2 ovos e café" → ["pão", "2 ovos", "café"] (amounts kept as written). */
export function splitFoods(text: string): string[] {
  return text
    .split(/\s*(?:,|;|\+|\s+e\s+|\n)\s*/i)
    .map((x) => x.replace(/^[-•*]\s*/, '').trim())
    .filter((x) => x.length > 0 && x.length <= 120)
}

/**
 * Lines → meal drafts on real dates. `date`: the day the lines go to; a weekday heading switches to that day of
 * `week` (Monday id). Lines that say nothing recognisable still become a meal with that text as its name.
 */
export function parseMealText(text: string, opts: { date: string; week: WeekId; types: MealType[] }): MealDraft[] {
  const out: MealDraft[] = []
  let date = opts.date
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const f = fold(line).replace(/[:\-–]+$/, '').trim()
    const heading = f.match(/^(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira)?$/)
    if (heading) {
      const wd = WEEKDAY[heading[1]]
      date = addDaysToDate(opts.week, (wd + 6) % 7)
      continue
    }
    let rest = line
    let time = ''
    const tm = rest.match(TIME)
    if (tm) {
      time = `${tm[1].padStart(2, '0')}:${tm[2] ?? '00'}`
      rest = rest.replace(tm[0], ' ')
    }
    // "Almoço: arroz, feijão" / "Almoço - arroz" → label + foods; without a separator the line is the name.
    const sep = rest.match(/^\s*([^:\-–]{1,40}?)\s*[:\-–]\s*(.+)$/)
    const label = (sep ? sep[1] : rest).replace(/\s+/g, ' ').trim()
    const foods = sep ? splitFoods(sep[2]) : []
    const type = typeOf(label, opts.types)
    const typeLabel = opts.types.find((t) => t.id === type)?.label ?? ''
    // A label that is only the type ("Almoço") is not repeated as the name.
    const name = type && fold(label) === fold(typeLabel) ? '' : sep ? (type ? '' : label) : label
    out.push({ date, time, type, name: name.slice(0, 120), ingredients: foods, source: line })
  }
  return out
}
