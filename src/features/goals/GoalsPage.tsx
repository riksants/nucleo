import { Plus, Target } from 'lucide-react'
import { PageHeader } from '../../app/Shell'
import { sortByNewest } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Goal } from '../../data/types'
import { Button } from '../../ui/Button'
import { EmptyState, SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { useOpenParam } from '../useOpenParam'
import { GoalCard } from './GoalCard'
import { GoalForm } from './GoalForm'

export function GoalsPage() {
  const { data } = useStore()
  const sheet = useSheet<Goal>()
  useOpenParam(data.goals, sheet.show)

  const all = sortByNewest(data.goals)
  const active = all.filter((g) => !g.purchasedAt)
  const purchased = all.filter((g) => g.purchasedAt)

  return (
    <>
      <PageHeader
        title="Metas"
        subtitle="Compare o que quer comprar com seu saldo"
        actions={
          <Button icon={<Plus size={18} />} onClick={() => sheet.show()}>
            Nova meta
          </Button>
        }
      />
      {active.length === 0 && purchased.length === 0 ? (
        <EmptyState
          icon={<Target size={22} />}
          title="Nenhuma meta ainda"
          text="Adicione algo que pretende comprar e veja quanto falta com base no seu saldo."
          action="Adicionar meta"
          onAction={() => sheet.show()}
        />
      ) : (
        <div className="space-y-8">
          {active.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {active.map((g) => (
                <GoalCard key={g.id} goal={g} onOpen={sheet.show} />
              ))}
            </div>
          )}
          {purchased.length > 0 && (
            <section>
              <SectionTitle>Comprados</SectionTitle>
              <div className="grid gap-4 md:grid-cols-2">
                {purchased.map((g) => (
                  <GoalCard key={g.id} goal={g} onOpen={sheet.show} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      <GoalForm open={sheet.open} onClose={sheet.close} goal={sheet.item} />
    </>
  )
}
