/**
 * Everything Buscar can take the person to besides their records: sections, screens inside them, settings and
 * "create" actions, each with the words people use for it. Only places and actions that exist in the app.
 */
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CalendarRange,
  Coins,
  DatabaseBackup,
  FileClock,
  FileUp,
  HandCoins,
  House,
  LayoutPanelLeft,
  Lock,
  MessageCircle,
  Moon,
  Palette,
  PieChart,
  Plus,
  Scale,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Sunrise,
  Tags,
  Timer,
  UserRound,
  Wallet,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import { MODULES } from '../../app/modules'
import type { RoutePath } from '../../app/router'
import type { ModuleId } from '../../data/types'

export type DestinationKind = 'section' | 'screen' | 'action' | 'answer'

/** Live figure shown under an answer ("€1.200 a receber"), computed by the page from the person's data. */
export type HintId = 'projectsReceivable' | 'salesReceivable' | 'balance' | 'upcomingCharges' | 'openTasks'

export interface Destination {
  id: string
  kind: DestinationKind
  title: string
  subtitle: string
  icon: LucideIcon
  /** Words and phrases people use for it (synonyms, related words, common misspellings are handled by the matcher). */
  keywords: string[]
  /** Only offered while this section is visible (a hidden section's own entry offers to show it instead). */
  module?: ModuleId
  path: RoutePath
  params?: Record<string, string>
  hint?: HintId
  /** Only when the person has the data this needs (e.g. a plan to sign someone up to). */
  requires?: 'subPlans'
}

/** Extra words for each section, beyond its name and description. */
const SECTION_WORDS: Record<ModuleId, string[]> = {
  today: ['hoje', 'dia', 'agora', 'meu dia', 'resumo do dia', 'prazos', 'pendencias'],
  finance: ['dinheiro', 'saldo', 'conta bancaria', 'banco', 'carteira', 'financas', 'gastos', 'despesas', 'receitas', 'entradas', 'saidas', 'pagamento', 'pagamentos', 'movimentacoes', 'transacoes', 'extrato', 'lancamentos', 'orcamento'],
  projects: ['trabalho', 'trabalhos', 'freela', 'job', 'site', 'app', 'prazos', 'entregas', 'a receber', 'cobranca'],
  tasks: ['tarefa', 'afazeres', 'to do', 'todo', 'pendencias', 'fazer', 'checklist', 'lembrar'],
  clients: ['cliente', 'contatos', 'contato', 'pessoas', 'crm', 'telefone', 'whatsapp', 'empresa'],
  goals: ['metas', 'meta', 'objetivo de compra', 'desejos', 'lista de desejos', 'comprar', 'economizar', 'poupar', 'guardar dinheiro'],
  tools: ['assinatura', 'assinaturas', 'mensalidade', 'mensalidades', 'ferramentas', 'apps', 'servicos', 'streaming', 'netflix', 'spotify', 'cobranca mensal', 'renovacao', 'planos pagos'],
  accounts: ['senha', 'senhas', 'contas', 'conta', 'acessos', 'login', 'logins', 'usuario', 'cofre', 'credenciais'],
  notes: ['nota', 'notas', 'anotacao', 'bloco de notas', 'ideias', 'texto', 'rascunho', 'memo'],
  portfolio: ['portfolio', 'portifolio', 'trabalhos entregues', 'cases', 'galeria', 'feitos'],
  sales: ['venda', 'vendas', 'vender', 'compradores', 'pedidos', 'faturamento', 'a receber', 'pagamento', 'recebimento', 'devendo', 'fiado'],
  subscribers: ['assinante', 'assinantes', 'membros', 'mensalistas', 'recorrencia', 'planos', 'cobrancas'],
  routine: ['rotina', 'horarios', 'agenda semanal', 'cronograma', 'organizar semana', 'ia'],
  meals: ['alimentacao', 'comida', 'refeicoes', 'refeicao', 'cardapio', 'dieta', 'almoco', 'jantar', 'cafe da manha', 'receitas', 'nutricao'],
  life: ['vida', 'pessoal', 'projetos pessoais', 'objetivos', 'sonhos', 'calendario', 'planos de vida'],
  week: ['semana', 'semanal', 'score', 'pontuacao', 'sequencias', 'desafios', 'metas da semana', 'revisao'],
  agenda: ['agenda', 'compromissos', 'compromisso', 'eventos', 'reuniao', 'reunioes', 'consulta', 'horario', 'calendario'],
  inbox: ['caixa de entrada', 'capturar', 'captura', 'inbox', 'ideia rapida', 'anotar rapido', 'organizar depois'],
  recurring: ['recorrente', 'recorrentes', 'contas a pagar', 'contas da casa', 'boleto', 'boletos', 'luz', 'agua', 'aluguel', 'mensal', 'repetir', 'checklist'],
  habits: ['habito', 'habitos', 'agua', 'treino', 'academia', 'leitura', 'meditar', 'dormir', 'sequencia'],
}

