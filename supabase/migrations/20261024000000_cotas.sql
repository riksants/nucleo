-- Cotas por conta: impede que uma conta (ou alguém usando a API direto com a própria sessão)
-- encha o banco. Os limites ficam no banco, valem para qualquer cliente e podem ser ajustados
-- sem migração nova:
--   update public.quota_limits set max_value = 30000 where key = 'records.tasks';
--
-- O que muda:
--   1. tabela nova quota_limits: os limites (leitura para quem está logado; ninguém do app escreve);
--   2. tabela nova quota_usage: o uso atual de cada conta, por coleção e no total. Calculada agora
--      a partir dos registros existentes e mantida só pelos gatilhos abaixo (o app só lê a própria);
--   3. gatilho records_quota em records: ao criar um item (ou reativar um apagado) confere o limite
--      de itens da coleção, de linhas da conta e de tamanho da conta; ao editar, só o tamanho, e só
--      quando o item cresce. Apagar (a "lápide" do app ou DELETE) libera espaço na hora;
--   4. gatilho push_quota em push_subscriptions: no máximo N aparelhos por conta;
--   5. gatilho notifications_quota em scheduled_notifications: no máximo N lembretes ativos
--      (pendentes ou enviados nos últimos 14 dias). O app não pode marcar um lembrete como
--      enviado (só o dispatcher faz isso), senão a contagem seria burlada. O app nunca envia sent_at.
--
-- Ao passar de um limite o banco recusa só aquela escrita, com o código 23514 (o mesmo de uma
-- regra de validação) e a mensagem "quota_exceeded:<limite>:<valor>". O app já trata esse código:
-- o item continua salvo no aparelho e o restante sincroniza normalmente.
--
-- O que NÃO muda: nenhuma linha existente é alterada ou apagada, nenhuma política RLS, coluna
-- ou permissão das tabelas existentes. Uma conta que já estiver acima de um limite mantém tudo;
-- só não cria itens novos naquela coleção até ficar abaixo dele. Editar e apagar continuam livres.
--
-- Tudo numa transação: ou aplica inteiro, ou não muda nada. Durante a contagem inicial as escritas
-- em records esperam alguns milissegundos (leituras continuam).
--
-- Para desfazer (não toca em nenhum registro):
--   drop trigger if exists records_quota on public.records;
--   drop trigger if exists push_quota on public.push_subscriptions;
--   drop trigger if exists notifications_quota on public.scheduled_notifications;
--   drop function if exists public.records_quota(), public.push_quota(), public.notifications_quota(),
--     public.quota_limit(text), public.quota_raise(text, bigint);
--   drop table if exists public.quota_usage, public.quota_limits;

begin;

-- ---------------------------------------------------------------- limites
create table if not exists public.quota_limits (
  key text primary key check (char_length(key) between 1 and 100),
  max_value bigint not null check (max_value >= 0),
  note text not null default ''
);

-- Itens ativos (não apagados) por coleção. Apagados não contam aqui.
insert into public.quota_limits (key, max_value, note) values
  ('records.transactions', 50000, 'Movimentações'),
  ('records.automationRuns', 50000, 'Feito pelo Núcleo'),
  ('records.completions', 50000, 'Marcações do dia'),
  ('records.sales', 50000, 'Vendas'),
  ('records.tasks', 20000, 'Tarefas'),
  ('records.events', 20000, 'Compromissos'),
  ('records.meals', 20000, 'Refeições planejadas'),
  ('records.focusSessions', 20000, 'Sessões de foco'),
  ('records.shoppingItems', 20000, 'Lista de compras'),
  ('records.inbox', 10000, 'Caixa de entrada'),
  ('records.notes', 10000, 'Anotações'),
  ('records.planSteps', 10000, 'Etapas de projetos e objetivos'),
  ('records.subscribers', 10000, 'Assinantes'),
  ('records.clients', 5000, 'Clientes'),
  ('records.projects', 5000, 'Projetos de trabalho'),
  ('records.accounts', 5000, 'Senhas'),
  ('records.weeklyGoals', 5000, 'Metas semanais'),
  ('records.goals', 2000, 'Metas de compra'),
  ('records.tools', 2000, 'Assinaturas'),
  ('records.offerings', 2000, 'Produtos de assinatura'),
  ('records.recurring', 2000, 'Recorrentes'),
  ('records.lifePlans', 2000, 'Projetos pessoais e objetivos'),
  ('records.challenges', 2000, 'Desafios'),
  ('records.weekSnapshots', 2000, 'Resumos de semanas fechadas'),
  ('records.weekCheckins', 2000, 'Check-ins semanais'),
  ('records.financeGoals', 1000, 'Metas financeiras'),
  ('records.portfolio', 150, 'Portfólio (com imagens)'),
  ('records.habits', 500, 'Hábitos'),
  ('records.subPlans', 500, 'Planos'),
  ('records.rules', 500, 'Minhas regras'),
  ('records.routinePlans', 500, 'Rotinas'),
  ('records.mealPlans', 500, 'Planos alimentares'),
  ('records.plannerProfiles', 20, 'Questionários'),
  -- Coleção futura sem limite próprio.
  ('records.default', 2000, 'Coleção sem limite próprio'),
  -- Conta inteira (todas as coleções).
  ('account.rows', 200000, 'Linhas na conta, contando itens apagados'),
  ('account.bytes', 26214400, 'Tamanho dos dados da conta (25 MB, medido como texto JSON)'),
  ('push.devices', 10, 'Aparelhos com notificações'),
  ('notifications.active', 2000, 'Lembretes pendentes ou enviados nos últimos 14 dias')
