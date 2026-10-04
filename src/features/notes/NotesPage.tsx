import { NotebookPen, Pin, PinOff, Plus } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../../app/Shell'
import { matches } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Note } from '../../data/types'
import { formatDateTime } from '../../lib/dates'
import { Button, IconButton } from '../../ui/Button'
import { EmptyState, SearchField, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft, useSheet } from '../../ui/formHooks'
import { useOpenParam } from '../useOpenParam'

export function NoteEditor({ open, onClose, note, initial, onSaved }: { open: boolean; onClose(): void; note: Note | null; initial?: { title?: string; body?: string }; onSaved?(note: Note): void }) {
  const { save } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const [d, set] = useDraft(open, () => ({ title: note?.title ?? initial?.title ?? '', body: note?.body ?? initial?.body ?? '', pinned: note?.pinned ?? false }))

  const submit = async () => {
    if (!d.title.trim() && !d.body.trim()) return 'A nota está vazia'
    const saved = await save('notes', { ...note, title: d.title.trim(), body: d.body, pinned: d.pinned })
    toast(note ? 'Nota atualizada' : 'Nota criada')
    onSaved?.(saved)
    onClose()
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={note ? 'Editar nota' : 'Nova nota'}
      onSubmit={submit}
      size="lg"
      onDelete={note ? () => del('notes', note.id, 'nota', { feminine: true, after: onClose }) : undefined}
    >
      <div className="flex items-start gap-2 pt-1">
        <input
          value={d.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Título"
          autoFocus={!note}
          className="h-12 min-w-0 flex-1 bg-transparent text-[22px]! font-semibold tracking-tight placeholder:text-faint focus:outline-none"
        />
        <IconButton label={d.pinned ? 'Desafixar' : 'Fixar'} size="sm" onClick={() => set('pinned', !d.pinned)} className={d.pinned ? 'text-accent-hi' : ''}>
          {d.pinned ? <Pin size={18} fill="currentColor" /> : <Pin size={18} />}
        </IconButton>
      </div>
      <textarea
        value={d.body}
        onChange={(e) => set('body', e.target.value)}
        placeholder="Escreva aqui…"
        className="min-h-[40dvh] w-full resize-none bg-transparent pt-2 text-[16px] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
      />
      {note && (
        <p className="text-[13px] text-faint">
          Criada {formatDateTime(note.createdAt).toLowerCase()} · editada {formatDateTime(note.updatedAt).toLowerCase()}
        </p>
      )}
    </FormSheet>
  )
}

function NoteCard({ note, onOpen }: { note: Note; onOpen(n: Note): void }) {
  return (
    <button type="button" onClick={() => onOpen(note)} className="card press flex w-full flex-col p-4 text-left hover:border-line-strong">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-tight">{note.title || note.body.split('\n')[0]}</h3>
        {note.pinned && <Pin size={15} className="mt-1 shrink-0 text-accent-hi" fill="currentColor" />}
      </div>
      {note.title && note.body && <p className="mt-1.5 line-clamp-3 text-[15px] leading-relaxed whitespace-pre-line text-soft">{note.body}</p>}
      <p className="mt-3 text-xs text-faint">{formatDateTime(note.updatedAt)}</p>
    </button>
  )
}

export function NotesPage() {
  const { data } = useStore()
  const [query, setQuery] = useState('')
  const editor = useSheet<Note>()
  useOpenParam(data.notes, editor.show)

  const list = [...data.notes].filter((n) => matches(query, n.title, n.body)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  const pinned = list.filter((n) => n.pinned)
  const others = list.filter((n) => !n.pinned)

  const grid = (items: Note[]) => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((n) => (
        <NoteCard key={n.id} note={n} onOpen={editor.show} />
      ))}
    </div>
  )

  return (
    <>
      <PageHeader
        title="Anotações"
        actions={
          <Button icon={<Plus size={18} />} onClick={() => editor.show()}>
            Nova
          </Button>
        }
      />
      {data.notes.length === 0 ? (
        <EmptyState icon={<NotebookPen size={22} />} title="Nenhuma nota ainda" text="Ideias, lembretes, rascunhos — tudo em um lugar." action="Criar nota" onAction={() => editor.show()} />
      ) : (
        <>
          <div className="mb-5">
            <SearchField value={query} onChange={setQuery} placeholder="Buscar nas notas" />
          </div>
          {list.length === 0 && <EmptyState compact icon={<PinOff size={22} />} title="Nada encontrado" />}
          {pinned.length > 0 && (
            <section className="mb-6">
              <SectionTitle>Fixadas</SectionTitle>
              {grid(pinned)}
            </section>
          )}
          {others.length > 0 && (
            <section>
              {pinned.length > 0 && <SectionTitle>Outras</SectionTitle>}
              {grid(others)}
            </section>
          )}
        </>
      )}
      <NoteEditor open={editor.open} onClose={editor.close} note={editor.item} />
    </>
  )
}
