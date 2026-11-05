/**
 * How values read in an answer (presentation only — the guard and the facts do not change).
 * "qua, 30/06/2027" → "30 de junho de 2027"; "seg, 30/11" → "segunda, 30 de novembro"; a commitment
 * "qua, 05/11 · 10:00 · Reunião" keeps its time and title after the friendlier date.
 */
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const WEEKDAYS: Record<string, string> = { dom: 'domingo', seg: 'segunda', ter: 'terça', qua: 'quarta', qui: 'quinta', sex: 'sexta', 'sáb': 'sábado' }

export function naturalDate(display: string): string {
  return display.replace(/^(?:(dom|seg|ter|qua|qui|sex|sáb),\s*)?(\d{2})\/(\d{2})(?:\/(\d{4}))?/, (all, wd: string | undefined, d: string, m: string, y: string | undefined) => {
    const month = MONTHS[Number(m) - 1]
    if (!month) return all
    const day = `${Number(d)} de ${month}`
    if (y) return `${day} de ${y}`
    return wd ? `${WEEKDAYS[wd]}, ${day}` : day
  })
}

/** Paragraphs that are warnings, shown apart from the main answer. */
export const NOTE_START = /^\s*(?:[-•]\s*)?(aten[cç][aã]o|limita[cç][aã]o|aviso|importante|observa[cç][aã]o)\s*:/i
