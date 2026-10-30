# Pendências

## Lembretes com o app fechado — LIGADO em 2026-10-30

- Função `push-dispatch` publicada (sem verificação de JWT do gateway; recusa sem `DISPATCH_SECRET` → 403).
- Secrets da função: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:supportnucleo@gmail.com),
  `DISPATCH_SECRET`. Cópia de segurança só em `Documents/Nucleo-backup-PRIVADO/nucleo-push-PRIVADO.json`
  (perder a chave privada = gerar outra e cada aparelho ativar de novo).
- `pg_cron` + `pg_net` ligados; `supabase/cron.sql` aplicado (URL e segredo no Vault): `nucleo-push-dispatch`
  a cada minuto e `nucleo-push-cleanup` semanal. Variável do GitHub `VITE_VAPID_PUBLIC_KEY` criada.
- Plano Free: 500 mil execuções de função/mês incluídas; o cron usa ~43 mil.
- Migração `20261030000000_push_dispatch_permissao.sql` aplicada (só `grant select, delete` em
  `push_subscriptions` para o service_role; `schema_version` com 12 linhas). O envio usa
  `_shared/push/webpush.ts` (WebCrypto), não o pacote `web-push`, que quebra no runtime das Edge Functions.
- Conferido em produção (2026-10-30), 2 contas de teste apagadas no fim: 22/22 — entrega pelo cron, app
  fechado, isolamento entre contas (RLS), concluído não chega, 1 entrega por lembrete, 2 disparos simultâneos.
  Assinatura VAPID aceita pelo servidor da Apple (web.push.apple.com).
- Diagnóstico (SQL Editor): `select status, start_time from cron.job_run_details order by start_time desc limit 5;`
- Desligar: `select cron.unschedule('nucleo-push-dispatch');` (os lembretes continuam dentro do app).
- Limites reais: iPhone só com o app na Tela de Início e iOS 16.4+; entrega depende do sistema (modo foco,
  economia de bateria). Lembretes cobrem os próximos 14 dias a partir da última vez que o app foi aberto.

## Auth: configurações do painel do Supabase (Etapa 2)

Registrado em 2026-10-22, na Etapa 2 da auditoria.

- **Aplicado pelo dono do projeto em 2026-10-24:** senha mínima 8 + "Letters and digits", "Secure password
  change", validade do código por e-mail 1800 s, token de acesso 900 s, limites (Rate Limits) conferidos,
  Site URL `https://hellonucleo.app/`; Redirect URLs: localhost, `hellonucleo.app` e `www.hellonucleo.app`.
- **Captcha ligado no Supabase em 2026-10-28** (Authentication → Attack Protection; Cloudflare Turnstile).
  Conferido em produção: sem token (ou com token falso) entrar, criar conta, recuperar senha e OTP são recusados;
  pelo app, o token real passa nos três. É a única proteção real contra tentativas distribuídas, cadastros em massa e spam de e-mail. O app
  (`Captcha.tsx`, `VITE_TURNSTILE_SITE_KEY`) manda o token em Entrar, Criar conta, Recuperar senha e
  Reenviar e-mail. Ordem: publicar o app, conferir em produção, esperar os aparelhos atualizarem, e só
  então ligar no Supabase com a Secret Key. Desfazer = desligar a opção no Supabase.
  - Depois de ligado, o `.env.local` com a chave de **teste** não entra no projeto real (o Supabase recusa
    o token de teste): para testar localmente contra produção, use a Site Key real com `localhost` no widget.
  - Builds de e2e: `dist-e2e-cloud` com `VITE_TURNSTILE_SITE_KEY=` (vazio, senão o Vite pega a chave do
    `.env.local`); `dist-e2e-captcha` com a chave de teste (comando no topo de `auth-captcha.e2e.mjs`).
- **Risco que continua:** depois de "Sair de todos os aparelhos" ou de trocar a senha, um token já emitido
  continua aceito pela API de dados até expirar (agora no máximo 15 min).
- "Prevent use of leaked passwords" só existe no plano Pro.
- **Endurecimento futuro, não implementar sem autorização:** políticas RLS que exigem a sessão viva em
  `auth.sessions` (token revogado deixaria de valer na hora, sem esperar expirar). Precisa de migration.

## Cotas por conta (Etapa 3)

