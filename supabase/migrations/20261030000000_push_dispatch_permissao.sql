-- Envio de lembretes com o app fechado (2026-10-30).
-- A função push-dispatch (service_role) precisa ler os aparelhos inscritos e apagar os que o serviço
-- de push deu como encerrados (404/410). Neste projeto o service_role não tem permissão em nenhuma
-- tabela; sem isto o envio parava em "permission denied for table push_subscriptions".
-- Só acrescenta permissão; não mexe em dados nem em políticas.
-- Desfazer: revoke select, delete on public.push_subscriptions from service_role;

begin;

grant select, delete on public.push_subscriptions to service_role;

insert into public.schema_version (version, note) values ('20261030000000_push_dispatch_permissao', '') on conflict do nothing;

commit;
