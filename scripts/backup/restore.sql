-- Puts a backup back into a database that has the stub (supabase-stub.sql) and every migration,
-- and no data yet. Needs a superuser (a local Postgres, or the throwaway one in the workflow):
-- triggers are off so every row comes back exactly as it was (dates included).
-- psql -v dir=<folder> -f restore.sql
\set ON_ERROR_STOP on
\cd :dir
set timezone = 'UTC';
begin;
set local session_replication_role = replica;
\copy auth.users (id, email, created_at) from 'accounts.csv' with (format csv)
truncate public.quota_limits, public.schema_version;
\copy public.quota_limits (key, max_value, note) from 'quota_limits.csv' with (format csv)
\copy public.schema_version (version, applied_at, note) from 'schema_version.csv' with (format csv)
\copy public.records (user_id, collection, id, data, deleted, client_updated_at, server_updated_at) from 'records.csv' with (format csv)
\copy public.user_settings (user_id, data, client_updated_at, server_updated_at) from 'user_settings.csv' with (format csv)
-- Usage counters, as the quota triggers would have kept them.
insert into public.quota_usage (user_id, scope, live, total, bytes)
select user_id, collection, count(*) filter (where not deleted), count(*), sum(octet_length(data::text))
  from public.records group by user_id, collection
union all
select user_id, '*', count(*) filter (where not deleted), count(*), sum(octet_length(data::text))
  from public.records group by user_id;
commit;
-- With the triggers off nothing checked the references: every row must belong to a restored account.
do $$
begin
  if exists (select 1 from public.records r where not exists (select 1 from auth.users u where u.id = r.user_id))
     or exists (select 1 from public.user_settings s where not exists (select 1 from auth.users u where u.id = s.user_id)) then
    raise exception 'há dados de contas que não estão no backup';
  end if;
end $$;
