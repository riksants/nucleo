-- NÚCLEO IA — Etapa 1: orçamento de IA em dólares (por pergunta, por conta, global).
--
-- NÃO APLICADA EM PRODUÇÃO. Aplicar só com autorização do dono.
--
-- O que muda:
--   1. ai_usage: aceita kind 'ia' e ganha colunas de custo (micro-dólares) e de tokens de cache.
--      Nenhuma linha existente muda. Nunca guarda texto.
--   2. ai_tiers: limites por nível (trial, subscriber, owner, none) — alteráveis sem publicar código.
--   3. ai_entitlements: o nível de cada conta (manual agora; o sistema de assinatura grava depois).
--      Conta sem linha começa 'trial' no primeiro uso.
--   4. quota_limits: teto global dinâmico (cresce com os níveis ativos), teto de segurança e disjuntor.
--   5. Funções: ia_reserve / ia_settle (só service_role, chamadas pela função nucleo-ia) e
--      ia_my_usage (a própria pessoa vê seu uso).
--
-- O que NÃO muda: records, settings, sync, RLS existentes, ai_reserve (planejador/interpretador antigo).
--
-- Para desfazer (sem linhas 'ia' em ai_usage):
--   drop function if exists public.ia_reserve(uuid, text, int, text, text, bigint, bigint), public.ia_settle(bigint, boolean, bigint, int, int, int, int, text[], text), public.ia_my_usage(), public.ia_global_cap();
--   drop table if exists public.ai_entitlements, public.ai_tiers;
--   delete from public.quota_limits where key like 'ia.%';
--   alter table public.ai_usage drop column if exists model, drop column if exists route, drop column if exists turn_id,
--     drop column if exists cache_read_tokens, drop column if exists cache_write_tokens,
--     drop column if exists cost_micros, drop column if exists reserved_micros,
--     drop constraint if exists ai_usage_kind_check,
--     add constraint ai_usage_kind_check check (kind in ('routine', 'meals', 'both', 'assistant'));

-- ---------------------------------------------------------------- 1. ai_usage
alter table public.ai_usage
  drop constraint if exists ai_usage_kind_check,
  add constraint ai_usage_kind_check check (kind in ('routine', 'meals', 'both', 'assistant', 'ia')),
  add column if not exists model text check (model is null or model in ('haiku', 'sonnet', 'opus')),
  add column if not exists route text check (route is null or route in ('rapida', 'atenta', 'profunda')),
  add column if not exists turn_id text check (turn_id is null or char_length(turn_id) between 8 and 48),
  add column if not exists cache_read_tokens integer check (cache_read_tokens is null or cache_read_tokens >= 0),
  add column if not exists cache_write_tokens integer check (cache_write_tokens is null or cache_write_tokens >= 0),
  add column if not exists cost_micros bigint check (cost_micros is null or cost_micros >= 0),
  add column if not exists reserved_micros bigint check (reserved_micros is null or reserved_micros >= 0);

create index if not exists ai_usage_ia_user_time on public.ai_usage (user_id, created_at) where kind = 'ia';
create index if not exists ai_usage_ia_time on public.ai_usage (created_at) where kind = 'ia';
create index if not exists ai_usage_ia_turn on public.ai_usage (user_id, turn_id) where kind = 'ia';

-- ---------------------------------------------------------------- 2. níveis
create table if not exists public.ai_tiers (
  tier text primary key check (tier ~ '^[a-z_]{2,20}$'),
  -- Orçamento do período: mês do calendário (UTC) ou, com trial_days, o período de teste inteiro.
  period_micros bigint not null check (period_micros >= 0),
  daily_micros bigint not null check (daily_micros >= 0),
  sonnet_period_micros bigint not null check (sonnet_period_micros >= 0),
  request_haiku_micros bigint not null check (request_haiku_micros >= 0),
  request_sonnet_micros bigint not null check (request_sonnet_micros >= 0),
  trial_days int check (trial_days is null or trial_days between 1 and 90),
  note text not null default ''
);

-- Assinatura R$ 19,90 → ~US$ 3,08 líquidos (15% loja, R$ 5,50/US$). IA ≤ ~30% disso.
insert into public.ai_tiers values
  ('trial',      250000,  80000, 120000, 10000, 100000, 7,    'Teste grátis: US$ 0,25 no período de 7 dias'),
  ('subscriber', 900000, 120000, 500000, 10000, 100000, null, 'Assinante: US$ 0,90/mês, até US$ 0,50 em análise profunda'),
  ('owner',     5000000, 600000, 3000000, 10000, 150000, null, 'Dono do app'),
  ('none',            0,      0,      0,     0,      0, null, 'Sem IA (só comandos locais)')
