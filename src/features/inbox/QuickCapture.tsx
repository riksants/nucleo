import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isEnabled } from '../../app/modules'
import { useCurrentPrimaryAction } from '../../app/primaryAction'
import { useRoute } from '../../app/router'
import { useStore } from '../../data/store'
import { Button } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { TextArea } from '../../ui/Field'
import { Sheet } from '../../ui/Sheet'

/** Minimal capture: type, save. Organizing happens later in the inbox. */
export function CaptureSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { save } = useStore()
  const { toast } = useFeedback()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      await save('inbox', { text: value, status: 'open', convertedTo: null, processedAt: null })
      setText('')
      toast('Guardado na caixa de entrada')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Capturar"
      footer={
        <Button size="lg" block onClick={submit} disabled={!text.trim() || busy}>
          Guardar para organizar depois
        </Button>
      }
    >
      <TextArea
        aria-label="O que você quer guardar?"
        placeholder="Tarefa, ideia, lembrete… ex.: Ligar para João amanhã"
        rows={3}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
        }}
      />
      <p className="mt-2 px-1 text-[13px] text-faint">Depois você transforma em tarefa, compromisso, anotação ou projeto.</p>
    </Sheet>
  )
}

/**
 * Hidden while the page scrolls down (so it never covers values or switches), shown again on scroll up,
 * near the top or at the end of the page, and whenever the section changes.
 */
function useHideOnScroll(path: string) {
  // Hidden only for the section where it was hidden: switching sections shows it again.
  const [hiddenOn, setHiddenOn] = useState<string | null>(null)
  useEffect(() => {
    let last = window.scrollY
    let frame = 0
    const update = () => {
      frame = 0
      const y = window.scrollY
      const atEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 24
      if (y < 64 || atEnd) setHiddenOn(null)
      else if (y - last > 6) setHiddenOn(path)
      else if (last - y > 6) setHiddenOn(null)
      last = y
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [path])
  return hiddenOn === path
}

/** Round button above the tab bar (phone) — only when the inbox section is on. */
export function QuickCaptureButton() {
  const { settings, ready } = useStore()
  const { path } = useRoute()
  const [open, setOpen] = useState(false)
  const hidden = useHideOnScroll(path)
  // One "+" per screen: what this screen creates (Nova tarefa, Novo projeto…); otherwise the capture.
  const action = useCurrentPrimaryAction()
  // The Assistant has its own input in that spot; Início and Financeiro have their own main actions (null).
  if (!ready || path === '/assistant' || action === null) return null
  if (!action && !isEnabled(settings, 'inbox')) return null
  return (
    <>
      <button
        type="button"
        aria-label={action ? action.aria : 'Capturar na caixa de entrada'}
        title={action ? action.aria : 'Capturar'}
        disabled={action?.disabled}
        onClick={() => (action ? action.onPress() : setOpen(true))}
        data-hidden={hidden}
        className="fab fixed right-4 z-40 grid size-14 place-items-center rounded-full bg-accent text-on-accent shadow-xl shadow-shade/50 hover:brightness-[0.96] disabled:opacity-40 lg:hidden"
        style={{ bottom: 'calc(max(8px, env(safe-area-inset-bottom)) + 84px)' }}
      >
        <Plus size={24} strokeWidth={2.4} />
      </button>
      <CaptureSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}

/** Same capture from the desktop sidebar. */
export function SidebarCapture() {
  const { settings } = useStore()
  const [open, setOpen] = useState(false)
  if (!isEnabled(settings, 'inbox')) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-5 flex h-10 w-full items-center gap-2.5 rounded-xl bg-accent/12 px-3 text-sm font-medium text-accent-hi transition-colors hover:bg-accent/20"
      >
        <Plus size={16} />
        Capturar
      </button>
      <CaptureSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
