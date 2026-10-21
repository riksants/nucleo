import { useCallback, useRef } from 'react'
import type { Analysis } from '../../core/import/analyze'
import { planImport, type Decision, type ImportMeta } from '../../core/import/plan'
import { undoImport, type UndoImportResult } from '../../core/import/undo'
import { todayIn, zoneOf } from '../../core/period'
import { newId, useStore } from '../../data/store'
import type { AutomationRun, ImportTemplate } from '../../data/types'

/** Signed in, an undo waits for the sync to be idle with nothing queued (another device may still be sending movements). */
export const UNDO_NOT_SYNCED = 'Espere a sincronização terminar (e a conexão voltar) para desfazer: outro aparelho pode ainda estar enviando movimentações desta importação.'

export function useImportActions() {
  const { data, settings, convert, commit, updateSettings, syncStatus, retryLoad } = useStore()
  const busy = useRef(false)

  /** Writes the confirmed preview in one go. Returns the import run, or a message. */
  const importNow = useCallback(
    async (analysis: Analysis, decisions: Map<number, Decision>, meta: Omit<ImportMeta, 'importId'>): Promise<AutomationRun | string> => {
      if (busy.current) return 'A importação já está sendo gravada.'
      busy.current = true
      try {
        const now = new Date()
        const ctx = { settings, today: todayIn(zoneOf(settings), now), convert, now }
        const plan = planImport(analysis, decisions, { ...meta, importId: `import-${newId()}` }, data, ctx)
        if (typeof plan === 'string') return plan
        try {
          await commit(plan.ops, { by: 'person', rules: plan.rules })
        } catch (err) {
          console.error('Importação: falha ao gravar', err)
          // Nothing was saved on the device (one transaction): the screen goes back to what is stored.
          retryLoad()
          return 'Não consegui gravar a importação. Nada foi importado — tente de novo.'
        }
        return plan.run
      } finally {
        busy.current = false
      }
    },
    [data, settings, convert, commit, retryLoad],
  )

  const undo = useCallback(
    async (run: AutomationRun): Promise<UndoImportResult | string> => {
      const syncSafe = !syncStatus || (syncStatus.state === 'idle' && syncStatus.pending === 0 && navigator.onLine !== false)
      if (!syncSafe) return UNDO_NOT_SYNCED
      const r = undoImport(run, data, todayIn(zoneOf(settings)))
      if (!r) return 'Esta importação já foi desfeita.'
      await commit(r.ops, { by: 'undo' })
      return r
    },
    [data, settings, commit, syncStatus],
  )

  /** A model with the same header replaces the older one. */
  const saveTemplate = useCallback(
    (t: ImportTemplate) => updateSettings({ importTemplates: [...(settings.importTemplates ?? []).filter((x) => x.signature !== t.signature && x.id !== t.id), t] }),
    [settings.importTemplates, updateSettings],
  )
  const removeTemplate = useCallback((id: string) => updateSettings({ importTemplates: (settings.importTemplates ?? []).filter((x) => x.id !== id) }), [settings.importTemplates, updateSettings])

  return { importNow, undo, saveTemplate, removeTemplate }
}
