import { COLLECTION_NAMES, type DataState, type Settings } from '../src/data/types'
import type { AutomationCtx } from '../src/core/automation/types'
import { makeConverter } from '../src/lib/rates'

export const emptyData = (): DataState => Object.fromEntries(COLLECTION_NAMES.map((n) => [n, []])) as unknown as DataState

export const baseSettings: Settings = {
  onboarded: true, baseCurrency: 'EUR', initialBalance: 0, startedAt: '2026-01-01T00:00:00.000Z',
  rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'Europe/Madrid',
}

export function makeCtx(data: Partial<DataState>, today: string, over: Partial<AutomationCtx> = {}): AutomationCtx {
  return {
    data: { ...emptyData(), ...data },
    settings: baseSettings,
    today,
    convert: makeConverter({ EUR: 1, BRL: 6, AED: 4 }),
    now: new Date(`${today}T10:00:00.000Z`),
    ...over,
  }
}

export const T = '2026-01-01T00:00:00.000Z'