const sections: Destination[] = MODULES.map((m) => ({
  id: `section:${m.id}`,
  kind: 'section',
  title: m.label,
  subtitle: m.description,
  icon: m.icon,
  keywords: SECTION_WORDS[m.id],
  module: m.id,
  path: m.path,
}))

const icon = (id: ModuleId) => MODULES.find((m) => m.id === id)!.icon

/** Screens and settings that are not a section of their own. */
const screens: Destination[] = [
  { id: 'home', kind: 'screen', title: 'Início', subtitle: 'Saldo, atalhos e o seu dia', icon: House, keywords: ['inicio', 'home', 'principal', 'painel', 'comeco'], path: '/' },
  { id: 'account', kind: 'screen', title: 'Conta', subtitle: 'Entrar, sair, sincronização e e-mail', icon: UserRound, keywords: ['conta', 'minha conta', 'perfil', 'login', 'entrar', 'sair', 'logout', 'sincronizacao', 'sincronizar', 'nuvem', 'email', 'excluir conta', 'apagar conta', 'sessoes', 'aparelhos'], path: '/account' },
  { id: 'assistant', kind: 'screen', title: 'Assistente', subtitle: 'Peça em uma frase: o Núcleo registra e responde', icon: MessageCircle, keywords: ['assistente', 'chat', 'conversar', 'perguntar', 'ia', 'inteligencia artificial', 'robo', 'ajuda'], path: '/assistant' },
  { id: 'settings', kind: 'screen', title: 'Configurações', subtitle: 'Aparência, moeda, cofre, backup e seções', icon: Settings, keywords: ['configuracoes', 'configuracao', 'ajustes', 'preferencias', 'opcoes', 'config'], path: '/settings' },
  { id: 'settings:sections', kind: 'screen', title: 'Personalizar seções', subtitle: 'Configurações · mostrar ou esconder seções', icon: SlidersHorizontal, keywords: ['secoes visiveis', 'esconder secao', 'mostrar secao', 'ativar secao', 'ligar secao', 'desligar', 'modulos', 'personalizar'], path: '/settings', params: { painel: 'secoes' } },
  { id: 'settings:tabs', kind: 'screen', title: 'Barra de navegação', subtitle: 'Configurações · o que aparece ao lado de Início', icon: LayoutPanelLeft, keywords: ['barra', 'abas', 'menu de baixo', 'navegacao', 'atalhos da barra'], path: '/settings', params: { painel: 'barra' } },
  { id: 'settings:theme', kind: 'screen', title: 'Tema e aparência', subtitle: 'Configurações · claro, escuro ou automático', icon: Palette, keywords: ['tema', 'aparencia', 'modo escuro', 'modo claro', 'dark', 'cores'], path: '/settings' },
  { id: 'settings:currency', kind: 'screen', title: 'Moeda e câmbio', subtitle: 'Configurações · moeda principal e taxas', icon: Coins, keywords: ['moeda', 'cambio', 'cotacao', 'taxa', 'euro', 'real', 'dolar', 'conversao'], path: '/settings' },
  { id: 'settings:balance', kind: 'screen', title: 'Saldo inicial e correção', subtitle: 'Configurações · corrigir saldo e categorias', icon: Scale, keywords: ['saldo inicial', 'corrigir saldo', 'ajustar saldo', 'ajuste'], module: 'finance', path: '/settings' },
  { id: 'settings:categories', kind: 'screen', title: 'Categorias financeiras', subtitle: 'Configurações · nomes das categorias', icon: Tags, keywords: ['categorias', 'categoria', 'classificar gastos'], module: 'finance', path: '/settings' },
  { id: 'settings:vault', kind: 'screen', title: 'Cofre de senhas', subtitle: 'Configurações · trocar senha do cofre e bloqueio', icon: Lock, keywords: ['cofre', 'senha do cofre', 'trocar senha', 'bloquear', 'seguranca'], module: 'accounts', path: '/settings' },
  { id: 'settings:backup', kind: 'screen', title: 'Backup', subtitle: 'Configurações · exportar e importar seus dados', icon: DatabaseBackup, keywords: ['backup', 'copia de seguranca', 'exportar', 'importar dados', 'baixar dados', 'restaurar'], path: '/settings' },
  { id: 'reminders', kind: 'screen', title: 'Lembretes e notificações', subtitle: 'O que lembrar, quando e com quanta antecedência', icon: Bell, keywords: ['lembretes', 'lembrete', 'notificacoes', 'avisos', 'alertas', 'alarme'], path: '/reminders' },
  { id: 'automations', kind: 'screen', title: 'Feito pelo Núcleo', subtitle: 'Automações · o que o Núcleo fez e o que espera confirmação', icon: Sparkles, keywords: ['automacoes', 'automacao', 'automatico', 'pendentes', 'confirmar cobranca'], path: '/automations' },
  { id: 'rules', kind: 'screen', title: 'Minhas regras', subtitle: 'Automações · quando acontecer X, faça Y', icon: Wand2, keywords: ['regras', 'regra', 'automacoes', 'automatizar', 'gatilho', 'se entao', 'criar regra'], path: '/rules' },
  { id: 'imports', kind: 'screen', title: 'Extratos importados', subtitle: 'Automações · importações feitas e como desfazer', icon: FileClock, keywords: ['extratos', 'importacoes', 'historico de importacao', 'desfazer importacao'], module: 'finance', path: '/imports' },
  { id: 'import', kind: 'action', title: 'Importar extrato', subtitle: 'Financeiro · CSV ou OFX do seu banco', icon: FileUp, keywords: ['importar extrato', 'extrato bancario', 'csv', 'ofx', 'banco', 'importar movimentacoes'], module: 'finance', path: '/import' },
  { id: 'finance:month', kind: 'screen', title: 'Resumo do mês', subtitle: 'Financeiro · entradas, saídas e categorias do mês', icon: PieChart, keywords: ['resumo do mes', 'mes', 'mensal', 'quanto gastei', 'gastos do mes', 'relatorio', 'categorias', 'onde gastei'], module: 'finance', path: '/finance', params: { view: 'month' } },
  { id: 'today:morning', kind: 'screen', title: 'Começar o dia', subtitle: 'Hoje · o plano da manhã', icon: Sunrise, keywords: ['comecar o dia', 'manha', 'bom dia', 'planejar o dia'], module: 'today', path: '/today', params: { mode: 'morning' } },
  { id: 'today:night', kind: 'screen', title: 'Fechar o dia', subtitle: 'Hoje · revisar e preparar amanhã', icon: Moon, keywords: ['fechar o dia', 'noite', 'encerrar o dia', 'amanha', 'boa noite'], module: 'today', path: '/today', params: { mode: 'night' } },
  { id: 'focus', kind: 'screen', title: 'Modo foco', subtitle: 'Tarefas · cronômetro para uma tarefa', icon: Timer, keywords: ['foco', 'concentrar', 'pomodoro', 'cronometro', 'timer'], module: 'tasks', path: '/focus' },
  { id: 'week:plan', kind: 'screen', title: 'Planejar semana', subtitle: 'Semana · metas da próxima semana', icon: CalendarRange, keywords: ['planejar semana', 'proxima semana', 'metas da semana'], module: 'week', path: '/week', params: { view: 'plan' } },
  { id: 'meals:shopping', kind: 'screen', title: 'Lista de compras', subtitle: 'Alimentação · o que comprar para as refeições', icon: ShoppingCart, keywords: ['lista de compras', 'compras', 'mercado', 'supermercado', 'feira', 'ingredientes'], module: 'meals', path: '/meals', params: { view: 'shopping' } },
  { id: 'meals:plan', kind: 'screen', title: 'Plano de refeições com IA', subtitle: 'Alimentação · montar o cardápio da semana', icon: icon('meals'), keywords: ['plano alimentar', 'cardapio da semana', 'montar cardapio', 'dieta'], module: 'meals', path: '/meals', params: { view: 'plan' } },
  { id: 'life:calendar', kind: 'screen', title: 'Calendário', subtitle: 'Vida · o mês com prazos e compromissos', icon: icon('life'), keywords: ['calendario', 'mes', 'datas', 'prazos'], module: 'life', path: '/life', params: { view: 'calendar' } },
  { id: 'life:projects', kind: 'screen', title: 'Projetos pessoais', subtitle: 'Vida · projetos com etapas', icon: icon('life'), keywords: ['projetos pessoais', 'projeto pessoal', 'etapas'], module: 'life', path: '/life', params: { view: 'projects' } },
  { id: 'life:objectives', kind: 'screen', title: 'Objetivos', subtitle: 'Vida · objetivos e o progresso de cada um', icon: icon('life'), keywords: ['objetivos', 'objetivo', 'metas de vida', 'sonhos', 'meta pessoal'], module: 'life', path: '/life', params: { view: 'objectives' } },
  { id: 'life:changes', kind: 'screen', title: 'O que mudou?', subtitle: 'Vida · comparação com períodos anteriores', icon: icon('life'), keywords: ['o que mudou', 'mudancas', 'comparar', 'evolucao', 'progresso'], module: 'life', path: '/life', params: { view: 'changes' } },
]

