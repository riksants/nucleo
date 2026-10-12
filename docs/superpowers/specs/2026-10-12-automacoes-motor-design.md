# Automações — Parte 1: motor + automações prontas

Data: 2026-10-12 · Branch: `feature/automacoes` · Status: aprovado pelo usuário (2ª revisão)

## Objetivo

Fazer o Núcleo trabalhar sozinho com o que já está cadastrado — automação real, não
lembretes. O app vai para a App Store no futuro: cada automação precisa ser explicável,
desligável e desfazível por desconhecidos.

**Regra geral: o Núcleo pode automatizar ações, mas nunca inventar fatos.**
Pode criar uma cobrança, reservar dinheiro, mudar status por regra objetiva. Não pode dizer
que alguém pagou, ou que uma despesa foi paga, sem confirmação da pessoa ou sem a opção
"Considerar pago automaticamente" ligada naquele item. Nunca cria dinheiro nem movimentação
fictícia. Reservar para meta nunca cria saída.

Partes: 1) motor + automações prontas (este documento) · 2) regras "quando X, faça Y" +
sugestões de automação baseadas no comportamento (não implementar agora) · 3) extrato
CSV/OFX + categoria automática (não implementar agora).

Fora de escopo: cobrança/planos pagos, Stripe, agenda externa, Atalhos, foto de recibo,
e-mail, notificações novas.

Já existem e não mudam: pagamento de projeto/venda → entrada (`src/data/receipts.ts`);
lista de compras do cardápio (`src/core/shopping.ts`).

## Automações

### 1. Assinante → cobrança

- Campo novo `Subscriber.paymentMode?: 'confirm' | 'autoPaid'`; ausente = `confirm`.
  Formulário: "Recebimento: Confirmar recebimento / Considerar pago automaticamente na data".
- Só `status === 'active'`. Para cada data de cobrança `<= hoje` (a partir do `since` da
  automação), numa única gravação:
  - **confirm:** cria a execução `pending` ("Cobrança de Fulano: a receber") e avança
    `nextCharge` um ciclo. Nada no Financeiro.
    - "Confirmar recebimento": folha com valor (padrão = preço do plano) e data
      (padrão = hoje), editáveis. Grava o pagamento no assinante (`finance: true`,
      `chargeRun: <id da execução>`) + a entrada no Financeiro (id fixo, padrão de
      `receipts.ts`, `ReceiptSource.kind = 'subscriber'`) e muda a execução para `done`.
    - "Não vai pagar": execução → `skipped`. Nada de dinheiro.
  - **autoPaid:** grava o pagamento (data = data da cobrança) + entrada + avança
    `nextCharge`; execução `done`. "Não pagou" = desfazer.
- Dia âncora: `Subscriber.chargeDay?: number` gravado na primeira execução (dia da
  `nextCharge`), para 31 → 28/fev → 31/mar não derivar.
- "Registrar pagamento" manual que já existe continua igual (não entra no Financeiro).

### 2. Ferramenta → cobrança

- Campo novo `Tool.autoPaid?: boolean`; ausente = desligado. Formulário:
  "Considerar pago automaticamente na data da cobrança".
- Gera só para `status === 'active'`, `billing` `monthly`/`yearly`/`once`, `price > 0`
  e `nextCharge` preenchida. `once`: o formulário passa a mostrar "Data da cobrança".
- **desligado:** execução `pending` "A pagar"; "Confirmar pagamento" (valor/data editáveis)
  cria a saída e muda para `done`; "Não paguei" → `skipped`.
- **ligado:** cria a saída (id fixo `auto-tool-<toolId>-<data>`, `source.kind = 'tool'`)
  na data; execução `done`.
- Em ambos: avança `nextCharge` (monthly/yearly) com `Tool.chargeDay`; `once` não avança e
  não gera de novo.
