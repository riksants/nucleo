-- Recria uma conta de e-mail/senha com o UUID ORIGINAL (o que vem do accounts.csv do backup), SEM senha
-- utilizável — a pessoa redefine a senha depois. É exatamente o que docs/RECUPERACAO-DESASTRE.md manda
-- fazer num projeto novo. Roda no schema auth que o GoTrue já criou. Preserva o UUID, então os records
-- restaurados (user_id = esse UUID) voltam a ser acessíveis quando a pessoa loga.
--   psql -v uid=<id> -v email=<email> -v created=<timestamptz> -f account-recovery-recreate.sql
\set ON_ERROR_STOP on

-- auth.users: colunas de token ficam '' (vazio), nunca NULL — o GoTrue espera string vazia e dá erro
-- de leitura de schema se vier NULL. encrypted_password vazio = nenhuma senha casa (bcrypt nunca bate).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values (
  '00000000-0000-0000-0000-000000000000', :'uid', 'authenticated', 'authenticated', :'email',
  '',
  now(), :'created', now(),
  '{"provider":"email","providers":["email"]}', '{}',
  '', '', '', ''
);

-- auth.identities: em versões recentes do Supabase é OBRIGATÓRIA para o login de e-mail funcionar.
-- Tudo aqui vem só do id e do e-mail do backup (nada mais é preciso).
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  :'uid', :'uid',
  jsonb_build_object('sub', :'uid', 'email', :'email', 'email_verified', true),
  'email', now(), now(), now()
);
