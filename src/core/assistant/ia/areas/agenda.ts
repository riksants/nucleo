/**
 * NÚCLEO IA — Agenda (core/agenda buildAgenda) and Busca (features/search). Both respect the privacy
 * areas: a task in the agenda needs "Tarefas", a habit "Hábitos", a meal "Alimentação"; search shows
 * only groups of allowed areas, and never Senhas or contact data.
 */
import { buildAgenda, KIND_LABEL, type AgendaItem } from '../../../agenda'
import { addDaysToDate } from '../../../period'
import { buildRecordIndex } from '../../../../features/search/records'
import { searchRecords } from '../../../../features/search/search'
import { parseQuery } from '../../../../features/search/engine'
import type { Settings } from '../../../../data/types'
import { factForModel } from '../../../../../supabase/functions/_shared/ia/facts.ts'
import type { Area } from '../../../../../supabase/functions/_shared/ia/tools.ts'
import { absent, areaOn, dayLabel, err, isDay, out, type LookupCtx, type LookupResult } from './shared'

const STATUS: Record<AgendaItem['status'], string> = { done: 'feito', skipped: 'pulado', pending: 'pendente', ended: 'horário encerrado' }
const KIND_AREA: Record<AgendaItem['kind'], Area> = { event: 'agenda', routine: 'agenda', recurring: 'agenda', task: 'tarefas', habit: 'habitos', meal: 'alimentacao' }

export function agendaLookup(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const { de, ate } = input
  if (!isDay(de) || !isDay(ate) || ate < de) return err('Datas inválidas: use AAAA-MM-DD, com "ate" depois de "de".')
  const days = Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1
  if (days > 14) return err('Intervalo grande demais: no máximo 14 dias por consulta.')
  const hidden = new Set<string>()
  const items = buildAgenda(ctx.data, ctx.settings, de, ate, ctx.now).filter((i) => {
    const ok = areaOn(ctx, KIND_AREA[i.kind])
    if (!ok) hidden.add(KIND_LABEL[i.kind])
    return ok
  })
  const byDay: { dia: unknown; total: unknown; itens: unknown[] }[] = []
  for (let d = de; d <= ate; d = addDaysToDate(d, 1)) {
    const list = items.filter((i) => i.date === d)
    // Dates only inside facts (labels say "do dia"), so the answer cites the day instead of writing it.
    const day = ctx.book.add({ kind: 'data', label: 'Dia', display: dayLabel(d), seal: 'confirmado', open: { path: '/agenda' } })
    const total = ctx.book.add({ kind: 'contagem', label: 'Total de compromissos do dia', display: String(list.length), seal: list.length ? 'confirmado' : 'ausente', open: { path: '/agenda' } })
    byDay.push({
      dia: factForModel(day),
      total: factForModel(total),
      itens: list.slice(0, 25).map((i) => {
        const when = i.start ? `${i.start}${i.end ? `–${i.end}` : ''}` : 'sem horário'
        // The fact shows time + title: the answer cites it once, without repeating either.
        const f = ctx.book.add({ kind: 'compromisso', label: `${KIND_LABEL[i.kind]} do dia`, display: i.start ? `${when} · ${i.title}` : i.title, seal: 'confirmado', open: { path: '/agenda' } })
        return { fato: factForModel(f), tipo: KIND_LABEL[i.kind], titulo: i.title, situacao: STATUS[i.status] }
      }),
    })
  }
  return out(
    {
      dias: byDay,
      ...(hidden.size ? { fora_do_alcance: `Itens de ${[...hidden].join(', ')} não aparecem porque essa área está desligada para a IA.` } : {}),
      observacao: 'Para citar um dia, use o fato do dia; para citar um compromisso, use o fato dele, que já mostra horário e título — não repita o título nem o horário ao lado.',
    },
    items.slice(0, 5).map((i) => i.title),
  )
}

/** Search group → privacy area. Groups not listed (e.g. Senhas) never reach the AI. */
const GROUP_AREA: Record<string, Area> = {
  Anotações: 'anotacoes',
  'Caixa de entrada': 'anotacoes',
  Assinantes: 'vendas',
  Vendas: 'vendas',
  Assinaturas: 'financas',
  Movimentações: 'financas',
  Clientes: 'clientes',
  'Projetos de trabalho': 'clientes',
  Portfólio: 'clientes',
  Compromissos: 'agenda',
  Recorrentes: 'agenda',
  Tarefas: 'tarefas',
  Hábitos: 'habitos',
  Refeições: 'alimentacao',
  'Metas de compra': 'metas',
  Etapas: 'metas',
  'Projetos pessoais': 'metas',
  Objetivos: 'metas',
}

export function searchLookup(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const text = typeof input.texto === 'string' ? input.texto.trim().slice(0, 120) : ''
  if (text.length < 2) return err('Texto de busca curto demais.')
  const settings = { ...ctx.settings, modules: { ...(ctx.settings.modules ?? {}), accounts: false } } as Settings
  const index = buildRecordIndex(ctx.data, settings)
  const groups = searchRecords(index, parseQuery(text)).filter((g) => GROUP_AREA[g.label] && areaOn(ctx, GROUP_AREA[g.label]))
  const hits = groups.flatMap((g) => g.hits.slice(0, 5).map((h) => ({ tipo: g.label, titulo: h.title, score: h.score }))).sort((a, b) => b.score - a.score)
  if (!hits.length) return out({ fatos: [absent(ctx.book, `Busca por “${text}”`)] }, [text])
  return out({ resultados: hits.slice(0, 10).map(({ tipo, titulo }) => ({ tipo, titulo })) }, hits.slice(0, 3).map((h) => h.titulo))
}
