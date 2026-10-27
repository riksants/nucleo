-- Limpezas periódicas (rodar no SQL Editor do Supabase depois da migração
-- 20261027000000_auditoria_etapas_4_10.sql). Pode rodar de novo: cada tarefa é recriada, nunca duplicada.
-- Precisa da extensão pg_cron (Database → Extensions; existe no plano gratuito).
--
-- O que agenda:
--   nucleo-history-cleanup   todo dia: versões do histórico mais velhas que 30 dias saem
--   nucleo-ai-usage-cleanup  todo domingo: registros de uso de IA com mais de 90 dias saem
--   nucleo-cron-log-cleanup  todo domingo: o registro das próprias execuções do cron com mais de 14 dias sai
-- Não envia nada para fora e não toca em registros do app.
--
-- Para desfazer: select cron.unschedule(jobname) from cron.job where jobname like 'nucleo-%-cleanup';

create extension if not exists pg_cron;

select cron.unschedule(jobname) from cron.job
 where jobname in ('nucleo-history-cleanup', 'nucleo-ai-usage-cleanup', 'nucleo-cron-log-cleanup');

select cron.schedule('nucleo-history-cleanup', '23 5 * * *', $$ select public.records_history_cleanup() $$);
select cron.schedule('nucleo-ai-usage-cleanup', '41 5 * * 0',
  $$ delete from public.ai_usage where created_at < now() - interval '90 days' $$);
select cron.schedule('nucleo-cron-log-cleanup', '47 5 * * 0',
  $$ delete from cron.job_run_details where end_time < now() - interval '14 days' $$);
