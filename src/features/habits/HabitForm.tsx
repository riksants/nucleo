import { BedDouble, BookOpen, Brain, Droplets, Dumbbell, GraduationCap, Salad, type LucideIcon } from 'lucide-react'
import { isTime } from '../../../supabase/functions/_shared/planner/time.ts'
import { isEnabled } from '../../app/modules'
import { nowIn, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import { CATEGORY_LABEL } from '../../core/weekGoals'
import type { Habit, HabitCategory, HabitLink, RecurrenceRule } from '../../data/types'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, Select, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft } from '../../ui/formHooks'
import { ToggleRow } from '../planner/controls'
import { RuleEditor, ruleProblem } from '../daily/RuleEditor'
import { MoreOptions, SmartLine } from '../daily/SmartCapture'

/** Presets set the name, the category (links to weekly metrics) and a sensible time and length to start from. */
const PRESETS: { name: string; category: HabitCategory; icon: LucideIcon; time?: string; minutes?: number; goal?: string }[] = [
  { name: 'Beber água', category: 'water', icon: Droplets, goal: '2 litros' },
  { name: 'Treinar', category: 'training', icon: Dumbbell, time: '07:00', minutes: 45 },
  { name: 'Estudar', category: 'study', icon: GraduationCap, time: '18:00', minutes: 30 },
  { name: 'Ler', category: 'reading', icon: BookOpen, time: '21:00', minutes: 20 },
  { name: 'Meditar', category: 'meditation', icon: Brain, time: '07:30', minutes: 10 },
  { name: 'Dormir cedo', category: 'sleep', icon: BedDouble, time: '23:00' },
  { name: 'Comer bem', category: 'food', icon: Salad },
]

const TIMES = [
  { label: 'Manhã', time: '07:00' },
  { label: 'Tarde', time: '13:00' },
  { label: 'Noite', time: '20:00' },
]
const LENGTHS = [10, 20, 30, 45, 60]

const chip = (on: boolean) =>
  `press h-9 shrink-0 rounded-full border px-3.5 text-[14px] font-medium transition-colors ${on ? 'border-accent/40 bg-accent/[0.14] text-accent-hi' : 'border-line bg-surface text-soft hover:text-ink'}`

/** Values suggested by the cadastro inteligente ("ler 20 minutos por dia"). */
export interface HabitInitial {
  name?: string
  rule?: RecurrenceRule
  time?: string
  minutes?: number
}

const linkValue = (l: HabitLink | undefined) => (!l ? '' : l.kind === 'recurring' ? `recurring:${l.id}` : `routine:${l.blockKind}`)
function parseLink(v: string): HabitLink | undefined {
  if (v.startsWith('recurring:')) return { kind: 'recurring', id: v.slice(10) }
  if (v === 'routine:training' || v === 'routine:study') return { kind: 'routine', blockKind: v.slice(8) as 'training' | 'study' }
  return undefined
}

/**
 * New/edit habit. Up front only what matters: what, how often, when. The rest (session length, target,
 * category, reminder, link) waits under "Mais opções".
 */
