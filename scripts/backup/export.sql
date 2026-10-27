-- Reads everything in ONE read-only transaction (one snapshot): the files and the checksums
-- describe exactly the same moment, even with the app writing at the same time.
-- psql -v dir=<folder> -f export.sql
\set ON_ERROR_STOP on
\cd :dir
set timezone = 'UTC';
begin isolation level repeatable read read only;
\copy (select user_id, collection, id, data, deleted, client_updated_at, server_updated_at from public.records) to 'records.csv' with (format csv)
\copy (select user_id, data, client_updated_at, server_updated_at from public.user_settings) to 'user_settings.csv' with (format csv)
\copy (select key, max_value, note from public.quota_limits) to 'quota_limits.csv' with (format csv)
\copy (select version, applied_at, note from public.schema_version) to 'schema_version.csv' with (format csv)
\copy (select id, email, created_at from public.backup_accounts()) to 'accounts.csv' with (format csv)
\o checksums.txt
\ir checksums.sql
\o
commit;
