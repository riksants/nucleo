-- Auditoria, Etapas 4 a 10: o que precisa do banco.
--
-- O que muda:
--   0. Correção da Etapa 3: excluir uma conta com 2 ou mais registros falhava (o gatilho de cotas
--      tentava atualizar o uso de uma conta que já estava sendo apagada). Agora funciona.
--   1. Datas (A3, B4): o relógio do aparelho não pode mais "congelar" um registro. Uma data mais de
--      5 min no futuro vale como agora + 5 min, e um registro que já está com data no futuro volta a
--      aceitar edições e exclusões (sem alterar nenhuma linha agora: só na próxima escrita dele).
--      collection e id de uma linha não podem mais ser trocados. Lembretes só podem ser agendados
--      entre ontem e daqui a 90 dias.
--   2. Histórico de versões (Etapa 4): tabela nova records_history. Ao editar ou apagar um item, a
--      versão anterior fica guardada por 30 dias, no máximo 20 versões por item e 25 MB por conta
--      (passando disso, as mais antigas saem primeiro; nunca bloqueia uma escrita). Edições seguidas
--      do mesmo item guardam no máximo uma versão a cada 10 minutos; exclusões sempre guardam.
--      Ninguém lê essa tabela pelo app. A conta excluída leva o histórico junto.
--   3. Usuário de backup (Etapa 4): papel nucleo_backup, SEM login até o dono definir uma senha.
--      Só leitura de records, user_settings, quota_limits e schema_version, e da lista de contas
--      (id, e-mail, data de criação) pela função backup_accounts(). Não escreve em nada.
--   4. Versão do banco (Etapa 6, A11): tabela schema_version com as migrations aplicadas. As
--      anteriores entram aqui conforme o que já existe no banco.
--   5. IA (Etapa 8, A10): função ai_reserve(), usada pelas Edge Functions (ainda não publicadas)
--      para reservar uma geração de forma atômica, contando erros, com teto por dia por pessoa e
--      teto global.
--   6. Excluir conta (Etapa 9): função delete_my_account(). Só a própria conta, só com login feito
--      com senha (ou código) nos últimos 10 minutos. Apaga a conta e tudo dela (cascata).
--   7. Endurecimento (Etapa 10): claim_push_endpoint só tira o aparelho de outra conta quando as
--      chaves também batem (B3); permissões que o app não usa saem (I1); senha de "Contas" só no
--      formato criptografado do cofre, para linhas novas (B5).
--
-- O que NÃO muda: nenhuma linha existente é alterada ou apagada. Nenhuma política existente muda.
--
-- Tudo numa transação: ou aplica inteiro, ou não muda nada. Se alguma escrita longa segurar a
-- tabela records por mais de 10 s, a migração falha sem mudar nada; é só rodar de novo.
--
-- Depois de aplicar (opcional, só quando for ligar o backup automático), o dono define a senha do
-- usuário de backup no SQL Editor — nunca no repositório:
--   alter role nucleo_backup with login password '<senha longa gerada>';
--
-- Para desfazer (não toca em nenhum registro):
--   drop trigger if exists records_keep_history on public.records;
--   drop trigger if exists notifications_before_write on public.scheduled_notifications;
--   alter table public.records drop constraint if exists records_accounts_secret_shape;
--   drop policy if exists records_backup_read on public.records;
--   drop policy if exists settings_backup_read on public.user_settings;
--   drop policy if exists quota_limits_backup_read on public.quota_limits;
--   drop function if exists public.records_keep_history(), public.records_history_cleanup(),
--     public.records_history_restore(bigint), public.notifications_before_write(), public.backup_accounts(),
--     public.ai_reserve(uuid, text, text, int, int), public.delete_my_account();
--   drop table if exists public.records_history, public.records_history_usage, public.schema_version;
--   revoke all on schema public from nucleo_backup; drop role if exists nucleo_backup;
--   delete from public.quota_limits where key like 'history.%' or key like 'ai.%';
--   e rodar de novo as funções records_before_write e settings_before_write de
--   20261001000000_nucleo_init.sql, claim_push_endpoint do mesmo arquivo e records_quota de
--   20261024000000_cotas.sql.

begin;

set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. datas (A3, B4)
-- Até 5 min à frente do servidor (relógios um pouco adiantados); além disso, vale agora + 5 min.
-- Uma versão guardada com data além desse teto (gravada antes desta migração por um relógio
-- adiantado) tem data inválida: a próxima escrita vale, e o registro volta ao normal.
create or replace function public.records_before_write() returns trigger
language plpgsql set search_path = '' as $$
declare
  ceiling timestamptz := now() + interval '5 minutes';
