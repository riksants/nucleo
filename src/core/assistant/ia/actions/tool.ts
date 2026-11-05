/**
 * NÚCLEO IA — what happens when the model calls `propor_acoes`: the app builds the plan from the
 * current data (nothing is written) and tells the model only the state of each item, so it can explain
 * or ask. The preview itself is shown by the app.
 */
import { ActionArgs } from '../../../../../supabase/functions/_shared/ia/actions.ts'
import type { Area } from '../../../../../supabase/functions/_shared/ia/tools.ts'
import type { DataState, Settings } from '../../../../data/types'
import { ACTION_LABEL, buildPlan, previewValues, type Plan } from './plan'
import { factForModel, type FactBook } from '../../../../../supabase/functions/_shared/ia/facts.ts'

export function runActionsTool(input: unknown, ctx: { data: DataState; settings: Settings; now: Date; areasOff: Area[]; uid: string; planId: string; book?: FactBook }): { content: string; isError: boolean; plan: Plan | null } {
  const parsed = ActionArgs.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`)
    return { content: JSON.stringify({ erro: 'Ações em formato inválido. Corrija estes campos (datas AAAA-MM-DD, horas HH:MM, valores em número) e tente de novo.', campos: issues }), isError: true, plan: null }
  }
  const refs = parsed.data.acoes.map((a) => a.ref)
  if (new Set(refs).size !== refs.length) return { content: JSON.stringify({ erro: 'Cada ação precisa de um ref diferente.' }), isError: true, plan: null }
  const plan = buildPlan(ctx.planId, ctx.uid, parsed.data.resumo, parsed.data.acoes, ctx)
  return {
    plan,
    isError: false,
    content: JSON.stringify({
      previa_mostrada_na_tela: true,
      itens: plan.items.map((i) => ({
        ref: i.ref,
        o_que: `${ACTION_LABEL[i.action.tipo]}${i.action.titulo || i.action.pessoa || i.action.alvo ? `: ${i.action.titulo ?? i.action.pessoa ?? i.action.alvo}` : ''}`,
        situacao: i.state === 'pronto' ? 'pronto para confirmar' : i.state === 'aviso' ? 'pronto, com aviso' : i.state === 'existente' ? 'já existe (será usado o registro atual)' : 'precisa de ajuste',
        ...(i.messages.length ? { observacoes: i.messages.map((m) => m.text) } : {}),
        ...(ctx.book ? { valores_da_previa: previewValues(plan, i.ref, ctx).map((v) => factForModel(ctx.book!.add({ ...v, seal: 'proposto', base: 'na prévia, ainda não gravado' }))) } : {}),
      })),
      instrucao:
        'Nada foi gravado. A pessoa revisa, edita e confirma na prévia. Diga em 1 ou 2 frases o que o plano faz e o que precisa de atenção; para citar um valor, data ou horário da prévia use o fato dele ({fN}) e nunca diga que algo foi feito. Se um item precisa de ajuste por falta de informação (por exemplo, se o dinheiro já foi recebido), pergunte isso à pessoa.',
    }),
  }
}
