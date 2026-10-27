-- One line per table: name, rows, checksum of every row (same result on the source and on a restore).
-- Text ordering uses the "C" collation so the result does not depend on the server's locale.
set timezone = 'UTC';
\pset format unaligned
\pset fieldsep '\t'
\pset tuples_only on
select 'records', count(*), md5(coalesce(string_agg(md5(t::text), '' order by t.user_id, t.collection collate "C", t.id collate "C"), ''))
  from (select user_id, collection, id, data, deleted, client_updated_at, server_updated_at from public.records) t
union all
select 'user_settings', count(*), md5(coalesce(string_agg(md5(t::text), '' order by t.user_id), ''))
  from (select user_id, data, client_updated_at, server_updated_at from public.user_settings) t
union all
select 'quota_limits', count(*), md5(coalesce(string_agg(md5(t::text), '' order by t.key collate "C"), ''))
  from (select key, max_value, note from public.quota_limits) t
union all
select 'schema_version', count(*), md5(coalesce(string_agg(md5(t::text), '' order by t.version collate "C"), ''))
  from (select version, applied_at, note from public.schema_version) t
union all
select 'accounts', count(*), md5(coalesce(string_agg(md5(t::text), '' order by t.id), ''))
  from (select id, email, created_at from public.backup_accounts()) t;
