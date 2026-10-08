import { Check, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { isDestructive, type Applied, type Proposal } from '../../core/assistant/proposal'
import { Button } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { useApply } from './useApply'

/**
 * Shows exactly what will change. Nothing is written before "Aplicar" (or
 * "Criar"). "Ajustar" lets the person untick changes. Deletions ask again.
 * After applying, "Desfazer" puts things back.
 */
/** Outcome of each proposal in this session, so coming back never offers "Criar" twice. */
const outcomes = new Map<string, { state: 'applied' | 'cancelled' | 'undone'; applied: Applied | null }>()

export function ProposalCard({ proposal, onDone }: { proposal: Proposal; onDone?(result: 'applied' | 'cancelled'): void }) {
  const { apply, undo } = useApply()
  const { confirm, toast } = useFeedback()
  const [chosen, setChosen] = useState(() => new Set(proposal.changes.map((c) => c.id)))
  const [adjusting, setAdjusting] = useState(false)
  const saved = outcomes.get(proposal.id)
  const [state, setStateRaw] = useState<'open' | 'applied' | 'cancelled' | 'undone'>(saved?.state ?? 'open')
  const [applied, setApplied] = useState<Applied | null>(saved?.applied ?? null)
  const setState = (next: 'applied' | 'cancelled' | 'undone', a: Applied | null = applied) => {
    outcomes.set(proposal.id, { state: next, applied: a })
    setStateRaw(next)
  }
  const [busy, setBusy] = useState(false)
  const single = proposal.kind === 'create' || proposal.changes.length === 1
  const destructive = isDestructive(proposal)

  const run = async () => {
    if (!chosen.size || busy) return
    if (destructive) {
      const ok = await confirm({ title: proposal.title, message: `${proposal.changes.filter((c) => chosen.has(c.id)).map((c) => c.label).join('\n')}\n\nConfirmar a exclusão?`, confirmLabel: 'Excluir', danger: true })
      if (!ok) return
    }
    setBusy(true)
    try {
      const a = await apply(proposal, chosen)
      setApplied(a)
      setState('applied', a)
      onDone?.('applied')
    } finally {
      setBusy(false)
    }
  }
  const revert = async () => {
    if (!applied) return
    const r = await undo(applied)
    setState('undone')
    toast(r.skipped ? `Desfeito, exceto ${r.skipped} ${r.skipped === 1 ? 'item que foi alterado' : 'itens que foram alterados'} depois` : 'Desfeito')
  }

  return (
    <div data-proposal={proposal.id} className="card mt-2 space-y-3 border-accent-hi/30 p-4">
      <p className="text-[13px] font-semibold text-soft">{proposal.title}</p>
      <ul className="space-y-1.5">
        {proposal.changes.map((c) => {
          const on = chosen.has(c.id)
          return (
            <li key={c.id} className="flex items-start gap-2.5">
              {adjusting ? (
                <button type="button" role="checkbox" aria-checked={on} aria-label={`Incluir: ${c.label}`} onClick={() => setChosen((s) => (on ? new Set([...s].filter((x) => x !== c.id)) : new Set([...s, c.id])))} className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border-2 ${on ? 'border-accent-hi bg-accent text-on-accent' : 'border-line-strong'}`}>
                  {on && <Check size={14} strokeWidth={2.6} />}
                </button>
              ) : (
                <span className={`mt-2 size-1.5 shrink-0 rounded-full ${on ? 'bg-accent-hi' : 'bg-faint'}`} />
              )}
              <span className={`min-w-0 flex-1 text-[15px] leading-snug break-words ${on ? '' : 'text-faint line-through'}`}>
                {c.label}
                {c.detail && <span className="block text-[13px] text-faint">{c.detail}</span>}
              </span>
            </li>
          )
        })}
      </ul>
      {proposal.notes.map((n) => (
        <p key={n} className="text-[13px] leading-relaxed text-faint">
          {n}
        </p>
      ))}
      {state === 'open' && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={run} disabled={!chosen.size || busy} className={destructive ? 'bg-expense! hover:bg-expense/90!' : ''}>
            {destructive ? 'Excluir' : proposal.kind === 'create' ? 'Criar' : 'Aplicar'}
          </Button>
          {!single && (
            <Button variant="secondary" onClick={() => setAdjusting(!adjusting)}>
              {adjusting ? 'Pronto' : 'Ajustar'}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setState('cancelled')
              onDone?.('cancelled')
            }}
          >
            Cancelar
          </Button>
        </div>
      )}
      {state === 'applied' && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-[14px] text-income">
            <Check size={16} /> {proposal.kind === 'create' ? 'Criado' : destructive ? 'Excluído' : 'Aplicado'}
          </span>
          <Button variant="secondary" icon={<Undo2 size={16} />} onClick={revert}>
            Desfazer
          </Button>
        </div>
      )}
      {state === 'cancelled' && <p className="text-[14px] text-faint">Cancelado — nada foi alterado.</p>}
      {state === 'undone' && <p className="text-[14px] text-faint">Desfeito.</p>}
    </div>
  )
}