begin
  new.client_updated_at := least(new.client_updated_at, ceiling);
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'user_id não pode mudar';
    end if;
    if new.collection is distinct from old.collection or new.id is distinct from old.id then
      raise exception using errcode = '23514', message = 'collection e id não podem mudar';
    end if;
    -- Escrita atrasada de um aparelho que ficou offline: mantém a versão mais nova.
    if old.client_updated_at <= ceiling and new.client_updated_at < old.client_updated_at then
      return null;
    end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

create or replace function public.settings_before_write() returns trigger
language plpgsql set search_path = '' as $$
declare
  ceiling timestamptz := now() + interval '5 minutes';
begin
  new.client_updated_at := least(new.client_updated_at, ceiling);
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'user_id não pode mudar';
    end if;
    if old.client_updated_at <= ceiling and new.client_updated_at < old.client_updated_at then
      return null;
    end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

-- Lembretes: o app agenda no máximo 14 dias à frente. Fora de [ontem, +90 dias] é erro do cliente
-- (ou abuso da fila do dispatcher). O dispatcher (service_role) não passa por esta regra.
create or replace function public.notifications_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('role', true) in ('authenticated', 'anon')
     and (new.fire_at < now() - interval '1 day' or new.fire_at > now() + interval '90 days') then
    raise exception using errcode = '23514', message = 'fire_at fora da janela permitida';
  end if;
  return new;
end $$;

-- Roda antes de notifications_quota (ordem alfabética).
drop trigger if exists notifications_before_write on public.scheduled_notifications;
create trigger notifications_before_write before insert or update on public.scheduled_notifications
  for each row execute function public.notifications_before_write();

-- ---------------------------------------------------------------- 1b. excluir conta com cotas
-- Correção da Etapa 3: excluir uma conta com 2 ou mais registros falhava (erro de chave estrangeira
-- em quota_usage), inclusive pelo painel do Supabase. Mesma função, com a saída antecipada no começo.
create or replace function public.records_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  acct public.quota_usage;
  col public.quota_usage;
  lim bigint;
  -- O que a linha antiga deixa de ocupar e o que a nova passa a ocupar.
  old_live int := 0;
  old_total int := 0;
  old_bytes bigint := 0;
  new_live int := 0;
  new_total int := 0;
  new_bytes bigint := 0;
  col_live int;
begin
  -- A conta está sendo excluída (cascata de auth.users): o uso dela sai junto. Sem isto, a segunda
  -- linha da conta atualizava um contador cuja conta já não existe e a exclusão inteira falhava.
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  -- Uma escrita por vez por conta: escritas simultâneas da mesma conta esperam aqui,
  -- então duas não passam juntas do limite.
  select * into acct from public.quota_usage where user_id = uid and scope = '*' for update;
  if not found then
    if tg_op = 'DELETE' then
      return old; -- conta sem uso registrado (ou sendo excluída): nada a descontar
    end if;
    insert into public.quota_usage (user_id, scope) values (uid, '*') on conflict do nothing;
    select * into acct from public.quota_usage where user_id = uid and scope = '*' for update;
  end if;

  if tg_op = 'INSERT' then
    -- Com ON CONFLICT este gatilho roda mesmo quando a linha já existe e a escrita vira
    -- atualização; nesse caso quem conta é o gatilho de atualização.
    if exists (select 1 from public.records r where r.user_id = new.user_id and r.collection = new.collection and r.id = new.id) then
      return new;
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    old_live := case when old.deleted then 0 else 1 end;
    old_total := 1;
    old_bytes := octet_length(old.data::text);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_live := case when new.deleted then 0 else 1 end;
    new_total := 1;
    new_bytes := octet_length(new.data::text);
  end if;

  if tg_op <> 'DELETE' then
    -- Linhas da conta (contando apagados): só criar soma.
    if new_total > old_total then
      lim := public.quota_limit('account.rows');
      if lim is not null and acct.total + 1 > lim then
        perform public.quota_raise('account.rows', lim);
      end if;
    end if;
    -- Tamanho da conta: só quando cresce.
    if new_bytes > old_bytes then
      lim := public.quota_limit('account.bytes');
      if lim is not null and acct.bytes + (new_bytes - old_bytes) > lim then
        perform public.quota_raise('account.bytes', lim);
      end if;
    end if;
    -- Itens ativos na coleção: criar, reativar um apagado ou mudar de coleção.
    col_live := new_live - case when tg_op = 'UPDATE' and old.collection = new.collection then old_live else 0 end;
    if col_live > 0 then
      select * into col from public.quota_usage where user_id = uid and scope = new.collection;
      lim := coalesce(public.quota_limit('records.' || new.collection), public.quota_limit('records.default'));
      if lim is not null and coalesce(col.live, 0) + col_live > lim then
        perform public.quota_raise('records.' || new.collection, lim);
      end if;
    end if;
  end if;

  update public.quota_usage
     set live = live + new_live - old_live, total = total + new_total - old_total, bytes = bytes + new_bytes - old_bytes
   where user_id = uid and scope = '*';
  if tg_op in ('UPDATE', 'DELETE') then
    update public.quota_usage
       set live = live - old_live, total = total - old_total, bytes = bytes - old_bytes
     where user_id = uid and scope = old.collection;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.quota_usage as u (user_id, scope, live, total, bytes)
      values (uid, new.collection, new_live, new_total, new_bytes)
      on conflict (user_id, scope) do update
        set live = u.live + excluded.live, total = u.total + excluded.total, bytes = u.bytes + excluded.bytes;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- ---------------------------------------------------------------- 2. histórico de versões (Etapa 4)
