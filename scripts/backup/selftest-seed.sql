-- Synthetic, deterministic data for the backup self-test (no production, no real people).
-- Runs on a database that already has the stub + every migration. Triggers and FK checks are off so
-- the rows get exact values; the CHECK constraints still apply, so this also proves a valid shape
-- (vault-shaped "accounts" secret, no plaintext password). Fake UUIDs/e-mails only.
\set ON_ERROR_STOP on
set timezone = 'UTC';
begin;
set local session_replication_role = replica;

insert into auth.users (id, email, created_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@selftest.invalid', '2026-01-02T03:04:05Z'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@selftest.invalid',   '2026-02-03T04:05:06Z');

insert into public.records (user_id, collection, id, data, deleted, client_updated_at, server_updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'notes', 'n1', '{"id":"n1","title":"primeira nota"}', false, '2026-03-01T10:00:00Z', '2026-03-01T10:00:00Z'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'notes', 'n2', '{"id":"n2","title":"apagada"}', true,  '2026-03-02T10:00:00Z', '2026-03-02T10:00:00Z'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'transactions', 't1', '{"id":"t1","cents":12345,"kind":"in"}', false, '2026-03-03T10:00:00Z', '2026-03-03T10:00:00Z'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'accounts', 'ac1', '{"id":"ac1","label":"e-mail","secret":{"v":1,"iv":"YWFh","ct":"YmJi"}}', false, '2026-03-04T10:00:00Z', '2026-03-04T10:00:00Z'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'tasks', 'k1', '{"id":"k1","text":"tarefa do bob"}', false, '2026-03-05T10:00:00Z', '2026-03-05T10:00:00Z');

insert into public.user_settings (user_id, data, client_updated_at, server_updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"baseCurrency":"BRL","theme":"dark"}', '2026-03-01T10:00:00Z', '2026-03-01T10:00:00Z');

insert into public.ai_entitlements (user_id, tier, valid_until, started_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner', null, '2026-03-01T10:00:00Z', '2026-03-01T10:00:00Z'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'free',  null, '2026-03-05T10:00:00Z', '2026-03-05T10:00:00Z');

commit;
