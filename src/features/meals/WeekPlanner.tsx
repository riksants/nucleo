import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ClipboardPaste, Copy, FileUp, History, MessageCircle, Plus, Settings2 } from 'lucide-react'
import { navigate } from '../../app/router'
import { useMemo, useState } from 'react'
import { DEFAULT_MEAL_TYPES, copyWeek, fromTemplate, mealsOfWeek, mealTitle, mealTypes, sortMeals, typeLabel, weekDays } from '../../core/meals'
import { addDaysToDate, useToday, weekStart, zoneOf } from '../../core/period'
import { newId, useStore } from '../../data/store'
import type { MealEntry, MealType, WeekId } from '../../data/types'
import { Button, IconButton } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { TextInput } from '../../ui/Field'
import { useSheet } from '../../ui/formHooks'
import { Sheet } from '../../ui/Sheet'
import { useDailyActions } from '../../core/actions'
import { CheckButton } from '../daily/CheckButton'
import { Switch } from '../settings/ModulePicker'
import { weekLabel } from '../week/GoalForm'
import { MealForm, type MealInitial } from './MealForm'
import { DayStrip, MealTypeIcon } from './MealParts'
import { PasteSheet, RepeatSheet } from './QuickMeals'
import { MEALS_CURRENT } from '../planner/plans'

const DAY_NAME = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