Registrado em 2026-10-24. Migração `20261024000000_cotas.sql` **aplicada no Supabase em 2026-10-24** pelo dono
do projeto (app publicado no commit `67955a1`). Conferido depois: `quota_usage` com 25 linhas e as duas contas com
dados certas; em produção, criar uma anotação, sincronizar, apagar e sincronizar de novo funcionou sem erro.
**Etapa 3 concluída.**

- Ajustar um limite, sem migração nova (SQL Editor):
  `update public.quota_limits set max_value = 30000 where key = 'records.tasks';`
- Ver o uso de uma conta: `select * from public.quota_usage where user_id = '…' order by scope;`
- O uso é mantido pelos gatilhos. Só fica errado se alguém mexer direto em `quota_usage` ou usar
  `truncate` em `records`. Para recalcular tudo do zero (não toca em nenhum registro):

  ```sql
  begin;
  lock table public.records in share row exclusive mode;
  update public.quota_usage set live = 0, total = 0, bytes = 0;
  insert into public.quota_usage (user_id, scope, live, total, bytes)
  select user_id, collection, count(*) filter (where not deleted), count(*), sum(octet_length(data::text))
    from public.records group by user_id, collection
  union all
  select user_id, '*', count(*) filter (where not deleted), count(*), sum(octet_length(data::text))
    from public.records group by user_id
  on conflict (user_id, scope) do update set live = excluded.live, total = excluded.total, bytes = excluded.bytes;
  commit;
  ```
- **A acompanhar:** "Feito pelo Núcleo" (`automationRuns`) nunca é limpo pelo app. Com muitas regras ativas, é
  a coleção que mais cresce e a que primeiro chegaria ao limite de itens ou de 25 MB. Ao atingir, o
  histórico novo fica só no aparelho (as regras continuam rodando). Solução futura: apagar o histórico antigo.
- **A acompanhar:** apagar no app deixa uma "lápide" que conta nas 200.000 linhas da conta. Não há como o
  usuário liberar isso pelo app; se uma conta chegar perto, o dono do projeto aumenta o limite.
- Criar várias contas: a defesa é o CAPTCHA no Supabase (ligado em 2026-10-28).

## Auditoria, Etapas 4 a 10 (fechamento da Parte 1)

Registrado em 2026-10-27; **em produção desde 2026-10-28** (app no commit `dfebec7`).
- Migração `20261027000000_auditoria_etapas_4_10.sql` aplicada pelo dono do projeto (`schema_version` com 11
  linhas). Ela também fechou o que ficou da Etapa 3 (A3, B4, janela de `fire_at`) e corrigiu o defeito que impedia
  excluir uma conta com 2 ou mais registros.
- Backup diário ligado (secret `NUCLEO_BACKUP_DB_URL`, variável `NUCLEO_BACKUP_AGE_RECIPIENT`). O primeiro, em
  2026-10-28, restaurou idêntico num banco vazio e também com a chave privada do dono, num Postgres local.
- `scripts/verify-rls.mjs` contra a produção, com 2 contas de teste: 42/42. "Excluir conta" em produção, nas mesmas
  contas (3 itens, uma edição com histórico, configurações e cotas): 15/15; as contas não entram mais e nada sobra.

**Parte 1 encerrada em 2026-10-28.** Política de privacidade publicada em `/privacidade.html` (responsável:
Riquelme Santos Lima, contato supportnucleo@gmail.com), com link em Conta.

Opcional:
- Ligar a extensão pg_cron e rodar `supabase/cron-manutencao.sql` (limpeza diária do histórico). Sem ela, cada
  conta limpa as próprias versões antigas ao editar.
- Antes de publicar as Edge Functions de IA: limite de gasto mensal no console da Anthropic.

Conferido em produção (consulta somente leitura, 2026-10-27): Postgres 17.11; o usuário `postgres` cria papéis,
ignora RLS e pode apagar em `auth.users` (o que a migração e `delete_my_account` precisam); `nucleo_backup` não
existe; nenhuma data no futuro e nenhuma senha fora do formato do cofre (a migração não terá o que corrigir);
as 10 migrations anteriores estão aplicadas; pg_cron e pg_net **não** estão ligados (o envio de lembretes
pelo servidor, `supabase/cron.sql`, nunca foi agendado); 4 contas, 2 com dados; a conta que mais muda alterou
91 itens (673 kB) em 30 dias, longe do limite de 25 MB do histórico.
- Existe uma função `public.rls_auto_enable` que não está no repositório. Pelo nome, é a opção do Supabase de
  ligar o RLS sozinho em tabelas novas; não atrapalha a migração (as tabelas novas já ligam o RLS).

