# Automações — Parte 1: motor + automações prontas

Data: 2026-10-12 · Branch: `feature/automacoes`

## Objetivo

Fazer o Núcleo trabalhar sozinho com o que já está cadastrado — automação real, não
lembretes nem notificações. O app vai para a App Store no futuro, então cada automação
precisa ser confiável para desconhecidos: explicável, desligável e desfazível.

Esta é a parte 1 de 3:

1. **Motor + automações prontas** (este documento)
2. Regras "quando X, faça Y" montadas pela pessoa — usa o mesmo motor
3. Importar extrato CSV/OFX + categoria automática

Fora de escopo (decidido): cobrança/planos pagos, Stripe, agenda externa, Atalhos do
iPhone, foto de recibo, e-mail encaminhado, notificações/lembretes novos.

Já existem e não mudam: pagamento de projeto/venda → entrada no Financeiro
(`src/data/receipts.ts`); lista de compras a partir do cardápio (`src/core/shopping.ts`).

## Automações

### 1. Assinante → entrada

- Novos campos opcionais em `Subscriber`: `billingMode?: 'auto' | 'manual'` e `autoSince?: string`
  (dia em que passou para auto). `billingMode` ausente = `manual`
  (assinantes existentes e novos começam manuais; a pessoa troca no formulário).
- Só assinantes com `status === 'active'` geram algo. Teste, pausado e cancelado: nada.
- **auto:** para cada data de cobrança vencida (`nextCharge <= hoje`), numa única gravação:
  - adiciona um pagamento ao assinante (valor e moeda do plano, data = data da cobrança,
    `finance: true`);
  - cria a entrada no Financeiro com id fixo derivado do pagamento (mesmo padrão de
    `receipts.ts`, novo `ReceiptSource.kind: 'subscriber'`), data = data da cobrança;
  - avança `nextCharge` em 1 mês ou 1 ano conforme o plano (dia 29–31 cai no último dia
    em meses curtos — `addMonths` já existente);
  - registra a execução.
  Ação "Não pagou" = desfazer daquela execução.
- **manual:** a cobrança vencida aparece como "a receber" no assinante e em Assinantes;
  um toque em "Confirmar recebimento" executa exatamente o mesmo que o modo auto (mesma
  execução, mesmo id). Nada é criado sem o toque.
- Vários períodos vencidos (app sem abrir) são lançados um a um, cada um com a sua data.

### 2. Ferramenta → saída

- `Tool` com `status === 'active'` e `billing` `monthly`/`yearly`: para cada `nextCharge <= hoje`,
  cria a saída no Financeiro (valor/moeda da ferramenta, data = data da cobrança, categoria de
  ferramentas/assinaturas se existir) e avança `nextCharge` 1 mês/1 ano.
- `billing: 'once'`: lança uma vez na `nextCharge` e não avança.
- `free`, `trial`, `cancelled`, ou `nextCharge` vazio: nada.
- Sem modo manual (o cartão é cobrado de qualquer jeito); tem desfazer.

### 3. Projeto concluído → cliente

- Ao salvar um projeto com `status` passando para `done`: se o cliente vinculado não tiver
  nenhum outro projeto fora de `done`/`paused`, e o cliente não estiver `archived`, o cliente
  passa para `done`.
- Ao salvar um projeto saindo de `done` para qualquer status em andamento
  (`notStarted`, `inProgress`, `waitingClient`, `review`) e o cliente estiver `done`, o cliente
  volta para `active`.
- Roda na mesma gravação (`repo.batch`) que salva o projeto. Registra a execução (com o
  status anterior do cliente, para desfazer).

### 4. Meta com prazo → guardar por mês

- Novo campo opcional em `FinanceGoal`:
  `autoSave?: { day: number; mode: 'calculated' | 'fixed'; amount: Cents; since: string }`.
  Ausente = desligado. `day` 1–31 (29–31 → último dia do mês curto). `since` = dia em que
  foi ligado.
- Em cada dia `day` de cada mês, a partir de `since` e até hoje:
  - `calculated`: valor = `ceil(falta / meses restantes até o prazo, contando o mês atual)`,
    falta = `target − saved` no momento da execução; mínimo 0.
  - `fixed`: valor = `amount`, limitado ao que falta.
  - soma o valor a `saved` e registra no `history` (`withSaved`).
- "Mudar este mês": altera o valor daquela execução (ajusta `saved` pela diferença).
  "Pular este mês": desfaz/marca a execução como pulada. Os meses seguintes, no modo
  calculado, se recalculam sozinhos.
- Para sozinho quando `saved >= target`, quando o prazo passa ou quando a meta é arquivada.
- Não mexe no saldo do Financeiro: só marca quanto do saldo está separado (como o "guardado"
  já funciona).

## Motor

### Peças

