import { ArrowUp, Check, Link2, List, ListChecks, NotebookPen, Pin, PinOff, Sparkles, Star } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { isEnabled } from '../../app/modules'
import { PageHeader } from '../../app/Shell'
import { parseCapture } from '../../core/capture'
import type { Suggestion } from '../../core/intentSuggest'
import { actionsOf, LARGE_NOTE, MAX_NOTE, noteMatches, sizeWords, summaryOf } from '../../core/noteIndex'
import { toggleLine } from '../../core/noteText'
import { todayIn, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import type { Note } from '../../data/types'
import { formatDateTime } from '../../lib/dates'
import { displayUrl, normalizeUrl } from '../../lib/links'
import { readPref, writePref } from '../../lib/prefs'
import { IconButton } from '../../ui/Button'
import { EmptyState, SearchField, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft, useSheet } from '../../ui/formHooks'
import { Chips } from '../../ui/Segmented'
import { RecurringForm } from '../recurring/RecurringForm'
import { TaskForm } from '../tasks/TaskForm'
import { useOpenParam } from '../useOpenParam'

/** Text being written, kept on this device until saved: closing the app by accident never loses it. */
interface NoteDraft {
  title: string
  body: string
  at: number
}
/** Prefilled from elsewhere (Caixa de entrada): that source keeps the text, so no draft of its own. */
const draftKey = (note: Note | null, prefilled = false) => (prefilled ? null : `noteDraft:${note?.id ?? 'new'}`)
/** Very large drafts aren't copied to local storage (its space is small); they still save normally. */
const DRAFT_MAX = 1_500_000

/**
 * The note editor. The text box is not tied to the screen state (no re-render per keystroke, so a 260 000-
 * character note types as fast as a short one): its text is read when saving and copied to a local draft a
 * moment after each pause.
 */
export function NoteEditor({ open, onClose, note, initial, onSaved }: { open: boolean; onClose(): void; note: Note | null; initial?: { title?: string; body?: string }; onSaved?(note: Note): void }) {
  const { save, data } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const body = useRef<HTMLTextAreaElement>(null)
  const title = useRef<HTMLInputElement>(null)
  const saveTimer = useRef(0)
  const [size, setSize] = useState(0)
  const [recovered, setRecovered] = useState<NoteDraft | null>(null)
  const [d, set] = useDraft(open, () => ({
    pinned: note?.pinned ?? false,
    favorite: note?.favorite ?? false,
    category: note?.category ?? '',
  }))
  const categories = useMemo(() => [...new Set(data.notes.map((n) => n.category).filter(Boolean) as string[])].sort(), [data.notes])
  const key = draftKey(note, Boolean(initial && !note))
  const read = () => (key ? readPref<NoteDraft | null>(key, null) : null)
  const write = (v: NoteDraft | null) => key && writePref(key, v)
  const startBody = note?.body ?? initial?.body ?? ''
  const startTitle = note?.title ?? initial?.title ?? ''

  // Opening: the saved text goes into the box once; a newer unsaved draft of this note is offered back.
  useEffect(() => {
    if (!open) return
    window.clearTimeout(saveTimer.current)
    const draft = read()
    const newer = draft && (draft.body !== startBody || draft.title !== startTitle) && (!note || draft.at > Date.parse(note.updatedAt))
    setRecovered(newer ? draft : null)
    if (draft && !newer) write(null)
    requestAnimationFrame(() => {
      if (body.current) body.current.value = startBody
      if (title.current) title.current.value = startTitle
      setSize(startBody.length)
    })
  }, [open, note]) // eslint-disable-line react-hooks/exhaustive-deps

  const keepDraft = () => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const text = body.current?.value ?? ''
      setSize(text.length)
      if (text.length <= DRAFT_MAX) write({ title: title.current?.value ?? '', body: text, at: Date.now() })
    }, 800)
  }

  const submit = async () => {
    const text = body.current?.value ?? ''
    const head = (title.current?.value ?? '').trim()
    if (!head && !text.trim()) return 'A nota está vazia'
    if (text.length > MAX_NOTE) return `A nota tem ${sizeWords(text.length)}: o limite é ${sizeWords(MAX_NOTE)}. Divida em duas notas — nada foi cortado nem salvo.`
    const saved = await save('notes', { ...note, title: head, body: text, pinned: d.pinned, favorite: d.favorite || undefined, category: d.category.trim() || undefined })
    window.clearTimeout(saveTimer.current)
    write(null)
    toast(note ? 'Nota atualizada' : 'Nota criada')
    onSaved?.(saved)
    onClose()
  }

  /** Starts a checklist or list item on a new line at the caret. */
  const insert = (prefix: string) => {
    const el = body.current
    if (!el) return
    const pos = el.selectionStart ?? el.value.length
    const before = el.value.slice(0, pos)
    const lead = before && !before.endsWith('\n') ? '\n' : ''
    el.setRangeText(`${lead}${prefix}`, pos, pos, 'end')
    el.focus()
    keepDraft()
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={note ? 'Editar nota' : 'Nova nota'}
      onSubmit={submit}
      size="lg"
      onDelete={note ? () => del('notes', note.id, 'nota', { feminine: true, after: () => (write(null), onClose()) }) : undefined}
    >
      {recovered && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-2xl bg-warn/[0.08] px-3.5 py-2.5 text-[14px]">
          <span className="min-w-0 flex-1">Há um texto não salvo desta nota ({sizeWords(recovered.body.length)}).</span>
          <button
            type="button"
            onClick={() => {
              if (body.current) body.current.value = recovered.body
              if (title.current) title.current.value = recovered.title
              setSize(recovered.body.length)
              setRecovered(null)
            }}
            className="press h-8 rounded-full bg-accent px-3 text-[13px] font-semibold text-on-accent"
          >
            Recuperar
          </button>
          <button type="button" onClick={() => (write(null), setRecovered(null))} className="h-8 px-2 text-[13px] text-faint hover:text-soft">
            Descartar
          </button>
        </div>
      )}
      <div className="flex items-start gap-1 pt-1">
        <input
          ref={title}
          defaultValue={startTitle}
          onInput={keepDraft}
          placeholder="Título"
          aria-label="Título"
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
          className="h-8 w-32 rounded-full border border-line bg-transparent px-3 text-[13px] placeholder:text-faint focus:border-accent/60 focus:outline-none"
        />
        <datalist id="note-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <textarea
        ref={body}
        defaultValue={startBody}
        onInput={keepDraft}
        onKeyDown={(e) => {
          // Enter inside a checklist/list continues it; on an empty item it ends it. Only the current line is read.
          if (e.key !== 'Enter' || e.shiftKey) return
          const el = e.currentTarget
          const pos = el.selectionStart
          const lineStart = el.value.lastIndexOf('\n', pos - 1) + 1
          const line = el.value.slice(lineStart, pos)
          const m = line.match(/^(\s*[-*]\s(?:\[[ xX]\]\s)?)(.*)$/)
          if (!m) return
          e.preventDefault()
          if (!m[2].trim()) el.setRangeText('', lineStart, pos, 'end')
          else el.setRangeText(`\n${m[1].replace(/\[[xX]\]/, '[ ]')}`, pos, pos, 'end')
          keepDraft()
        }}
        placeholder="Escreva aqui… Use “- [ ]” para checklist."
        aria-label="Texto da nota"
        spellCheck={size < LARGE_NOTE}
        className="min-h-[40dvh] w-full resize-none bg-transparent pt-2 text-[16px] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
      />
      <p className={`text-[13px] ${size > MAX_NOTE ? 'font-medium text-expense' : 'text-faint'}`}>
        {size > MAX_NOTE ? `${sizeWords(size)} · acima do limite de ${sizeWords(MAX_NOTE)}: divida antes de salvar` : size >= LARGE_NOTE ? `Nota grande · ${sizeWords(size)} · as sugestões olham só o começo` : null}
        {note && size < LARGE_NOTE && `Criada ${formatDateTime(note.createdAt).toLowerCase()} · editada ${formatDateTime(note.updatedAt).toLowerCase()}`}
      </p>
    </FormSheet>
  )
}

