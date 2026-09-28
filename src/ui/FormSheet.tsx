import { Trash2 } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, IconButton } from './Button'
import { useFeedback } from './Feedback'
import { Sheet } from './Sheet'

interface FormSheetProps {
  open: boolean
  onClose(): void
  title: string
  submitLabel?: string
  /** Return an error message to keep the sheet open, or nothing on success. */
  onSubmit(): Promise<string | void> | string | void
  onDelete?(): void
  children: ReactNode
  size?: 'md' | 'lg'
}

export function FormSheet({ open, onClose, title, submitLabel = 'Salvar', onSubmit, onDelete, children, size }: FormSheetProps) {
  const { toast } = useFeedback()
  const [busy, setBusy] = useState(false)
  const formId = `form-${title.replace(/\s+/g, '-')}`

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const error = await onSubmit()
      if (error) toast(error, 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível salvar', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      size={size}
      footer={
        <div className="flex gap-3">
          {onDelete && (
            <IconButton label="Excluir" className="size-14! rounded-[1.1rem]! bg-expense/10 text-expense hover:bg-expense/20" onClick={onDelete}>
              <Trash2 size={20} />
            </IconButton>
          )}
          <Button type="submit" form={formId} size="lg" block disabled={busy}>
            {submitLabel}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        {children}
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}
