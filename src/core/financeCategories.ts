/**
 * Finance categories. Optional on every movement: no category = "Sem
 * categoria". Default ids are fixed, so renaming a label never touches stored
 * movements; personal categories get their own id. Hiding a category only
 * removes it from the pickers — movements that use it keep showing its name.
 */
import type { FinanceCategory, Settings } from '../data/types'

export const NO_CATEGORY = 'Sem categoria'

export const DEFAULT_CATEGORIES: FinanceCategory[] = [
  { id: 'food', label: 'Alimentação', type: 'out' },
  { id: 'transport', label: 'Transporte', type: 'out' },
  { id: 'housing', label: 'Moradia', type: 'out', fixed: true },
  { id: 'bills', label: 'Contas', type: 'out', fixed: true },
  { id: 'health', label: 'Saúde', type: 'out' },
  { id: 'leisure', label: 'Lazer', type: 'out' },
  { id: 'shopping', label: 'Compras', type: 'out' },
  { id: 'education', label: 'Educação', type: 'out' },
  { id: 'subscriptions', label: 'Assinaturas', type: 'out', fixed: true },
  { id: 'travel', label: 'Viagem', type: 'out' },
  { id: 'work', label: 'Trabalho', type: 'out' },
  { id: 'other', label: 'Outros', type: 'out' },
  { id: 'salary', label: 'Salário', type: 'in' },
  { id: 'freelance', label: 'Freelance', type: 'in' },
  { id: 'sales', label: 'Vendas', type: 'in' },
  { id: 'investments', label: 'Investimentos', type: 'in' },
  { id: 'refund', label: 'Reembolso', type: 'in' },
  { id: 'otherIncome', label: 'Outros', type: 'in' },
]

type CategorySettings = Pick<Settings, 'financeCategories'>

export function allCategories(settings: CategorySettings): FinanceCategory[] {
  return [...DEFAULT_CATEGORIES, ...(settings.financeCategories?.custom ?? [])]
}

/** Categories offered when choosing, for one type. `keep` stays even if hidden (the one already set). */
export function pickableCategories(settings: CategorySettings, type: 'in' | 'out', keep?: string): FinanceCategory[] {
  const hidden = new Set(settings.financeCategories?.hidden ?? [])
  return allCategories(settings).filter((c) => c.type === type && (!hidden.has(c.id) || c.id === keep))
}

export function findCategory(settings: CategorySettings, id: string | undefined): FinanceCategory | null {
  if (!id) return null
  return allCategories(settings).find((c) => c.id === id) ?? null
}

export function categoryLabel(settings: CategorySettings, id: string | undefined): string {
  if (!id) return NO_CATEGORY
  return findCategory(settings, id)?.label ?? 'Outra categoria'
}

/** Ids of fixed expenses (not extrapolated by the forecast). Ready for more categories later. */
export function fixedCategoryIds(settings: CategorySettings): Set<string> {
  return new Set(allCategories(settings).filter((c) => c.type === 'out' && c.fixed).map((c) => c.id))
}

export function isCategoryHidden(settings: CategorySettings, id: string): boolean {
  return (settings.financeCategories?.hidden ?? []).includes(id)
}
