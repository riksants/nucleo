import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { normalizeSettings } from '../data/normalize'
import { useStore } from '../data/store'
import type { Settings } from '../data/types'
import { backupFileName, buildBackup, saveFile } from '../lib/backup'
import { isChunkError, logError } from '../lib/errorLog'

const RELOAD_KEY = 'nucleo:chunkReloadAt'

/**
 * A new version was published while the app was open and a section's old code is gone: one reload
 * gets the new version. Never twice in a row (a real problem would reload forever).
 */
function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < 30_000) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    return false
  }
  location.reload()
  return true
}

interface Props {
  children: ReactNode
  /** What to show instead of a blank screen. */
  fallback(error: Error, retry: () => void): ReactNode
}

/** No error in a screen may leave the whole app blank (audit A6/A8). */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError('tela', error)
    console.error('Erro na tela', error, info.componentStack)
    if (isChunkError(error)) reloadForNewVersion()
  }

  render() {
    if (!this.state.error) return this.props.children
    if (isChunkError(this.state.error)) {
      return <Screen title="Atualizando o NÚCLEO" text="Saiu uma versão nova enquanto o app estava aberto. Recarregue para continuar." />
    }
    return this.props.fallback(this.state.error, () => this.setState({ error: null }))
  }
}

function Screen({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <p className="text-[20px] font-semibold tracking-tight">{title}</p>
        <p className="mt-2 text-[15px] leading-relaxed text-soft">{text}</p>
        <div className="mt-6 grid gap-3">
          <button type="button" onClick={() => location.reload()} className="press min-h-12 rounded-2xl bg-accent px-4 text-[15px] font-semibold text-on-accent">
            Recarregar
          </button>
          {children}
        </div>
      </div>
    </div>
  )
}

/** Outside the store (the session or the store itself failed): only a reload is possible. */
export function BareErrorScreen() {
  return <Screen title="Algo deu errado" text="Seus dados continuam salvos neste aparelho e na conta. Recarregue para continuar." />
}

/** Shown inside the store: the data is still there, so it can be exported before anything else. */
export function AppErrorScreen({ error, retry }: { error: Error; retry(): void }) {
  const { data, settings, updateSettings } = useStore()
  const [note, setNote] = useState<string | null>(null)

  const exportData = async () => {
    try {
      await saveFile(buildBackup(data, settings).blob, backupFileName())
      setNote('Backup exportado.')
    } catch {
      setNote('Não foi possível exportar agora.')
    }
  }

  // Only the settings that change how screens look: money, vault, categories and automations stay.
  const resetDisplay = async () => {
    const keep: (keyof Settings)[] = ['onboarded', 'baseCurrency', 'initialBalance', 'startedAt', 'rates', 'manualRates', 'lastBackupAt', 'vault', 'timeZone', 'financeCategories', 'automations', 'mealTypes', 'importTemplates', 'reminders']
    const next = normalizeSettings(Object.fromEntries(keep.filter((k) => k in settings).map((k) => [k, settings[k]])))
    const cleared = Object.fromEntries(Object.keys(settings).filter((k) => !keep.includes(k as keyof Settings)).map((k) => [k, undefined])) as Partial<Settings>
    await updateSettings({ ...cleared, ...next })
    retry()
  }

  return (
    <Screen title="Algo deu errado nesta tela" text="Seus dados continuam salvos. Recarregue; se o erro voltar, exporte um backup e redefina a exibição (seções, abas e preferências de tela).">
      <button type="button" onClick={exportData} className="press min-h-12 rounded-2xl border border-line-strong px-4 text-[15px] font-semibold">
        Exportar meus dados
      </button>
      <button type="button" onClick={resetDisplay} className="press min-h-12 rounded-2xl border border-line-strong px-4 text-[15px] font-semibold">
        Redefinir exibição
      </button>
      {note && <p className="text-[13px] text-soft">{note}</p>}
      <p className="text-[12px] break-words text-faint">{error.message.slice(0, 160)}</p>
    </Screen>
  )
}