- `src/core/automation/` — funções puras, uma por automação:
  `plan(state, settings, today) → Occurrence[]`. Cada `Occurrence` tem `key` fixa, o tipo,
  a data, o resumo legível e as operações (`BatchOp[]`) com os valores anteriores necessários
  para desfazer. Não leem nem gravam o banco.
- Nova coleção `automationRuns` (`AutomationRun extends Entity`):
  - `id` = key fixa, ex.: `auto-sub-<subscriberId>-<YYYY-MM-DD>`,
    `auto-tool-<toolId>-<date>`, `auto-goal-<goalId>-<YYYY-MM>`,
    `auto-client-<projectId>-<updatedAt>`;
  - `automation`: `'subscriberCharge' | 'toolCharge' | 'projectClient' | 'goalSave'`;
  - `date`, `summary` (texto mostrado), `amount?`, `currency?`;
  - `created`: ids criados; `changed`: `{ collection, id, field, before, after }[]`;
  - `status`: `'done' | 'undone' | 'skipped'`. Cobranças manuais "a receber" não são
    execuções gravadas: são calculadas na hora a partir do planejamento.
- Executor `useAutomations` (montado uma vez no store): compara as `Occurrence` planejadas
  com `automationRuns`; para cada uma sem execução registrada, grava as operações + a execução
  num único `repo.batch`. Qualquer execução registrada (inclusive desfeita/pulada) nunca é refeita.

### Quando roda

- Ao abrir o app (depois da primeira sincronização, quando houver conta), quando o dia muda,
  e quando o app volta a ficar visível.
- Projeto → cliente: dentro da gravação do projeto, não no executor periódico.
- Execuções concorrentes no mesmo aparelho são serializadas (uma de cada vez).

### Duplicação

- O id fixo da execução e dos registros criados faz dois aparelhos convergirem para o mesmo
  registro na sincronização (último a gravar vence, conteúdo igual).

### Desfazer

- Aplica o inverso num único `repo.batch`: remove os registros criados, devolve os campos
  alterados ao valor anterior **só se ainda estiverem com o valor que a automação gravou**
  (se a pessoa editou depois, mantém a edição dela).
- Meta: subtrai o valor da execução de `saved` (não restaura o número antigo), preservando
  valores guardados à mão depois.
- A execução fica com `status: 'undone'` (ou `'skipped'` para "Pular este mês").

### Limites de segurança

- Atraso só é recuperado a partir do dia em que a automação foi ligada naquele item
  (`billingMode` → guarda `autoSince` no assinante; ferramenta → `settings` registra quando
  a automação de ferramentas foi ligada; meta → `autoSave.since`). Nunca lança antes disso.
- Máximo de 36 execuções por item numa passada (proteção contra dados estranhos).
- Moeda sem cotação: a execução espera até haver cotação (mesma regra dos recebimentos).
- Item apagado: nada é gerado; execuções antigas continuam no histórico.

## Interface

- **Configurações → Automações:** um interruptor por automação, com uma frase do que faz.
  Todas começam ligadas; assinante e meta só agem quando ativados no próprio item.
- **"Feito pelo Núcleo"** (nova tela, acessível em Configurações → Automações e com atalho
  no Início quando houver execuções recentes): lista por data — o quê, valor, de onde —
  com "Desfazer"; na meta, "Mudar este mês" / "Pular este mês"; no assinante, "Não pagou".
- **Assinante:** campo "Cobrança: Automática / Manual" no formulário; cobranças manuais
  vencidas mostram "A receber — Confirmar".
- **Meta:** seção "Guardar todo mês" (dia, Calculado/Valor fixo), mostrando o valor deste mês.

## Dados e sincronização

- `DB_VERSION` 7 → 8 (nova coleção `automationRuns`); atualizar `tests/db-version.test.ts`.
- Migração Supabase `20261012000000_automacoes.sql`: adiciona `automationRuns` à lista
  permitida de `records.collection`. O usuário roda no Supabase, como nas etapas anteriores.
- Campos novos são todos opcionais; registros antigos não são alterados.
- `Settings.automations?: Partial<Record<AutomationId, { on: boolean; since: string }>>`.

## Testes

- Unitários (vitest) por automação: fim de mês, ano bissexto, mensal/anual/única,
  recuperar atraso, limite "desde quando ligado", status que não geram, moeda sem cotação,
  meta calculada após mês pulado/mês menor, parada ao atingir/arquivar/prazo.
- Idempotência: executar o motor duas vezes → mesmo estado.
- Desfazer: inverso exato; edição posterior da pessoa preservada.
- Dois aparelhos com o mock de sincronização existente: nenhuma duplicata.
- e2e (`tests/e2e/`): "Feito pelo Núcleo" mostra a execução e o desfazer remove a entrada.
