/**
 * Rotina: one activity, on one or several days. New activities are only added (the rest of the plan is never
 * rewritten); a change asks whether it is for this day or every day with the same activity; "Duplicar" copies
 * it to other days that don't have it yet. A sentence can fill the form ("Academia seg, qua e sex das 7h às 8h").
 */
import { Copy, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { DAY_LONG, findConflicts, KIND_LABEL, sortBlocks } from '../../../supabase/functions/_shared/planner/schedule.ts'
import { isTime, toMinutes } from '../../../supabase/functions/_shared/planner/time.ts'
import { useToday, zoneOf } from '../../core/period'
import { addActivity, duplicateActivity, emptyRoutine, kindFromTitle, parseRoutineLine, removeActivity, sameActivity, updateActivity, type Scope } from '../../core/routine'
import { newId, useStore } from '../../data/store'
import type { BlockKind, RoutineAnswers, RoutineBlock, RoutinePlan, Weekday } from '../../data/types'
import { Button } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, Select, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { MoreOptions } from '../daily/SmartCapture'
import { DayPicker } from './controls'

const REMIND: { value: string; label: string }[] = [
  { value: '', label: 'Padrão das notificações' },
  { value: 'off', label: 'Não lembrar' },
  { value: '0', label: 'Na hora' },
  { value: '5', label: '5 min antes' },
  { value: '10', label: '10 min antes' },
  { value: '15', label: '15 min antes' },
  { value: '30', label: '30 min antes' },
]
const remindOf = (v: string): number | false | undefined => (v === '' ? undefined : v === 'off' ? false : Number(v))
const remindValue = (r: RoutineBlock['remindMin']) => (r === undefined ? '' : r === false ? 'off' : String(r))

/** `plan`: the plan being edited (null = no routine yet: a manual one is created on the first save). */
export function ActivitySheet({ open, onClose, block, plan, answers, day }: { open: boolean; onClose(): void; block: RoutineBlock | null; plan: RoutinePlan | null; answers: RoutineAnswers; day: Weekday }) {
  const { settings, save } = useStore()
  const { toast, confirm } = useFeedback()
  const today = useToday(zoneOf(settings))
  const base = (plan ?? emptyRoutine()) as RoutinePlan
  const siblings = block ? sameActivity(base, block) : []
  const [line, setLine] = useState('')
  const [ask, setAsk] = useState<[string, string] | null>(null)
  const [d, set, setAll] = useDraft(open, () => ({
    title: block?.title ?? '',
    kind: (block?.kind ?? 'activity') as BlockKind,
    kindTouched: Boolean(block),
    start: block?.start ?? '',
    end: block?.end ?? '',
    days: block ? [block.day] : [day],
    remind: remindValue(block?.remindMin),
    scope: 'one' as Scope,
    copyTo: [] as Weekday[],
  }))

  const fill = () => {
    if (!line.trim()) return
    const p = parseRoutineLine(line, today)
    setAsk(p.timeOptions ?? null)
    setAll((x) => ({ ...x, title: p.title || x.title, kind: p.kind, kindTouched: false, start: p.start || x.start, end: p.end || x.end, days: p.days.length ? p.days : x.days }))
  }

  const check = (next: RoutinePlan, ids: string[]) => findConflicts(sortBlocks(next.blocks), answers).find((c) => c.ids.some((id) => ids.includes(id)))?.message ?? null

  const submit = async () => {
    const title = d.title.trim()
    if (!title) return 'Dê um nome à atividade'
    if (!isTime(d.start) || !isTime(d.end) || toMinutes(d.end) <= toMinutes(d.start)) return 'Confira os horários (o fim depois do início)'
    if (!block && !d.days.length) return 'Escolha pelo menos um dia'
    const remindMin = remindOf(d.remind)
    let next: RoutinePlan
    let ids: string[]
    if (block) {
      next = updateActivity(base, block, { title, kind: d.kind, start: d.start, end: d.end, remindMin }, d.scope)
      ids = ids_(base, block, d.scope)
      if (d.copyTo.length) {
        const dup = duplicateActivity(next, { ...block, title, kind: d.kind, start: d.start, end: d.end, ...(remindMin !== undefined ? { remindMin } : {}) }, d.copyTo, newId)
        next = dup.plan
        ids = [...ids, ...dup.added.map((b) => b.id)]
      }
    } else {
      const added = addActivity(base, { title, kind: d.kind, start: d.start, end: d.end, days: d.days, ...(remindMin !== undefined ? { remindMin } : {}) }, newId)
      if (!added.added.length) return 'Essa atividade já está nesses dias'
      next = added.plan
      ids = added.added.map((b) => b.id)
    }
    const clash = check(next, ids)
    if (clash) return clash
    await save('routinePlans', { ...next, blocks: sortBlocks(next.blocks) })
    toast(block ? (d.scope === 'all' && siblings.length > 1 ? `Atualizado em ${siblings.length} dias` : 'Atividade atualizada') : ids.length > 1 ? `Adicionado em ${ids.length} dias` : 'Adicionado à rotina')
    onClose()
  }

  const del = async () => {
    if (!block) return
    const all = d.scope === 'all' && siblings.length > 1
    const ok = await confirm({ title: all ? `Remover de ${siblings.length} dias?` : 'Remover este dia?', message: 'As marcações já feitas ficam guardadas. Os outros horários da rotina não mudam.', confirmLabel: 'Remover', danger: true })
    if (!ok) return
    await save('routinePlans', removeActivity(base, block, d.scope))
    toast('Removido da rotina')
    onClose()
  }

  return (
    <FormSheet open={open} onClose={onClose} title={block ? 'Editar atividade' : 'Nova atividade'} submitLabel={block ? 'Salvar' : 'Adicionar'} onSubmit={submit} onDelete={block ? del : undefined}>
      <FormGrid>
        {!block && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <TextInput aria-label="Descrever em uma frase" placeholder="Ex.: Academia seg, qua e sex das 7h às 8h" value={line} onChange={(e) => setLine(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), fill())} />
              <Button variant="secondary" icon={<Sparkles size={16} />} onClick={fill} disabled={!line.trim()} className="h-12! shrink-0 px-4!">
                Preencher
              </Button>
            </div>
            {ask && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-warn/[0.08] px-3.5 py-2.5 text-[14px]">
                <span className="font-medium">Qual horário?</span>
                {ask.map((t) => (
                  <button key={t} type="button" onClick={() => (setAll((x) => ({ ...x, start: t, end: plusHour(t) })), setAsk(null))} className="press h-8 rounded-full border border-line bg-surface px-3 text-[13px] font-medium">
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <Field label="O quê">
          <TextInput value={d.title} placeholder="Ex.: Estudar inglês" onChange={(e) => setAll((x) => ({ ...x, title: e.target.value, kind: x.kindTouched ? x.kind : kindFromTitle(e.target.value) }))} autoFocus={!block} />
        </Field>
        {block ? (
          siblings.length > 1 && (
            <Field label="Aplicar a">
              <Segmented<Scope>
                block
                size="sm"
                label="Aplicar a"
                value={d.scope}
                onChange={(v) => set('scope', v)}
                options={[
                  { value: 'one', label: `Só ${DAY_LONG[block.day].toLowerCase()}` },
                  { value: 'all', label: `Todos os ${siblings.length} dias` },
                ]}
              />
            </Field>
          )
        ) : (
          <Field label="Dias">
            <DayPicker value={d.days} onChange={(days) => set('days', days as Weekday[])} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Início">
            <TextInput type="time" value={d.start} onChange={(e) => setAll((x) => ({ ...x, start: e.target.value, end: x.end && isTime(e.target.value) && toMinutes(x.end) > toMinutes(e.target.value) ? x.end : isTime(e.target.value) ? plusHour(e.target.value) : x.end }))} />
          </Field>
          <Field label="Fim">
            <TextInput type="time" value={d.end} onChange={(e) => set('end', e.target.value)} />
          </Field>
        </div>
        <MoreOptions defaultOpen={Boolean(block && block.remindMin !== undefined)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <Select value={d.kind} onChange={(e) => setAll((x) => ({ ...x, kind: e.target.value as BlockKind, kindTouched: true }))}>
                {(Object.keys(KIND_LABEL) as BlockKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lembrar">
              <Select value={d.remind} onChange={(e) => set('remind', e.target.value)}>
                {REMIND.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {block && (
            <Field label="Duplicar para" hint="só nos dias que ainda não têm">
              <div className="space-y-1.5">
                <DayPicker value={d.copyTo} onChange={(days) => set('copyTo', (days as Weekday[]).filter((x) => x !== block.day))} />
                <p className="flex items-center gap-1.5 text-[12px] text-faint">
                  <Copy size={14} /> Os outros horários da rotina não mudam.
                </p>
              </div>
            </Field>
          )}
          {(d.kind === 'training' || d.kind === 'study') && <p className="text-[13px] leading-relaxed text-faint">Para ligar a um hábito (Treinar, Estudar), use "Vincular a" no próprio hábito: o dia mostra uma linha só.</p>}
        </MoreOptions>
        {block?.fixed && <p className="text-[13px] text-faint">Este horário veio de um compromisso fixo do questionário.</p>}
      </FormGrid>
    </FormSheet>
  )
}

function plusHour(t: string) {
  const m = Math.min(toMinutes(t) + 60, 23 * 60 + 59)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

const ids_ = (plan: RoutinePlan, block: RoutineBlock, scope: Scope) => (scope === 'all' ? sameActivity(plan, block) : [block]).map((b) => b.id)
