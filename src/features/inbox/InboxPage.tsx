import { Archive, ArrowUp, CalendarClock, Compass, FolderHeart, FolderKanban, Inbox, ListRestart, ListTodo, NotebookPen, Receipt, Salad, ShoppingBasket, Sparkles, Trash2 } from 'lucide-react'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { isEnabled } from '../../app/modules'
import { PageHeader } from '../../app/Shell'
import { suggestFor, type Suggestion, type SuggestionKind } from '../../core/intentSuggest'
import { zoneOf, todayIn, weekStart } from '../../core/period'
import { matches } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { CollectionName, InboxItem, ModuleId } from '../../data/types'
import { formatDateTime } from '../../lib/dates'
import { usePref } from '../../lib/prefs'
import { IconButton } from '../../ui/Button'
import { EmptyState, SearchField } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { useSheet } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { EventForm } from '../agenda/EventForm'
import { NoteEditor } from '../notes/NotesPage'
import { ProjectForm } from '../projects/ProjectForm'
import { RecurringForm } from '../recurring/RecurringForm'
import { TaskForm } from '../tasks/TaskForm'
import { PlanForm } from '../life/Plans'
import { MealForm } from '../meals/MealForm'
import { COLLECTION_LABELS } from '../account/MigrationOffer'
import { useOpenParam } from '../useOpenParam'
import { markOrganized, splitCapture, suggestedDate } from './inbox'

type Target = 'task' | 'event' | 'note' | 'project' | 'lifeProject' | 'objective' | 'meal' | 'bill'
type Tab = 'new' | 'done' | 'archived'

const SECTION: Record<SuggestionKind, ModuleId | null> = { shopping: 'meals', task: 'tasks', event: 'agenda', bill: 'recurring', note: 'notes', project: 'projects', lifeProject: 'life', objective: 'life' }
const ICON: Record<SuggestionKind, ReactNode> = {
  shopping: <ShoppingBasket size={14} />,
  task: <ListTodo size={14} />,
  event: <CalendarClock size={14} />,
  bill: <Receipt size={14} />,
  note: <NotebookPen size={14} />,
  project: <FolderKanban size={14} />,
  lifeProject: <FolderHeart size={14} />,
  objective: <Compass size={14} />,
}

function Choice({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint: string; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-15 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-tint/[0.03] tap">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl icon-tile">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="block text-[13px] text-faint">{hint}</span>
      </span>
    </button>
  )
}

