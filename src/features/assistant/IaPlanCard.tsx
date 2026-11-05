import { AlertTriangle, Check, CircleSlash, Pencil, Undo2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useStore } from '../../data/store'
import { applyPlan, undoPlan, type AppliedPlan } from '../../core/assistant/ia/actions/apply'
import { buildPlan, editAction, toggle, initialChoice, type EditableField, type Plan, type PlanItem } from '../../core/assistant/ia/actions/plan'
import { areasOffFor } from '../../core/assistant/ia/lookups'
import { currentUid } from './iaApi'

/**
 * NÚCLEO IA — the editable preview of a plan. Nothing is written until "Confirmar". The plan is
 * rebuilt from the current data on every change (edits, other screens), so warnings stay true.
 */
export function IaPlanCard({ plan: proposed }: { plan: Plan }) {
  const { data, settings, commit, convert } = useStore()
  const [actions, setActions] = useState(proposed.actions)
  const [chosen, setChosen] = useState(() => initialChoice(proposed))
  const [note, setNote] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [ruleEffects, setRuleEffects] = useState<string[]>([])
  const [remaining, setRemaining] = useState<string[]>([])
  const [applied, setApplied] = useState<AppliedPlan | null>(null)
  const [state, setState] = useState<'preview' | 'applying' | 'applied' | 'undone' | 'cancelled'>('preview')
  const [editing, setEditing] = useState<string | null>(null)
  const busy = useRef(false)
  const areasOff = areasOffFor(settings)
  const now = new Date()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => buildPlan(proposed.id, proposed.uid, proposed.summary, actions, { data, settings, now, areasOff }, proposed.pins), [actions, data, settings])
  const live = (ref: string) => chosen.has(ref) && plan.items.find((i) => i.ref === ref)?.state !== 'erro'
  const count = plan.items.filter((i) => live(i.ref)).length
  const latest = useRef({ data, settings })
  latest.current = { data, settings }

  const onToggle = (ref: string) => {
    const r = toggle(plan, chosen, ref)
    setChosen(r.chosen)
    const labels = r.also.map((x) => plan.items.find((i) => i.ref === x)?.label).filter(Boolean)
    setNote(labels.length ? (chosen.has(ref) ? `Também desmarquei o que depende dele: ${labels.join('; ')}.` : `Também marquei o que ele precisa: ${labels.join('; ')}.`) : null)
  }
  const onEdit = (ref: string, field: EditableField, value: string | number | boolean | null) => setActions(editAction({ ...plan, actions }, ref, field, value))

  const confirm = async () => {
    if (busy.current) return // a second tap while writing does nothing
    busy.current = true
    setState('applying')
    setProblems([])
    const r = await applyPlan({ ...plan, actions }, new Set([...chosen].filter(live)), { commit, convert, currentUid, snapshot: () => latest.current, areasOff })
    busy.current = false
    if (!r.ok) {
      setProblems(r.problems)
      setState('preview')
      return
    }
    setApplied(r.applied)
    setRuleEffects(r.ruleEffects)
    setState('applied')
    setNote(r.written ? null : 'Isso já estava aplicado: nada novo foi gravado.')
  }
  const undo = async () => {
    if (!applied || busy.current) return
    busy.current = true
    const r = await undoPlan(applied, { commit, snapshot: () => latest.current })
    busy.current = false
    if (!r.ok) {
      setProblems([r.problem])
      setRemaining(r.remaining)
      return
    }
    setRuleEffects(r.ruleEffects)
    setRemaining([])
    setProblems([])
    setState('undone')
  }

  // Cancelled before confirming: nothing was ever written, the card just closes.
  if (state === 'cancelled')
    return (
      <p className="mt-2 text-[14px] text-soft" data-ia-plan={proposed.id} data-plan-state="cancelled">
        Cancelado. Nada foi gravado.
      </p>
    )
  if (state === 'applied' || state === 'undone') {
    return (
      <div className="card mt-2 space-y-2 p-4" data-ia-plan={proposed.id} data-plan-state={state}>
        <p className="flex items-center gap-2 text-[15px] font-medium text-ink">
          {state === 'applied' ? <Check size={16} className="text-accent-hi" /> : <Undo2 size={16} />}
          {state === 'applied' ? `Feito: ${count} ${count === 1 ? 'item' : 'itens'} gravados no Núcleo` : 'Desfeito: tudo voltou como estava'}
        </p>
        {note && <p className="text-[13px] text-faint">{note}</p>}
        {ruleEffects.length > 0 && (
          <div className="text-[13px] leading-snug text-soft" data-rule-effects>
            <p className="font-medium text-ink">{state === 'applied' ? 'Suas regras também agiram nesta confirmação:' : 'Também foi desfeito o que suas regras fizeram:'}</p>
            {ruleEffects.map((t) => (
              <p key={t}>• {t}</p>
            ))}
          </div>
        )}
        {problems.map((p) => (
          <p key={p} className="text-[14px] text-soft" role="alert">
            {p}
          </p>
        ))}
        {remaining.length > 0 && (
          <ul className="text-[13px] leading-snug text-soft" data-undo-remaining>
            {remaining.map((t) => (
              <li key={t}>• {t}</li>
            ))}
          </ul>
        )}
        {state === 'applied' && applied && (
          <button type="button" onClick={undo} className="press flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[14px] text-soft hover:text-ink">
            <Undo2 size={14} /> Desfazer tudo
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="card mt-2 space-y-3 border-accent-hi/30 p-4" data-ia-plan={proposed.id} data-plan-state={state}>
      <div>
        <p className="text-[15px] font-medium text-ink">Prévia das alterações</p>
        <p className="text-[13px] text-faint">Nada foi gravado. Marque o que quer, ajuste se precisar e confirme.</p>
      </div>
      <ul className="space-y-2.5">
        {plan.items.map((i) => (
          <PlanRow key={i.ref} item={i} on={live(i.ref)} editing={editing === i.ref} onToggle={() => onToggle(i.ref)} onEditToggle={() => setEditing(editing === i.ref ? null : i.ref)} onEdit={(f, v) => onEdit(i.ref, f, v)} />
        ))}
      </ul>
      {note && <p className="text-[13px] text-soft">{note}</p>}
      {problems.map((p) => (
        <p key={p} className="flex gap-1.5 text-[14px] text-soft" role="alert">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-accent-hi" /> {p}
        </p>
      ))}
      <div className="flex gap-2">
        <button type="button" disabled={state === 'applying'} onClick={() => setState('cancelled')} className="press h-11 shrink-0 rounded-full border border-line px-4 text-[15px] text-soft hover:text-ink disabled:opacity-40" data-plan-cancel>
          Cancelar
        </button>
        <button type="button" disabled={!count || state === 'applying'} onClick={confirm} className="press h-11 min-w-0 flex-1 rounded-full bg-accent px-4 text-[15px] font-medium text-on-accent disabled:opacity-40">
          {state === 'applying' ? 'Gravando…' : count ? `Confirmar ${count} ${count === 1 ? 'item' : 'itens'}` : 'Nada marcado'}
        </button>
      </div>
    </div>
  )
}

const FIELD_LABEL: Record<EditableField, string> = { titulo: 'Título', data: 'Data', hora: 'Horário', valor: 'Valor', ja_recebido_ou_pago: 'Já recebido / pago' }

function PlanRow({ item, on, editing, onToggle, onEditToggle, onEdit }: { item: PlanItem; on: boolean; editing: boolean; onToggle(): void; onEditToggle(): void; onEdit(f: EditableField, v: string | number | boolean | null): void }) {
  const blocked = item.state === 'erro'
  const a = item.action
  return (
    <li className="flex gap-3" data-plan-item={item.ref} data-item-state={item.state}>
      {item.state === 'existente' ? (
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border-2 border-line text-faint" title="Já existe">
          <Check size={14} />
        </span>
      ) : (
        <button type="button" role="checkbox" aria-checked={on} aria-label={`Incluir: ${item.label}`} disabled={blocked} onClick={onToggle} className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border-2 ${on ? 'border-accent-hi bg-accent text-on-accent' : 'border-line-strong'} disabled:opacity-40`}>
          {on ? <Check size={14} strokeWidth={2.6} /> : blocked ? <CircleSlash size={14} /> : null}
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] leading-snug break-words ${blocked ? 'text-faint' : 'text-ink'}`}>{item.label}</p>
        {item.details.map((d) => (
          <p key={d} className="text-[13px] leading-snug text-faint">
            {d}
          </p>
        ))}
        {item.messages.map((m) => (
          <p key={m.text} className={`mt-0.5 flex gap-1 text-[13px] leading-snug ${m.level === 'erro' ? 'text-accent-hi' : 'text-soft'}`}>
            <AlertTriangle size={14} className="mt-px shrink-0" /> {m.text}
          </p>
        ))}
        {item.editable.length > 0 && (
          <button type="button" onClick={onEditToggle} className="flex min-h-11 items-center gap-1 text-[14px] font-medium text-accent-hi hover:text-ink" data-plan-edit>
            <Pencil size={14} /> {editing ? 'Fechar edição' : 'Editar'}
          </button>
        )}
        {editing && (
          <div className="mt-2 grid gap-2">
            {item.editable.map((f) =>
              f === 'ja_recebido_ou_pago' ? (
                <label key={f} className="flex items-center gap-2 text-[14px] text-soft">
                  <input type="checkbox" checked={a.ja_recebido_ou_pago === true} onChange={(e) => onEdit(f, e.target.checked ? true : null)} /> {FIELD_LABEL[f]}
                </label>
              ) : (
                <label key={f} className="grid gap-1 text-[13px] text-faint">
                  {FIELD_LABEL[f]}
                  <input
                    aria-label={`${FIELD_LABEL[f]}: ${item.label}`}
                    type={f === 'data' ? 'date' : f === 'hora' ? 'time' : f === 'valor' ? 'number' : 'text'}
                    step={f === 'valor' ? '0.01' : undefined}
                    min={f === 'valor' ? '0' : undefined}
                    value={f === 'valor' ? (a.valor ?? '') : ((a[f] as string | null) ?? '')}
                    onChange={(e) => onEdit(f, f === 'valor' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value || null)}
                    className="h-10 rounded-xl border border-line bg-raised px-3 text-[15px] text-ink"
                  />
                </label>
              ),
            )}
          </div>
        )}
      </div>
    </li>
  )
}
