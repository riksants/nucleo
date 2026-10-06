import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, MessageCircle, Plus, Settings2 } from 'lucide-react'
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
          <Button variant="secondary" icon={<Plus size={17} />} onClick={add} className="shrink-0">
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

/** Monday → Sunday of one real week; each meal opens and edits its own record. */
export function WeekPlanner({ week, onWeek }: { week: WeekId; onWeek(w: WeekId): void }) {
  const { data, settings, save } = useStore()
  const { confirm, toast } = useFeedback()
  const { setMealDone } = useDailyActions()
  const today = useToday(zoneOf(settings))
  const current = weekStart(today)
  const form = useSheet<MealEntry>()
  const [initial, setInitial] = useState<MealInitial | undefined>()
  const [typesOpen, setTypesOpen] = useState(false)
  // Only this week's meals are grouped (records of other weeks are not touched).
  const meals = useMemo(() => sortMeals(mealsOfWeek(data.meals, week), settings), [data.meals, week, settings])
  const prevWeek = addDaysToDate(week, -7)
  const prevCount = useMemo(() => mealsOfWeek(data.meals, prevWeek).length, [data.meals, prevWeek])
  const template = data.mealPlans.find((p) => p.id === MEALS_CURRENT)

  const addOn = (date: string) => {
    setInitial({ date })
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
    const ok = await confirm({ title: 'Usar o plano da IA nesta semana?', message: `${template.meals.length} refeições do plano serão criadas nos dias desta semana. O plano continua igual.`, confirmLabel: 'Usar' })
    if (!ok) return
    for (const m of fromTemplate(template, week, settings)) await save('meals', m)
    toast('Plano aplicado nesta semana')
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <IconButton label="Semana anterior" size="sm" onClick={() => onWeek(prevWeek)}>
            <ChevronLeft size={18} />
          </IconButton>
          <p className="min-w-0 truncate px-1 text-[15px] font-semibold">{weekLabel(week)}</p>
          <IconButton label="Próxima semana" size="sm" onClick={() => onWeek(addDaysToDate(week, 7))}>
            <ChevronRight size={18} />
          </IconButton>
          {week !== current && (
            <Button variant="ghost" className="h-9! px-3!" onClick={() => onWeek(current)}>
              Esta semana
            </Button>
          )}
        </div>
        <IconButton label="Tipos de refeição" size="sm" onClick={() => setTypesOpen(true)}>
          <Settings2 size={17} />
        </IconButton>
        <Button icon={<Plus size={18} />} onClick={() => addOn(week <= today && today <= addDaysToDate(week, 6) ? today : week)}>
          Refeição
        </Button>
      </div>

      {(prevCount > 0 || (template && !meals.length)) && (
        <div className="flex flex-wrap gap-2">
          {prevCount > 0 && (
            <Button variant="secondary" icon={<Copy size={16} />} onClick={copyPrevious}>
              Copiar semana anterior
            </Button>
          )}
          {template && !meals.length && (
            <Button variant="secondary" icon={<MessageCircle size={16} />} onClick={useTemplate}>
              Usar plano da IA
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {weekDays(week).map((date) => {
          const list = meals.filter((m) => m.date === date)
          const wd = new Date(`${date}T12:00:00Z`).getUTCDay()
          return (
            <section key={date} className={`card p-2 ${date === today ? 'border-accent-hi/40' : ''}`} aria-label={`${DAY_NAME[wd]} ${date.slice(8, 10)}/${date.slice(5, 7)}`}>
              <div className="flex items-center gap-2 px-2 pt-1">
                <p className="min-w-0 flex-1 text-[14px] font-semibold">
                  {DAY_NAME[wd]} <span className="font-normal text-faint">{date.slice(8, 10)}/{date.slice(5, 7)}</span>
                  {date === today && <span className="ml-2 text-[12px] font-medium text-accent-hi">hoje</span>}
                </p>
                <IconButton label={`Adicionar refeição em ${DAY_NAME[wd]}`} size="sm" onClick={() => addOn(date)}>
                  <Plus size={17} />
                </IconButton>
              </div>
              {list.length ? (
                list.map((m) => (
                  <div key={m.id} className="flex items-start gap-1 rounded-2xl hover:bg-tint/[0.03] tap">
                    <CheckButton status={m.done ? 'done' : 'pending'} onClick={() => setMealDone(m, !m.done)} label={m.done ? `Desmarcar ${mealTitle(settings, m)}` : `Marcar ${mealTitle(settings, m)} como realizada`} />
                    <button type="button" onClick={() => form.show(m)} className="min-w-0 flex-1 py-2.5 pr-2 text-left">
                      <span className={`block truncate text-[15px] ${m.done ? 'text-faint line-through' : ''}`}>
                        {m.time && <span className="num mr-2 text-soft">{m.time}</span>}
                        {mealTitle(settings, m)}
                      </span>
                      {(m.name && m.type) || m.ingredients.length ? (
                        <span className="block truncate text-[13px] text-faint">{[m.name && m.type ? typeLabel(settings, m.type) : '', m.ingredients.join(', ')].filter(Boolean).join(' · ')}</span>
                      ) : null}
                    </button>
                  </div>
                ))
              ) : (
                <p className="px-2 pt-1 pb-2 text-[13px] text-faint">Nada planejado</p>
              )}
            </section>
          )
        })}
      </div>

      <MealForm open={form.open} onClose={form.close} meal={form.item} initial={form.item ? undefined : initial} />
      <MealTypesSheet open={typesOpen} onClose={() => setTypesOpen(false)} />
    </div>
  )
}
