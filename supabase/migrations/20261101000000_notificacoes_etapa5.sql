-- Etapa 5 — Notificações confiáveis
--
-- 1. Revisão: o app só grava lembretes pela função sync_notifications, que recusa um aparelho com
--    dados antigos. "Antigo" é decidido aqui, não no aparelho: existe registro (ou configuração)
--    da conta mais novo do que o que o aparelho baixou, ou outro aparelho já gravou com uma base
--    mais nova. Assim um aparelho desatualizado não sobrescreve, não recria e não apaga nada.
-- 2. Séries: lembretes que se repetem (contas, hábitos, rotina, assinaturas…) e datas distantes
--    ficam como regra em notification_series. renew_notifications (pg_cron, de hora em hora) cria
--    as próximas ocorrências com as MESMAS chaves que o app usaria, só depois do momento que o app
--    já cobriu. Os lembretes continuam mesmo que o app fique semanas sem ser aberto.
-- 3. Histórico: cada lembrete guarda o que aconteceu no envio (enviado ao serviço de push, falhou,
--    nenhum aparelho inscrito, expirado). "Enviado" não quer dizer "recebido" nem "lido": o Web Push
--    não confirma entrega. Dispensado/visto na central são marcas que a própria pessoa faz.
--
-- Pode rodar de novo (idempotente). Não apaga dados.
--
-- Desfazer (volta ao comportamento anterior; o app novo continua funcionando pelo caminho antigo):
--   drop function if exists public.sync_notifications(timestamptz, timestamptz, timestamptz, jsonb, text[], jsonb, text[], jsonb);
--   drop function if exists public.renew_notifications(uuid);
--   drop function if exists public.record_dispatch(jsonb);
--   drop function if exists public.mark_notifications(text[], text);
--   drop function if exists public.send_test_notification();
--   drop table if exists public.notification_series, public.notification_state;
--   grant insert, update, delete on public.scheduled_notifications to authenticated;
--   (claim_due_notifications: recriar a versão de 20261001000000_nucleo_init.sql)

-- ---------------------------------------------------------------- 1. colunas do histórico
alter table public.scheduled_notifications
  add column if not exists kind text not null default '' check (char_length(kind) <= 20),
  add column if not exists custom boolean not null default false,
  add column if not exists detail text not null default '' check (char_length(detail) <= 300),
  add column if not exists origin text not null default 'app' check (origin in ('app', 'series', 'test')),
  add column if not exists series_key text check (char_length(series_key) < 200),
  add column if not exists status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'failed', 'nodevice', 'expired')),
  add column if not exists sent_count int not null default 0,
  add column if not exists failed_count int not null default 0,
  add column if not exists grouped boolean not null default false,
  add column if not exists last_error text check (char_length(last_error) <= 200),
  add column if not exists dismissed_at timestamptz,
  add column if not exists seen_at timestamptz;

-- Linhas enviadas antes desta migração ficam com status 'scheduled' e sent_at preenchido: o app
-- mostra "Processado (resultado não registrado)", sem afirmar que chegou.

-- Links só para dentro do app (a central e o service worker abrem o que estiver aqui). NOT VALID:
-- vale para o que for gravado daqui em diante, sem reler as linhas antigas.
alter table public.scheduled_notifications drop constraint if exists scheduled_url_internal;
alter table public.scheduled_notifications add constraint scheduled_url_internal check (url = '' or url like '#/%') not valid;

create index if not exists scheduled_history_idx on public.scheduled_notifications (user_id, fire_at desc);
create index if not exists scheduled_series_idx on public.scheduled_notifications (user_id, series_key) where series_key is not null and sent_at is null;

-- O app não escreve mais direto: só pelas funções abaixo (que conferem a revisão).
revoke insert, update, delete on public.scheduled_notifications from authenticated;

