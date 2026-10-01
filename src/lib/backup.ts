import { COLLECTION_NAMES, type DataState, type Settings } from '../data/types'
import { isCurrencyCode } from './money'

const APP_ID = 'nucleo'
const FORMAT_VERSION = 1

interface BackupFile {
  app: typeof APP_ID
  version: number
  exportedAt: string
  settings: Settings
  data: DataState
}

export interface ParsedBackup {
  exportedAt: string
  settings: Settings | null
  data: Partial<DataState>
  counts: Record<string, number>
  total: number
}

/**
 * Backup file. Passwords never go out in plain text: vault-sealed passwords stay
 * encrypted (the vault's wrapped key travels with the settings, so the same
 * vault password opens them after restoring) and legacy plain-text ones are left out.
 */
export function buildBackup(data: DataState, settings: Settings): { blob: Blob; omittedPasswords: number } {
  let omittedPasswords = 0
  const accounts = data.accounts.map((a) => {
    if (!a.password) return a
    omittedPasswords++
    return { ...a, password: '' }
  })
  const file: BackupFile = { app: APP_ID, version: FORMAT_VERSION, exportedAt: new Date().toISOString(), settings, data: { ...data, accounts } }
  return { blob: new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }), omittedPasswords }
}

export function backupFileName(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `nucleo-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Validates a backup file's shape. Throws an Error with a readable message when invalid. */
export function parseBackup(text: string): ParsedBackup {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('O arquivo não é um JSON válido.')
  }
  if (!isRecord(json) || json.app !== APP_ID) throw new Error('Este arquivo não é um backup do Núcleo.')
  if (typeof json.version !== 'number' || json.version > FORMAT_VERSION) throw new Error('Backup de uma versão mais nova do app.')
  if (!isRecord(json.data)) throw new Error('Backup sem dados.')

  const data: Partial<DataState> = {}
  const counts: Record<string, number> = {}
  let total = 0
  for (const name of COLLECTION_NAMES) {
    const list = json.data[name]
    if (list === undefined) continue
    if (!Array.isArray(list) || !list.every((x) => isRecord(x) && typeof x.id === 'string' && typeof x.createdAt === 'string')) {
      throw new Error(`Dados inválidos em "${name}".`)
    }
    ;(data as Record<string, unknown>)[name] = list
    counts[name] = list.length
    total += list.length
  }

  let settings: Settings | null = null
  if (isRecord(json.settings)) {
    const s = json.settings as unknown as Settings
    if (typeof s.baseCurrency === 'string' && isCurrencyCode(s.baseCurrency) && typeof s.initialBalance === 'number') settings = s
  }

  return { exportedAt: typeof json.exportedAt === 'string' ? json.exportedAt : '', settings, data, counts, total }
}

/** Saves the file: share sheet on phones (lets iOS "Save to Files"), download elsewhere. */
export async function saveFile(blob: Blob, name: string): Promise<boolean> {
  const file = new File([blob], name, { type: blob.type })
  const touch = window.matchMedia('(pointer: coarse)').matches
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return true
    } catch (err) {
      if ((err as Error).name === 'AbortError') return false
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return true
}