on conflict (key) do nothing;

alter table public.quota_limits enable row level security;
drop policy if exists quota_limits_select on public.quota_limits;
create policy quota_limits_select on public.quota_limits for select to authenticated using (true);

-- ---------------------------------------------------------------- uso
create table if not exists public.quota_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Nome da coleção, ou '*' para a conta inteira.
  scope text not null check (char_length(scope) between 1 and 100),
  live bigint not null default 0,
  total bigint not null default 0,
  bytes bigint not null default 0,
  primary key (user_id, scope)
);

alter table public.quota_usage enable row level security;
drop policy if exists quota_usage_select on public.quota_usage;
create policy quota_usage_select on public.quota_usage for select to authenticated using (user_id = (select auth.uid()));

-- O Supabase dá todas as permissões em tabelas novas por padrão: aqui o app só lê.
revoke all on public.quota_limits, public.quota_usage from anon, authenticated;
grant select on public.quota_limits, public.quota_usage to authenticated;

-- ---------------------------------------------------------------- funções
create or replace function public.quota_limit(p_key text) returns bigint
language sql stable set search_path = '' as $$
  select max_value from public.quota_limits where key = p_key
$$;

create or replace function public.quota_raise(p_key text, p_limit bigint) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using
    errcode = '23514',
    message = format('quota_exceeded:%s:%s', p_key, p_limit),
    hint = 'Limite da conta atingido. Apague itens antigos para liberar espaço.';
end $$;

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

create or replace function public.push_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  lim bigint := public.quota_limit('push.devices');
begin
  perform pg_advisory_xact_lock(hashtextextended('nucleo.push:' || new.user_id::text, 0));
  if exists (select 1 from public.push_subscriptions p where p.user_id = new.user_id and p.endpoint = new.endpoint) then
    return new; -- o mesmo aparelho de novo (ON CONFLICT): não é um aparelho a mais
  end if;
  if lim is not null and (select count(*) from public.push_subscriptions p where p.user_id = new.user_id) >= lim then
    perform public.quota_raise('push.devices', lim);
  end if;
  return new;
end $$;

create or replace function public.notifications_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  lim bigint := public.quota_limit('notifications.active');
begin
  -- Só o dispatcher (service_role) marca lembretes como enviados; pedidos do app chegam como
  -- authenticated (o papel da requisição continua o mesmo dentro de security definer).
  if current_setting('role', true) in ('authenticated', 'anon') then
    new.sent_at := case when tg_op = 'UPDATE' then old.sent_at end;
  end if;
  if tg_op = 'UPDATE' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nucleo.notifications:' || new.user_id::text, 0));
  if exists (select 1 from public.scheduled_notifications s where s.user_id = new.user_id and s.key = new.key) then
    return new; -- reagendamento do mesmo lembrete (ON CONFLICT)
  end if;
  if lim is not null and (
    select count(*) from public.scheduled_notifications s
     where s.user_id = new.user_id and (s.sent_at is null or s.sent_at > now() - interval '14 days')
  ) >= lim then
    perform public.quota_raise('notifications.active', lim);
  end if;
  return new;
end $$;

revoke all on function public.quota_limit(text), public.quota_raise(text, bigint), public.records_quota(),
  public.push_quota(), public.notifications_quota() from public, anon, authenticated;

-- ---------------------------------------------------------------- contagem inicial e gatilhos
-- Segura as escritas em records (não as leituras) até o fim da transação, para a contagem
-- inicial e o gatilho começarem exatamente do mesmo ponto. Se não conseguir em 10 s (alguma
-- escrita longa em andamento), a migração falha inteira sem mudar nada; é só rodar de novo.
set local lock_timeout = '10s';
lock table public.records in share row exclusive mode;

insert into public.quota_usage (user_id, scope, live, total, bytes)
select user_id, collection, count(*) filter (where not deleted), count(*), coalesce(sum(octet_length(data::text)), 0)
  from public.records
 group by user_id, collection
on conflict (user_id, scope) do update set live = excluded.live, total = excluded.total, bytes = excluded.bytes;

insert into public.quota_usage (user_id, scope, live, total, bytes)
select user_id, '*', count(*) filter (where not deleted), count(*), coalesce(sum(octet_length(data::text)), 0)
  from public.records
 group by user_id
on conflict (user_id, scope) do update set live = excluded.live, total = excluded.total, bytes = excluded.bytes;

-- Roda depois de records_before_write (ordem alfabética): escrita atrasada descartada lá não conta aqui.
drop trigger if exists records_quota on public.records;
create trigger records_quota before insert or update or delete on public.records
  for each row execute function public.records_quota();

drop trigger if exists push_quota on public.push_subscriptions;
create trigger push_quota before insert on public.push_subscriptions
  for each row execute function public.push_quota();

drop trigger if exists notifications_quota on public.scheduled_notifications;
create trigger notifications_quota before insert or update on public.scheduled_notifications
  for each row execute function public.notifications_quota();

commit;
