import { Mountain } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDailyActions } from '../../core/actions'
import { isEnabled } from '../../app/modules'
import { challengeState, CHALLENGE_STATUS_LABEL, CHALLENGE_TEMPLATES, endDateOf, FINANCE_NOSPEND, type ChallengeTemplate } from '../../core/challenges'
import { statusOf, type CompletionIndex } from '../../core/completions'
import { addDaysToDate, weekdayOfDate } from '../../core/period'
import { CATEGORY_LABEL } from '../../core/weekGoals'
import { useStore } from '../../data/store'
import type { Challenge, ChallengeMode, HabitCategory } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { Button } from '../../ui/Button'
import { Badge, Progress, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, Select, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft, useSheet } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { NumberInput } from '../planner/controls'

const TONE = { not_started: 'neutral', active: 'accent', completed: 'positive', ended: 'neutral' } as const

function ChallengeForm({ open, onClose, today }: { open: boolean; onClose(): void; today: string }) {
  const { data, save, settings } = useStore()
  const { toast } = useFeedback()
  const categories = [...new Set(data.habits.map((h) => h.category).filter(Boolean))] as HabitCategory[]
  const [template, setTemplate] = useState<ChallengeTemplate | null>(null)
  const [d, set, setAll] = useDraft(open, () => ({ name: '', mode: 'daily' as ChallengeMode, rule: 'manual', target: 7, durationDays: 7, startDate: today }))

  const pick = (t: ChallengeTemplate | null) => {
    setTemplate(t)
    if (t) setAll((x) => ({ ...x, name: t.name, mode: t.mode, rule: t.rule, target: t.target, durationDays: t.durationDays }))
  }

  const submit = async () => {
    if (!d.name.trim()) return 'Dê um nome ao desafio'
    if (d.target < 1 || d.durationDays < 1) return 'Confira a duração e o objetivo'
    await save('challenges', {
      template: template?.id ?? null,
      name: d.name.trim(),
      objective: template?.objective ?? (d.mode === 'daily' ? `Cumprir todos os ${d.durationDays} dias` : `Chegar a ${d.target} no período`),
      mode: d.mode,
      rule: d.rule,
      // Daily: every valid day of the period (e.g. weekdays only) must be met.
      target: d.mode === 'daily' ? Array.from({ length: d.durationDays }, (_, i) => addDaysToDate(d.startDate, i)).filter((x) => !template?.days?.length || template.days.includes(weekdayOfDate(x))).length : d.target,
      startDate: d.startDate,
      durationDays: d.durationDays,
      endedAt: null,
      ...(template?.days ? { days: template.days } : {}),
    })
    toast('Desafio criado')
    setTemplate(null)
    onClose()
  }

  const rules: { value: string; label: string }[] =
    d.mode === 'daily'
      ? [
          { value: 'manual', label: 'Eu marco cada dia' },
          ...(isEnabled(settings, 'finance') ? [{ value: FINANCE_NOSPEND, label: 'Sem gasto desnecessário (Financeiro)' }] : []),
          { value: 'training', label: 'Treino feito no dia' },
          { value: 'routine:80', label: '80% da rotina no dia' },
          ...categories.map((c) => ({ value: `category:${c}`, label: `Hábito de ${CATEGORY_LABEL[c].toLowerCase()} feito` })),
          ...data.habits.filter((h) => h.active).map((h) => ({ value: `habit:${h.id}`, label: `Hábito: ${h.name}` })),
        ]
      : [
          { value: 'training.days', label: 'Dias de treino' },
          { value: 'study.days', label: 'Dias com estudo' },
          { value: 'tasks.completed', label: 'Tarefas concluídas' },
          ...categories.map((c) => ({ value: `category:${c}`, label: `Dias com ${CATEGORY_LABEL[c].toLowerCase()}` })),
          ...data.habits.filter((h) => h.active).map((h) => ({ value: `habit:${h.id}`, label: `Hábito: ${h.name}` })),
        ]

  return (
    <FormSheet open={open} onClose={onClose} title="Novo desafio" submitLabel="Começar desafio" onSubmit={submit}>
      <div className="-mx-1 mb-5 flex flex-wrap gap-2">
        {CHALLENGE_TEMPLATES.map((t) => (
          <button key={t.id} type="button" aria-pressed={template?.id === t.id} onClick={() => pick(t)} className={`press h-9 rounded-full border px-3.5 text-[14px] font-medium ${template?.id === t.id ? 'border-transparent bg-ink text-bg' : 'border-line bg-surface text-soft hover:text-ink'}`}>
            {t.name}
          </button>
        ))}
        <button type="button" aria-pressed={!template} onClick={() => pick(null)} className={`press h-9 rounded-full border px-3.5 text-[14px] font-medium ${!template ? 'border-transparent bg-ink text-bg' : 'border-line bg-surface text-soft hover:text-ink'}`}>
          Personalizado
        </button>
      </div>
      <FormGrid>
        <Field label="Nome">
          <TextInput value={d.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        {!template && (
          <>
            <Field label="Como funciona">
              <Segmented block value={d.mode} onChange={(m) => setAll((x) => ({ ...x, mode: m, rule: m === 'daily' ? 'manual' : 'training.days' }))} options={[{ value: 'daily', label: 'Todo dia' }, { value: 'total', label: 'Total no período' }]} />
            </Field>
            <Field label={d.mode === 'daily' ? 'Cada dia conta quando' : 'Somar'}>
              <Select value={d.rule} onChange={(e) => set('rule', e.target.value)}>
                {rules.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            {d.mode === 'total' && (
              <Field label="Objetivo">
                <NumberInput label="Objetivo" value={d.target} min={1} max={1000} onChange={(v) => set('target', v)} />
              </Field>
            )}
          </>
        )}
        <div className="half">
          <Field label="Duração">
            <NumberInput label="Duração em dias" value={d.durationDays} min={1} max={90} suffix="dias" onChange={(v) => set('durationDays', v)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Começa em">
            <TextInput type="date" min={today} value={d.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
        </div>
        {d.rule === FINANCE_NOSPEND && <p className="text-[13px] leading-relaxed text-faint">Usa suas saídas do Financeiro: o dia conta quando há saídas registradas e nenhuma marcada como desnecessária. Dia sem nenhum registro não é considerado automaticamente — você pode confirmar tocando nele.</p>}
      </FormGrid>
    </FormSheet>
  )
}

/** Personal challenges (no ranking). Progress comes from the same metrics as goals. */
export function ChallengesSection({ today, index }: { today: string; index: CompletionIndex }) {
  const { data, settings, save, remove } = useStore()
  const { setCompletion } = useDailyActions()
  const { confirm, toast } = useFeedback()
  const [creating, setCreating] = useState(false)
  const detail = useSheet<string>()
  const [showPast, setShowPast] = useState(false)
  const states = useMemo(() => data.challenges.map((c) => ({ c, s: challengeState(c, data, settings) })), [data, settings])
  const live = states.filter(({ s }) => s.status === 'active' || s.status === 'not_started')
  const past = states.filter(({ s }) => s.status === 'completed' || s.status === 'ended').sort((a, b) => (a.s.endDate < b.s.endDate ? 1 : -1))
  const open = states.find(({ c }) => c.id === detail.item) ?? null

  const end = async (c: Challenge) => {
    const ok = await confirm({ title: 'Encerrar desafio?', message: 'Ele vai para o histórico como encerrado. Nada é apagado.', confirmLabel: 'Encerrar' })
    if (!ok) return
    await save('challenges', { ...c, endedAt: new Date().toISOString() })
    detail.close()
  }

  return (
    <section>
      <SectionTitle action="Novo desafio" onAction={() => setCreating(true)}>
        Desafios
      </SectionTitle>
      {live.length ? (
        <div className="card divide-y divide-line">
          {live.map(({ c, s }) => (
            <button key={c.id} type="button" onClick={() => detail.show(c.id)} className="block w-full px-4 py-3.5 text-left hover:bg-white/[0.03]">
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{c.name}</span>
                <Badge tone={TONE[s.status]}>{CHALLENGE_STATUS_LABEL[s.status]}</Badge>
              </span>
              <span className="mt-2 block">
                <Progress value={s.percent} tone="accent" />
              </span>
              <span className="mt-1.5 block text-[12.5px] text-faint">
                {s.value} de {s.target} · {s.status === 'not_started' ? `começa ${formatDateValue(c.startDate).toLowerCase()}` : `até ${formatDateValue(s.endDate).toLowerCase()}`}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="card flex items-center justify-between gap-3 px-5 py-4">
          <span className="flex items-center gap-2 text-[15px] text-faint">
            <Mountain size={17} /> Nenhum desafio em andamento
          </span>
          <button type="button" onClick={() => setCreating(true)} className="shrink-0 text-sm font-medium text-accent-hi hover:text-ink">
            Escolher
          </button>
        </div>
      )}
      {past.length > 0 && (
        <button type="button" onClick={() => setShowPast(!showPast)} className="mt-2 px-1 text-[13px] text-faint hover:text-soft">
          {showPast ? 'Esconder histórico' : `Histórico · ${past.length}`}
        </button>
      )}
      {showPast && (
        <div className="card mt-2 divide-y divide-line">
          {past.map(({ c, s }) => (
            <button key={c.id} type="button" onClick={() => detail.show(c.id)} className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-white/[0.03]">
              <span className="min-w-0 flex-1 truncate text-[15px] text-soft">{c.name}</span>
              <Badge tone={TONE[s.status]}>{CHALLENGE_STATUS_LABEL[s.status]}</Badge>
            </button>
          ))}
        </div>
      )}

      <Sheet open={detail.open && open !== null} onClose={detail.close} title={open?.c.name}>
        {open && (
          <div className="space-y-4">
            <p className="text-[15px] leading-relaxed text-soft">{open.c.objective}</p>
            <p className="text-[14px] text-faint">
              {formatDateValue(open.c.startDate)} → {formatDateValue(endDateOf(open.c))} · {open.c.durationDays} dias · <Badge tone={TONE[open.s.status]}>{CHALLENGE_STATUS_LABEL[open.s.status]}</Badge>
            </p>
            <Progress value={open.s.percent} tone={open.s.status === 'completed' ? 'positive' : 'accent'} />
            {open.c.mode === 'daily' && open.s.days.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {open.s.days.map((d) => {
                  const finance = open.c.rule === FINANCE_NOSPEND
                  // Finance rule: only days without any expense can be confirmed by hand.
                  const manual = open.c.rule === 'manual' || (finance && !d.expenses)
                  const isMarked = manual && statusOf(index, 'challenge', open.c.id, d.date) === 'done'
                  const label = finance ? (d.met ? (d.expenses ? 'saídas registradas, nenhuma desnecessária' : 'confirmado por você') : d.unnecessary ? 'com gasto marcado como desnecessário' : d.noData ? 'sem registro' : '') : ''
                  return (
                    <button
                      key={d.date}
                      type="button"
                      disabled={!manual || !d.counted || open.s.status === 'ended'}
                      onClick={() => setCompletion('challenge', open.c.id, d.date, isMarked ? null : 'done')}
                      title={label ? `${d.date} · ${label}` : d.date}
                      aria-label={label ? `Dia ${d.date.slice(8, 10)}: ${label}` : undefined}
                      className={`grid h-10 min-w-10 place-items-center rounded-xl border px-1.5 text-[13px] font-medium ${d.met ? 'border-transparent bg-accent text-white' : d.noData ? 'border-dashed border-line text-faint' : d.counted ? 'border-line bg-raised text-soft' : 'border-dashed border-line text-faint'}`}
                    >
                      {d.date.slice(8, 10)}
                    </button>
                  )
                })}
              </div>
            )}
            {open.c.rule === 'manual' && open.s.status === 'active' && <p className="text-[13px] text-faint">Toque no dia para marcar.</p>}
            {open.c.rule === FINANCE_NOSPEND && (
              <p className="text-[13px] leading-relaxed text-faint">
                Preenchido: saídas registradas e nenhuma marcada como desnecessária. Tracejado: dia sem registro — toque para confirmar que não houve gasto desnecessário.
                {open.s.days.some((d) => d.unnecessary) ? ' Dias com gasto marcado como desnecessário ficam sem preenchimento.' : ''}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {open.s.status === 'active' && (
                <Button variant="secondary" onClick={() => end(open.c)}>
                  Encerrar
                </Button>
              )}
              <Button
                variant="ghost"
                className="text-expense!"
                onClick={async () => {
                  const ok = await confirm({ title: 'Excluir desafio?', confirmLabel: 'Excluir', danger: true })
                  if (!ok) return
                  await remove('challenges', open.c.id)
                  detail.close()
                  toast('Desafio excluído')
                }}
              >
                Excluir
              </Button>
            </div>
          </div>
        )}
      </Sheet>
      <ChallengeForm open={creating} onClose={() => setCreating(false)} today={today} />
    </section>
  )
}
