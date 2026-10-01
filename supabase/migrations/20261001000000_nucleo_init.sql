-- Núcleo: dados por conta, isolados por RLS.
-- Toda linha pertence a auth.uid(); nenhuma política deixa um usuário ler ou
-- escrever linhas de outro. A chave service_role (usada só nas Edge Functions)
-- é a única que ignora RLS e nunca vai para o frontend.

-- ---------------------------------------------------------------- records
create table if not exists public.records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  collection text not null check (collection in (
    'transactions', 'goals', 'clients', 'projects', 'tasks', 'tools', 'accounts', 'notes', 'portfolio',
    'sales', 'offerings', 'subPlans', 'subscribers', 'plannerProfiles', 'routinePlans', 'mealPlans'
  )),
  id text not null check (char_length(id) between 1 and 100),
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, collection, id),
  -- Imagens do portfólio ficam dentro do registro (JPEG comprimido).
  constraint records_data_size check (pg_column_size(data) < 3000000),
  -- Senhas de "Contas" só chegam ao servidor criptografadas pelo cofre.
  constraint records_no_plain_password check (collection <> 'accounts' or coalesce(data ->> 'password', '') = '')
);

create index if not exists records_sync_idx on public.records (user_id, server_updated_at);

create or replace function public.records_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'user_id não pode mudar';
    end if;
    -- Escrita atrasada de um aparelho que ficou offline: mantém a versão mais nova.
    if new.client_updated_at < old.client_updated_at then
      return null;
    end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists records_before_write on public.records;
create trigger records_before_write before insert or update on public.records
  for each row execute function public.records_before_write();

alter table public.records enable row level security;

drop policy if exists records_select on public.records;
drop policy if exists records_insert on public.records;
drop policy if exists records_update on public.records;
drop policy if exists records_delete on public.records;
create policy records_select on public.records for select to authenticated using (user_id = (select auth.uid()));
create policy records_insert on public.records for insert to authenticated with check (user_id = (select auth.uid()));
create policy records_update on public.records for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy records_delete on public.records for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- settings
create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp(),
  constraint user_settings_size check (pg_column_size(data) < 500000)
);

create or replace function public.settings_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'user_id não pode mudar';
    end if;
    if new.client_updated_at < old.client_updated_at then
      return null;
    end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists settings_before_write on public.user_settings;
create trigger settings_before_write before insert or update on public.user_settings
  for each row execute function public.settings_before_write();

alter table public.user_settings enable row level security;
drop policy if exists settings_select on public.user_settings;
drop policy if exists settings_insert on public.user_settings;
drop policy if exists settings_update on public.user_settings;
drop policy if exists settings_delete on public.user_settings;
create policy settings_select on public.user_settings for select to authenticated using (user_id = (select auth.uid()));
create policy settings_insert on public.user_settings for insert to authenticated with check (user_id = (select auth.uid()));
create policy settings_update on public.user_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy settings_delete on public.user_settings for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- push
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null check (endpoint like 'https://%' and char_length(endpoint) < 1000),
  p256dh text not null check (char_length(p256dh) < 200),
  auth text not null check (char_length(auth) < 100),
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;
drop policy if exists push_select on public.push_subscriptions;
drop policy if exists push_insert on public.push_subscriptions;
drop policy if exists push_delete on public.push_subscriptions;
create policy push_select on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy push_insert on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy push_delete on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- Um aparelho entrega notificações só para quem se inscreveu por último nele
-- (evita que, num aparelho compartilhado, o usuário anterior continue recebendo).
create or replace function public.claim_push_endpoint(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> auth.uid();
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth)
    on conflict (user_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
revoke all on function public.claim_push_endpoint(text, text, text) from public, anon;
grant execute on function public.claim_push_endpoint(text, text, text) to authenticated;

create table if not exists public.scheduled_notifications (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (char_length(key) < 200),
  fire_at timestamptz not null,
  title text not null check (char_length(title) <= 120),
  body text not null check (char_length(body) <= 240),
  url text not null default '' check (char_length(url) <= 200),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
create index if not exists scheduled_due_idx on public.scheduled_notifications (fire_at) where sent_at is null;

alter table public.scheduled_notifications enable row level security;
drop policy if exists sched_select on public.scheduled_notifications;
drop policy if exists sched_insert on public.scheduled_notifications;
drop policy if exists sched_update on public.scheduled_notifications;
drop policy if exists sched_delete on public.scheduled_notifications;
create policy sched_select on public.scheduled_notifications for select to authenticated using (user_id = (select auth.uid()));
create policy sched_insert on public.scheduled_notifications for insert to authenticated with check (user_id = (select auth.uid()));
create policy sched_update on public.scheduled_notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy sched_delete on public.scheduled_notifications for delete to authenticated using (user_id = (select auth.uid()));

-- O dispatcher (service_role) reserva os lembretes vencidos de forma atômica:
-- dois disparos simultâneos nunca pegam a mesma linha.
create or replace function public.claim_due_notifications(p_limit int default 200)
returns table (user_id uuid, key text, title text, body text, url text)
language sql security definer set search_path = '' as $$
  update public.scheduled_notifications s
     set sent_at = now()
   where (s.user_id, s.key) in (
     select n.user_id, n.key from public.scheduled_notifications n
      where n.sent_at is null and n.fire_at <= now() and n.fire_at > now() - interval '6 hours'
      order by n.fire_at
      limit p_limit
      for update skip locked
   )
  returning s.user_id, s.key, s.title, s.body, s.url;
$$;
revoke all on function public.claim_due_notifications(int) from public, anon, authenticated;
grant execute on function public.claim_due_notifications(int) to service_role;

-- ---------------------------------------------------------------- IA
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('routine', 'meals', 'both')),
  request_id text not null check (char_length(request_id) between 8 and 64),
  status text not null default 'pending' check (status in ('pending', 'ok', 'error')),
  result jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

alter table public.ai_usage enable row level security;
-- Só leitura das próprias linhas; quem escreve é a Edge Function (service_role).
drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));

-- Nada é acessível sem login.
revoke all on public.records, public.user_settings, public.push_subscriptions, public.scheduled_notifications, public.ai_usage from anon;
grant select, insert, update, delete on public.records, public.user_settings, public.scheduled_notifications to authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant select on public.ai_usage to authenticated;
