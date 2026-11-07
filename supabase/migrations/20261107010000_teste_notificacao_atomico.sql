-- PARTE 9 (rate limiting): limite de 5 notificações de teste por hora, agora atômico e com HTTP 429.
--
-- send_test_notification() contava as notificações de teste da última hora e só depois inseria, sem trava:
-- pedidos simultâneos em segundos diferentes podiam todos ver "4" e passar do teto (o mesmo segundo já era
-- barrado pela chave). Agora uma trava por conta (pg_advisory_xact_lock) faz a contagem e a inserção juntas:
-- o segundo pedido espera o primeiro terminar e enxerga o que ele gravou.
--
-- Ao atingir o limite a resposta passa a ser HTTP 429 com Retry-After (segundos até a mais antiga sair da
-- janela de 1 hora). O texto do erro continua "quota_exceeded:notifications.test:5" (o app o reconhece).
-- Nada mais muda: mesma assinatura, mesmo dono, mesmas permissões (create or replace mantém os grants).
--
-- Desfazer: rodar de novo a definição de 20261102000000_teste_notificacao.sql.

begin;

create or replace function public.send_test_notification() returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  k text;
  n int;
  oldest timestamptz;
  wait int;
begin
  if uid is null then raise exception 'sem sessão'; end if;
  -- Contagem e inserção sob a mesma trava por conta: sem corrida entre pedidos simultâneos.
  perform pg_advisory_xact_lock(hashtextextended('nucleo.test-notification:' || uid::text, 0));
  select count(*), min(created_at) into n, oldest
    from public.scheduled_notifications
   where user_id = uid and origin = 'test' and created_at > now() - interval '1 hour';
  if n >= 5 then
    wait := greatest(1, ceil(extract(epoch from (oldest + interval '1 hour' - now()))))::int;
    raise sqlstate 'PGRST' using
      message = json_build_object('code', '23514', 'message', 'quota_exceeded:notifications.test:5', 'details', null,
                                  'hint', 'Limite de 5 testes por hora.')::text,
      detail = json_build_object('status', 429, 'headers', json_build_object('Retry-After', wait::text))::text;
  end if;
  k := 'test:' || to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS');
  insert into public.scheduled_notifications (user_id, key, fire_at, title, body, url, kind, custom, detail, origin)
  values (uid, k, now() + interval '5 seconds', 'Núcleo', 'Teste', '#/notifications', 'app', true,
          'Teste de notificação enviado pelo botão “Enviar teste”.', 'test')
  on conflict (user_id, key) do nothing;
  return k;
end $$;

commit;
