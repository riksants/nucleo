-- Automações (Parte 2): permite 1 coleção nova na tabela records.
--   rules: as regras da pessoa ("Quando X → se Y → faça Z"), criadas em
--          "Minhas regras". O que cada regra fez continua em automationRuns
--          ("Feito pelo Núcleo"), que já existe.
--
-- O que muda: só a lista de valores aceitos na coluna "collection".
-- O que NÃO muda: nenhuma tabela, linha, política RLS, gatilho ou permissão.
-- Todos os registros existentes continuam válidos (a lista nova contém a anterior).
-- As regras de acesso (cada usuário só vê e altera as próprias linhas) já valem
-- para qualquer coleção da tabela records, inclusive a nova.
--
-- Uma única instrução ALTER TABLE: ou troca a regra inteira, ou não muda nada.
-- Para desfazer: rodar de novo a regra da Parte 1 (20261012000000_automacoes.sql),
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
    'automationRuns',
    -- nova (Regras)
    'rules'
  ));
