import { Lightbulb } from 'lucide-react'
import { useState } from 'react'
import { navigate } from '../../app/router'
import type { RuleSuggestion } from '../../core/rules/suggestions'
import { Button } from '../../ui/Button'
import { useRules } from './useRules'

/** One suggestion, with "Por quê?" and the three answers. Shared with Início. */
export function SuggestionCard({ s, onCreate, compact }: { s: RuleSuggestion; onCreate(s: RuleSuggestion): void; compact?: boolean }) {
  const { answer } = useRules()
  const [why, setWhy] = useState(false)
  return (
    <div className="card px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/12 text-accent-hi">
          <Lightbulb size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-snug font-medium">{s.title}</span>
          {!compact && (
            <button type="button" onClick={() => setWhy((w) => !w)} className="mt-1 text-[13px] font-medium text-accent-hi hover:text-ink" aria-expanded={why}>
              Por quê?
            </button>
          )}
          {why && (
            <span className="mt-1.5 block text-[13px] leading-relaxed text-soft">
              {s.why}
              <span className="mt-1 block text-faint">{s.items.join(' · ')}</span>
            </span>
          )}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 pl-12">
        <Button size="md" onClick={() => onCreate(s)}>
          {s.fixedExpense ? 'Cadastrar como conta fixa' : compact ? 'Ver sugestão' : 'Criar regra'}
        </Button>
        <button type="button" className="text-[14px] font-medium text-soft hover:text-ink" onClick={() => void answer(s.key, 'snoozed')}>
          Agora não
        </button>
        {!compact && (
          <button type="button" className="text-[14px] font-medium text-faint hover:text-ink" onClick={() => void answer(s.key, 'dismissed')}>
            Não sugerir isso novamente
          </button>
        )}
      </div>
    </div>
  )
}

/** Início: the one suggestion of the moment, if any (opens Minhas regras to decide). */
export function HomeSuggestion() {
  const { suggestion } = useRules()
  if (!suggestion) return null
  return <SuggestionCard s={suggestion} compact onCreate={() => navigate('/rules', { suggestion: '1' })} />
}
