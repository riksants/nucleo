import { motion } from 'framer-motion'
import { Check, RotateCcw } from 'lucide-react'
import { goalProgress } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Goal } from '../../data/types'
import { formatDateTime } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { Badge, Progress } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'

export function GoalCard({ goal, onOpen, compact }: { goal: Goal; onOpen(g: Goal): void; compact?: boolean }) {
  const { balance, settings, convert, save } = useStore()
  const { toast } = useFeedback()
  const p = goalProgress(goal, balance, settings.baseCurrency, convert)
  const purchased = goal.purchasedAt !== null

  const togglePurchased = async () => {
    await save('goals', { ...goal, purchasedAt: purchased ? null : new Date().toISOString() })
    toast(purchased ? 'Meta reativada' : 'Marcado como comprado')
  }

  return (
    <motion.article layout="position" className={`card p-5 ${purchased ? 'opacity-60' : ''}`}>
      <button type="button" onClick={() => onOpen(goal)} className="block w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[17px] font-semibold tracking-tight">{goal.name}</h3>
            {goal.note && !compact && <p className="mt-0.5 line-clamp-2 text-sm text-soft">{goal.note}</p>}
          </div>
          {purchased ? (
            <Badge tone="positive">Comprado</Badge>
          ) : (
            p.reached && <Badge tone="positive">Saldo suficiente</Badge>
          )}
        </div>

        <p className="num mt-3 text-[26px] leading-none font-semibold">{formatMoney(goal.price, goal.currency)}</p>

        {!purchased && (
          <>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1">
                <Progress value={p.percent ?? 0} tone={p.reached ? 'positive' : 'goal'} />
              </div>
              <span className={`num w-11 text-right text-[15px] font-semibold ${p.reached ? 'text-income' : 'text-goal'}`}>
                {p.percent === null ? '—' : `${p.percent}%`}
              </span>
            </div>
            {p.balance === null ? (
              <p className="mt-3 text-sm text-faint">Sem cotação para comparar com seu saldo.</p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-faint">Saldo atual</p>
                  <p className="num mt-0.5 text-[15px] font-medium">{formatMoney(p.balance, goal.currency)}</p>
                </div>
                <div className="text-right">
                  <p className="text-faint">{p.reached ? 'Sobra' : 'Faltam'}</p>
                  <p className="num mt-0.5 text-[15px] font-medium">
                    {formatMoney(p.reached ? p.balance - goal.price : (p.missing ?? 0), goal.currency)}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
        {purchased && goal.purchasedAt && <p className="mt-2 text-sm text-soft">Comprado {formatDateTime(goal.purchasedAt).toLowerCase()}</p>}
      </button>

      {!compact && (
        <button
          type="button"
          onClick={togglePurchased}
          className="press mt-4 flex h-10 items-center gap-2 rounded-xl px-3 -ml-1 text-sm font-medium text-soft hover:bg-tint/[0.04] hover:text-ink"
        >
          {purchased ? <RotateCcw size={16} /> : <Check size={16} />}
          {purchased ? 'Voltar para metas' : 'Marcar como comprado'}
        </button>
      )}
    </motion.article>
  )
}
