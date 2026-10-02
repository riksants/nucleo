-- Etapa 4 (planejamento pessoal): permite 2 coleções novas na tabela records.
--   lifePlans: projetos pessoais e objetivos (campo kind)
--   planSteps: etapas de projetos pessoais e objetivos
--
-- O que muda: só a lista de valores aceitos na coluna "collection".
-- O que NÃO muda: nenhuma tabela, linha, política RLS, gatilho ou permissão.
-- Todos os registros existentes continuam válidos (a lista nova contém a anterior).
-- As regras de acesso (cada usuário só vê e altera as próprias linhas) já valem
-- para qualquer coleção da tabela records, inclusive as novas.
--
-- Uma única instrução ALTER TABLE: ou troca a regra inteira, ou não muda nada.
-- Para desfazer: rodar de novo a regra da Etapa 3 (20261004000000_etapa3_financas.sql),
-- desde que não existam linhas das duas coleções novas.

alter table public.records
  drop constraint if exists records_collection_check,
  add constraint records_collection_check check (collection in (
    'transactions', 'goals', 'clients', 'projects', 'tasks', 'tools', 'accounts', 'notes', 'portfolio',
    'sales', 'offerings', 'subPlans', 'subscribers', 'plannerProfiles', 'routinePlans', 'mealPlans',
    'inbox', 'habits', 'recurring', 'completions', 'events', 'focusSessions',
    'weeklyGoals', 'challenges', 'weekCheckins', 'weekSnapshots',
    'financeGoals',
    -- novas (Etapa 4)
    'lifePlans', 'planSteps'
  ));
