# Monitoramento de erros (Sentry) — PARTE 14

Monitora **erros reais em produção** com **privacidade por padrão**. Desligado sem configuração; nenhum
dado privado sai do navegador.

## Como funciona

- **SDK**: `@sentry/react` (oficial) + `@sentry/vite-plugin` (source maps). Só erros — **sem** Session
  Replay e **sem** performance tracing (`tracesSampleRate: 0`).
- **Liga só com DSN**: `src/lib/monitoring.ts` lê `import.meta.env.VITE_SENTRY_DSN`. Vazio (dev, e2e,
  ou produção sem a Variable) = **desligado**. `MONITORING_ENABLED` reflete isso.
- **Captura**: exceções não tratadas e promises rejeitadas (handlers globais do SDK) e crashes de
  renderização (via o `ErrorBoundary` existente, `captureRenderError`, **uma** vez por crash). O
  `errorLog` local (localStorage) e os fallbacks amigáveis continuam como antes.
- **Barreira `beforeSend` (allowlist)**: remove `extra`, corpo/cookies/headers de auth de request,
  contextos que não sejam técnicos; mascara qualquer valor sensível por **nome** (senha, token, cofre,
  OTP, recovery, dinheiro…) **e por formato** (JWT, Bearer, `sk-ant`, `age`, código de recuperação,
  valores em dinheiro). Um evento que não dá para sanear com segurança **não é enviado**.
- **Usuário**: só um **pseudônimo** (hash do uid), nunca e-mail/nome/IP. Limpo no logout e na troca de
  conta.
- **Release** = commit do deploy (`VITE_RELEASE` = `github.sha`). **Environment** = `production`.
- **Resiliência**: `init` e envios são `try/catch`; Sentry fora do ar/bloqueado **nunca** quebra o app,
  o PWA, o service worker ou o push.
- **CSP**: `connect-src` libera **apenas** o host de ingestão derivado do DSN (sem curinga).
- **Source maps**: gerados `hidden`, **enviados ao Sentry e apagados do `dist`** (não ficam públicos no
  GitHub Pages). Só acontece quando o `SENTRY_AUTH_TOKEN` está presente no build do CI.

## O que VOCÊ precisa fazer (configuração manual — pare e faça isto)

Sem estes passos o Sentry fica **desligado** e nenhum erro é recebido.

1. **Criar conta/projeto no Sentry** (https://sentry.io, plano free serve): crie uma organização e um
   **projeto do tipo React**. Anote:
   - o **DSN** (Settings → Projects → [projeto] → Client Keys (DSN)) — é **público**;
   - o **slug da organização** e o **slug do projeto**.
2. **GitHub → Settings → Secrets and variables → Actions → Variables** (públicas), botão "New
   repository variable":
   - `VITE_SENTRY_DSN` = o DSN do passo 1;
   - `SENTRY_ORG` = slug da organização;
   - `SENTRY_PROJECT` = slug do projeto.
3. **GitHub → … → Secrets** (secreto), botão "New repository secret":
   - `SENTRY_AUTH_TOKEN` = um **Auth Token** do Sentry (Settings → Account → Auth Tokens, ou
     Organization → Developer Settings) com escopos `project:releases` e `org:read`. **Nunca** coloque
     este token como Variable nem com prefixo `VITE_`.
4. **Alertas** (Sentry → o projeto → Alerts → Create Alert):
   - **A. Novo erro não visto**: template "Issues" → "A new issue is created" → Action: envie e-mail
     para você (ou use o alerta padrão "New issue" que o Sentry já cria). 
   - **B. Pico de erros**: "Number of errors" → "is more than" **20** em **1 hour** (ajuste depois) →
     e-mail.
   - **C. Muitos usuários afetados**: "Number of users affected" → "is more than" **5** in **1 hour** →
     e-mail.
   - Destino: **e-mail** (Settings → Notifications já manda para o e-mail da conta; não precisa de
     integração externa).
5. Me avise quando terminar. Depois do deploy autorizado, geramos um erro de teste controlado e
   confirmamos: evento recebido, environment `production`, release = commit, **source map resolvendo**
   para o `.tsx` original, e **sem PII/segredos**. Então removemos qualquer gatilho de teste.

## Importante

- O **DSN** no cliente é normal e público (só permite **enviar** eventos). Não confunda com o
  **auth token** (secreto, só no CI).
- Em desenvolvimento local o Sentry fica desligado (sem DSN). Erros locais não poluem produção.
- Edge Functions: nesta etapa os erros de servidor continuam nos **logs do Supabase** (as funções já
  fazem `console.error` com mensagens sanitizadas). Não instalamos SDK Deno para não arriscar enviar
  prompts/respostas da IA/tokens. Integração server-side fica como decisão futura separada.