/** "Create" actions: each opens the same form as the screen's own "+" button. */
const NEW = { novo: '1' }
const actions: Destination[] = [
  { id: 'new:task', kind: 'action', title: 'Nova tarefa', subtitle: 'Tarefas', icon: Plus, keywords: ['tarefa', 'afazer', 'lembrar de', 'todo'], module: 'tasks', path: '/tasks', params: NEW },
  { id: 'new:client', kind: 'action', title: 'Novo cliente', subtitle: 'Clientes · cadastrar contato', icon: Plus, keywords: ['cliente', 'contato', 'pessoa', 'cadastro de cliente'], module: 'clients', path: '/clients', params: NEW },
  { id: 'new:project', kind: 'action', title: 'Novo projeto', subtitle: 'Projetos de trabalho', icon: Plus, keywords: ['projeto', 'trabalho', 'job', 'site', 'app', 'freela'], module: 'projects', path: '/projects', params: NEW },
  { id: 'new:income', kind: 'action', title: 'Registrar entrada', subtitle: 'Financeiro · dinheiro que entrou', icon: ArrowDownLeft, keywords: ['entrada', 'receita', 'recebimento', 'recebi', 'ganhei', 'salario', 'deposito', 'adicionar dinheiro', 'pagamento recebido', 'movimentacao'], module: 'finance', path: '/finance', params: { novo: 'in' } },
  { id: 'new:expense', kind: 'action', title: 'Registrar saída', subtitle: 'Financeiro · pagamento, gasto ou compra', icon: ArrowUpRight, keywords: ['saida', 'pagamento', 'pagar', 'paguei', 'gasto', 'gastei', 'despesa', 'compra', 'comprei', 'retirar', 'conta paga', 'movimentacao'], module: 'finance', path: '/finance', params: { novo: 'out' } },
  { id: 'new:sale', kind: 'action', title: 'Nova venda', subtitle: 'Vendas · quem comprou e quanto pagou', icon: Plus, keywords: ['venda', 'vendi', 'pedido', 'comprador'], module: 'sales', path: '/sales', params: NEW },
  { id: 'new:subscriber', kind: 'action', title: 'Novo assinante', subtitle: 'Assinantes', icon: Plus, keywords: ['assinante', 'membro', 'mensalista'], module: 'subscribers', path: '/subscribers', params: NEW, requires: 'subPlans' },
  { id: 'new:tool', kind: 'action', title: 'Nova assinatura', subtitle: 'Assinaturas · app, ferramenta ou serviço que você paga', icon: Plus, keywords: ['assinatura', 'mensalidade', 'ferramenta', 'servico', 'streaming'], module: 'tools', path: '/tools', params: NEW },
  { id: 'new:goal', kind: 'action', title: 'Nova meta de compra', subtitle: 'Metas de compra', icon: Plus, keywords: ['meta', 'metas', 'desejo', 'compra', 'economizar para'], module: 'goals', path: '/goals', params: NEW },
  { id: 'new:objective', kind: 'action', title: 'Novo objetivo', subtitle: 'Vida · objetivos', icon: Plus, keywords: ['objetivo', 'meta', 'meta pessoal', 'sonho'], module: 'life', path: '/life', params: { view: 'objectives', novo: '1' } },
  { id: 'new:lifeProject', kind: 'action', title: 'Novo projeto pessoal', subtitle: 'Vida · projetos pessoais', icon: Plus, keywords: ['projeto pessoal', 'projeto'], module: 'life', path: '/life', params: { view: 'projects', novo: '1' } },
  { id: 'new:event', kind: 'action', title: 'Novo compromisso', subtitle: 'Agenda', icon: Plus, keywords: ['compromisso', 'evento', 'reuniao', 'consulta', 'agendar', 'marcar horario'], module: 'agenda', path: '/agenda', params: NEW },
  { id: 'new:habit', kind: 'action', title: 'Novo hábito', subtitle: 'Hábitos', icon: Plus, keywords: ['habito', 'treino', 'leitura', 'agua'], module: 'habits', path: '/habits', params: NEW },
  { id: 'new:recurring', kind: 'action', title: 'Novo recorrente', subtitle: 'Recorrentes · checklist que se repete', icon: Plus, keywords: ['recorrente', 'conta a pagar', 'boleto', 'repetir', 'todo mes'], module: 'recurring', path: '/recurring', params: NEW },
  { id: 'new:note', kind: 'action', title: 'Nova anotação', subtitle: 'Anotações', icon: Plus, keywords: ['anotacao', 'nota', 'anotar', 'escrever', 'ideia'], module: 'notes', path: '/notes', params: NEW },
  { id: 'new:account', kind: 'action', title: 'Novo acesso', subtitle: 'Senhas · guardar login e senha no cofre', icon: Plus, keywords: ['senha', 'acesso', 'login', 'conta', 'credencial'], module: 'accounts', path: '/accounts', params: NEW },
  { id: 'new:portfolio', kind: 'action', title: 'Adicionar ao portfólio', subtitle: 'Portfólio · trabalho entregue', icon: Plus, keywords: ['portfolio', 'trabalho entregue', 'case'], module: 'portfolio', path: '/portfolio', params: NEW },
  { id: 'new:inbox', kind: 'action', title: 'Capturar na caixa de entrada', subtitle: 'Caixa de entrada · anote agora, organize depois', icon: Plus, keywords: ['capturar', 'captura', 'ideia rapida', 'anotar rapido', 'inbox'], module: 'inbox', path: '/inbox', params: NEW },
]

