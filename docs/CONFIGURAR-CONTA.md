# Ativar conta, sincronização, IA e notificações

Sem estes passos o Núcleo continua funcionando como antes: tudo fica no aparelho.
As novas seções (Hoje, Vendas, Assinantes, Rotina e Alimentação em modo manual, cofre de
senhas, moedas e lembretes dentro do app) já funcionam sem conta.

Precisam de configuração: **conta + sincronização**, **IA** e **notificações com o app fechado**.

## 1. Criar o projeto no Supabase (plano gratuito)

1. Crie uma conta em https://supabase.com e um projeto novo (região mais próxima, ex.: São Paulo).
2. **SQL Editor** → cole e rode `supabase/migrations/20261001000000_nucleo_init.sql`.
3. **Authentication → Sign In / Providers → Email**: deixe “Confirm email” ligado.
4. **Authentication → URL Configuration**:
   - Site URL: `https://riksants.github.io/nucleo/`
   - Redirect URLs: `https://riksants.github.io/nucleo/` e `http://localhost:5173/nucleo/`
5. **Authentication → Emails → Templates** — inclua o código nos e-mails (no iPhone o link do
   e-mail abre no Safari, fora do app instalado; com o código a pessoa confirma dentro do app):
   - *Confirm signup*: acrescente `Seu código: {{ .Token }}`
   - *Reset password*: acrescente `Seu código: {{ .Token }}`
6. **Project Settings → API**: copie `Project URL` e a chave `anon`/`publishable`.

> A chave `service_role` **nunca** vai para o app nem para o GitHub. Ela só existe dentro das
> Edge Functions, onde o Supabase a injeta automaticamente.

## 2. Ligar o app ao projeto

No GitHub → repositório `nucleo` → **Settings → Secrets and variables → Actions → Variables**:

| Variável | Valor |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | chave anon/publishable |
| `VITE_VAPID_PUBLIC_KEY` | chave pública VAPID (passo 4) |

São valores públicos por natureza (a proteção está nas políticas RLS do banco).

## 3. Conferir o isolamento no servidor real

Crie duas contas de teste pelo app (ou em Authentication → Users), depois:

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... \
A_EMAIL=... A_PASSWORD=... B_EMAIL=... B_PASSWORD=... \
node scripts/verify-rls.mjs
```

Ele tenta, como a conta B, ler/alterar/apagar/criar dados da conta A por requisições diretas.

## 4. IA e notificações (Edge Functions)

Instale a CLI (`npm i -g supabase`), depois `supabase login` e `supabase link --project-ref SEU-REF`.

Gere as chaves VAPID **no seu computador** (a privada não deve ir para o repositório):

```bash
npx web-push generate-vapid-keys
```

Cadastre os segredos das funções:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...            # https://console.anthropic.com
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:seu-email
supabase secrets set DISPATCH_SECRET=$(openssl rand -hex 32)  # anote o valor
supabase secrets set ALLOWED_ORIGINS=https://riksants.github.io,http://localhost:5173
# opcional: supabase secrets set PLANNER_DAILY_LIMIT=10
```

Publique as funções:

```bash
supabase functions deploy planner
supabase functions deploy push-dispatch --no-verify-jwt   # chamada pelo agendador com DISPATCH_SECRET
```

Por fim, rode `supabase/cron.sql` no SQL Editor (troque a URL do projeto e o `DISPATCH_SECRET`).
Ele dispara o envio a cada minuto com `pg_cron` + `pg_net`.

## Custos

- **Supabase grátis**: 50 mil usuários ativos/mês, 500 MB de banco, 500 mil chamadas de função/mês.
  O agendador usa ~43 mil chamadas/mês. Projetos grátis **pausam após 7 dias sem uso** (reativa no painel).
  Plano Pro: US$ 25/mês, se um dia precisar.
- **IA (Anthropic, modelo Claude Opus 5.5)**: cobrada por uso — US$ 4 por milhão de tokens de entrada e
  US$ 20 por milhão de saída. Uma geração de rotina + alimentação costuma usar poucos milhares de
  tokens (centavos de dólar). O limite padrão é 10 gerações por pessoa por dia. Defina um limite de
  gasto mensal no console da Anthropic.
- **Notificações (Web Push)**: grátis (serviços da Apple/Google/Mozilla).

## Assistente — interpretador opcional com IA (desligado por padrão)

O Assistente funciona 100% sem IA: comandos, sugestões, reorganização e replanejamento rodam no aparelho, sem custo.
O interpretador opcional só entende frases livres e devolve uma intenção; quem executa (com confirmação) é o app.

Só faça isto se quiser ativar — gera custo por uso na Anthropic:

1. Publicar a função: `supabase functions deploy assistant` (usa a mesma `ANTHROPIC_API_KEY` do planejador, como segredo da função).
2. Opcional: `supabase secrets set ASSISTANT_DAILY_LIMIT=30` (padrão 30 por pessoa/dia).
3. No app: Configurações → Assistente → "Entender frases livres com IA" (pede consentimento; desliga a qualquer momento).

O que é enviado: só a frase digitada e a data de hoje. O que fica gravado em `ai_usage`: tipo da intenção, modelo e número de tokens — nunca o texto.
Para estimar custo: some `input_tokens` e `output_tokens` de `kind = 'assistant'` e multiplique pelos preços atuais do modelo `claude-haiku-4-5` na página de preços da Anthropic.
