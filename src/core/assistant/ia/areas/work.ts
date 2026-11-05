/**
 * NÚCLEO IA — Clientes e projetos (data/receipts projectReceived/projectRemaining) e Tarefas.
 * Contact data (e-mail, phone, WhatsApp, address) never goes to the AI.
 */
import { projectReceived, projectRemaining } from '../../../../data/receipts'
import { ACTIVE_PROJECT_STATUSES } from '../../../../data/selectors'
import { CLIENT_STATUS, PROJECT_STATUS, TASK_PRIORITY } from '../../../../data/labels'
import { todayIn, zoneOf } from '../../../period'
import { absent, byCurrency, countFact, dateFact, err, has, isDay, moduleOn, moneyFact, out, textArg, type LookupCtx, type LookupResult } from './shared'

const label = <V extends string>(opts: { value: V; label: string }[], v: V) => opts.find((o) => o.value === v)?.label ?? v

export function clientsProjects(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const { data, settings, book, now } = ctx
  const today = todayIn(zoneOf(settings), now)
  const q = textArg(input.nome)
  const activeOnly = input.situacao === 'ativos'
  const clientsOn = moduleOn(ctx, 'clients')
  const projectsOn = moduleOn(ctx, 'projects')
  const clientName = new Map(data.clients.map((c) => [c.id, c.name]))
  const projects = projectsOn
    ? data.projects.filter((p) => (!activeOnly || ACTIVE_PROJECT_STATUSES.has(p.status) || p.status === 'idea' || projectRemaining(p) > 0) && (!q || has(p.name, q) || has(clientName.get(p.clientId ?? ''), q)))
    : []
  const clients = clientsOn ? data.clients.filter((c) => (!activeOnly || c.status === 'active' || c.status === 'waiting' || c.status === 'potential') && (!q || has(c.name, q) || has(c.company, q))) : []
  if (!projects.length && !clients.length) return out({ fatos: [absent(book, q ? `Clientes ou projetos com “${q}”` : 'Clientes e projetos', 'nenhum encontrado')] }, [q ?? ''])

  const openTasks = (projectId: string) => data.tasks.filter((t) => t.projectId === projectId && t.status !== 'done').length
  return out(
    {
      totais_por_moeda: {
        cobrado: byCurrency(book, projects.map((p) => ({ cents: p.charged, currency: p.currency })), 'Valor cobrado dos projetos listados', 'confirmado', '/projects'),
        recebido: byCurrency(book, projects.map((p) => ({ cents: projectReceived(p), currency: p.currency })), 'Já recebido dos projetos listados', 'confirmado', '/projects'),
        a_receber: byCurrency(book, projects.map((p) => ({ cents: projectRemaining(p), currency: p.currency })), 'Ainda a receber dos projetos listados', 'confirmado', '/projects'),
      },
      projetos: projects.slice(0, 30).map((p) => ({
        nome: p.name,
        cliente: clientName.get(p.clientId ?? '') ?? 'sem cliente',
        situacao: label(PROJECT_STATUS, p.status),
        cobrado: p.charged ? moneyFact(book, p.charged, p.currency, `Cobrado no projeto ${p.name}`, 'confirmado', undefined, '/projects') : 'sem valor',
        recebido: moneyFact(book, projectReceived(p), p.currency, `Recebido no projeto ${p.name}`, projectReceived(p) ? 'confirmado' : 'ausente', undefined, '/projects'),
        a_receber: moneyFact(book, projectRemaining(p), p.currency, `A receber no projeto ${p.name}`, 'confirmado', undefined, '/projects'),
        ...(p.dueDate ? { prazo: dateFact(book, p.dueDate, `Prazo do projeto ${p.name}`, 'confirmado', true), atrasado: p.dueDate < today && ACTIVE_PROJECT_STATUSES.has(p.status) } : {}),
        tarefas_abertas: openTasks(p.id),
      })),
      clientes: clients.slice(0, 30).map((c) => ({
        nome: c.name,
        ...(c.company ? { empresa: c.company } : {}),
        situacao: label(CLIENT_STATUS, c.status),
        projetos: data.projects.filter((p) => p.clientId === c.id).length,
      })),
      observacao: 'Recebido vem dos pagamentos registrados no projeto; a receber = cobrado menos recebido. Moedas separadas.',
    },
    [...projects.slice(0, 3).map((p) => p.name), ...clients.slice(0, 2).map((c) => c.name)],
  )
}

export function tasksLookup(input: Record<string, unknown>, ctx: LookupCtx): LookupResult {
  const { data, settings, book, now } = ctx
  if (!moduleOn(ctx, 'tasks')) return err('A seção Tarefas está desligada.')
  const today = todayIn(zoneOf(settings), now)
  const de = input.de == null ? null : input.de
  const ate = input.ate == null ? null : input.ate
  if ((de !== null && !isDay(de)) || (ate !== null && !isDay(ate))) return err('Datas inválidas: use AAAA-MM-DD ou null.')
  const proj = textArg(input.projeto)
  const projectName = new Map(data.projects.map((p) => [p.id, p.name]))
  const f = input.filtro
  const list = data.tasks
    .filter((t) => (f === 'abertas' ? t.status !== 'done' : f === 'concluidas' ? t.status === 'done' : f === 'atrasadas' ? t.status !== 'done' && Boolean(t.dueDate) && t.dueDate < today : true))
    .filter((t) => (!proj || has(projectName.get(t.projectId ?? ''), proj)) && (!de || (t.dueDate && t.dueDate >= de)) && (!ate || (t.dueDate && t.dueDate <= ate)))
    .sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1)
  const name = `tarefas ${f === 'abertas' ? 'abertas' : f === 'concluidas' ? 'concluídas' : f === 'atrasadas' ? 'atrasadas' : ''}${proj ? ` do projeto ${proj}` : ''}`.trim()
  if (!list.length) return out({ fatos: [absent(book, name, 'nenhuma tarefa')] }, [proj ?? ''])
  return out(
    {
      quantidade: countFact(book, list.length, name, ['tarefa', 'tarefas']),
      tarefas: list.slice(0, 40).map((t) => ({
        titulo: t.title,
        situacao: t.status === 'done' ? 'concluída' : t.status === 'doing' ? 'fazendo' : 'a fazer',
        ...(t.dueDate ? { prazo: dateFact(book, t.dueDate, `Prazo de “${t.title}”`), atrasada: t.status !== 'done' && t.dueDate < today } : { prazo: 'sem prazo' }),
        ...(t.priority !== 'none' ? { prioridade: label(TASK_PRIORITY, t.priority) } : {}),
        ...(t.projectId && projectName.get(t.projectId) ? { projeto: projectName.get(t.projectId) } : {}),
      })),
      ...(list.length > 40 ? { aviso: 'Mostrando as 40 primeiras pelo prazo.' } : {}),
    },
    list.slice(0, 3).map((t) => t.title),
  )
}