/** One note in the list: title, two short lines, checklist progress, links; never lays out the whole text. */
function NoteRow({ note, onOpen, actions }: { note: Note; onOpen(n: Note): void; actions: number }) {
  const { save } = useStore()
  const s = summaryOf(note)
  return (
    <li className="px-4 py-3">
      <button type="button" onClick={() => onOpen(note)} className="flex w-full items-start gap-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold tracking-tight">{s.title}</span>
          {s.lines.length > 0 && s.lines[0].kind !== 'check' && <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-soft [overflow-wrap:anywhere]">{s.lines.filter((l) => l.kind !== 'check').slice(0, 2).map((l) => l.text).join(' · ').slice(0, 220)}</span>}
        </span>
        {note.favorite && <Star size={16} className="mt-0.5 shrink-0 text-accent-hi" fill="currentColor" aria-label="Favorita" />}
        {note.pinned && <Pin size={16} className="mt-0.5 shrink-0 text-accent-hi" fill="currentColor" aria-label="Fixada" />}
      </button>
      {s.lines.some((l) => l.kind === 'check') && (
        <ul className="mt-1.5 space-y-1">
          {s.lines
            .filter((l) => l.kind === 'check')
            .slice(0, 3)
            .map((l) =>
              l.kind === 'check' ? (
                <li key={l.index}>
                  <button type="button" onClick={() => save('notes', { ...note, body: toggleLine(note.body, l.index) })} className="flex w-full items-start gap-2 text-left text-[13px] leading-snug">
                    <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-[5px] border ${l.done ? 'border-accent bg-accent text-on-accent' : 'border-check-line'}`}>{l.done && <Check size={14} strokeWidth={2.6} />}</span>
                    <span className={`min-w-0 truncate ${l.done ? 'text-faint line-through' : 'text-soft'}`}>{l.text}</span>
                  </button>
                </li>
              ) : null,
            )}
        </ul>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
        {note.category && <span className="rounded-full bg-tint/[0.06] px-2 py-0.5 font-medium text-soft">{note.category}</span>}
        {s.progress.total > 0 && (
          <span className={s.progress.done === s.progress.total ? 'text-income' : ''}>
            {s.progress.done}/{s.progress.total} feitos
          </span>
        )}
        {s.links.slice(0, 1).map((u) => (
          <a key={u} href={normalizeUrl(u)} target="_blank" rel="noreferrer" className="inline-flex max-w-[60%] items-center gap-1 font-medium text-accent-hi">
            <Link2 size={14} className="shrink-0" /> <span className="truncate">{displayUrl(u)}</span>
          </a>
        ))}
        {actions > 0 && (
          <span className="inline-flex items-center gap-1 text-accent-hi">
            <Sparkles size={14} /> {actions}
          </span>
        )}
        <span className="ml-auto">{formatDateTime(note.updatedAt)}</span>
      </div>
    </li>
  )
}

type Filter = 'all' | 'favorites' | `cat:${string}`
/** Rows drawn at a time (thousands of notes stay light); "Mostrar mais" adds the next ones. */
const PAGE = 60

export function NotesPage() {
  const { data, settings, save } = useStore()
  const { toast } = useFeedback()
  const [query, setQuery] = useState('')
  const search = useDeferredValue(query)
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(PAGE)
  const [quick, setQuick] = useState('')
  const editor = useSheet<Note>()
  const [acting, setActing] = useState<{ note: Note; line: string; suggestion: Suggestion } | null>(null)
  useOpenParam(data.notes, editor.show)
  const today = todayIn(zoneOf(settings))
  const enabled = (k: string) => (k === 'bill' ? isEnabled(settings, 'recurring') : k === 'event' ? isEnabled(settings, 'agenda') : isEnabled(settings, 'tasks'))

  const categories = useMemo(() => [...new Set(data.notes.map((n) => n.category).filter(Boolean) as string[])].sort(), [data.notes])
  const list = useMemo(
    () =>
      [...data.notes]
        .filter((n) => (filter === 'all' ? true : filter === 'favorites' ? n.favorite : n.category === filter.slice(4)))
        .filter((n) => noteMatches(n, search))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [data.notes, filter, search],
  )
  const pinned = list.filter((n) => n.pinned)
  const others = list.filter((n) => !n.pinned)
  const found = useMemo(() => data.notes.flatMap((n) => actionsOf(n, today, enabled).map((a) => ({ note: n, ...a }))).slice(0, 3), [data.notes, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const openChecks = useMemo(() => data.notes.reduce((sum, n) => sum + (summaryOf(n).progress.total - summaryOf(n).progress.done), 0), [data.notes])

  const addQuick = async (e?: FormEvent) => {
    e?.preventDefault()
    const text = quick.trim()
    if (!text) return
    if (text.length > MAX_NOTE) return toast(`Texto acima de ${sizeWords(MAX_NOTE)}: divida em duas notas`, 'error')
    await save('notes', { title: '', body: text, pinned: false })
    setQuick('')
    toast('Nota criada')
  }

  const done = (note: Note, line: string) => () => void save('notes', { ...note, acted: [...(note.acted ?? []), line].slice(-50) })
  const parsed = acting ? parseCapture(acting.line, today) : null

  const rows = (items: Note[]) => (
    <ul className="card divide-y divide-line">
      {items.map((n) => (
        <NoteRow key={n.id} note={n} onOpen={editor.show} actions={actionsOf(n, today, enabled).length} />
      ))}
    </ul>
  )
  const shownOthers = others.slice(0, Math.max(0, limit - pinned.length))

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

      <form onSubmit={addQuick} className="mb-5 flex items-end gap-2 rounded-2xl border border-line bg-surface p-1.5 focus-within:border-accent-hi/60">
        <textarea
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void addQuick()
            }
          }}
          rows={1}
          placeholder="Nota rápida… (Enter salva, Shift+Enter quebra a linha)"
          aria-label="Nota rápida"
          enterKeyHint="done"
          className="max-h-48 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-[16px] leading-snug text-ink placeholder:text-faint focus:outline-none [field-sizing:content]"
        />
        <IconButton label="Salvar nota" tone="accent" type="submit" className="size-11! shrink-0 rounded-xl" disabled={!quick.trim()}>
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
                      <span className="block truncate text-[12px] text-faint">em “{summaryOf(a.note).title}”</span>
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
            <SearchField value={query} onChange={(v) => (setQuery(v), setLimit(PAGE))} placeholder="Buscar nas notas (texto inteiro)" />
            {(categories.length > 0 || data.notes.some((n) => n.favorite)) && (
              <Chips<Filter>
                value={filter}
                onChange={(v) => (setFilter(v), setLimit(PAGE))}
                options={[{ value: 'all', label: 'Todas' }, { value: 'favorites', label: 'Favoritas' }, ...categories.map((c) => ({ value: `cat:${c}` as Filter, label: c }))]}
              />
            )}
          </div>
          {list.length === 0 && <EmptyState compact icon={<PinOff size={20} />} title="Nada encontrado" action={query || filter !== 'all' ? 'Limpar filtros' : undefined} onAction={() => (setQuery(''), setFilter('all'))} />}
          {pinned.length > 0 && (
            <section className="mb-4">
              <SectionTitle>Fixadas</SectionTitle>
              {rows(pinned)}
            </section>
          )}
          {shownOthers.length > 0 && (
            <section>
              {pinned.length > 0 && <SectionTitle>Outras</SectionTitle>}
              {rows(shownOthers)}
            </section>
          )}
          {others.length > shownOthers.length && (
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="mt-3 w-full rounded-2xl py-3 text-[14px] font-medium text-accent-hi hover:bg-accent/[0.06]">
              Mostrar mais {Math.min(PAGE, others.length - shownOthers.length)} de {others.length - shownOthers.length}
            </button>
          )}
        </>
      )}
      <NoteEditor open={editor.open} onClose={editor.close} note={editor.item} />
      <TaskForm
        open={!!acting && acting.suggestion.kind !== 'bill'}
        onClose={() => setActing(null)}
        task={null}
        initial={{ title: parsed?.title || acting?.line, dueDate: acting?.suggestion.date ?? parsed?.date, dueTime: acting?.suggestion.time ?? parsed?.time, notes: acting ? `Da nota “${summaryOf(acting.note).title}”` : '' }}
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

