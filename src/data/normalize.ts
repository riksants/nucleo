import { isCurrencyCode } from '../lib/money'
import type { Entity, Settings } from './types'

/**
 * What comes from outside the app's own code (a backup file, another device through the sync, an
 * older or newer version of the app) is checked here before the screens use it. A malformed value
 * must never turn into a blank screen on every device of the account (audit A6).
 */

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  baseCurrency: 'BRL',
  initialBalance: 0,
  startedAt: '',
  rates: null,
  manualRates: {},
  lastBackupAt: null,
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isCode = (v: unknown): v is string => isStr(v) && isCurrencyCode(v)
const isTime = (v: unknown) => isStr(v) && /^\d{2}:\d{2}$/.test(v)

/** Currency → positive rate, dropping anything else. */
function rateTable(v: unknown): Record<string, number> | null {
  if (!isObj(v)) return null
  const out: Record<string, number> = {}
  for (const [k, x] of Object.entries(v)) if (isCode(k) && isNum(x) && x > 0) out[k] = x
  return out
}

function validZone(v: unknown): v is string {
  if (!isStr(v) || !v) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: v })
    return true
  } catch {
    return false
  }
}

/** Keeps only the entries of an object whose values pass `ok`. */
function entries(v: unknown, ok: (x: unknown) => boolean): Obj | undefined {
  if (!isObj(v)) return undefined
  return Object.fromEntries(Object.entries(v).filter(([, x]) => ok(x)))
}

/**
 * Settings with every field the app reads in the shape it expects. Wrong fields fall back to the
 * default (or are left out when optional). Fields this version doesn't know are kept as they are
 * (they may belong to a newer version on another device). The vault is kept whenever it is an object:
 * dropping it would lock the person out of their passwords; the vault code checks it before use.
 */
export function normalizeSettings(raw: unknown): Settings {
  const s: Obj = isObj(raw) ? raw : {}
  const out: Obj = { ...s }
  const set = (key: string, ok: boolean, value: unknown = s[key]) => {
    if (ok) out[key] = value
    else delete out[key]
  }

  out.onboarded = isBool(s.onboarded) ? s.onboarded : DEFAULT_SETTINGS.onboarded
  out.baseCurrency = isCode(s.baseCurrency) ? s.baseCurrency : DEFAULT_SETTINGS.baseCurrency
  out.initialBalance = isNum(s.initialBalance) ? Math.round(s.initialBalance) : DEFAULT_SETTINGS.initialBalance
  out.startedAt = isStr(s.startedAt) ? s.startedAt : DEFAULT_SETTINGS.startedAt
  out.manualRates = rateTable(s.manualRates) ?? {}
  out.lastBackupAt = isStr(s.lastBackupAt) ? s.lastBackupAt : null
  const rates = isObj(s.rates) ? s.rates : null
  const values = rates && rateTable(rates.values)
  out.rates = rates && values && Object.keys(values).length ? { values: { ...values, EUR: 1 }, fetchedAt: isStr(rates.fetchedAt) ? rates.fetchedAt : '', source: isStr(rates.source) ? rates.source : '' } : null

  set('displayCurrency', isCode(s.displayCurrency))
  set('currencies', Array.isArray(s.currencies), Array.isArray(s.currencies) ? s.currencies.filter(isCode) : undefined)
  set('modules', isObj(s.modules), entries(s.modules, isBool))
  set('modulesReviewed', isBool(s.modulesReviewed))
  set('vault', s.vault === null || isObj(s.vault))
  set('timeZone', validZone(s.timeZone))
  set('morningAutoOpen', isBool(s.morningAutoOpen))
  set('hideScore', isBool(s.hideScore))
  set('modulesSeen', Array.isArray(s.modulesSeen), Array.isArray(s.modulesSeen) ? s.modulesSeen.filter(isStr) : undefined)
  set('tabs', Array.isArray(s.tabs), Array.isArray(s.tabs) ? s.tabs.filter(isStr) : undefined)
  const mark = (x: unknown) => isObj(x) && isStr(x.s) && isStr(x.at)
  set('insightState', isObj(s.insightState), entries(s.insightState, mark))
  set('ruleSuggestions', isObj(s.ruleSuggestions), entries(s.ruleSuggestions, mark))
  set('activeHours', isObj(s.activeHours) && isTime(s.activeHours.start) && isTime(s.activeHours.end))
  set('assistantAi', isObj(s.assistantAi) && isBool(s.assistantAi.enabled) && (s.assistantAi.consentAt === null || isStr(s.assistantAi.consentAt)))
  set('mealTypes', Array.isArray(s.mealTypes), Array.isArray(s.mealTypes) ? s.mealTypes.filter((m) => isObj(m) && isStr(m.id) && isStr(m.label) && isBool(m.active)) : undefined)
  const fc = isObj(s.financeCategories) ? s.financeCategories : null
  set(
    'financeCategories',
    Boolean(fc),
    fc && {
      ...fc,
      custom: Array.isArray(fc.custom) ? fc.custom.filter((c) => isObj(c) && isStr(c.id) && isStr(c.label) && (c.type === 'in' || c.type === 'out')) : [],
      hidden: Array.isArray(fc.hidden) ? fc.hidden.filter(isStr) : [],
    },
  )
  set('automations', isObj(s.automations), entries(s.automations, (x) => isObj(x) && isBool(x.on) && isStr(x.since)))
  set('importTemplates', Array.isArray(s.importTemplates), Array.isArray(s.importTemplates) ? s.importTemplates.filter((t) => isObj(t) && isStr(t.id) && isStr(t.name) && isObj(t.columns)) : undefined)
  const rem = isObj(s.reminders) ? s.reminders : null
  const isWhen = (w: unknown) => w === 'before' || w === 'at' || w === 'both'
  set('reminders', Boolean(rem), rem && {
    showDetails: rem.showDetails === true,
    rules: entries(rem.rules, (r) => isObj(r) && isBool(r.enabled)) ?? {},
    ...(isObj(rem.quiet) && isTime(rem.quiet.from) && isTime(rem.quiet.to) ? { quiet: { from: rem.quiet.from as string, to: rem.quiet.to as string } } : {}),
    ...(rem.quiet === null ? { quiet: null } : {}),
    ...(isBool(rem.on) ? { on: rem.on } : {}),
    ...(isWhen(rem.when) ? { when: rem.when } : {}),
    ...(isBool(rem.followUp) ? { followUp: rem.followUp } : {}),
    ...(isObj(rem.kinds) ? { kinds: entries(rem.kinds, isObj) ?? {} } : {}),
  })
  set('updatedAt', isStr(s.updatedAt))
  return out as unknown as Settings
}

/**
 * A record from the server can be stored only when it is an object with the same id (the device
 * database is keyed by id). Anything else is skipped instead of breaking the whole download.
 */
export function isStorableEntity(data: unknown, id: string): data is Entity {
  return isObj(data) && isStr(data.id) && data.id === id
}