on conflict (tier) do nothing;

create table if not exists public.ai_entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tier text not null references public.ai_tiers (tier),
  -- null = sem prazo (ex.: owner). Vencido = nível 'none'.
  valid_until timestamptz,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_tiers enable row level security;
alter table public.ai_entitlements enable row level security;
-- Ninguém do app lê ou escreve direto; só as funções abaixo (security definer).
revoke all on public.ai_tiers, public.ai_entitlements from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'nucleo_backup') then
    grant select on public.ai_tiers, public.ai_entitlements to nucleo_backup;
    drop policy if exists ai_tiers_backup_read on public.ai_tiers;
    create policy ai_tiers_backup_read on public.ai_tiers for select to nucleo_backup using (true);
    drop policy if exists ai_entitlements_backup_read on public.ai_entitlements;
    create policy ai_entitlements_backup_read on public.ai_entitlements for select to nucleo_backup using (true);
  end if;
end $$;

-- ---------------------------------------------------------------- 4. limites globais
insert into public.quota_limits (key, max_value, note) values
  ('ia.global_floor_daily_micros', 1000000, 'IA: piso do teto global diário (US$ 1)'),
  ('ia.global_burst_pct', 200, 'IA: fator de pico sobre a soma diária dos níveis ativos (200 = 2x)'),
  ('ia.global_hard_daily_micros', 50000000, 'IA: teto de segurança absoluto por dia (US$ 50) — subir com a receita'),
  ('ia.anomaly_floor_hour_micros', 500000, 'IA: gasto na última hora acima disso (e do fator) bloqueia análise profunda'),
  ('ia.anomaly_pct', 400, 'IA: fator sobre a média horária de 7 dias que bloqueia análise profunda (400 = 4x)'),
  ('ia.pause_floor_hour_micros', 2000000, 'IA: gasto na última hora acima disso (e do fator) pausa a IA'),
  ('ia.pause_pct', 1000, 'IA: fator sobre a média horária de 7 dias que pausa a IA (1000 = 10x)'),
  ('ia.pending_minutes', 5, 'IA: chamada pendente há mais que isso conta com o valor reservado')
on conflict (key) do nothing;

-- Teto global de hoje: piso + soma diária dos níveis válidos × fator, limitado pelo teto de segurança.
create or replace function public.ia_global_cap() returns bigint
language sql stable security definer set search_path = '' as $$
  select least(
    coalesce(public.quota_limit('ia.global_hard_daily_micros'), 50000000),
    coalesce(public.quota_limit('ia.global_floor_daily_micros'), 1000000)
      + coalesce((
          select sum(case when t.trial_days is not null then t.period_micros / t.trial_days else t.period_micros / 30 end)
            from public.ai_entitlements e join public.ai_tiers t on t.tier = e.tier
           where e.valid_until is null or e.valid_until > now()
        ), 0) * coalesce(public.quota_limit('ia.global_burst_pct'), 200) / 100
  )::bigint
$$;

-- Custo que conta no orçamento: o real quando já se sabe, senão o reservado.
-- (Pendentes velhas viram erro com o valor reservado: nunca se gasta a mais por falta de acerto.)

-- ---------------------------------------------------------------- 5. reservar / acertar
create or replace function public.ia_reserve(p_user uuid, p_turn text, p_step int, p_model text, p_route text, p_wanted bigint, p_min bigint)
returns table (outcome text, usage_id bigint, granted bigint)
language plpgsql security definer set search_path = '' as $$
declare
  stale interval := make_interval(mins => coalesce(public.quota_limit('ia.pending_minutes'), 5)::int);
  req text := p_turn || ':' || p_step;
  ent public.ai_entitlements;
  t public.ai_tiers;
  period_start timestamptz;
  spent_day bigint; spent_period bigint; spent_sonnet bigint; spent_turn bigint;
  rem_request bigint; rem_day bigint; rem_period bigint; rem_sonnet bigint; rem_global bigint;
  hour_spent bigint; hour_avg numeric;
  g bigint;
  new_id bigint;
