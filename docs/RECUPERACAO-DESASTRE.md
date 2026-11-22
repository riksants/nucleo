# Recuperação de desastre — perda total do projeto Supabase

Cenário extremo: o projeto Supabase foi apagado, corrompido ou perdido. Este é o passo a passo para
voltar o Núcleo a funcionar a partir do último backup. Leia inteiro antes de começar. **Nunca restaure
por cima de um banco bom; comece sempre num banco vazio e confira antes de apontar o app para ele.**

O que você precisa ter em mãos (fora do GitHub):
- a **chave privada** `age` (`nucleo-backup-chave.txt`) — sem ela nenhum backup abre;
- acesso à conta GitHub (para baixar o último `.age`) e à conta Supabase (para criar um projeto novo);
- um Postgres **local** 15+ e o `age` instalados, para conferir o backup antes de subir nada.

## 1. Onde está o último backup

GitHub → repositório `nucleo` → **Actions** → workflow **Backup** → a execução verde mais recente →
seção **Artifacts** → baixe o `.zip` e descompacte. Dentro há um único arquivo
`nucleo-backup-<data>.tar.gz.age` (criptografado). Há um por dia, retidos por 30 dias.

> Se o GitHub também estiver indisponível, use a cópia do `.age` que você guardou offline (recomendado
> manter uma). O arquivo é inútil para quem não tem sua chave privada.

## 2. Abrir e conferir num Postgres local (sempre antes de tocar no Supabase)

```bash
age -d -i nucleo-backup-chave.txt -o backup.tar.gz nucleo-backup-<data>.tar.gz.age
tar -xzf backup.tar.gz
cd schema
bash restore-from-bundle.sh "postgresql://postgres@localhost:5432/teste"
```

O backup é **autossuficiente** (formato 2): a pasta `schema/` traz todo o DDL (stub, migrations,
`restore.sql`, `validate.sql`) e este script, então a restauração local **não depende do repositório**.
O banco `teste` é apagado e recriado; ao final o script confere a estrutura e lê um registro real
(`validate.sql`). Veja `manifest.txt` (data/commit) e `checksums.txt` (contagens por tabela).

Conteúdo do backup: `records`, `user_settings`, `quota_limits`, `schema_version`, `ai_entitlements`
(níveis de IA por conta) e `accounts.csv` (id, e-mail e data de criação de cada conta). **Não** inclui:
senhas de login (ver passo 5), lembretes agendados e aparelhos de push (o app recria), e o histórico de
versões (o backup é o estado do dia).

## 3. Criar o projeto/banco novo

1. Supabase → **New project** (mesma região de antes, se possível). Guarde a nova senha do banco e as
   novas chaves (`anon`, `service_role`, URL) — elas mudam.
2. Aplique **todas** as migrations do repositório, em ordem, no SQL Editor (ou pelo bundle: os arquivos
   em `schema/migrations/`). Isso recria schema, funções, policies/RLS e triggers.

## 4. Ordem correta do restore (dados)

Faça num banco **recém-criado e vazio**, depois das migrations. A forma mais segura é restaurar primeiro
**localmente** (passo 2), conferir, e só então levar os dados ao Supabase. Ordem das tabelas (por causa
das chaves estrangeiras):

1. **contas** (`auth.users`) — ver passo 5;
2. `quota_limits` e `schema_version` (já vêm das migrations; o backup tem a cópia exata);
3. `records`;
4. `user_settings`;
5. `ai_entitlements`;
6. recontar `quota_usage` a partir de `records` (o `restore.sql` do bundle já faz isso).

## 5. Contas e senhas (a parte manual inevitável)

As senhas de login ficam no `auth` do Supabase e **não** entram no backup — de propósito: o usuário de
backup é só-leitura e **não enxerga hash de senha**, então, se a connection string vazasse, nenhuma senha
vazaria junto. Num projeto novo, há dois caminhos:

- **Preferido — preservar os ids (sem remapear dados):** no SQL Editor do projeto novo, recrie cada conta
  com o **id original** do `accounts.csv`, criando a linha em `auth.users` **e** em `auth.identities` (em
  versões recentes do Supabase o login de e-mail exige a identidade; as colunas de token ficam `''`, nunca
  `NULL`). É exatamente o script `scripts/backup/account-recovery-recreate.sql` (também vai dentro do backup):
  ```sql
  -- repita por conta, com uid/email/created do accounts.csv
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', '<uid>', 'authenticated', 'authenticated', '<email>',
    '', now(), '<created_at>', now(),
    '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values ('<uid>', '<uid>', jsonb_build_object('sub','<uid>','email','<email>','email_verified',true),
          'email', now(), now(), now());
  ```
  `encrypted_password` vazio = **sem senha utilizável**; cada pessoa usa **"Esqueci minha senha"** para
  definir a senha nova. Como os ids são os mesmos, `records`/`user_settings`/`ai_entitlements` restauram
  batendo com `user_id` — **sem remapear nada**. Essa recriação (UUID original → reset → login mantendo o
  UUID) é testada contra um GoTrue real no CI (`.github/workflows/account-recovery.yml`).
- **Alternativa — recadastro:** se preferir não inserir em `auth.users`, as pessoas se cadastram de novo
  (ids novos). Aí, antes de gravar os dados, troque no banco local o `user_id` antigo pelo novo (ligados
  pelo e-mail no `accounts.csv`), numa transação, conferindo as contagens antes do `commit`.

## 6. O que reconfigurar manualmente

- **Segredos do GitHub Actions:** `NUCLEO_BACKUP_DB_URL` (nova senha/host do pooler do usuário
  `nucleo_backup` — recrie o papel e dê a senha), e confira `NUCLEO_BACKUP_AGE_RECIPIENT` (a chave
  **pública**, continua a mesma). Veja `docs/BACKUP.md`.
- **Secrets do app** (`.env`/hosting): nova `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
- **Edge Functions / Turnstile / Sentry:** reimplante as functions e reponha os secrets delas
  (`service_role`, chaves do Turnstile, DSN do Sentry). O Sentry não guarda dados do app; só erros.
- **pg_cron** (limpeza do histórico), se você usava: Database → Extensions → pg_cron e rode
  `supabase/cron-manutencao.sql`.
- **DNS/domínio:** o app é estático (GitHub Pages); só reaponte as chaves do Supabase.

## 7. Validar antes de apontar o Núcleo para o banco novo

1. No banco restaurado, rode `schema/validate.sql` — tem que passar sem erro (estrutura completa,
   invariantes e um registro real legível).
2. Confira contagens contra `checksums.txt` (mesmas linhas por tabela).
3. Entre com **uma** conta de teste (após o reset de senha) e confirme que os dados aparecem e
   sincronizam.
4. Só então troque as chaves do Supabase no app em produção.

## Em uma linha

Baixe o último `.age` → abra com a chave privada → restaure e **valide** local → crie o projeto novo e
aplique as migrations → recrie as contas pelos ids do `accounts.csv` → restaure os dados na ordem acima →
rode `validate.sql` → reconfigure os secrets → aponte o app. Nunca pule a validação.
