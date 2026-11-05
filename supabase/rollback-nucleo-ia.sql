-- NÚCLEO IA — reversão da migração 20261103000000_nucleo_ia.sql (testada em tests/nucleo-ia-db.test.ts).
--
-- Antes de reverter, desligue a IA sem apagar nada (reversível em segundos): teto global zero →
-- toda pergunta recebe "A IA está pausada" e os comandos do Assistente continuam.
--   update public.quota_limits set max_value = 0 where key = 'ia.global_hard_daily_micros';
-- (para religar: max_value = 10000000, o valor de lançamento)
-- Reversão completa (apaga o registro de custo da IA; registros, settings e sync não mudam):
begin;
delete from public.ai_usage where kind = 'ia';
drop function if exists public.ia_reserve(uuid, text, int, text, text, bigint, bigint), public.ia_settle(bigint, boolean, bigint, int, int, int, int, text[], text), public.ia_my_usage(), public.ia_global_cap();
drop table if exists public.ai_entitlements, public.ai_tiers;
delete from public.quota_limits where key like 'ia.%';
alter table public.ai_usage drop column if exists model, drop column if exists route, drop column if exists turn_id,
  drop column if exists cache_read_tokens, drop column if exists cache_write_tokens,
  drop column if exists cost_micros, drop column if exists reserved_micros,
  drop constraint if exists ai_usage_kind_check,
  add constraint ai_usage_kind_check check (kind in ('routine', 'meals', 'both', 'assistant'));
delete from public.schema_version where version = '20261103000000_nucleo_ia';
commit;