begin
  if p_model not in ('haiku', 'sonnet', 'opus') or p_route not in ('rapida', 'atenta', 'profunda')
     or p_step < 1 or p_step > 20 or p_wanted < 0 or p_min < 0 or char_length(p_turn) not between 8 and 48 then
    raise exception using errcode = '22023', message = 'ia_reserve: argumentos inválidos';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nucleo.ia:' || p_user::text, 0));

  update public.ai_usage set status = 'error', cost_micros = reserved_micros
   where user_id = p_user and kind = 'ia' and status = 'pending' and created_at < now() - stale;

  if exists (select 1 from public.ai_usage where user_id = p_user and request_id = req) then
    return query select 'duplicate'::text, null::bigint, 0::bigint;
    return;
  end if;
  if exists (select 1 from public.ai_usage where user_id = p_user and kind = 'ia' and status = 'pending') then
    return query select 'busy'::text, null::bigint, 0::bigint;
    return;
  end if;

  select * into ent from public.ai_entitlements where user_id = p_user;
  if not found then
    insert into public.ai_entitlements (user_id, tier, valid_until)
      select p_user, 'trial', now() + make_interval(days => trial_days) from public.ai_tiers where tier = 'trial'
      returning * into ent;
  end if;
  if ent.user_id is null or (ent.valid_until is not null and ent.valid_until <= now()) then
    select * into t from public.ai_tiers where tier = 'none';
  else
    select * into t from public.ai_tiers where tier = ent.tier;
  end if;
  if t.tier is null or t.period_micros = 0 then
    return query select 'no-plan'::text, null::bigint, 0::bigint;
    return;
  end if;
  if p_model = 'opus' then
    return query select 'no-plan'::text, null::bigint, 0::bigint;
    return;
  end if;

  period_start := case when t.trial_days is not null then ent.started_at else date_trunc('month', now() at time zone 'utc') at time zone 'utc' end;
  select coalesce(sum(coalesce(cost_micros, reserved_micros)) filter (where created_at > now() - interval '24 hours'), 0),
         coalesce(sum(coalesce(cost_micros, reserved_micros)) filter (where created_at >= period_start), 0),
         coalesce(sum(coalesce(cost_micros, reserved_micros)) filter (where created_at >= period_start and model = 'sonnet'), 0),
         coalesce(sum(coalesce(cost_micros, reserved_micros)) filter (where turn_id = p_turn), 0)
    into spent_day, spent_period, spent_sonnet, spent_turn
    from public.ai_usage where user_id = p_user and kind = 'ia' and created_at >= least(period_start, now() - interval '24 hours') - interval '1 hour';
  -- (um turno não dura mais que alguns minutos; a janela acima cobre as linhas dele)

  rem_request := (case when p_model = 'sonnet' or spent_turn > 0 and exists (
                    select 1 from public.ai_usage where user_id = p_user and turn_id = p_turn and model = 'sonnet')
                  then t.request_sonnet_micros else t.request_haiku_micros end) - spent_turn;
  rem_day := t.daily_micros - spent_day;
  rem_period := t.period_micros - spent_period;
  rem_sonnet := case when p_model = 'sonnet' then t.sonnet_period_micros - spent_sonnet else null end;

  -- Global: uma reserva por vez em todo o sistema neste trecho (contagem + reserva juntas).
  perform pg_advisory_xact_lock(hashtextextended('nucleo.ia:global', 0));
  select coalesce(sum(coalesce(cost_micros, reserved_micros)) filter (where created_at > now() - interval '1 hour'), 0),
         coalesce(sum(coalesce(cost_micros, reserved_micros)), 0) / 168.0
    into hour_spent, hour_avg
    from public.ai_usage where kind = 'ia' and created_at > now() - interval '7 days';
  if hour_spent > greatest(coalesce(public.quota_limit('ia.pause_floor_hour_micros'), 2000000), hour_avg * coalesce(public.quota_limit('ia.pause_pct'), 1000) / 100) then
    return query select 'paused'::text, null::bigint, 0::bigint;
    return;
  end if;
  if p_model = 'sonnet' and hour_spent > greatest(coalesce(public.quota_limit('ia.anomaly_floor_hour_micros'), 500000), hour_avg * coalesce(public.quota_limit('ia.anomaly_pct'), 400) / 100) then
    return query select 'sonnet-blocked'::text, null::bigint, 0::bigint;
    return;
  end if;
  rem_global := public.ia_global_cap() - (select coalesce(sum(coalesce(cost_micros, reserved_micros)), 0) from public.ai_usage where kind = 'ia' and created_at > now() - interval '24 hours');

  g := least(p_wanted, rem_request, rem_day, rem_period, coalesce(rem_sonnet, p_wanted), rem_global);
  if g < p_min or g <= 0 then
    return query select (case
      when rem_sonnet is not null and rem_sonnet < p_min then 'limit-sonnet'
      when rem_period < p_min then 'limit-month'
      when rem_day < p_min then 'limit-day'
      when rem_request < p_min then 'limit-request'
      else 'global' end)::text, null::bigint, 0::bigint;
    return;
  end if;

  insert into public.ai_usage (user_id, kind, request_id, status, model, route, turn_id, reserved_micros)
    values (p_user, 'ia', req, 'pending', p_model, p_route, p_turn, g)
    returning id into new_id;
  return query select 'ok'::text, new_id, g;
