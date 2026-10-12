-- Automações (Parte 1): permite 1 coleção nova na tabela records.
--   automationRuns: o que o Núcleo fez ou preparou sozinho ("Feito pelo Núcleo"):
--                   cobranças a receber/a pagar, pagamentos automáticos, reservas
--                   para metas e mudanças de status de clientes, com o necessário
--                   para desfazer.
--
-- O que muda: só a lista de valores aceitos na coluna "collection".
-- O que NÃO muda: nenhuma tabela, linha, política RLS, gatilho ou permissão.
-- Todos os registros existentes continuam válidos (a lista nova contém a anterior).
-- As regras de acesso (cada usuário só vê e altera as próprias linhas) já valem
-- para qualquer coleção da tabela records, inclusive a nova.
--
-- Uma única instrução ALTER TABLE: ou troca a regra inteira, ou não muda nada.
-- Para desfazer: rodar de novo a regra da Etapa 5 (20261006000000_etapa5_alimentacao.sql),
-- desde que não existam linhas da coleção nova.

alter table public.records
  drop constraint if exists records_collection_check,
  add constraint records_collection_check check (collection in (
    'transactions', 'goals', 'clients', 'projects', 'tasks', 'tools', 'accounts', 'notes', 'portfolio',
    'sales', 'offerings', 'subPlans', 'subscribers', 'plannerProfiles', 'routinePlans', 'mealPlans',
    'inbox', 'habits', 'recurring', 'completions', 'events', 'focusSessions',
    'weeklyGoals', 'challenges', 'weekCheckins', 'weekSnapshots',
    'financeGoals',
    'lifePlans', 'planSteps',
    'meals', 'shoppingItems',
    -- nova (Automações)
    'automationRuns'
  ));