-- ---------------------------------------------------------------- 2. estado e séries
create table if not exists public.notification_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tz text not null,
  quiet_from text check (quiet_from ~ '^[0-2][0-9]:[0-5][0-9]$'),
  quiet_to text check (quiet_to ~ '^[0-2][0-9]:[0-5][0-9]$'),
  -- Até onde o app já gravou a lista exata (o servidor só cria lembretes depois disso).
  covered_until timestamptz,
  -- Base (versão dos dados) da última gravação aceita: uma base mais antiga é recusada.
  basis_cursor timestamptz,
  basis_settings timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_series (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (char_length(key) < 200),
  template text not null check (char_length(template) < 180 and position('{d}' in template) > 0),
  rule jsonb not null check (rule ->> 'type' in ('daily', 'weekdays', 'monthly', 'interval', 'once')),
  start_date date,
  end_date date,
  skip date[] not null default '{}' check (cardinality(skip) <= 60),
  day_offset int not null check (day_offset between -60 and 0),
  at_time time not null,
  minus_min int not null check (minus_min between 0 and 10080),
  kind text not null check (char_length(kind) <= 20),
  custom boolean not null default false,
  title text not null check (char_length(title) <= 120),
  body text not null check (char_length(body) <= 240),
  detail text not null default '' check (char_length(detail) <= 300),
  url text not null default '' check (char_length(url) <= 200 and (url = '' or url like '#/%')),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.notification_state enable row level security;
alter table public.notification_series enable row level security;
drop policy if exists nstate_select on public.notification_state;
drop policy if exists nseries_select on public.notification_series;
create policy nstate_select on public.notification_state for select to authenticated using (user_id = (select auth.uid()));
create policy nseries_select on public.notification_series for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.notification_state, public.notification_series from anon, authenticated;
grant select on public.notification_state, public.notification_series to authenticated;

-- ---------------------------------------------------------------- 3. regra e momento (iguais ao app)
-- Mesmo cálculo de src/core/recurrence.ts (occursOn), mais `months` (cobranças anuais) e `once`.
create or replace function public.nucleo_occurs(p_rule jsonb, p_start date, p_d date) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  t text := p_rule ->> 'type';
  dom int;
  last_day int;
  months int;
  step int;
begin
  if p_start is not null and p_d < p_start then return false; end if;
  if t = 'daily' then return true; end if;
  if t = 'once' then return p_d = (p_rule ->> 'date')::date; end if;
  if t = 'weekdays' then
    return coalesce(p_rule -> 'days', '[]'::jsonb) @> to_jsonb(extract(dow from p_d)::int);
  end if;
  if t = 'monthly' then
    dom := greatest(1, coalesce((p_rule ->> 'dayOfMonth')::int, 1));
    last_day := extract(day from (date_trunc('month', p_d) + interval '1 month - 1 day'))::int;
    if extract(day from p_d)::int <> least(dom, last_day) then return false; end if;
    months := greatest(1, coalesce((p_rule ->> 'months')::int, 1));
    if months = 1 then return true; end if;
    if p_start is null then return false; end if;
    return ((extract(year from p_d)::int * 12 + extract(month from p_d)::int) - (extract(year from p_start)::int * 12 + extract(month from p_start)::int)) % months = 0;
  end if;
  if t = 'interval' then
    if p_start is null then return false; end if;
    step := greatest(1, round(coalesce((p_rule ->> 'every')::numeric, 1))::int) * case when p_rule ->> 'unit' = 'week' then 7 else 1 end;
    return (p_d - p_start) >= 0 and (p_d - p_start) % step = 0;
  end if;
  return false; -- regra de uma versão mais nova: nada, em vez de adivinhar
exception when others then
  return false;
end $$;

-- Mesmo cálculo de outsideQuiet (engine.ts): dentro do horário silencioso, vai para o fim dele.
create or replace function public.nucleo_fire(p_date date, p_time time, p_minus int, p_tz text, p_from text, p_to text) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  fire timestamptz := ((p_date + p_time) at time zone p_tz) - make_interval(mins => p_minus);
  lt timestamp;
  hm text;
  overnight boolean;
  inside boolean;
  day date;
begin
  if p_from is null or p_to is null or p_from = p_to then return fire; end if;
  lt := fire at time zone p_tz;
  hm := to_char(lt, 'HH24:MI');
  overnight := p_from > p_to;
  inside := case when overnight then hm >= p_from or hm < p_to else hm >= p_from and hm < p_to end;
  if not inside then return fire; end if;
  day := lt::date + case when overnight and hm >= p_from then 1 else 0 end;
  return (day + p_to::time) at time zone p_tz;
end $$;

-- ---------------------------------------------------------------- 4. renovação pelo servidor
-- Cria as ocorrências das próximas 2 semanas que o app ainda não cobriu. ON CONFLICT DO NOTHING:
-- o que o app gravou (exato) sempre vence. Um usuário com problema (cota) não trava os outros.
create or replace function public.renew_notifications(p_user uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
  n int := 0;
  added int;
begin
  -- Nunca enviados a tempo (o envio só pega as últimas 6 horas): ficam como "expirado" no histórico.
  update public.scheduled_notifications set status = 'expired'
   where sent_at is null and status = 'scheduled' and fire_at < now() - interval '6 hours'
     and (p_user is null or user_id = p_user);
  for u in select st.user_id from public.notification_state st
            where (p_user is null or st.user_id = p_user)
              and exists (select 1 from public.notification_series s where s.user_id = st.user_id) loop
    begin
      insert into public.scheduled_notifications (user_id, key, fire_at, title, body, url, kind, custom, detail, origin, series_key)
      select s.user_id, replace(s.template, '{d}', to_char(x.d, 'YYYY-MM-DD')), f.fire, s.title, s.body, s.url, s.kind, s.custom, s.detail, 'series', s.key
        from public.notification_series s
        join public.notification_state st on st.user_id = s.user_id
       cross join lateral (select (now() at time zone st.tz)::date as today) t
       cross join lateral generate_series(-1, 15) g(i)
       cross join lateral (select t.today - s.day_offset + g.i as d) x
       cross join lateral (select public.nucleo_fire(x.d + s.day_offset, s.at_time, s.minus_min, st.tz, st.quiet_from, st.quiet_to) as fire) f
       where s.user_id = u
         and public.nucleo_occurs(s.rule, s.start_date, x.d)
         and (s.end_date is null or x.d <= s.end_date)
         and not (x.d = any (s.skip))
         and f.fire > greatest(now(), coalesce(st.covered_until, '-infinity'::timestamptz))
         and f.fire <= now() + interval '14 days'
      on conflict (user_id, key) do nothing;
      get diagnostics added = row_count;
      n := n + added;
    exception when others then
      raise warning 'renew_notifications %: %', u, sqlerrm;
    end;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- 5. gravação pelo app, com revisão
create or replace function public.sync_notifications(
  p_cursor timestamptz,
  p_settings_at timestamptz,
  p_until timestamptz,
  p_upserts jsonb,
  p_deletes text[],
  p_series jsonb,
  p_series_deletes text[],
  p_state jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  st public.notification_state;
  r jsonb;
  tz text := p_state ->> 'tz';
  changed text[] := '{}';
begin
  if uid is null then raise exception 'sem sessão'; end if;
  -- Um aparelho de cada vez por conta (duas gravações ao mesmo tempo não se misturam).
  perform pg_advisory_xact_lock(hashtextextended('nucleo.notify-sync:' || uid::text, 0));

  -- Revisão: existe algo na conta mais novo do que este aparelho baixou? Então ele está desatualizado.
  if (p_cursor is null and exists (select 1 from public.records where user_id = uid))
     or (p_cursor is not null and exists (select 1 from public.records where user_id = uid and server_updated_at > p_cursor))
     or exists (select 1 from public.user_settings where user_id = uid and client_updated_at > coalesce(p_settings_at, '-infinity'::timestamptz)) then
    return jsonb_build_object('status', 'stale');
  end if;
  select * into st from public.notification_state where user_id = uid for update;
  -- Outro aparelho já gravou com uma base mais nova (cobre também registros apagados de vez).
  if found and ((st.basis_cursor is not null and (p_cursor is null or p_cursor < st.basis_cursor))
             or (st.basis_settings is not null and (p_settings_at is null or p_settings_at < st.basis_settings))) then
    return jsonb_build_object('status', 'stale');
  end if;

  if tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then
    raise exception using errcode = '22023', message = 'fuso horário inválido';
  end if;
  if p_until is null or p_until > now() + interval '31 days' then
    raise exception using errcode = '22023', message = 'janela inválida';
  end if;

  -- Lembretes exatos do app. Os já enviados nunca mudam (histórico).
  delete from public.scheduled_notifications
   where user_id = uid and sent_at is null and key = any (coalesce(p_deletes, '{}'));
  for r in select * from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) loop
    insert into public.scheduled_notifications as s (user_id, key, fire_at, title, body, url, kind, custom, detail, origin)
    values (uid, r ->> 'key', (r ->> 'fire_at')::timestamptz, r ->> 'title', r ->> 'body', coalesce(r ->> 'url', ''),
            coalesce(r ->> 'kind', ''), coalesce((r ->> 'custom')::boolean, false), coalesce(r ->> 'detail', ''), 'app')
    on conflict (user_id, key) do update
      set fire_at = excluded.fire_at, title = excluded.title, body = excluded.body, url = excluded.url,
          kind = excluded.kind, custom = excluded.custom, detail = excluded.detail, origin = 'app', series_key = null,
          status = 'scheduled'
      where s.sent_at is null;
  end loop;

  -- Séries. Uma série mudada ou removida leva junto as ocorrências futuras que o servidor criou para ela.
  if p_series_deletes is not null and cardinality(p_series_deletes) > 0 then
    delete from public.notification_series where user_id = uid and key = any (p_series_deletes);
    changed := changed || p_series_deletes;
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_series, '[]'::jsonb)) loop
    insert into public.notification_series as s (user_id, key, template, rule, start_date, end_date, skip, day_offset, at_time, minus_min, kind, custom, title, body, detail, url, updated_at)
    values (uid, r ->> 'key', r ->> 'template', r -> 'rule', nullif(r ->> 'start', '')::date, nullif(r ->> 'end', '')::date,
            coalesce((select array_agg(x::date) from jsonb_array_elements_text(r -> 'skip') x), '{}'),
            (r ->> 'dayOffset')::int, (r ->> 'time')::time, (r ->> 'minus')::int, r ->> 'kind', coalesce((r ->> 'custom')::boolean, false),
            r ->> 'title', r ->> 'body', coalesce(r ->> 'detail', ''), coalesce(r ->> 'url', ''), now())
    on conflict (user_id, key) do update
      set template = excluded.template, rule = excluded.rule, start_date = excluded.start_date, end_date = excluded.end_date,
          skip = excluded.skip, day_offset = excluded.day_offset, at_time = excluded.at_time, minus_min = excluded.minus_min,
          kind = excluded.kind, custom = excluded.custom, title = excluded.title, body = excluded.body, detail = excluded.detail,
          url = excluded.url, updated_at = now();
    changed := changed || (r ->> 'key');
  end loop;
  if (select count(*) from public.notification_series where user_id = uid) > 450 then
    raise exception using errcode = '23514', message = 'quota_exceeded:notifications.series:450';
  end if;
  if cardinality(changed) > 0 then
    delete from public.scheduled_notifications
     where user_id = uid and sent_at is null and origin = 'series' and series_key = any (changed);
  end if;

  insert into public.notification_state as s (user_id, tz, quiet_from, quiet_to, covered_until, basis_cursor, basis_settings, updated_at)
  values (uid, tz, p_state ->> 'quietFrom', p_state ->> 'quietTo', p_until, p_cursor, p_settings_at, now())
  on conflict (user_id) do update
    set tz = excluded.tz, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to, covered_until = excluded.covered_until,
        basis_cursor = greatest(s.basis_cursor, excluded.basis_cursor), basis_settings = greatest(s.basis_settings, excluded.basis_settings),
        updated_at = now();

  -- O que mudou já volta a ter as ocorrências depois da janela do app.
  if cardinality(changed) > 0 then perform public.renew_notifications(uid); end if;
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------- 6. envio (dispatcher)
drop function if exists public.claim_due_notifications(int);
create function public.claim_due_notifications(p_limit int default 200)
returns table (user_id uuid, key text, title text, body text, url text, kind text, custom boolean, fire_at timestamptz)
language sql security definer set search_path = '' as $$
  update public.scheduled_notifications s
     set sent_at = now()
   where (s.user_id, s.key) in (
     select n.user_id, n.key from public.scheduled_notifications n
      where n.sent_at is null and n.status = 'scheduled' and n.fire_at <= now() and n.fire_at > now() - interval '6 hours'
      order by n.fire_at
      limit p_limit
      for update skip locked
   )
  returning s.user_id, s.key, s.title, s.body, s.url, s.kind, s.custom, s.fire_at;
