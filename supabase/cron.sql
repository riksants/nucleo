-- Agenda o envio de lembretes (depois de publicar a função push-dispatch com --no-verify-jwt).
-- Usa as extensões pg_cron e pg_net, que existem no plano gratuito. Pode rodar de novo: atualiza
-- em vez de duplicar. Substitua os dois valores marcados (nunca salve este arquivo com eles).
-- Não mexe em nenhuma tabela do app.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- URL e segredo ficam no Vault do Supabase (não no código nem na definição da tarefa).
do $$
declare
  wanted jsonb := jsonb_build_object(
    'nucleo_project_url', 'https://SEU-PROJETO.supabase.co',
    'nucleo_dispatch_secret', 'MESMO-VALOR-DO-DISPATCH_SECRET'
  );
  k text;
  found uuid;
begin
  for k in select jsonb_object_keys(wanted) loop
    select id into found from vault.secrets where name = k;
    if found is null then
      perform vault.create_secret(wanted ->> k, k);
    else
      perform vault.update_secret(found, wanted ->> k);
    end if;
  end loop;
end $$;

select cron.unschedule(jobname) from cron.job where jobname in ('nucleo-push-dispatch', 'nucleo-push-cleanup');

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

-- Limpeza semanal: lembretes de mais de 14 dias atrás (o envio só pega os das últimas 6 horas,
-- então nada que ainda seria enviado sai daqui) e o registro de execuções do cron (1.440 linhas
-- por dia com a tarefa de cada minuto).
select cron.schedule(
  'nucleo-push-cleanup',
  '17 4 * * 0',
  $$
  delete from public.scheduled_notifications where fire_at < now() - interval '14 days';
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  $$
);