create table if not exists public.records_history (
  version_id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  collection text not null,
  id text not null,
  data jsonb not null,
  deleted boolean not null,
  client_updated_at timestamptz not null,
  -- Quando esta versão deixou de ser a atual.
  replaced_at timestamptz not null default now(),
  bytes integer not null
);
create index if not exists records_history_item_idx on public.records_history (user_id, collection, id, replaced_at desc);
create index if not exists records_history_user_idx on public.records_history (user_id, replaced_at);
create index if not exists records_history_age_idx on public.records_history (replaced_at);

-- Quanto cada conta ocupa no histórico (mantido só pelo gatilho e pela limpeza).
create table if not exists public.records_history_usage (
  user_id uuid primary key references auth.users (id) on delete cascade,
  versions bigint not null default 0,
  bytes bigint not null default 0
);

-- Ninguém do app lê ou escreve: o histórico é para o dono do projeto restaurar pelo SQL Editor.
alter table public.records_history enable row level security;
alter table public.records_history_usage enable row level security;
revoke all on public.records_history, public.records_history_usage from anon, authenticated;

insert into public.quota_limits (key, max_value, note) values
  ('history.days', 30, 'Dias que uma versão antiga fica no histórico'),
  ('history.per_item', 20, 'Versões antigas guardadas por item'),
  ('history.bytes', 26214400, 'Tamanho do histórico por conta (25 MB); passando, saem as mais antigas'),
  ('history.interval_minutes', 10, 'Edições seguidas do mesmo item: no máximo uma versão a cada N minutos')
on conflict (key) do nothing;

create or replace function public.records_keep_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  max_bytes bigint := coalesce(public.quota_limit('history.bytes'), 26214400);
  per_item bigint := coalesce(public.quota_limit('history.per_item'), 20);
  keep_days bigint := coalesce(public.quota_limit('history.days'), 30);
  gap bigint := coalesce(public.quota_limit('history.interval_minutes'), 10);
  removing boolean := tg_op = 'DELETE' or (new.deleted and not old.deleted);
  b integer;
  used bigint;
  gone_n bigint := 0;
  gone_b bigint := 0;
  n bigint;
  s bigint;
