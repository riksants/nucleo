import { ArrowUp, Check, Link2, List, ListChecks, NotebookPen, Pin, PinOff, Sparkles, Star } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { isEnabled } from '../../app/modules'
import { PageHeader } from '../../app/Shell'
import { actionsInNote, type Suggestion } from '../../core/intentSuggest'
import { checklistProgress, linksIn, parseNote, toggleLine } from '../../core/noteText'
import { todayIn, zoneOf } from '../../core/period'
import { matches } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Note } from '../../data/types'
import { formatDateTime } from '../../lib/dates'
import { displayUrl, normalizeUrl } from '../../lib/links'
import { IconButton } from '../../ui/Button'
import { EmptyState, SearchField, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft, useSheet } from '../../ui/formHooks'
import { Chips } from '../../ui/Segmented'
import { RecurringForm } from '../recurring/RecurringForm'
import { TaskForm } from '../tasks/TaskForm'
import { useOpenParam } from '../useOpenParam'

export function NoteEditor({ open, onClose, note, initial, onSaved }: { open: boolean; onClose(): void; note: Note | null; initial?: { title?: string; body?: string }; onSaved?(note: Note): void }) {
  const { save, data } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const body = useRef<HTMLTextAreaElement>(null)
  const [d, set] = useDraft(open, () => ({
    title: note?.title ?? initial?.title ?? '',
    body: note?.body ?? initial?.body ?? '',
    pinned: note?.pinned ?? false,
    favorite: note?.favorite ?? false,
    category: note?.category ?? '',
  }))
  const categories = [...new Set(data.notes.map((n) => n.category).filter(Boolean) as string[])].sort()

  const submit = async () => {
    if (!d.title.trim() && !d.body.trim()) return 'A nota está vazia'
    const saved = await save('notes', { ...note, title: d.title.trim(), body: d.body, pinned: d.pinned, favorite: d.favorite || undefined, category: d.category.trim() || undefined })
    toast(note ? 'Nota atualizada' : 'Nota criada')
    onSaved?.(saved)
    onClose()
  }

  /** Starts a checklist or list item on a new line at the caret. */
  const insert = (prefix: string) => {
    const el = body.current
    const pos = el?.selectionStart ?? d.body.length
    const before = d.body.slice(0, pos)
    const lead = before && !before.endsWith('\n') ? '\n' : ''
    const next = `${before}${lead}${prefix}${d.body.slice(pos)}`
    set('body', next)
    requestAnimationFrame(() => {
      const at = before.length + lead.length + prefix.length
      el?.focus()
      el?.setSelectionRange(at, at)
    })
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
      <div className="flex items-start gap-1 pt-1">
        <input
          value={d.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Título"
          autoFocus={!note}
          className="h-12 min-w-0 flex-1 bg-transparent text-[22px]! font-semibold tracking-tight placeholder:text-faint focus:outline-none"
        />
        <IconButton label={d.favorite ? 'Tirar dos favoritos' : 'Favoritar'} size="sm" onClick={() => set('favorite', !d.favorite)} className={d.favorite ? 'text-accent-hi' : ''}>
          <Star size={18} fill={d.favorite ? 'currentColor' : 'none'} />
        </IconButton>
        <IconButton label={d.pinned ? 'Desafixar' : 'Fixar'} size="sm" onClick={() => set('pinned', !d.pinned)} className={d.pinned ? 'text-accent-hi' : ''}>
          <Pin size={18} fill={d.pinned ? 'currentColor' : 'none'} />
        </IconButton>
      </div>
      <div className="flex flex-wrap items-center gap-2 pb-1">
        <button type="button" onClick={() => insert('- [ ] ')} className="press inline-flex h-8 items-center gap-1.5 rounded-full bg-tint/[0.05] px-3 text-[13px] font-medium text-soft hover:text-ink">
          <ListChecks size={16} /> Checklist
        </button>
        <button type="button" onClick={() => insert('- ')} className="press inline-flex h-8 items-center gap-1.5 rounded-full bg-tint/[0.05] px-3 text-[13px] font-medium text-soft hover:text-ink">
          <List size={16} /> Lista
        </button>
        <input
          value={d.category}
          onChange={(e) => set('category', e.target.value)}
          list="note-categories"
          placeholder="Categoria"
          aria-label="Categoria"
          maxLength={40}
          className="h-8 w-36 rounded-full border border-line bg-transparent px-3 text-[13px] placeholder:text-faint focus:border-accent/60 focus:outline-none"
        />
        <datalist id="note-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <textarea
        ref={body}
        value={d.body}
        onChange={(e) => set('body', e.target.value)}
        onKeyDown={(e) => {
          // Enter inside a checklist/list continues it; on an empty item it ends it.
          if (e.key !== 'Enter' || e.shiftKey) return
          const el = e.currentTarget
          const pos = el.selectionStart
          const lineStart = d.body.lastIndexOf('\n', pos - 1) + 1
          const line = d.body.slice(lineStart, pos)
          const m = line.match(/^(\s*[-*]\s(?:\[[ xX]\]\s)?)(.*)$/)
          if (!m) return
          e.preventDefault()
          if (!m[2].trim()) {
            set('body', d.body.slice(0, lineStart) + d.body.slice(pos))
            return
          }
          const prefix = m[1].replace(/\[[xX]\]/, '[ ]')
          const next = `${d.body.slice(0, pos)}\n${prefix}${d.body.slice(pos)}`
          set('body', next)
          requestAnimationFrame(() => el.setSelectionRange(pos + 1 + prefix.length, pos + 1 + prefix.length))
        }}
        placeholder="Escreva aqui… Use “- [ ]” para checklist."
        aria-label="Texto da nota"
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

/** A card shows a preview: each line is cut short so a huge note never makes the list lay out the whole text. */
const clip = (s: string, n = 240) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** The note as it reads: title, checklist with real checkboxes, list, a few lines of text, links, category. */
function NoteCard({ note, onOpen, actions }: { note: Note; onOpen(n: Note): void; actions: number }) {
  const { save } = useStore()
  // Only the first lines matter for the preview (the whole body is still parsed for checklist progress).
  const lines = parseNote(note.body.slice(0, 4000)).filter((l) => l.text.trim())
  const progress = checklistProgress(note.body)
  const links = linksIn(note.body)
  const title = clip(note.title || lines[0]?.text || 'Sem título', 120)
  const shown = (note.title ? lines : lines.slice(1)).slice(0, 6)
  return (
    <article className="card mb-3 break-inside-avoid p-4 transition-colors hover:border-line-strong">
      <button type="button" onClick={() => onOpen(note)} className="flex w-full items-start gap-2 text-left">
        <h3 className="min-w-0 flex-1 text-[16px] leading-snug font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</h3>
        {note.favorite && <Star size={16} className="mt-0.5 shrink-0 text-accent-hi" fill="currentColor" aria-label="Favorita" />}
        {note.pinned && <Pin size={16} className="mt-0.5 shrink-0 text-accent-hi" fill="currentColor" aria-label="Fixada" />}
      </button>
      {shown.length > 0 && (
        <ul className="mt-2 space-y-1">
          {shown.map((l) =>
            l.kind === 'check' ? (
              <li key={l.index}>
                <button type="button" onClick={() => save('notes', { ...note, body: toggleLine(note.body, l.index) })} className="flex w-full items-start gap-2 text-left text-[14px] leading-snug">
                  <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-[5px] border ${l.done ? 'border-accent bg-accent text-on-accent' : 'border-check-line'}`}>{l.done && <Check size={14} strokeWidth={2.6} />}</span>
                  <span className={`min-w-0 [overflow-wrap:anywhere] ${l.done ? 'text-faint line-through' : 'text-soft'}`}>{clip(l.text)}</span>
                </button>
              </li>
            ) : (
              <li key={l.index} onClick={() => onOpen(note)} className={`line-clamp-2 cursor-pointer text-[14px] leading-snug text-soft [overflow-wrap:anywhere] ${l.kind === 'bullet' ? 'pl-3 before:-ml-3 before:inline-block before:w-3 before:content-["•"]' : ''}`}>
                {clip(l.text)}
              </li>
            ),
          )}
        </ul>
      )}
      {links.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {links.slice(0, 2).map((u) => (
            <a key={u} href={normalizeUrl(u)} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent/[0.1] px-2.5 py-1 text-[12px] font-medium text-accent-hi">
              <Link2 size={14} className="shrink-0" /> <span className="truncate">{displayUrl(u)}</span>
            </a>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
        {note.category && <span className="rounded-full bg-tint/[0.06] px-2 py-0.5 font-medium text-soft">{note.category}</span>}
        {progress.total > 0 && (
          <span className={progress.done === progress.total ? 'text-income' : ''}>
            {progress.done}/{progress.total} feitos
          </span>
        )}
        {actions > 0 && (
          <span className="inline-flex items-center gap-1 text-accent-hi">
            <Sparkles size={14} /> {actions} {actions === 1 ? 'ação sugerida' : 'ações sugeridas'}
          </span>
        )}
        <span className="ml-auto">{formatDateTime(note.updatedAt)}</span>
      </div>
    </article>
  )
}

type Filter = 'all' | 'favorites' | `cat:${string}`

export function NotesPage() {
  const { data, settings, save } = useStore()
  const { toast } = useFeedback()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [quick, setQuick] = useState('')
  const editor = useSheet<Note>()
  const [acting, setActing] = useState<{ note: Note; line: string; suggestion: Suggestion } | null>(null)
  useOpenParam(data.notes, editor.show)
  const today = todayIn(zoneOf(settings))
  const enabled = (k: string) => (k === 'bill' ? isEnabled(settings, 'recurring') : k === 'event' ? isEnabled(settings, 'agenda') : isEnabled(settings, 'tasks'))

  const categories = [...new Set(data.notes.map((n) => n.category).filter(Boolean) as string[])].sort()
  const list = [...data.notes]
    .filter((n) => matches(query, n.title, n.body, n.category))
    .filter((n) => (filter === 'all' ? true : filter === 'favorites' ? n.favorite : n.category === filter.slice(4)))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  const pinned = list.filter((n) => n.pinned)
  const others = list.filter((n) => !n.pinned)
  const actionsOf = (n: Note) => actionsInNote(n.body, today, enabled).filter((a) => !n.acted?.includes(a.line))
  const found = data.notes.flatMap((n) => actionsOf(n).map((a) => ({ note: n, ...a }))).slice(0, 3)
  const openChecks = data.notes.reduce((sum, n) => {
    const p = checklistProgress(n.body)
    return sum + (p.total - p.done)
  }, 0)

  const addQuick = async (e: FormEvent) => {
    e.preventDefault()
    const text = quick.trim()
    if (!text) return
    await save('notes', { title: '', body: text, pinned: false })
    setQuick('')
    toast('Nota criada')
  }

  const done = (note: Note, line: string) => () => void save('notes', { ...note, acted: [...(note.acted ?? []), line].slice(-50) })

  const columns = (items: Note[]) => (
    <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
      {items.map((n) => (
        <NoteCard key={n.id} note={n} onOpen={editor.show} actions={actionsOf(n).length} />
      ))}
    </div>
  )

  return (
    <>
      <PageHeader
        rich
        icon={NotebookPen}
        eyebrow={categories.length ? `${categories.length} ${categories.length === 1 ? 'categoria' : 'categorias'}` : 'Ideias, listas e rascunhos'}
        title="Anotações"
        primary={{ label: 'Nova', aria: 'Nova anotação', onPress: () => editor.show() }}
        stats={
          data.notes.length
            ? [
                { label: 'Notas', value: data.notes.length },
                { label: 'Fixadas', value: data.notes.filter((n) => n.pinned).length },
                { label: 'Itens a fazer', value: openChecks },
              ]
            : undefined
        }
      />

      <form onSubmit={addQuick} className="mb-5 flex gap-2">
        <input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Nota rápida… (Enter salva)"
          aria-label="Nota rápida"
          enterKeyHint="done"
          className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-ink placeholder:text-faint focus:border-accent-hi/60 focus:outline-none"
        />
        <IconButton label="Salvar nota" tone="accent" type="submit" className="size-12! rounded-2xl" disabled={!quick.trim()}>
          <ArrowUp size={20} strokeWidth={2.4} />
        </IconButton>
      </form>

      {data.notes.length === 0 ? (
        <EmptyState icon={<NotebookPen size={20} />} title="Nenhuma nota ainda" text="Ideias, checklists, links e rascunhos. Se uma nota tiver algo a fazer (“renovar o domínio dia 10”), o Núcleo sugere criar a tarefa." action="Criar nota" onAction={() => editor.show()} />
      ) : (
        <>
          {found.length > 0 && (
            <section className="mb-6" aria-label="Ações encontradas nas notas">
              <SectionTitle>Encontrado nas suas notas</SectionTitle>
              <div className="card divide-y divide-line">
                {found.map((a) => (
                  <div key={`${a.note.id}:${a.line}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <Sparkles size={16} className="shrink-0 text-accent-hi" />
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="line-clamp-2 block text-[15px] leading-snug">{a.line}</span>
                      <span className="block truncate text-[12px] text-faint">em “{a.note.title || a.note.body.split('\n')[0]}”</span>
                    </span>
                    <button type="button" onClick={() => setActing({ note: a.note, line: a.line, suggestion: a.suggestion })} className="press h-9 shrink-0 rounded-full bg-accent/[0.12] px-3 text-[13px] font-semibold text-accent-hi hover:bg-accent/[0.2]">
                      {a.suggestion.kind === 'bill' ? 'Criar conta' : a.suggestion.kind === 'event' ? 'Criar lembrete' : 'Criar tarefa'}
                    </button>
                    <button type="button" onClick={done(a.note, a.line)} aria-label="Ignorar sugestão" className="shrink-0 rounded-xl px-2 py-2 text-[13px] text-faint hover:text-soft">
                      Ignorar
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="mb-4 space-y-3">
            <SearchField value={query} onChange={setQuery} placeholder="Buscar nas notas" />
            {(categories.length > 0 || data.notes.some((n) => n.favorite)) && (
              <Chips<Filter>
                value={filter}
                onChange={setFilter}
                options={[{ value: 'all', label: 'Todas' }, { value: 'favorites', label: 'Favoritas' }, ...categories.map((c) => ({ value: `cat:${c}` as Filter, label: c }))]}
              />
            )}
          </div>
          {list.length === 0 && <EmptyState compact icon={<PinOff size={20} />} title="Nada encontrado" action={query || filter !== 'all' ? 'Limpar filtros' : undefined} onAction={() => (setQuery(''), setFilter('all'))} />}
          {pinned.length > 0 && (
            <section className="mb-4">
              <SectionTitle>Fixadas</SectionTitle>
              {columns(pinned)}
            </section>
          )}
          {others.length > 0 && (
            <section>
              {pinned.length > 0 && <SectionTitle>Outras</SectionTitle>}
              {columns(others)}
            </section>
          )}
        </>
      )}
      <NoteEditor open={editor.open} onClose={editor.close} note={editor.item} />
      <TaskForm
        open={!!acting && acting.suggestion.kind !== 'bill'}
        onClose={() => setActing(null)}
        task={null}
        initial={{ title: acting?.line, dueDate: acting?.suggestion.date, dueTime: acting?.suggestion.time, notes: acting ? `Da nota “${acting.note.title || 'sem título'}”` : '' }}
        onSaved={() => acting && done(acting.note, acting.line)()}
      />
      <RecurringForm
        open={acting?.suggestion.kind === 'bill'}
        onClose={() => setActing(null)}
        item={null}
        initial={{ title: acting?.line, bill: true, rule: { type: 'monthly', dayOfMonth: acting?.suggestion.dayOfMonth ?? Number(today.slice(8)) } }}
        onSaved={() => acting && done(acting.note, acting.line)()}
      />
    </>
  )
}
