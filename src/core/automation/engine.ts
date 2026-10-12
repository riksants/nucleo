/**
 * The automation engine: which automations are on, since when, and everything they should do now.
 * Each automation acts only from its `since` day on (the day it was first turned on, or turned
 * back on): what happened before is never caught up.
 */
import type { AutomationId, Settings } from '../../data/types'
import { planGoalSaves } from './goalSave'
import { planSubscriberCharges } from './subscriberCharge'
import { planToolCharges } from './toolCharge'
import type { AutomationCtx, ItemPlan } from './types'

export const AUTOMATIONS: { id: AutomationId; title: string; text: string }[] = [
  {
    id: 'subscriberCharge',
    title: 'Cobranças de assinantes',
    text: 'No dia da renovação, cria a cobrança “A receber”. Só registra o pagamento sozinho nos assinantes marcados como “Considerar pago automaticamente”.',
  },
  {
    id: 'toolCharge',
    title: 'Cobranças de assinaturas',
    text: 'No dia da cobrança, cria “A pagar”. Só lança a saída sozinha nas assinaturas marcadas como “Considerar pago automaticamente”.',
  },
  {
    id: 'projectClient',
    title: 'Projetos e clientes',
    text: 'Quando o último projeto em aberto de um cliente é concluído, o cliente passa para Concluído. Se um projeto for reaberto, ele volta para Ativo (só quando foi o Núcleo que concluiu).',
  },
  {
    id: 'goalSave',
    title: 'Guardar todo mês nas metas',
    text: 'No dia escolhido em cada meta, reserva parte do seu saldo disponível. Não cria saída: o dinheiro continua no saldo.',
  },
]

/** The day this automation acts from, or null when it is off (or not started yet). */
export function automationSince(settings: Pick<Settings, 'automations'>, id: AutomationId): string | null {
  const a = settings.automations?.[id]
  return a?.on ? a.since : null
}

/** Automations never started get "on, since today". Null = nothing to write. */
export function sinceDefaults(settings: Pick<Settings, 'automations'>, today: string): NonNullable<Settings['automations']> | null {
  const current = settings.automations ?? {}
  const missing = AUTOMATIONS.filter((a) => !current[a.id])
  if (!missing.length) return null
  return { ...current, ...Object.fromEntries(missing.map((a) => [a.id, { on: true, since: today }])) }
}

/** Everything the date-based automations should do now (runs already written are left out). */
export function planAll(ctx: AutomationCtx): ItemPlan[] {
  const out: ItemPlan[] = []
  const sub = automationSince(ctx.settings, 'subscriberCharge')
  if (sub) out.push(...planSubscriberCharges(ctx, sub))
  const tool = automationSince(ctx.settings, 'toolCharge')
  if (tool) out.push(...planToolCharges(ctx, tool))
  const goal = automationSince(ctx.settings, 'goalSave')
  if (goal) out.push(...planGoalSaves(ctx, goal))
  return out.filter((p) => p.ops.length)
}