begin
  -- Nada a guardar: a "lápide" de um item apagado, ou uma escrita que não mudou o conteúdo.
  if old.deleted and old.data = '{}'::jsonb then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.data = old.data and new.deleted = old.deleted then
    return null;
  end if;
  -- A conta está sendo excluída (cascata de auth.users): o histórico vai junto.
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return null;
  end if;
  -- Edição seguida do mesmo item: já há uma versão recente. Exclusões (e restaurações) sempre guardam.
  if not removing and coalesce(current_setting('nucleo.history_always', true), '') <> 'on' and exists (
    select 1 from public.records_history h
     where h.user_id = old.user_id and h.collection = old.collection and h.id = old.id
       and h.replaced_at > now() - make_interval(mins => gap::int)
  ) then
    return null;
  end if;

  b := octet_length(old.data::text);
  if b > max_bytes then
    return null;
  end if;

  insert into public.records_history (user_id, collection, id, data, deleted, client_updated_at, bytes)
    values (old.user_id, old.collection, old.id, old.data, old.deleted, old.client_updated_at, b);
  -- Também serializa as escritas da mesma conta no histórico (trava a linha de uso).
  insert into public.records_history_usage as u (user_id, versions, bytes) values (old.user_id, 1, b)
    on conflict (user_id) do update set versions = u.versions + 1, bytes = u.bytes + b
    returning u.bytes into used;

  -- Só as N versões mais novas de cada item.
  with gone as (
    delete from public.records_history h
     where h.version_id in (
       select x.version_id from public.records_history x
        where x.user_id = old.user_id and x.collection = old.collection and x.id = old.id
        order by x.replaced_at desc, x.version_id desc
        offset per_item)
    returning h.bytes)
  select count(*), coalesce(sum(gone.bytes), 0) into n, s from gone;
  gone_n := gone_n + n;
  gone_b := gone_b + s;

  -- Mais velhas que o prazo (a limpeza diária faz o mesmo para contas paradas).
  with gone as (
    delete from public.records_history h
     where h.user_id = old.user_id and h.replaced_at < now() - make_interval(days => keep_days::int)
    returning h.bytes)
  select count(*), coalesce(sum(gone.bytes), 0) into n, s from gone;
  gone_n := gone_n + n;
  gone_b := gone_b + s;

  -- Passou do tamanho da conta: saem as mais antigas.
  if used - gone_b > max_bytes then
    with ranked as (
      select x.version_id, sum(x.bytes) over (order by x.replaced_at desc, x.version_id desc) as running
        from public.records_history x where x.user_id = old.user_id),
    gone as (
      delete from public.records_history h using ranked r
       where h.version_id = r.version_id and r.running > max_bytes
      returning h.bytes)
    select count(*), coalesce(sum(gone.bytes), 0) into n, s from gone;
    gone_n := gone_n + n;
    gone_b := gone_b + s;
  end if;

  if gone_n > 0 then
    update public.records_history_usage
       set versions = versions - gone_n, bytes = bytes - gone_b
     where user_id = old.user_id;
  end if;
  return null;
end $$;

-- Limpeza diária (supabase/cron-manutencao.sql): versões mais velhas que o prazo, de todas as contas.
create or replace function public.records_history_cleanup() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  keep_days bigint := coalesce(public.quota_limit('history.days'), 30);
  removed bigint;
begin
  with gone as (
    delete from public.records_history h
     where h.replaced_at < now() - make_interval(days => keep_days::int)
    returning h.user_id, h.bytes),
  per as (
    select gone.user_id, count(*) as n, sum(gone.bytes) as b from gone group by gone.user_id),
  upd as (
    update public.records_history_usage u set versions = u.versions - per.n, bytes = u.bytes - per.b
      from per where u.user_id = per.user_id
    returning 1)
  select count(*) into removed from gone;
  return removed;
end $$;