export function HabitForm({ open, onClose, habit, initial }: { open: boolean; onClose(): void; habit: Habit | null; initial?: HabitInitial }) {
  const { data, save, remove, settings } = useStore()
  const { toast, confirm } = useFeedback()
  const now = nowIn(zoneOf(settings))
  const [d, set, setAll] = useDraft(open, () => ({
    name: habit?.name ?? initial?.name ?? '',
    rule: (habit?.rule ?? initial?.rule ?? { type: 'daily' }) as RecurrenceRule,
    time: habit?.time ?? initial?.time ?? '',
    goal: habit?.goal ?? '',
    minutes: habit?.minutes ? String(habit.minutes) : initial?.minutes ? String(initial.minutes) : '',
    active: habit?.active ?? true,
    category: (habit?.category ?? '') as HabitCategory | '',
    remind: habit?.remind !== false,
    link: linkValue(habit?.link),
    auto: habit?.autoFromLink === true,
  }))
  const linkable = data.recurring.filter((r) => r.active && (!r.endDate || r.endDate >= now.date))
  const routineOn = isEnabled(settings, 'routine') && data.routinePlans.some((p) => p.id === 'routine-current')

  const submit = async () => {
    if (!d.name.trim()) return 'Dê um nome ao hábito'
    const problem = ruleProblem(d.rule)
    if (problem) return problem
    if (d.time && !isTime(d.time)) return 'Confira o horário'
    const minutes = d.minutes ? Math.round(Number(d.minutes)) : 0
    if (d.minutes && (!Number.isFinite(minutes) || minutes < 1 || minutes > 600)) return 'Duração entre 1 e 600 minutos'
    const link = parseLink(d.link)
    await save('habits', {
      ...habit,
      name: d.name.trim(),
      rule: d.rule,
      time: d.time,
      goal: d.goal.trim(),
      minutes: minutes || undefined,
      active: d.active,
      category: d.category || undefined,
      remind: d.remind ? undefined : false,
      link,
      autoFromLink: link && d.auto ? true : undefined,
      startDate: habit?.startDate ?? now.date,
    })
    toast(habit ? 'Hábito atualizado' : d.time ? `Hábito criado: aparece no seu dia às ${d.time}` : 'Hábito criado')
    onClose()
  }

  const del = async () => {
    if (!habit) return
    const ok = await confirm({
      title: 'Excluir hábito?',
      message: 'Para pausar sem perder nada, desative em vez de excluir. O histórico de dias marcados fica guardado.',
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (!ok) return
    await remove('habits', habit.id)
    toast('Hábito excluído')
    onClose()
  }

  return (
    <FormSheet open={open} onClose={onClose} title={habit ? 'Editar hábito' : 'Novo hábito'} submitLabel={habit ? 'Salvar' : 'Criar hábito'} onSubmit={submit} onDelete={habit ? del : undefined}>
      <FormGrid>
        {!habit && (
          <SmartLine
            placeholder="Ex.: Ler 20 minutos por dia às 21h"
            onDraft={(x) => setAll((v) => ({ ...v, name: x.title || v.name, rule: x.rule ?? v.rule, time: x.time ?? v.time, minutes: x.minutes ? String(x.minutes) : v.minutes }))}
          />
        )}
        {!habit && !d.name && (
          <div>
            <p className="mb-2 text-[13px] font-medium text-soft">Ou comece por um destes</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setAll((x) => ({ ...x, name: p.name, category: p.category, time: p.time ?? x.time, minutes: p.minutes ? String(p.minutes) : x.minutes, goal: p.goal ?? x.goal }))}
                  className="press flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-3 py-2.5 text-left text-[14px] font-medium hover:border-line-strong"
                >
                  <span className="icon-tile grid size-8 shrink-0 place-items-center rounded-xl">
                    <p.icon size={16} />
                  </span>
                  <span className="min-w-0 truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Hábito">
          <TextInput value={d.name} placeholder="Ex.: Estudar inglês" onChange={(e) => set('name', e.target.value)} autoFocus={!habit && !initial} />
        </Field>

        <RuleEditor key={`${open}:${habit?.id ?? 'new'}`} fresh={!habit} value={d.rule} onChange={(r) => set('rule', r)} kinds={['daily', 'weekly', 'interval']} today={now.weekday} />

        <Field label="Horário" hint="opcional · com horário, entra no seu dia">
          <div className="space-y-2">
            <div className="no-scrollbar flex gap-2 overflow-x-auto">
              <button type="button" onClick={() => set('time', '')} className={chip(!d.time)}>
                Sem horário
              </button>
              {TIMES.map((t) => (
                <button key={t.label} type="button" onClick={() => set('time', t.time)} className={chip(d.time === t.time)}>
                  {t.label} · {t.time}
                </button>
              ))}
            </div>
            <TextInput type="time" aria-label="Horário exato" value={d.time} onChange={(e) => set('time', e.target.value)} />
          </div>
        </Field>

        <MoreOptions defaultOpen={Boolean(habit?.link || (initial?.minutes && !habit))}>
          <Field label="Duração da sessão" hint="ao usar o cronômetro e atingir, o dia é marcado sozinho">
            <div className="no-scrollbar flex gap-2 overflow-x-auto">
              <button type="button" onClick={() => set('minutes', '')} className={chip(!d.minutes)}>
                Sem duração
              </button>
              {[...new Set([...LENGTHS, ...(d.minutes && !LENGTHS.includes(Number(d.minutes)) ? [Number(d.minutes)] : [])])].map((m) => (
                <button key={m} type="button" onClick={() => set('minutes', String(m))} className={chip(d.minutes === String(m))}>
                  {m} min
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Meta" hint="opcional">
              <TextInput value={d.goal} placeholder="Ex.: 2 litros" onChange={(e) => set('goal', e.target.value)} />
            </Field>
            <Field label="Categoria">
              <Select value={d.category} onChange={(e) => set('category', e.target.value as HabitCategory | '')}>
                <option value="">Nenhuma</option>
                {(Object.keys(CATEGORY_LABEL) as HabitCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {d.time && (
            <ToggleRow checked={d.remind} onChange={(v) => set('remind', v)} hint="Um aviso no horário; nunca depois de marcado">
              Lembrar
            </ToggleRow>
          )}

          {(linkable.length > 0 || routineOn) && (
            <Field label="Vincular a" hint="opcional · uma linha só no seu dia">
              <Select value={d.link} onChange={(e) => set('link', e.target.value)}>
                <option value="">Nada</option>
                {routineOn && <option value="routine:training">Treino da rotina</option>}
                {routineOn && <option value="routine:study">Estudo da rotina</option>}
                {linkable.map((r) => (
                  <option key={r.id} value={`recurring:${r.id}`}>
                    {r.title} (recorrente)
                  </option>
                ))}
                {d.link.startsWith('recurring:') && !linkable.some((r) => `recurring:${r.id}` === d.link) && <option value={d.link}>Recorrente encerrado</option>}
              </Select>
            </Field>
          )}
          {d.link && (
            <ToggleRow checked={d.auto} onChange={(v) => set('auto', v)} hint={d.auto ? 'Concluir o item vinculado marca este hábito junto' : 'Ao concluir o item vinculado, o Núcleo pergunta se marca o hábito'}>
              Marcar junto automaticamente
            </ToggleRow>
          )}
        </MoreOptions>

        {habit && (
          <ToggleRow checked={d.active} onChange={(v) => set('active', v)} hint="Desativado: some do dia, o histórico fica">
            Ativo
          </ToggleRow>
        )}
      </FormGrid>
    </FormSheet>
  )
}