/** Meal types: turn on/off, rename, order, add personal ones (kept in settings). */
export function MealTypesSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { settings, updateSettings } = useStore()
  const { toast } = useFeedback()
  const [name, setName] = useState('')
  const list = mealTypes(settings)
  const write = (next: MealType[]) => updateSettings({ mealTypes: next })
  const move = (i: number, dir: -1 | 1) => {
    const next = [...list]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    return write(next)
  }
  const add = async () => {
    const label = name.trim()
    if (!label) return
    if (list.some((t) => t.label.toLowerCase() === label.toLowerCase())) return toast('Esse tipo já existe', 'error')
    await write([...list, { id: `c-${newId()}`, label: label.slice(0, 40), active: true }])
    setName('')
  }
  return (
    <Sheet open={open} onClose={onClose} title="Tipos de refeição">
      <div className="space-y-4 pt-1">
        <p className="text-[14px] text-soft">Use só os que fazem sentido para você. Desligar um tipo não apaga refeições.</p>
        <div className="card divide-y divide-line">
          {list.map((t, i) => (
            <div key={t.id} className="flex min-h-14 items-center gap-1 px-3 py-1.5">
              <TextInput aria-label={`Nome do tipo ${t.label}`} defaultValue={t.label} maxLength={40} className="h-10!" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.label && write(list.map((x) => (x.id === t.id ? { ...x, label: e.target.value.trim() } : x)))} />
              <IconButton label={`Subir ${t.label}`} size="sm" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={16} />
              </IconButton>
              <IconButton label={`Descer ${t.label}`} size="sm" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={16} />
              </IconButton>
              <button type="button" role="switch" aria-checked={t.active} aria-label={`Usar ${t.label}`} onClick={() => write(list.map((x) => (x.id === t.id ? { ...x, active: !x.active } : x)))} className="shrink-0 p-1">
                <Switch checked={t.active} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <TextInput aria-label="Novo tipo de refeição" placeholder="Ex.: Pré-treino" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
          <Button variant="secondary" icon={<Plus size={18} />} onClick={add} className="shrink-0">
            Adicionar
          </Button>
        </div>
        {settings.mealTypes && (
          <button type="button" onClick={() => write(DEFAULT_MEAL_TYPES)} className="text-[13px] text-faint hover:text-soft">
            Voltar aos tipos padrão
          </button>
        )}
      </div>
    </Sheet>
  )
}

/** Monday → Sunday of one real week, one day at a time; each meal opens and edits its own record. */
export function WeekPlanner({ week, onWeek }: { week: WeekId; onWeek(w: WeekId): void }) {
  const { data, settings, save } = useStore()
  const { confirm, toast } = useFeedback()
  const { setMealDone } = useDailyActions()
  const today = useToday(zoneOf(settings))
  const current = weekStart(today)
  const form = useSheet<MealEntry>()
  const [initial, setInitial] = useState<MealInitial | undefined>()
  const [typesOpen, setTypesOpen] = useState(false)
  const days = weekDays(week)
  const [picked, setPicked] = useState<string | null>(null)
  const day = picked && days.includes(picked) ? picked : days.includes(today) ? today : days[0]
  // Only this week's meals are grouped (records of other weeks are not touched).
  const meals = useMemo(() => sortMeals(mealsOfWeek(data.meals, week), settings), [data.meals, week, settings])
  const prevWeek = addDaysToDate(week, -7)
  const prevCount = useMemo(() => mealsOfWeek(data.meals, prevWeek).length, [data.meals, prevWeek])
  const template = data.mealPlans.find((p) => p.id === MEALS_CURRENT)
  const counts = Object.fromEntries(days.map((d) => [d, meals.filter((m) => m.date === d).length]))
  const list = meals.filter((m) => m.date === day)
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay()

  const addOn = (date: string) => {
    setInitial({ date })
    form.show()
  }
  const [repeat, setRepeat] = useState(false)
  const [paste, setPaste] = useState(false)
  const [showWeek, setShowWeek] = useState(false)
  /** A meal used before, on this day: the usual form, filled in (checked there before saving). */
  const repeatOn = (m: MealEntry) => {
    setRepeat(false)
    setInitial({ date: day, type: m.type, name: m.name, time: m.time, ingredients: m.ingredients })
    form.show()
  }
  const copyPrevious = async () => {
    const ok = await confirm({
      title: 'Copiar a semana anterior?',
      message: `${prevCount} ${prevCount === 1 ? 'refeição será criada' : 'refeições serão criadas'} nesta semana, nos mesmos dias. A semana anterior não muda e nada vem marcado como realizado.${meals.length ? ` Esta semana já tem ${meals.length} — elas continuam.` : ''}`,
      confirmLabel: 'Copiar',
    })
    if (!ok) return
    for (const m of copyWeek(data.meals, prevWeek, week)) await save('meals', m)
    toast('Semana copiada')
  }
  const useTemplate = async () => {
    if (!template) return
    const ok = await confirm({ title: 'Usar o modelo aprovado nesta semana?', message: `${template.meals.length} refeições do modelo serão criadas nos dias desta semana, como planejadas. O modelo continua igual.`, confirmLabel: 'Usar' })
    if (!ok) return
    for (const m of fromTemplate(template, week, settings)) await save('meals', m)
    toast('Modelo aplicado nesta semana')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <IconButton label="Semana anterior" size="sm" onClick={() => (onWeek(prevWeek), setPicked(null))}>
          <ChevronLeft size={18} />
        </IconButton>
        <p className="min-w-0 flex-1 truncate px-1 text-center text-[15px] font-semibold">{weekLabel(week)}</p>
        <IconButton label="Próxima semana" size="sm" onClick={() => (onWeek(addDaysToDate(week, 7)), setPicked(null))}>
          <ChevronRight size={18} />
        </IconButton>
        <IconButton label="Tipos de refeição" size="sm" onClick={() => setTypesOpen(true)}>
          <Settings2 size={18} />
        </IconButton>
      </div>
      {week !== current && (
        <button type="button" onClick={() => (onWeek(current), setPicked(null))} className="mx-auto block text-[13px] font-semibold text-accent-hi">
          Voltar para esta semana
        </button>
      )}

      <DayStrip days={days} value={day} today={today} counts={counts} onPick={setPicked} label="Dias da semana" />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <section aria-label={`${DAY_NAME[wd]} ${day.slice(8, 10)}/${day.slice(5, 7)}`}>
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
              {DAY_NAME[wd]} <span className="font-normal text-faint">{day.slice(8, 10)}/{day.slice(5, 7)}</span>
              {day === today && <span className="ml-2 text-[12px] font-semibold text-accent-hi">hoje</span>}
            </h2>
            <button type="button" onClick={() => addOn(day)} className="press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold text-accent-hi hover:bg-accent/[0.08]">
              <Plus size={16} /> Refeição
            </button>
          </div>
          <div className="no-scrollbar -mx-1 mb-2.5 flex gap-2 overflow-x-auto px-1">
            <button type="button" onClick={() => setRepeat(true)} className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-medium text-soft hover:text-ink">
              <History size={14} /> Repetir anterior
            </button>
            <button type="button" onClick={() => setPaste(true)} className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-medium text-soft hover:text-ink">
              <ClipboardPaste size={14} /> Colar várias
            </button>
            <button type="button" onClick={() => navigate('/intake', { target: 'meals' })} className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-medium text-soft hover:text-ink">
              <FileUp size={14} /> Importar dieta
            </button>
          </div>
          {list.length ? (
            <div className="card divide-y divide-line">
              {list.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                  <MealTypeIcon type={m.type} />
                  <button type="button" onClick={() => form.show(m)} className="min-w-0 flex-1 text-left">
                    <span className="flex items-center gap-2">
                      {m.time && <span className="num shrink-0 text-[13px] font-medium text-soft">{m.time}</span>}
                      <span className={`truncate text-[15px] font-medium ${m.done ? 'text-faint' : ''}`}>{mealTitle(settings, m)}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.done ? 'bg-income/[0.14] text-income' : 'bg-tint/[0.06] text-faint'}`}>{m.done ? 'Feita' : 'Planejada'}</span>
                    </span>
                    {(m.name && m.type) || m.ingredients.length ? (
                      <span className="mt-0.5 block truncate text-[13px] text-faint">{[m.name && m.type ? typeLabel(settings, m.type) : '', m.ingredients.join(' · ')].filter(Boolean).join(' — ')}</span>
                    ) : null}
                  </button>
                  <CheckButton status={m.done ? 'done' : 'pending'} onClick={() => setMealDone(m, !m.done)} label={m.done ? `Desmarcar ${mealTitle(settings, m)}` : `Marcar ${mealTitle(settings, m)} como realizada`} />
                </div>
              ))}
            </div>
          ) : (
            <div className="card px-4 py-5 text-center">
              <p className="text-[15px] text-soft">Nada planejado para este dia.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button variant="secondary" icon={<Plus size={16} />} onClick={() => addOn(day)}>
                  Adicionar refeição
                </Button>
                {!meals.length && prevCount > 0 && (
                  <Button variant="ghost" icon={<Copy size={16} />} onClick={copyPrevious}>
                    Copiar semana anterior
                  </Button>
                )}
                {!meals.length && template && (
                  <Button variant="ghost" icon={<MessageCircle size={16} />} onClick={useTemplate}>
                    Usar modelo aprovado
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>

        <button type="button" aria-expanded={showWeek} onClick={() => setShowWeek(!showWeek)} className="-mt-2 px-1 text-left text-[13px] font-semibold text-soft hover:text-ink lg:hidden">
          {showWeek ? 'Esconder a semana' : 'Ver a semana inteira'}
        </button>
        <section aria-label="Resumo da semana" className={showWeek ? 'block' : 'hidden lg:block'}>
          <h2 className="mb-2 px-1 text-[13px] font-semibold text-soft">Semana</h2>
          <ul className="card divide-y divide-line">
            {days.map((d) => {
              const ms = meals.filter((m) => m.date === d)
              const w = new Date(`${d}T12:00:00Z`).getUTCDay()
              return (
                <li key={d}>
                  <button type="button" onClick={() => setPicked(d)} className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-tint/[0.03] ${d === day ? 'text-accent-hi' : ''}`}>
                    <span className="w-[4.5rem] shrink-0 text-[14px] font-medium">{DAY_NAME[w]}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-faint">{ms.length ? ms.map((m) => mealTitle(settings, m)).join(' · ') : 'Nada planejado'}</span>
                    <span className="num shrink-0 text-[13px] text-soft">{ms.filter((m) => m.done).length}/{ms.length}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {meals.length > 0 && prevCount > 0 && (
            <button type="button" onClick={copyPrevious} className="mt-3 px-1 text-[13px] font-medium text-soft hover:text-ink">
              Copiar refeições da semana anterior
            </button>
          )}
        </section>
      </div>

      <MealForm open={form.open} onClose={form.close} meal={form.item} initial={form.item ? undefined : initial} />
      <MealTypesSheet open={typesOpen} onClose={() => setTypesOpen(false)} />
      <RepeatSheet open={repeat} onClose={() => setRepeat(false)} onPick={repeatOn} />
      <PasteSheet open={paste} onClose={() => setPaste(false)} date={day} />
    </div>
  )
}
