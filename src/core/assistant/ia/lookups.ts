/**
 * NÚCLEO IA — lookups run in the app, over the signed-in account's own data, with the app's own
 * calculations. They only READ. One module per area in ./areas; this file dispatches and enforces
 * the privacy areas (an area off = refused, whatever the model asks).
 *
 * What reaches the model is an ALLOWLIST per lookup: titles, dates, statuses, amounts, categories,
 * note text. Never passwords, vault, accesses (Senhas), notes of an access, e-mails, phones, addresses
 * or internal record ids. Every value comes out as a fact with a seal (FactBook).
 */
import { AREA_LABEL, TOOL_AREA, type ToolName } from '../../../../supabase/functions/_shared/ia/tools.ts'
import { agendaLookup, searchLookup } from './areas/agenda'
import { forecastLookup, trendLookup } from './areas/analysis'
import { financeSummary, movements, paidRecurring } from './areas/finance'
import { financeGoals, goalsAndPlans } from './areas/goals'
import { habitsLookup, mealsLookup, notesLookup } from './areas/life'
import { salesLookup, subscribersLookup } from './areas/sales'
import { err, type LookupCtx, type LookupResult } from './areas/shared'
import { clientsProjects, tasksLookup } from './areas/work'

export { areaAvailable, areasOffFor, type LookupCtx, type LookupResult } from './areas/shared'

const RUN: Record<ToolName, (input: Record<string, unknown>, ctx: LookupCtx) => LookupResult> = {
  consultar_agenda: agendaLookup,
  resumo_financeiro: financeSummary,
  tendencia_financeira: trendLookup,
  previsao_do_mes: forecastLookup,
  lancamentos: movements,
  contas_e_assinaturas_pagas: paidRecurring,
  metas_financeiras: financeGoals,
  metas_e_planos: goalsAndPlans,
  vendas: salesLookup,
  assinantes: subscribersLookup,
  clientes_e_projetos: clientsProjects,
  tarefas: tasksLookup,
  habitos_e_rotina: habitsLookup,
  alimentacao: mealsLookup,
  anotacoes: notesLookup,
  buscar: searchLookup,
}

export function runLookup(name: string, input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const tool = name as ToolName
  const area = TOOL_AREA[tool]
  const run = RUN[tool]
  if (!area || !run) return err('Consulta desconhecida.')
  if (ctx.areasOff.includes(area)) return err(`A área ${AREA_LABEL[area]} está desligada para a IA. A pessoa pode ligá-la em "Privacidade da IA", no Assistente.`)
  try {
    return run(input ?? {}, ctx)
  } catch {
    return err('Não foi possível fazer essa consulta agora.')
  }
}
