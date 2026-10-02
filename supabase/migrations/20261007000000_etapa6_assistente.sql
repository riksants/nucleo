-- Etapa 6 (inteligência): prepara o registro de uso do interpretador opcional do Assistente.
-- O interpretador fica DESLIGADO por padrão; sem ele não há chamada externa nem custo.
--
-- O que muda (somente na tabela ai_usage, que já existe):
--   1. o campo "kind" passa a aceitar também 'assistant' (além de 'routine', 'meals', 'both');
--   2. duas colunas opcionais para medir uso/custo aproximado sem guardar conteúdo:
--      input_tokens e output_tokens (números; nunca o texto enviado ou recebido).
--
-- O que NÃO muda: nenhuma outra tabela, nenhuma linha existente, nenhuma política RLS.
-- A tabela continua só com leitura das próprias linhas pelo usuário; quem grava é a
-- Edge Function com service_role. Registros antigos continuam válidos.
--
-- Para desfazer (se ainda não houver linhas 'assistant'):
--   alter table public.ai_usage drop column if exists input_tokens, drop column if exists output_tokens,
--     drop constraint if exists ai_usage_kind_check,
--     add constraint ai_usage_kind_check check (kind in ('routine', 'meals', 'both'));

alter table public.ai_usage
  drop constraint if exists ai_usage_kind_check,
  add constraint ai_usage_kind_check check (kind in ('routine', 'meals', 'both', 'assistant')),
  add column if not exists input_tokens integer check (input_tokens is null or input_tokens >= 0),
  add column if not exists output_tokens integer check (output_tokens is null or output_tokens >= 0);