Ficou de fora, de propósito:
- **M5** (relógio do servidor como referência e pagamentos como registros próprios): mexe no núcleo da
  sincronização; o teto de 5 min no servidor já tira o pior caso (registro congelado). Tratar numa etapa própria.
- **Monitoramento externo (Sentry ou similar):** exige conta no serviço e entra na política de privacidade.
  Por enquanto: registro local de erros (Configurações → Diagnóstico), e-mail do GitHub quando o backup falha,
  e a contagem de falhas do cron na consulta de diagnóstico.
- **Proteção da branch `main`** (exigir os testes antes do merge): configuração do GitHub, decisão do dono.
  O deploy já não publica se os testes falharem.
- **Tombstones eternos (B8):** apagá-los arriscaria "ressuscitar" itens em aparelhos que ficaram meses offline.
  Contam nas 200.000 linhas da conta; o limite pode subir se preciso.

## Segurança: senhas em texto puro no modo sem conta

Registrado em 2026-10-22, ao fechar a Etapa 1 da auditoria. Tratar numa etapa própria.

Quem usa o app **sem conta e sem cofre** guarda as senhas de "Contas" sem criptografia no banco do aparelho
(`nucleo`). Qualquer pessoa com acesso ao aparelho (ou às ferramentas do navegador) consegue lê-las, e o app as
mostra com o botão de revelar. A Etapa 1 resolveu só o caso das senhas que **já foram enviadas para uma conta**
(depois de uma migração conferida, a cópia sem conta perde a senha em texto puro). Para quem nunca entrou numa
conta, nada mudou. Correção provável: exigir o cofre também no modo sem conta.

## e2e de sincronização falhando (anterior à 2.1)

Registrado em 2026-10-21, na publicação da Parte 2.1. Revisto em 2026-10-22 (Etapa 1 da auditoria).

- **Resolvido.** `click: not found Entrar ou criar conta` em `finance-sync` e `assistant-sync` era configuração
  de teste: o `vite preview` que cada teste inicia precisa de `NUCLEO_BASE=/nucleo/`. Sem isso o JavaScript
  responde 404 e a tela fica em branco (`receipts-sync` e `sales-sync` já passavam a variável; os demais
  dependiam de quem rodava o teste). Agora todos os e2e com `dist-e2e-cloud` passam a variável sozinhos.
  `finance-sync` passa 8/8.
- **Intermitente, também no `main`:** `assistant-sync` — "ao reconectar: sobe uma única tarefa, com o user_id certo
  e a marca do Assistente" e "outro aparelho mostra 'Alterado pelo Assistente'" (4/6). Em 2026-10-22: `main` passou
  1 de 2 vezes; a Etapa 2, 1 de 4 rodadas válidas (mais uma que travou no cadastro por lentidão). Quando passa, a tarefa chega certa ao
  servidor: o teste confere 1,5 s depois de "Agora", e nesta máquina a sincronização às vezes demora mais. Não
  envolve sessão (o "offline" do teste é do mock, não dispara o evento `online` do navegador).
- **Resolvido em 2026-10-27:** `daily-sync` procurava o "+" da Caixa de entrada na tela inicial; agora vai à
  própria tela. 9/9.
- **Iguais no `main` (2026-10-27, rodados um por vez):** `home-switch` 7–8/9 (deslocamento de 0,045 ao voltar
  para a Início), `transitions-a11y` 6–7/7 (o passo entra em 205–225 ms, limite 200: depende da carga da
  máquina), `assistant-sync` 4/6 (acima).
- **Não revisto, igual no `main`:** `regression-account-sync`, `regression-existing-user` e `regression-new-user`
  terminam sem resumo (`SecurityError` ao acessar o IndexedDB; usam outro build).
- Rodar a suíte inteira de uma vez nesta máquina dá falhas falsas por falta de memória: rode em grupos de ~5
  e repita isoladamente o que falhar antes de tratar como regressão.
