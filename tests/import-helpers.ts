import { analyze, type Analysis, type ImportSource } from '../src/core/import/analyze'
import { csvLines, readFile } from '../src/core/import/read'
import { planImport, type Decision, type ImportPlan } from '../src/core/import/plan'
import type { ParsedLine } from '../src/core/import/types'
import { planRulesForWrite } from '../src/core/rules/engine'
import { applyOps } from '../src/core/rules/work'
import type { DataState, ImportTemplate } from '../src/data/types'
import { ctx as ruleCtx, data as makeData } from './rules-helpers'

export const enc = (s: string) => new TextEncoder().encode(s)

/** Lines of a CSV/OFX text, with the Núcleo's own guess (or a saved model). */
export function linesOf(text: string, name = 'extrato.csv', templates?: ImportTemplate[]): ParsedLine[] {
  const r = readFile(enc(text), name, templates)
  if (r.kind === 'error') throw new Error(r.message)
  if (r.kind === 'ofx') return r.lines
  const out = csvLines(r.sheet, r.mapping)
  if (out.problems.length) throw new Error(out.problems.join(' '))
  return out.lines
}

export const source = (over: Partial<ImportSource> = {}): ImportSource => ({ account: 'Sabadell', currency: 'EUR', ...over })

export function analyzeText(text: string, data: DataState = makeData(), over: Partial<ImportSource> = {}, name = 'extrato.csv'): Analysis {
  const c = ruleCtx()
  return analyze(linesOf(text, name), source(over), data, c)
}

/** Imports like the screen does: plan + the rules of the same write, applied to the data. */
export function importInto(data: DataState, analysis: Analysis, decisions = new Map<number, Decision>(), id = 'import-1', file = 'extrato.csv'): { data: DataState; plan: ImportPlan; ops: ReturnType<typeof planRulesForWrite> } {
  const c = ruleCtx()
  const plan = planImport(analysis, decisions, { importId: id, file, format: file.endsWith('.ofx') ? 'ofx' : 'csv', account: 'Sabadell' }, data, c)
  if (typeof plan === 'string') throw new Error(plan)
  const extra = planRulesForWrite(data, plan.ops, 'person', c, plan.rules)
  return { data: applyOps(data, [...plan.ops, ...extra]), plan, ops: extra }
}