$$;

-- Resultado de cada lembrete: [{user_id, key, status, sent, failed, error, grouped}].
create or replace function public.record_dispatch(p jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.scheduled_notifications s
     set status = x.status, sent_count = x.sent, failed_count = x.failed, last_error = left(x.error, 200), grouped = coalesce(x.grouped, false)
    from jsonb_to_recordset(p) as x(user_id uuid, key text, status text, sent int, failed int, error text, grouped boolean)
   where s.user_id = x.user_id and s.key = x.key and x.status in ('sent', 'failed', 'nodevice');
$$;

-- ---------------------------------------------------------------- 7. central: marcas da pessoa e teste
create or replace function public.mark_notifications(p_keys text[], p_action text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  n int;
begin
  if uid is null then raise exception 'sem sessão'; end if;
  if p_action = 'seen' then
    update public.scheduled_notifications set seen_at = now()
     where user_id = uid and seen_at is null and sent_at is not null and (p_keys is null or key = any (p_keys));
  elsif p_action = 'dismiss' then
    update public.scheduled_notifications set dismissed_at = now(), seen_at = coalesce(seen_at, now())
     where user_id = uid and key = any (coalesce(p_keys, '{}'));
  elsif p_action = 'restore' then
    update public.scheduled_notifications set dismissed_at = null where user_id = uid and key = any (coalesce(p_keys, '{}'));
  else
    raise exception using errcode = '22023', message = 'ação inválida';
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- "Enviar teste": passa pelo caminho real (tabela → cron → função → push). No máximo 5 por hora.
create or replace function public.send_test_notification() returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  k text;
begin
  if uid is null then raise exception 'sem sessão'; end if;
  if (select count(*) from public.scheduled_notifications where user_id = uid and origin = 'test' and created_at > now() - interval '1 hour') >= 5 then
    raise exception using errcode = '23514', message = 'quota_exceeded:notifications.test:5';
  end if;
  k := 'test:' || to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS');
  insert into public.scheduled_notifications (user_id, key, fire_at, title, body, url, kind, custom, detail, origin)
  values (uid, k, now() + interval '5 seconds', 'Núcleo · teste',
          'Teste de notificação: se você está vendo isto, os avisos com o app fechado funcionam neste aparelho.',
          '#/notifications', 'app', true, 'Teste de notificação enviado pelo botão “Enviar teste”.', 'test')
  on conflict (user_id, key) do nothing;
  return k;
end $$;

revoke all on function public.nucleo_occurs(jsonb, date, date), public.nucleo_fire(date, time, int, text, text, text),
  public.renew_notifications(uuid), public.record_dispatch(jsonb), public.claim_due_notifications(int),
  public.sync_notifications(timestamptz, timestamptz, timestamptz, jsonb, text[], jsonb, text[], jsonb),
  public.mark_notifications(text[], text), public.send_test_notification() from public, anon, authenticated;
grant execute on function public.sync_notifications(timestamptz, timestamptz, timestamptz, jsonb, text[], jsonb, text[], jsonb),
  public.mark_notifications(text[], text), public.send_test_notification() to authenticated;
grant execute on function public.claim_due_notifications(int), public.record_dispatch(jsonb), public.renew_notifications(uuid) to service_role;
