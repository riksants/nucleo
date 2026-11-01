-- "Enviar teste" com a mesma apresentação das notificações reais: título "Núcleo", mensagem "Teste".
-- Só troca os textos da função criada em 20261101000000 (mesma assinatura, mesmas permissões e limite).
-- Desfazer: rodar de novo a definição de send_test_notification de 20261101000000_notificacoes_etapa5.sql.
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
  values (uid, k, now() + interval '5 seconds', 'Núcleo', 'Teste', '#/notifications', 'app', true,
          'Teste de notificação enviado pelo botão “Enviar teste”.', 'test')
  on conflict (user_id, key) do nothing;
  return k;
end $$;

revoke all on function public.send_test_notification() from public, anon;
grant execute on function public.send_test_notification() to authenticated;
