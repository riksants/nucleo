-- Post-restore validation: run on the RESTORED database (after restore.sql) to prove the backup
-- rebuilt a working database, not just rows. Checks structure (tables, constraints, indexes,
-- functions, triggers, RLS/policies) and essential data invariants, and reads a real record back.
-- Any failure raises and stops the run (the workflow goes red). Safe on an empty database too:
-- structure is always required; data checks only assert consistency, which holds with zero rows.
--   psql -v ON_ERROR_STOP=1 -f validate.sql
\set ON_ERROR_STOP on
set timezone = 'UTC';
do $$
declare
  missing text;
  n_records bigint;
  n_accounts bigint;
  sample record;
  bad bigint;
begin
  -- 1. Tables that must exist to run the app.
  for missing in
    select t from unnest(array[
      'public.records', 'public.user_settings', 'public.quota_limits', 'public.quota_usage',
      'public.schema_version', 'public.ai_entitlements', 'public.ai_tiers',
      'public.records_history', 'public.records_history_usage',
      'public.push_subscriptions', 'public.scheduled_notifications', 'public.ai_usage',
      'auth.users'
    ]) t
    where to_regclass(t) is null
  loop
    raise exception 'ESTRUTURA: tabela ausente após o restore: %', missing;
  end loop;

  -- 2. Constraints that protect the data (plaintext password, vault shape of "accounts" secrets).
  for missing in
    select c from unnest(array['records_no_plain_password', 'records_accounts_secret_shape']) c
    where not exists (select 1 from pg_constraint where conname = c)
  loop
    raise exception 'ESTRUTURA: constraint ausente após o restore: %', missing;
  end loop;

  -- 3. Primary-key / uniqueness index on records (user_id, collection, id) must be back.
  if not exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indrelid
    where c.relname = 'records' and i.indisunique and i.indnatts >= 3
  ) then
    raise exception 'ESTRUTURA: índice único de records (user_id, collection, id) ausente';
  end if;

  -- 4. Functions the app and the recovery depend on.
  for missing in
    select f from unnest(array[
      'backup_accounts', 'delete_my_account', 'records_history_restore',
      'ai_reserve', 'records_before_write', 'settings_before_write'
    ]) f
    where not exists (
      select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = f
    )
  loop
    raise exception 'ESTRUTURA: função ausente após o restore: %', missing;
  end loop;

  -- 5. The before-write trigger on records (dates, history, quotas) must exist.
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'records' and not tg.tgisinternal
  ) then
    raise exception 'ESTRUTURA: nenhum trigger em public.records após o restore';
  end if;

  -- 6. Row-level security must be ON for the tables that hold account data.
  for missing in
    select c from unnest(array['records', 'user_settings', 'ai_entitlements']) c
    where not (select relrowsecurity from pg_class where relname = c and relnamespace = 'public'::regnamespace)
  loop
    raise exception 'ESTRUTURA: RLS desligada em public.% após o restore', missing;
  end loop;

  -- 7. At least one RLS policy per account table (the app relies on per-user isolation).
  for missing in
    select c from unnest(array['records', 'user_settings']) c
    where not exists (
      select 1 from pg_policy pol join pg_class rc on rc.oid = pol.polrelid
      where rc.relname = c and rc.relnamespace = 'public'::regnamespace
    )
  loop
    raise exception 'ESTRUTURA: nenhuma policy RLS em public.% após o restore', missing;
  end loop;

  -- ---- data invariants (hold even with zero rows) ----
  select count(*) into n_records from public.records;
  select count(*) into n_accounts from auth.users;

  -- 8. Every record / setting / entitlement belongs to a restored account (no orphans).
  select count(*) into bad from public.records r where not exists (select 1 from auth.users u where u.id = r.user_id);
  if bad > 0 then raise exception 'DADOS: % registros órfãos (user_id sem conta)', bad; end if;
  select count(*) into bad from public.user_settings s where not exists (select 1 from auth.users u where u.id = s.user_id);
  if bad > 0 then raise exception 'DADOS: % settings órfãos', bad; end if;
  select count(*) into bad from public.ai_entitlements e where not exists (select 1 from auth.users u where u.id = e.user_id);
  if bad > 0 then raise exception 'DADOS: % entitlements órfãos', bad; end if;

  -- 9. Every entitlement points at a known tier (FK would catch it; assert anyway).
  select count(*) into bad from public.ai_entitlements e where not exists (select 1 from public.ai_tiers t where t.tier = e.tier);
  if bad > 0 then raise exception 'DADOS: % entitlements com nível inexistente', bad; end if;

  -- 10. Usage counters rebuilt from records: every account with records must have a '*' row, and it
  -- must match the records exactly (a missing counter is a failure too, not just a divergent one).
  select count(*) into bad from (
    select user_id,
           count(*) filter (where not deleted) as live,
           count(*) as total
      from public.records group by user_id
  ) agg
  left join public.quota_usage q on q.user_id = agg.user_id and q.scope = '*'
  where q.user_id is null or q.live <> agg.live or q.total <> agg.total;
  if bad > 0 then raise exception 'DADOS: contadores de uso ausentes ou divergentes em % contas', bad; end if;

  -- 11. Read a REAL record back and confirm its payload is intact (when there is data).
  if n_records > 0 then
    select user_id, collection, id, data into sample
      from public.records where not deleted
      order by user_id, collection collate "C", id collate "C" limit 1;
    if sample.data is null or jsonb_typeof(sample.data) is null then
      raise exception 'DADOS: registro real ilegível após o restore';
    end if;
    raise notice 'validação: % registros em % contas; amostra lida (coleção %)', n_records, n_accounts, sample.collection;
  else
    raise notice 'validação: estrutura ok; banco sem registros (0 linhas)';
  end if;
end $$;