- **Alinhamento "Teste":** `isPaidTool` passa a exigir `status === 'active'`. Ferramenta em
  Teste deixa de contar como paga em todas as telas (filtro "Pagando", previsão do mês,
  Hoje, agenda, lembretes) — uma única interpretação no app.

### 3. Projeto concluído → cliente

- Toda gravação de projeto passa por `saveProject` (inclui projeto novo).
- Projeto passa a `done`, tem cliente, o cliente está `active` ou `waiting` e não tem outro
  projeto fora de `done`/`paused` → cliente vira `done`, na mesma gravação. Cliente
  `potential`/`archived` nunca é tocado.
- Projeto sai de `done` para `notStarted`/`inProgress`/`waitingClient`/`review` → cliente
  volta a `active` **somente se** o `done` atual dele foi posto pelo Núcleo (existe execução
  `projectClient` `done` para ele, não desfeita) e o cliente continua `done`.
  Estado manual nunca é sobrescrito.

### 4. Meta → guardar todo mês (reserva)

Conceitos (nenhum é gravado; tudo calculado):
- **Saldo** = saldo inicial + movimentações (como hoje).
- **Reservado** = soma do `saved` das metas `active` com `inBalance === true`, cada uma
  convertida da moeda da meta para a moeda de exibição/base pela cotação atual, só para
  mostrar e calcular. O valor guardado nunca é regravado por mudança de cotação. Meta sem
  cotação fica fora da soma e a tela avisa: "Reserva em USD ainda sem cotação: o Disponível
  não a considera".
- **Disponível** = Saldo − Reservado.

Campos novos em `FinanceGoal`:
- `inBalance?: boolean` — "Este dinheiro está no meu saldo". Ausente = não (metas antigas
  não mudam o Disponível). Ao ligar numa meta com `saved > 0`, confirmação:
  "Esta meta já possui €500 guardados. Ao ativar esta opção, €500 passarão a ser
  considerados reservados do seu saldo disponível." Só grava após confirmar.
- `autoSave?: { day: number; mode: 'calculated' | 'fixed'; amount: Cents; since: string }`.
  Exige `inBalance`.

Execução (uma por mês, id `auto-goal-<goalId>-<YYYY-MM>`), no dia `day` (29–31 → último dia
de mês curto), a partir de `since`:
- previsto: `fixed` = `amount`; `calculated` = `ceil(falta ÷ n)`, n = quantidades de dias de
  reserva que ainda cabem de hoje até o prazo, contando este. Limitado ao que falta.
- reservado = `min(previsto, Disponível convertido para a moeda da meta)`, mínimo 0.
  Sem cotação para converter → espera.
- soma o reservado a `saved` (`withSaved`). Texto: "Núcleo reservou €100 para Meta Viagem";
  quando faltou: "Previsto: €200 — reservado: €120 — faltaram €80 por saldo insuficiente."
  Reservado 0 → execução `skipped` com esse texto.
- "Mudar este mês" (novo valor; ajusta `saved` pela diferença, sem ultrapassar o Disponível)
  e "Pular este mês" (= desfazer, `skipped`). No modo calculado os meses seguintes se
  recalculam sozinhos.
- Para quando `saved >= target`, prazo passou, meta arquivada ou `inBalance` desligado.
- Nunca cria movimentação no Financeiro.

## Motor

- `src/core/automation/` — funções puras por automação:
  `plan(ctx) → Occurrence[]`, ctx = dados + settings + hoje + converter. Cada `Occurrence`:
  `key` fixa, automação, data, resumo, origem, valor, ops (`BatchOp[]`) e `changed` (campo,
  antes, depois) para desfazer.
- Coleção nova `automationRuns` (`AutomationRun extends Entity`): `id` = key; `automation`;
  `date`; `summary`; `origin: { collection, id, label }`; `amount?`; `currency?`;
  `created: { collection, id }[]`; `changed: { collection, id, field, before, after }[]`;
  `status: 'pending' | 'done' | 'undone' | 'skipped'`; `detail?` (ex.: faltou por saldo).
