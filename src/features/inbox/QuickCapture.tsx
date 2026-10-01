import { Plus } from 'lucide-react'
import { useState } from 'react'
import { isEnabled } from '../../app/modules'
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

/** Round button above the tab bar (phone) — only when the inbox section is on. */
export function QuickCaptureButton() {
  const { settings, ready } = useStore()
  const [open, setOpen] = useState(false)
  if (!ready || !isEnabled(settings, 'inbox')) return null
  return (
    <>
      <button
        type="button"
        aria-label="Capturar na caixa de entrada"
        title="Capturar"
        onClick={() => setOpen(true)}
        className="press fixed right-4 z-40 grid size-14 place-items-center rounded-full bg-accent text-white shadow-xl shadow-black/50 hover:bg-accent-hi lg:hidden"
        style={{ bottom: 'calc(max(8px, env(safe-area-inset-bottom)) + 84px)' }}
      >
        <Plus size={26} strokeWidth={2.4} />
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
