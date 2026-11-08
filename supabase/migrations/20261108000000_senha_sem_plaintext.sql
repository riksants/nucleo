-- PARTE 12 (criptografia): o banco passa a recusar senha do Cofre em texto aberto.
--
-- O Cofre guarda a senha de um "acesso" (collection accounts) cifrada em data->'secret' (AES-GCM).
-- O campo data->>'password' é um resquício de antes do Cofre (texto aberto) e deve ficar sempre vazio:
-- o cliente já recusa sincronizar accounts com password não vazio (PlainPasswordError em sync.ts) e a
-- migração do Cofre sela o legado no desbloqueio. Esta migração move essa garantia para o PostgreSQL,
-- para que nem a service_role nem um acesso direto ao PostgREST consigam gravar uma senha em texto aberto.
--
-- Verificado em produção (contagem somente-leitura, PARTE 12) antes de criar: 0 linhas de records e 0 de
-- records_history (collection accounts) com data->>'password' não vazio. Por isso a constraint pode ser
-- validada já nesta migração, sem bloquear nenhum legado.
--
-- Estratégia: NOT VALID primeiro (protege toda inserção/alteração a partir de agora, sem varrer a tabela
-- sob lock forte) e, em seguida, VALIDATE (confere as linhas existentes — 0 violações). Companheira da
-- constraint records_accounts_secret_shape (20261027000000), que valida o formato do secret.
--
-- Não altera nenhuma linha. Não toca em outras collections (o CHECK só olha accounts).
--
-- Desfazer (não toca em registro algum):
--   alter table public.records drop constraint if exists records_accounts_no_plaintext_password;

begin;

set local lock_timeout = '10s';

-- accounts: data->>'password' tem de estar ausente, nulo ou vazio. Senha de verdade só cifrada em 'secret'.
-- Demais collections nunca são barradas por esta regra.
alter table public.records drop constraint if exists records_accounts_no_plaintext_password;
alter table public.records add constraint records_accounts_no_plaintext_password check (
  collection <> 'accounts'
  or coalesce(data ->> 'password', '') = ''
) not valid;

-- 0 violações em produção (conferido): valida agora, para já valer para as linhas existentes também.
alter table public.records validate constraint records_accounts_no_plaintext_password;

commit;
