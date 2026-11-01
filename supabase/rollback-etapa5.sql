-- REVERSÃO da migração 20261101000000_notificacoes_etapa5.sql (só se a Etapa 5 der problema).
-- Volta o banco ao comportamento anterior: o app antigo (main e783fc2) grava direto na fila de
-- lembretes, como antes. Não apaga lembretes do app nem o histórico já enviado; apaga só os avisos
-- AINDA NÃO ENVIADOS que o servidor criou pelas séries (o app recria os dele ao abrir).
-- As colunas novas ficam (não atrapalham o app antigo). Uma transação: ou tudo, ou nada.
begin;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job where jobname in ('nucleo-push-renew', 'nucleo-push-cleanup');
    perform cron.schedule('nucleo-push-cleanup', '17 4 * * 0', $c$
      delete from public.scheduled_notifications where fire_at < now() - interval '14 days';
      delete from cron.job_run_details where end_time < now() - interval '7 days';
    $c$);
  end if;
end $$;

delete from public.scheduled_notifications where origin = 'series' and sent_at is null;

drop function if exists public.sync_notifications(timestamptz, timestamptz, timestamptz, jsonb, text[], jsonb, text[], jsonb);
drop function if exists public.renew_notifications(uuid);
drop function if exists public.record_dispatch(jsonb);
drop function if exists public.mark_notifications(text[], text);
drop function if exists public.send_test_notification();
drop function if exists public.nucleo_occurs(jsonb, date, date);
drop function if exists public.nucleo_fire(date, time, int, text, text, text);
drop table if exists public.notification_series, public.notification_state;
alter table public.scheduled_notifications drop constraint if exists scheduled_url_internal;

drop function if exists public.claim_due_notifications(int);
create function public.claim_due_notifications(p_limit int default 200)
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

grant insert, update, delete on public.scheduled_notifications to authenticated;
revoke truncate, references, trigger on public.scheduled_notifications from authenticated;

commit;
