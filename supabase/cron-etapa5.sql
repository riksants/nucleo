-- Etapa 5 — só as tarefas novas do pg_cron (não mexe no envio de cada minuto nem nos segredos).
-- Rodar DEPOIS da migração 20261101000000_notificacoes_etapa5.sql. Pode rodar de novo.

-- De hora em hora: o servidor cria as próximas ocorrências dos lembretes que se repetem e das datas
-- distantes (só depois do que o app já gravou). Só SQL, sem chamada externa, sem custo extra.
select cron.unschedule(jobname) from cron.job where jobname in ('nucleo-push-renew', 'nucleo-push-cleanup');
select cron.schedule('nucleo-push-renew', '7 * * * *', $$ select public.renew_notifications(null); $$);

-- Limpeza semanal: a central mostra 30 dias de histórico (antes eram apagados com 14).
select cron.schedule(
  'nucleo-push-cleanup',
  '17 4 * * 0',
  $$
  delete from public.scheduled_notifications where fire_at < now() - interval '35 days';
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  $$
);

-- Conferir: select jobname, schedule from cron.job order by jobname;
-- Desligar a renovação: select cron.unschedule('nucleo-push-renew');