/** Questions with a direct answer from the person's own numbers. */
const answers: Destination[] = [
  { id: 'answer:receivable-projects', kind: 'answer', title: 'A receber em projetos', subtitle: 'Projetos de trabalho', icon: HandCoins, keywords: ['a receber', 'receber', 'falta receber', 'me devem', 'devendo', 'pendente', 'cobrar', 'valores a receber'], module: 'projects', path: '/projects', hint: 'projectsReceivable' },
  { id: 'answer:receivable-sales', kind: 'answer', title: 'A receber em vendas', subtitle: 'Vendas', icon: HandCoins, keywords: ['a receber', 'receber', 'falta receber', 'me devem', 'devendo', 'fiado', 'pendente', 'cobrar', 'valores a receber'], module: 'sales', path: '/sales', hint: 'salesReceivable' },
  { id: 'answer:balance', kind: 'answer', title: 'Saldo atual', subtitle: 'Financeiro', icon: Wallet, keywords: ['saldo', 'quanto tenho', 'dinheiro', 'disponivel', 'tenho de dinheiro', 'conta'], module: 'finance', path: '/finance', hint: 'balance' },
  { id: 'answer:charges', kind: 'answer', title: 'Próximas cobranças', subtitle: 'Assinaturas', icon: icon('tools'), keywords: ['cobrancas', 'proximas cobrancas', 'vence', 'vencimento', 'renovacao', 'quanto pago', 'mensalidades'], module: 'tools', path: '/tools', hint: 'upcomingCharges' },
  { id: 'answer:tasks', kind: 'answer', title: 'Tarefas em aberto', subtitle: 'Tarefas', icon: icon('tasks'), keywords: ['tarefas', 'pendentes', 'pendencias', 'o que fazer', 'falta fazer'], module: 'tasks', path: '/tasks', hint: 'openTasks' },
]

export const CATALOG: Destination[] = [...sections, ...screens, ...actions, ...answers]

/** Shown when the search is empty: ideas of what to type, then a few direct shortcuts. */
export const EXAMPLES: { query: string; module?: ModuleId }[] = [
  { query: 'Nova tarefa', module: 'tasks' },
  { query: 'Registrar pagamento', module: 'finance' },
  { query: 'Quanto tenho para receber?', module: 'projects' },
  { query: 'Adicionar cliente', module: 'clients' },
  { query: 'Assinaturas', module: 'tools' },
  { query: 'Lista de compras', module: 'meals' },
  { query: 'Senhas', module: 'accounts' },
  { query: 'Backup' },
]