end $$;

create or replace function public.ia_settle(p_id bigint, p_ok boolean, p_cost bigint, p_input int, p_output int, p_cache_read int, p_cache_write int, p_tools text[], p_stop text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.ai_usage
     set status = case when p_ok then 'ok' else 'error' end,
         cost_micros = greatest(coalesce(p_cost, 0), 0),
         input_tokens = p_input, output_tokens = p_output,
         cache_read_tokens = p_cache_read, cache_write_tokens = p_cache_write,
         -- só nomes de consultas e o motivo de parada; nunca texto
         result = jsonb_build_object('tools', coalesce(to_jsonb(p_tools[1:8]), '[]'::jsonb), 'stop', left(coalesce(p_stop, ''), 20))
   where id = p_id and kind = 'ia' and status = 'pending';
end $$;

-- A própria pessoa vê seu nível e quanto usou (para o painel do Assistente).
create or replace function public.ia_my_usage()
returns table (tier text, valid_until timestamptz, period_start timestamptz, spent_day bigint, daily bigint, spent_period bigint, period bigint, spent_sonnet bigint, sonnet_period bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ent public.ai_entitlements;
  t public.ai_tiers;
  ps timestamptz;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'não autenticado';
  end if;
  select * into ent from public.ai_entitlements e where e.user_id = uid;
  if not found then
    select * into t from public.ai_tiers x where x.tier = 'trial';
    return query select 'trial'::text, null::timestamptz, now(), 0::bigint, t.daily_micros, 0::bigint, t.period_micros, 0::bigint, t.sonnet_period_micros;
    return;
  end if;
  select * into t from public.ai_tiers x where x.tier = case when ent.valid_until is not null and ent.valid_until <= now() then 'none' else ent.tier end;
  ps := case when t.trial_days is not null then ent.started_at else date_trunc('month', now() at time zone 'utc') at time zone 'utc' end;
  return query
    select t.tier, ent.valid_until, ps,
           coalesce(sum(coalesce(u.cost_micros, u.reserved_micros)) filter (where u.created_at > now() - interval '24 hours'), 0)::bigint, t.daily_micros,
           coalesce(sum(coalesce(u.cost_micros, u.reserved_micros)) filter (where u.created_at >= ps), 0)::bigint, t.period_micros,
           coalesce(sum(coalesce(u.cost_micros, u.reserved_micros)) filter (where u.created_at >= ps and u.model = 'sonnet'), 0)::bigint, t.sonnet_period_micros
      from public.ai_usage u where u.user_id = uid and u.kind = 'ia' and u.created_at >= least(ps, now() - interval '24 hours');
end $$;

revoke all on function public.ia_reserve(uuid, text, int, text, text, bigint, bigint), public.ia_settle(bigint, boolean, bigint, int, int, int, int, text[], text),
  public.ia_my_usage(), public.ia_global_cap() from public, anon, authenticated;
grant execute on function public.ia_reserve(uuid, text, int, text, text, bigint, bigint), public.ia_settle(bigint, boolean, bigint, int, int, int, int, text[], text),
  public.ia_global_cap() to service_role;
grant execute on function public.ia_my_usage() to authenticated;

insert into public.schema_version (version, note) values ('20261103000000_nucleo_ia', 'NÚCLEO IA etapa 1: orçamento em dólares')
  on conflict do nothing;
