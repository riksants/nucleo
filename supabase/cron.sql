-- Agenda o envio de lembretes (rodar UMA vez no SQL Editor do Supabase, depois
-- de publicar a função push-dispatch). Usa as extensões pg_cron e pg_net, que
-- existem no plano gratuito. Substitua os dois valores marcados.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Guarda URL e segredo no Vault do Supabase (não ficam no código).
select vault.create_secret('https://SEU-PROJETO.supabase.co', 'nucleo_project_url');
select vault.create_secret('MESMO-VALOR-DO-DISPATCH_SECRET', 'nucleo_dispatch_secret');

select cron.schedule(
  'nucleo-push-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'nucleo_project_url') || '/functions/v1/push-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'nucleo_dispatch_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- Limpeza semanal de lembretes antigos já enviados.
select cron.schedule(
  'nucleo-push-cleanup',
  '17 4 * * 0',
  $$ delete from public.scheduled_notifications where fire_at < now() - interval '14 days' $$
);