-- Restaura uma versão (SQL Editor, dono do projeto): o item volta como a edição mais nova, e os
-- aparelhos recebem na próxima sincronização. A versão atual vai para o histórico antes.
create or replace function public.records_history_restore(p_version_id bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare
  h public.records_history;
  stamp text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  restored jsonb;
begin
  select * into h from public.records_history where version_id = p_version_id;
  if not found then
    raise exception 'versão % não existe (ou já saiu do histórico)', p_version_id;
  end if;
  restored := case when h.data ? 'updatedAt' then jsonb_set(h.data, '{updatedAt}', to_jsonb(stamp)) else h.data end;
  perform set_config('nucleo.history_always', 'on', true);
  insert into public.records (user_id, collection, id, data, deleted, client_updated_at)
    values (h.user_id, h.collection, h.id, restored, h.deleted, now())
    on conflict (user_id, collection, id) do update
      set data = excluded.data, deleted = excluded.deleted, client_updated_at = excluded.client_updated_at;
  perform set_config('nucleo.history_always', '', true);
  return format('%s/%s restaurado da versão de %s', h.collection, h.id, h.replaced_at);
end $$;

drop trigger if exists records_keep_history on public.records;
create trigger records_keep_history after update or delete on public.records
  for each row execute function public.records_keep_history();

-- ---------------------------------------------------------------- 3. usuário de backup (Etapa 4)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nucleo_backup') then
    create role nucleo_backup nologin;
  end if;
end $$;
-- Mesmo que alguém dê uma permissão a mais por engano, a sessão dele não grava nada.
alter role nucleo_backup set default_transaction_read_only = on;
alter role nucleo_backup set statement_timeout = '10min';

-- ---------------------------------------------------------------- 4. versão do banco (A11)
create table if not exists public.schema_version (
  version text primary key check (char_length(version) between 1 and 100),
  applied_at timestamptz not null default now(),
  note text not null default ''
);
alter table public.schema_version enable row level security;
revoke all on public.schema_version from anon, authenticated;

-- As migrations anteriores, conforme o que já existe neste banco (cada uma deixa uma marca).
do $$
declare
  rule text := (select pg_get_constraintdef(c.oid) from pg_constraint c
                 where c.conname = 'records_collection_check' and c.conrelid = 'public.records'::regclass);
begin
  insert into public.schema_version (version, note) values ('20261001000000_nucleo_init', 'detectada') on conflict do nothing;
  if rule like '%''inbox''%' then insert into public.schema_version values ('20261002000000_etapa1_uso_diario', default, 'detectada') on conflict do nothing; end if;
  if rule like '%''weeklyGoals''%' then insert into public.schema_version values ('20261003000000_etapa2_uso_semanal', default, 'detectada') on conflict do nothing; end if;
  if rule like '%''financeGoals''%' then insert into public.schema_version values ('20261004000000_etapa3_financas', default, 'detectada') on conflict do nothing; end if;
  if rule like '%''lifePlans''%' then insert into public.schema_version values ('20261005000000_etapa4_vida', default, 'detectada') on conflict do nothing; end if;
  if rule like '%''shoppingItems''%' then insert into public.schema_version values ('20261006000000_etapa5_alimentacao', default, 'detectada') on conflict do nothing; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_usage' and column_name = 'input_tokens') then
    insert into public.schema_version values ('20261007000000_etapa6_assistente', default, 'detectada') on conflict do nothing;
  end if;
  if rule like '%''automationRuns''%' then insert into public.schema_version values ('20261012000000_automacoes', default, 'detectada') on conflict do nothing; end if;
  if rule like '%''rules''%' then insert into public.schema_version values ('20261019000000_regras', default, 'detectada') on conflict do nothing; end if;
  if to_regclass('public.quota_usage') is not null then
    insert into public.schema_version values ('20261024000000_cotas', default, 'detectada') on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------- 3b. permissões do backup
grant usage on schema public to nucleo_backup;
grant select on public.records, public.user_settings, public.quota_limits, public.schema_version to nucleo_backup;
drop policy if exists records_backup_read on public.records;
create policy records_backup_read on public.records for select to nucleo_backup using (true);
drop policy if exists settings_backup_read on public.user_settings;
create policy settings_backup_read on public.user_settings for select to nucleo_backup using (true);
drop policy if exists quota_limits_backup_read on public.quota_limits;
create policy quota_limits_backup_read on public.quota_limits for select to nucleo_backup using (true);
drop policy if exists schema_version_backup_read on public.schema_version;
create policy schema_version_backup_read on public.schema_version for select to nucleo_backup using (true);

-- Para uma restauração completa (projeto novo) é preciso saber de quem era cada user_id.
create or replace function public.backup_accounts() returns table (id uuid, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query select u.id, u.email::text, u.created_at from auth.users u order by u.created_at;
end $$;

-- ---------------------------------------------------------------- 5. IA (Etapa 8, A10)
insert into public.quota_limits (key, max_value, note) values
  ('ai.global_daily', 200, 'Gerações de IA por dia somando todas as contas'),
  ('ai.pending_minutes', 5, 'Geração "em andamento" há mais que isso conta como erro')
on conflict (key) do nothing;

-- Reserva uma geração. Uma por vez por pessoa (trava por conta), conta também as que deram erro,
-- e o planejador e o Assistente têm limites separados. Resultado:
--   ok (reservada; usage_id para gravar o fim), replay (já feita: result), busy, duplicate,
--   limit (limite da pessoa), global-limit (teto de todas as contas).
create or replace function public.ai_reserve(p_user uuid, p_kind text, p_request_id text, p_daily_limit int, p_busy_seconds int)
returns table (outcome text, usage_id bigint, result jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  kinds text[] := case when p_kind = 'assistant' then array['assistant'] else array['routine', 'meals', 'both'] end;
  stale interval := make_interval(mins => coalesce(public.quota_limit('ai.pending_minutes'), 5)::int);
  global_limit bigint := coalesce(public.quota_limit('ai.global_daily'), 200);
  prev public.ai_usage;
  new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('nucleo.ai:' || p_user::text, 0));
  -- Uma geração que nunca terminou (função caiu, tempo esgotado) vira erro.
  update public.ai_usage set status = 'error'
   where user_id = p_user and status = 'pending' and created_at < now() - stale;

  select * into prev from public.ai_usage where user_id = p_user and request_id = p_request_id;
  if found then
    return query select case prev.status when 'ok' then 'replay' when 'pending' then 'busy' else 'duplicate' end, prev.id, prev.result;
    return;
  end if;
  if exists (select 1 from public.ai_usage where user_id = p_user and kind = any (kinds) and status = 'pending'
              and created_at > now() - make_interval(secs => p_busy_seconds)) then
    return query select 'busy'::text, null::bigint, null::jsonb;
    return;
  end if;
  if (select count(*) from public.ai_usage where user_id = p_user and kind = any (kinds) and created_at > now() - interval '24 hours') >= p_daily_limit then
    return query select 'limit'::text, null::bigint, null::jsonb;
    return;
  end if;
  -- Teto global: trava de todas as contas só neste instante (a contagem e a reserva juntas).
  perform pg_advisory_xact_lock(hashtextextended('nucleo.ai:global', 0));
  if (select count(*) from public.ai_usage where created_at > now() - interval '24 hours') >= global_limit then
    return query select 'global-limit'::text, null::bigint, null::jsonb;
    return;
  end if;
  insert into public.ai_usage (user_id, kind, request_id, status) values (p_user, p_kind, p_request_id, 'pending')
    returning id into new_id;
  return query select 'ok'::text, new_id, null::jsonb;
end $$;

-- ---------------------------------------------------------------- 6. excluir conta (Etapa 9)
-- Só a própria conta, e só logo depois de confirmar a senha (ou um código): um token roubado ou
-- um aparelho esquecido aberto não basta. Apaga a conta; tudo dela sai junto (cascata).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  amr jsonb := auth.jwt() -> 'amr';
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'não autenticado';
  end if;
  if jsonb_typeof(amr) is distinct from 'array' or not exists (
    select 1 from jsonb_array_elements(amr) a
     where jsonb_typeof(a -> 'timestamp') = 'number' and (a ->> 'timestamp')::numeric > extract(epoch from now()) - 600
  ) then
    raise exception using errcode = '42501', message = 'reauth_required';
  end if;
  delete from auth.users where id = uid;
end $$;

-- ---------------------------------------------------------------- 7. endurecimento (Etapa 10)
-- B3: um aparelho só sai de outra conta quando é de fato o mesmo (mesmas chaves).
create or replace function public.claim_push_endpoint(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  delete from public.push_subscriptions
   where endpoint = p_endpoint and user_id <> auth.uid() and p256dh = p_p256dh;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth)
    on conflict (user_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

-- I1: o app só lê ai_usage e não altera inscrições de push (o RLS já barrava; agora nem a permissão existe).
revoke insert, update, delete, truncate, references, trigger on public.ai_usage from authenticated;
revoke update, truncate, references, trigger on public.push_subscriptions from authenticated;
revoke truncate, references, trigger on public.records, public.user_settings, public.scheduled_notifications from authenticated;

-- B5: senha de "Contas" só no formato do cofre (vale para linhas novas e editadas; as antigas ficam como estão).
alter table public.records drop constraint if exists records_accounts_secret_shape;
alter table public.records add constraint records_accounts_secret_shape check (
  collection <> 'accounts'
  or jsonb_typeof(data -> 'secret') is null
  or jsonb_typeof(data -> 'secret') = 'null'
  or coalesce(jsonb_typeof(data -> 'secret' -> 'iv') = 'string' and jsonb_typeof(data -> 'secret' -> 'ct') = 'string', false)
) not valid;

-- ---------------------------------------------------------------- permissões das funções novas
revoke all on function public.records_keep_history(), public.records_history_cleanup(), public.records_history_restore(bigint),
  public.notifications_before_write(), public.backup_accounts(), public.ai_reserve(uuid, text, text, int, int),
  public.delete_my_account() from public, anon, authenticated;
grant execute on function public.backup_accounts() to nucleo_backup;
grant execute on function public.ai_reserve(uuid, text, text, int, int) to service_role;
grant execute on function public.delete_my_account() to authenticated;
-- claim_push_endpoint foi recriada: mantém as permissões de antes.
revoke all on function public.claim_push_endpoint(text, text, text) from public, anon;
grant execute on function public.claim_push_endpoint(text, text, text) to authenticated;

insert into public.schema_version (version, note) values ('20261027000000_auditoria_etapas_4_10', '') on conflict do nothing;

commit;