- Executor `useAutomations` (montado no app): roda com sincronização ociosa (mesma regra de
  `useReceiptReconciler`), ao abrir, ao virar o dia e ao voltar para a tela. Para cada
  ocorrência sem execução gravada: grava ops + execução num único `commit`. Execução
  existente (qualquer status) nunca é refeita. Passadas serializadas.
- Projeto → cliente roda dentro de `saveProject`.
- Duplicação: ids fixos → dois aparelhos convergem no mesmo registro.

Desfazer (`undoRun`), num único `commit`:
- remove registros criados (entrada/saída, pagamento no assinante);
- campos alterados voltam ao valor anterior **só se ainda estiverem com o valor gravado
  pela automação** (edição posterior da pessoa é preservada); se não der para voltar a
  data da próxima cobrança, a tela diz isso;
- meta: subtrai o valor reservado de `saved` (nunca abaixo de 0);
- execução → `undone` (ou `skipped` para "Pular"/"Não vai pagar").

Limites de segurança:
- `Settings.automations?: Partial<Record<AutomationId, { on: boolean; since: string }>>`.
  Ausente = ligada, com `since` = dia da primeira passada do motor (gravado nela). Desligar
  e religar → `since` = hoje (o período desligado não é recuperado). Meta: `autoSave.since`.
- Máximo 36 execuções por item numa passada.
- Moeda sem cotação: espera.
- Item apagado: nada é gerado; execuções antigas ficam no histórico (origem "apagado").

## Interface

- **Configurações → Automações**: interruptor por automação, com frase do que faz, e link
  para "Feito pelo Núcleo".
- **"Feito pelo Núcleo"** (`/automations`): no topo, pendências ("A receber" / "A pagar")
  com Confirmar; abaixo, histórico por data: o que fez, quando, origem (toque abre),
  valor, Desfazer quando seguro (e "Mudar este mês"/"Pular este mês" nas metas).
- **Início**: bloco de pendências quando houver, e linha "Feito pelo Núcleo" com as
  execuções dos últimos 7 dias.
- **Financeiro**: card de saldo mostra Saldo, Reservado para metas e Disponível (quando há
  reserva); `MoneyCard` da semana mostra Disponível.
- **Assinante**: campo de recebimento; detalhe mostra cobranças a receber com Confirmar.
- **Ferramenta**: interruptor "Considerar pago automaticamente"; linha mostra "A pagar".
- **Meta**: "Este dinheiro está no meu saldo" + "Guardar todo mês" (dia, Calculado/Valor
  fixo, valor deste mês).

## Dados e sincronização

- `DB_VERSION` 7 → 8; `tests/db-version.test.ts` (32 coleções → 8).
- Migração `supabase/migrations/20261012000000_automacoes.sql`: só adiciona
  `automationRuns` à lista de `records.collection`. Nenhuma outra.
- Campos novos opcionais (JSON dos registros e das configurações): nada de SQL.

## Testes

- Unitários por automação: fim de mês/âncora, ano bissexto, mensal/anual/única,
  recuperar atraso, `since`, status que não geram, moeda sem cotação, confirm vs autoPaid,
  meta calculada após mês pulado, saldo insuficiente, parada (atingida/prazo/arquivada).
- Regra geral: nenhum `plan` cria entrada/saída em modo confirm/desligado.
- Reservado/Disponível: só `inBalance`, só ativas, conversão sem regravar, sem cotação.
- `isPaidTool` com Teste.
- Projeto → cliente: estados manuais preservados.
- Idempotência; desfazer exato e com edição posterior.
- Dois aparelhos com o mock de sincronização: sem duplicatas.
- RLS (PGlite): `automationRuns` aceita; demais continuam.
- e2e: "Feito pelo Núcleo" — pendência confirmada vira entrada; desfazer remove.