export function InboxPage() {
  const { data, settings, save, remove } = useStore()
  const { toast, confirm } = useFeedback()
  const organize = useSheet<InboxItem>()
  useOpenParam(data.inbox.filter((i) => i.status === 'open'), organize.show)
  const [target, setTarget] = useState<{ type: Target; item: InboxItem; suggestion?: Suggestion } | null>(null)
  const [tab, setTab] = usePref<Tab>('inbox.tab', 'new')
  const [query, setQuery] = useState('')
  const [text, setText] = useState('')
  const adding = useRef(false)
  const today = todayIn(zoneOf(settings))
  const on = (kind: SuggestionKind) => {
    const id = SECTION[kind]
    return !id || isEnabled(settings, id)
  }

  const open = data.inbox.filter((i) => i.status === 'open').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const done = data.inbox.filter((i) => i.status === 'done').sort((a, b) => ((a.processedAt ?? '') < (b.processedAt ?? '') ? 1 : -1))
  const organized = done.filter((i) => i.convertedTo)
  const archived = done.filter((i) => !i.convertedTo)
  const list = (tab === 'new' ? open : tab === 'done' ? organized : archived).filter((i) => matches(query, i.text))

  const capture = async (e: FormEvent) => {
    e.preventDefault()
    const value = text.trim()
    if (!value || adding.current) return
    adding.current = true
    try {
      await save('inbox', { text: value, status: 'open', convertedTo: null, processedAt: null })
      setText('')
      setTab('new')
      toast('Guardado na caixa de entrada')
    } finally {
      adding.current = false
    }
  }

  const start = (type: Target, item = organize.item, suggestion?: Suggestion) => {
    if (!item) return
    setTarget({ type, item, suggestion })
    organize.close()
  }

  /** The original item stays, marked as organized and linked to what it became. */
  const converted = (collection: CollectionName) => (saved: { id: string }) => {
    if (!target) return
    void save('inbox', markOrganized(target.item, { collection, id: saved.id }))
  }

  /** Straight to this week's shopping list; the inbox item stays, linked to it. */
  const toShopping = async (item = organize.item) => {
    if (!item) return
    const saved = await save('shoppingItems', { week: weekStart(today), kind: 'manual', name: splitCapture(item.text).title.slice(0, 120), qty: '', unit: '', category: 'Outros', checked: false, note: '', origin: 'inbox' })
    await save('inbox', markOrganized(item, { collection: 'shoppingItems', id: saved.id }))
    organize.close()
    toast('Foi para a Lista de compras')
  }

  /** A suggestion only opens the right form, filled in: nothing is created until the person saves it. */
  const apply = (item: InboxItem, s: Suggestion) => {
    if (s.kind === 'shopping') return toShopping(item)
    start(s.kind === 'bill' ? 'bill' : s.kind, item, s)
  }

  const archive = async () => {
    if (!organize.item) return
    await save('inbox', markOrganized(organize.item, null))
    organize.close()
    toast('Arquivado')
  }

  const reopen = async (item: InboxItem) => {
    await save('inbox', { ...item, status: 'open', convertedTo: null, processedAt: null })
    toast('Voltou para Novos')
  }

  const del = async () => {
    const item = organize.item
    if (!item) return
    const ok = await confirm({ title: 'Excluir da caixa de entrada?', message: item.text.slice(0, 120), confirmLabel: 'Excluir', danger: true })
    if (!ok) return
    await remove('inbox', item.id)
    organize.close()
    toast('Item excluído')
  }

  const convertedLabel = (to: { collection: CollectionName; id: string }) => {
    if (to.collection === 'meals') return 'refeição'
    if (to.collection === 'shoppingItems') return 'item da lista de compras'
    if (to.collection === 'recurring') return 'recorrente'
    if (to.collection !== 'lifePlans') return COLLECTION_LABELS[to.collection].toLowerCase()
    const plan = data.lifePlans.find((p) => p.id === to.id)
    return plan?.kind === 'objective' ? 'objetivo' : 'projeto pessoal'
  }
  const split = target ? splitCapture(target.item.text) : { title: '', notes: '' }
  const date = target ? (target.suggestion?.date ?? suggestedDate(target.item.text, today)) : ''
  const close = () => setTarget(null)

  return (
    <>
      <PageHeader
        rich
        icon={Inbox}
        eyebrow="Capture rápido, organize depois"
        title="Caixa de entrada"
        primary={{ label: 'Capturar', aria: 'Capturar na caixa de entrada', onPress: () => document.getElementById('inbox-capture')?.focus() }}
        stats={[
          { label: 'Novos', value: open.length },
          { label: 'Organizados', value: organized.length },
          { label: 'Arquivados', value: archived.length },
        ]}
      />

      <form onSubmit={capture} className="card mb-5 p-2">
        <div className="flex items-end gap-2">
          <textarea
            id="inbox-capture"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void capture(e)
              }
            }}
            rows={1}
            placeholder="O que está na sua cabeça? Ex.: pagar internet dia 10"
            aria-label="Capturar"
            className="max-h-40 min-h-12 min-w-0 flex-1 resize-none bg-transparent px-3 py-3 text-[16px] leading-snug text-ink placeholder:text-faint focus:outline-none [field-sizing:content]"
          />
          <IconButton label="Guardar" tone="accent" type="submit" className="size-12! shrink-0 rounded-2xl" disabled={!text.trim()}>
            <ArrowUp size={20} strokeWidth={2.4} />
          </IconButton>
        </div>
        {text.trim().length > 3 && (
          <p className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5 text-[12px] text-faint">
            <Sparkles size={14} className="text-accent-hi" /> Parece:
            {suggestFor(text, today, on).map((s) => (
              <span key={s.kind} className="rounded-full bg-tint/[0.06] px-2 py-0.5 font-medium text-soft">
                {s.label}
              </span>
            ))}
          </p>
        )}
      </form>

      <div className="mb-4 space-y-3">
        <Segmented<Tab>
          variant="underline"
          block
          label="Itens"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'new', label: `Novos · ${open.length}` },
            { value: 'done', label: `Organizados · ${organized.length}` },
            { value: 'archived', label: `Arquivados · ${archived.length}` },
          ]}
        />
        {data.inbox.length > 6 && <SearchField value={query} onChange={setQuery} placeholder="Buscar na caixa de entrada" />}
      </div>

      {list.length === 0 ? (
        <EmptyState
          compact
          icon={<Inbox size={20} />}
          title={query ? 'Nada encontrado' : tab === 'new' ? 'Nada para organizar' : tab === 'done' ? 'Nada organizado ainda' : 'Nada arquivado'}
          text={query ? undefined : tab === 'new' ? 'Escreva no campo acima: o Núcleo sugere para onde cada coisa vai.' : tab === 'done' ? 'O que virar tarefa, nota ou compromisso aparece aqui, com o vínculo.' : 'O que você marcar como “Já resolvi” fica aqui.'}
          action={query ? 'Limpar busca' : undefined}
          onAction={() => setQuery('')}
        />
      ) : tab === 'new' ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {list.map((item) => (
            <article key={item.id} className="card p-4">
              <button type="button" onClick={() => organize.show(item)} className="block w-full text-left">
                <span className="block text-[16px] leading-snug font-medium break-words whitespace-pre-wrap">{item.text}</span>
                <span className="mt-1 block text-[12px] text-faint">{formatDateTime(item.createdAt)}</span>
              </button>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestFor(item.text, today, on)
                  .slice(0, 2)
                  .map((s) => (
                    <button key={s.kind} type="button" onClick={() => apply(item, s)} className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-accent/[0.12] px-3 text-[13px] font-semibold text-accent-hi hover:bg-accent/[0.2]">
                      {ICON[s.kind]} {s.label}
                    </button>
                  ))}
                <button type="button" onClick={() => organize.show(item)} className="press inline-flex h-9 items-center rounded-full px-3 text-[13px] font-medium text-soft ring-1 ring-line ring-inset hover:text-ink">
                  Outro…
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-line">
          {list.slice(0, 60).map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-soft">{item.text}</span>
                <span className="block text-[12px] text-faint">
                  {item.convertedTo ? `Virou ${convertedLabel(item.convertedTo)}` : 'Arquivado'} · {item.processedAt ? formatDateTime(item.processedAt).toLowerCase() : ''}
                </span>
              </span>
              {!item.convertedTo && (
                <button type="button" onClick={() => reopen(item)} className="shrink-0 rounded-xl px-2.5 py-2 text-[13px] font-medium text-soft hover:bg-tint/[0.04] hover:text-ink">
                  Reabrir
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Sheet open={organize.open} onClose={organize.close} title="Organizar">
        {organize.item && <p className="pb-4 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-soft">{organize.item.text}</p>}
        <div className="card divide-y divide-line overflow-hidden">
          {isEnabled(settings, 'tasks') && <Choice icon={<ListTodo size={18} />} label="Tarefa" hint="Vai para Tarefas, com prazo se quiser" onClick={() => start('task')} />}
          <Choice icon={<CalendarClock size={18} />} label="Compromisso" hint="Com data e horário" onClick={() => start('event')} />
          {isEnabled(settings, 'notes') && <Choice icon={<NotebookPen size={18} />} label="Anotação" hint="Vai para Anotações" onClick={() => start('note')} />}
          {isEnabled(settings, 'recurring') && <Choice icon={<ListRestart size={18} />} label="Recorrente" hint="Conta ou rotina que se repete, com lembrete" onClick={() => start('bill')} />}
          {isEnabled(settings, 'projects') && <Choice icon={<FolderKanban size={18} />} label="Projeto de trabalho" hint="Abre o formulário de Projetos de trabalho" onClick={() => start('project')} />}
          {isEnabled(settings, 'meals') && <Choice icon={<ShoppingBasket size={18} />} label="Item da lista de compras" hint="Vai direto para a lista desta semana" onClick={() => toShopping()} />}
          {isEnabled(settings, 'meals') && <Choice icon={<Salad size={18} />} label="Refeição" hint="Abre o formulário rápido de refeição" onClick={() => start('meal')} />}
          {isEnabled(settings, 'life') && <Choice icon={<FolderHeart size={18} />} label="Projeto pessoal" hint="Viagem, mudança, reforma… com etapas" onClick={() => start('lifeProject')} />}
          {isEnabled(settings, 'life') && <Choice icon={<Compass size={18} />} label="Objetivo" hint="Algo maior, de médio ou longo prazo" onClick={() => start('objective')} />}
          <Choice icon={<Archive size={18} />} label="Já resolvi" hint="Arquiva, sem criar nada" onClick={archive} />
        </div>
        <button type="button" onClick={del} className="mt-4 flex items-center gap-2 px-1 text-[15px] text-expense hover:opacity-80">
          <Trash2 size={16} /> Excluir
        </button>
      </Sheet>

      <TaskForm open={target?.type === 'task'} onClose={close} task={null} initial={{ title: split.title, notes: split.notes, dueDate: date, dueTime: target?.suggestion?.time }} onSaved={converted('tasks')} />
      <EventForm open={target?.type === 'event'} onClose={close} event={null} initial={{ title: split.title, notes: split.notes, date, start: target?.suggestion?.time }} onSaved={converted('events')} />
      <NoteEditor open={target?.type === 'note'} onClose={close} note={null} initial={{ title: split.notes ? split.title : '', body: split.notes || split.title }} onSaved={converted('notes')} />
      <RecurringForm
        open={target?.type === 'bill'}
        onClose={close}
        item={null}
        initial={{ title: split.title, bill: true, rule: { type: 'monthly', dayOfMonth: target?.suggestion?.dayOfMonth ?? Number(today.slice(8)) } }}
        onSaved={converted('recurring')}
      />
      <ProjectForm open={target?.type === 'project'} onClose={close} project={null} initial={{ name: split.title, notes: split.notes }} onSaved={converted('projects')} />
      <MealForm open={target?.type === 'meal'} onClose={close} meal={null} initial={{ name: split.title, date: date || today }} onSaved={converted('meals')} />
      <PlanForm open={target?.type === 'lifeProject'} onClose={close} kind="project" plan={null} initial={{ title: split.title, notes: split.notes, fromInbox: target?.item.id }} onSaved={converted('lifePlans')} />
      <PlanForm open={target?.type === 'objective'} onClose={close} kind="objective" plan={null} initial={{ title: split.title, notes: split.notes, fromInbox: target?.item.id }} onSaved={converted('lifePlans')} />
    </>
  )
}
