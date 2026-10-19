# Automações — Parte 2.0: regras "quando X → se Y → faça Z"

Data: 2026-10-19 · Branch: `feature/regras` · Status: aprovado pelo usuário (desenho de 2026-10-18)

## Objetivo

A pessoa cria regras próprias ("Quando eu receber pagamento de projeto, se o valor for maior que
€500, reservar 20% para Impostos e criar a tarefa Separar documentos fiscais"), parte de modelos
prontos e recebe sugestões baseadas no que já faz. Reaproveita a Parte 1: `automationRuns`,
"Feito pelo Núcleo", desfazer, sincronização, ids fixos.

Regras que não mudam:
- **O Núcleo pode automatizar ações, mas nunca inventar fatos.** Nenhuma regra cria entrada ou
  saída, marca pagamento, altera valor de movimentação ou exclui registro. Reservar não é saída.
- Nenhuma regra pronta vem ligada. Nenhuma sugestão vira regra sem confirmação.
- Se o motor de regras falhar, a ação que a pessoa estava fazendo é gravada mesmo assim.
- Tudo o que uma regra faz aparece em "Feito pelo Núcleo".
- Offline-first; sem duplicidade entre aparelhos.
- **O que uma regra faz nunca dispara outra regra (nem ela mesma).**

Fora de escopo (2.1 ou depois): Assistente criando regras, modo teste/simulação, "tentar de novo",
condição de valor em qualquer moeda, desfazer ação isolada, cadeias de regras, Parte 3.

## Modelo

Coleção nova `rules` (`Rule extends Entity`):

```ts
interface Rule extends Entity {
  name: string
  on: boolean
  since: string            // "YYYY-MM-DD": dia em que foi ligada (religar = hoje)
  order: number            // posição em "Minhas regras" (menor = primeiro)
  trigger: RuleTrigger     // { kind, day?, weekdays? }
  conditions: RuleCondition[]  // todas verdadeiras (AND); OR = vários valores na mesma condição
  actions: RuleAction[]    // 1 a 5, em ordem
  template?: string
  paused?: { at: string; reason: string }  // pausada por segurança
}
```

"Última vez" e "quantas vezes" são calculados das execuções (nada de contador gravado).

### Gatilhos

| kind | Texto | Evento base |
|---|---|---|
| moneyIn / moneyOut | Entrar / sair dinheiro | movimentação nova `in`/`out` (ajuste não conta) |
| projectPayment | Receber pagamento de projeto | moneyIn com origem projeto |
| salePayment | Receber pagamento de venda | moneyIn com origem venda (`sale`/`saleGeneral`) |
| subscriberPaid | Um assinante pagar | moneyIn com origem assinante |
| toolPaid | Uma assinatura/ferramenta ser paga | moneyOut com origem ferramenta |
| saleCreated | Registrar uma venda | venda nova |
| projectCreated | Criar um projeto | projeto novo |
| projectStatus | Projeto mudar de status | status antes ≠ depois |
| projectDone | Concluir um projeto | status passou a `done` |
| taskCreated | Criar uma tarefa | tarefa nova (exceto `fromRoutine`) |
| taskDone | Concluir uma tarefa | status passou a `done` |
| taskOverdue | Uma tarefa atrasar | (por data) tarefa aberta, prazo passou |
| clientCreated / clientStatus | Cliente novo / mudar de status | diferença antes→depois |
| goalSaved | Meta receber reserva | `saved` aumentou |
| goalReached | Meta ser atingida | `saved` passou de < meta para ≥ meta |
| monthDay | Todo dia X do mês | (por data) 29–31 → último dia dos meses curtos |
| weekDay | Toda semana nos dias… | (por data) |

### Condições (opcionais, todas verdadeiras)

`amount` (maior/menor/entre, **com moeda**: só combina com eventos na mesma moeda), `currency`,
`category`, `origin` (manual, projeto, venda, assinante, ferramenta), `client`, `project`,
`text` (contém, sem acento/maiúscula), `status` (novo), `statusBefore`, `priority`, `goal`,
`weekday`. A tela só oferece as que fazem sentido para o gatilho (`catalog.ts`).

### Ações

| kind | Regras |
|---|---|
| reserveFixed | valor na moeda da meta; meta ativa e "no meu saldo"; limitado ao que falta e ao Disponível |
| reservePercent | só em gatilhos de dinheiro entrando; X% do valor do evento (arredonda para baixo), convertido para a moeda da meta pela cotação atual; sem cotação → não feita |
| createTask | título com marcadores `{cliente}` `{projeto}` `{valor}` `{tarefa}` `{venda}`; prazo: sem data ou daqui N dias (a partir da data do evento); pode ligar ao projeto do evento |
| projectStatus / clientStatus | só o projeto/cliente do evento, para o status escolhido; projeto passa pela automação projeto→cliente da Parte 1 |
| setCategory | só se a movimentação não tiver categoria e o tipo combinar |
| createNote | título + texto com marcadores |
| addInbox | texto com marcadores |

Gatilhos por data não aceitam reservas (dois aparelhos não convergiriam numa soma; para isso
existe "Guardar todo mês").

## Motor

### Eventos

Duas entradas, um motor (`src/core/rules/`):

1. **Na gravação.** `save` e `commit` do store recebem o autor: `person` (padrão), `assistant`,
   `automation` (Parte 1 e entradas automáticas de pagamento), `rule`, `undo`.
   Para `person`/`assistant`/`automation`, `detectEvents(antes, ops)` compara cada `put` com o
   registro anterior. As ações das regras que combinam são acrescentadas **à mesma gravação**.
   `rule` e `undo` nunca geram eventos. Mudanças vindas de outro aparelho, backup e migração
   não passam por `save`/`commit`: não geram eventos.
2. **Por data.** `planScheduledRules` roda junto com a Parte 1 (`useAutomations`, sincronização
   ociosa): `monthDay`/`weekDay` e `taskOverdue`. Só a ocorrência mais recente executa; as
   anteriores (desde `since`, até 31 dias, no máximo 5) ficam como "não rodou: o app não foi
   aberto nesse dia". `taskOverdue` só vale para tarefas cujo atraso começou com a regra ligada
   (prazo ≥ `since` − 1 dia), uma vez por tarefa e prazo.

Chaves estáveis do evento: `tx:<id>`, `sale:<id>`, `project:<id>`, `pstatus:<id>:<para>:<ms>`,
`task:<id>`, `taskdone:<id>:<completedAt>`, `overdue:<id>:<prazo>`, `client:<id>`,
`cstatus:<id>:<para>:<ms>`, `gsave:<id>:<ms>`, `greach:<id>:<meta>`, `day:<data>`.

Evento de dinheiro só vale se a data da movimentação ≥ `since` da regra (pagamento antigo cuja
entrada só foi criada agora, por falta de cotação, não dispara).

### Execução

- Regras ligadas, não pausadas, em ordem (`order`, depois `createdAt`).
- Condições avaliadas sobre o evento como aconteceu (antes de qualquer regra agir).
- Ações aplicadas em sequência sobre uma cópia de trabalho compartilhada (a de cima reserva
  primeiro do Disponível). Cada ação: feita, ou não feita com motivo; uma falha não impede as
  outras. Nenhuma ação feita → execução `skipped` com os motivos.
- Id da execução: `rule-<ruleId>-<hash16(chave)>`; itens criados `<runId>-<n>`. Execução já
  existente (qualquer status) nunca é refeita.
- Limite: 30 execuções por regra por dia; passou → a regra é desligada com
  `paused` ("Pausada por segurança: rodou 30 vezes hoje") e uma execução registra isso.
- Erro inesperado do motor: a gravação da pessoa segue sem as regras; uma execução
  `skipped` "As regras não conseguiram rodar nesta ação" é registrada (best effort).

### Execuções (`AutomationRun`)

`automation: 'rule'` + campos opcionais: `rule: { id, name }`, `cause: { key, label, txId? }`,
`actions: { text, ok }[]`. `created[]` ganha `fp?` (impressão do registro como a regra o criou);
`changed[]` ganha `delta?` (reserva). Resumo: "Regra “Separe para impostos”: reservou €240 para
Impostos · criou a tarefa “Separar documentos fiscais”".

### Desfazer

Num único `commit` com autor `undo`:
- reservas: tira o `delta` daquela ação (nunca abaixo de 0);
- tarefa/nota/Inbox criados: removidos só se ainda iguais ao `fp`; senão ficam (aviso);
- status/categoria: voltam só se ainda tiverem o valor que a regra gravou;
- execução → `undone`.
Cascata: desfazer uma execução da Parte 1 cuja entrada causou execuções de regra oferece
desfazê-las juntas. Se a movimentação que causou a regra foi apagada, a linha avisa.

### Parte 1

As automações prontas continuam iguais. O executor grava com autor `automation`; a entrada
automática de pagamento (`useReceiptReconciler`) também. "A receber"/"A pagar" não é dinheiro:
não dispara. Projeto → cliente roda antes das regras (dentro de `saveProject`). O editor avisa
quando a regra repete uma automação pronta ligada.

### Moedas

Condição de valor guarda moeda e só combina com a mesma moeda ("Esta regra só olha valores em
euro"). Percentual sobre o valor na moeda do evento; meta em outra moeda → conversão pela
cotação atual; sem cotação → ação não feita. O histórico mostra a conta.

### Dois aparelhos / offline

Evento nasce no aparelho onde a pessoa agiu; a execução sobe junto (mesma gravação, mesma fila).
Outro aparelho recebe pronto. Por data: mesmo id e mesmo conteúdo nos dois aparelhos → converge.

## Sugestões

Calculadas na hora (últimos 90 dias), nunca gravadas; o que a pessoa responde vai em
`Settings.ruleSuggestions` (`InsightMark`, poda de 200). Uma de cada vez. Nunca quando já existe
regra equivalente. Botões: Criar regra (abre o editor preenchido, desligado até salvar) /
Agora não (30 dias) / Não sugerir isso novamente. "Por quê?" lista as ocorrências reais.

1. **Reserva após recebimento**: meta X recebeu (até 2 dias depois, mesma moeda) ≈p% de entradas
   da mesma origem; ≥ 4 ocorrências dentro de ±3 pontos, ≥ 75% das entradas daquela origem no
   período, espalhadas por ≥ 21 dias, a última há ≤ 45 dias. Reservas feitas por automação/regra
   não contam.
2. **Tarefa após concluir projeto**: tarefa do mesmo projeto criada até 3 dias após `endDate`;
   ≥ 3 de pelo menos 75% dos projetos concluídos no período; última há ≤ 45 dias.
3. **Tarefa após venda**: tarefa cujo título cita o comprador ou o produto, criada até 3 dias
   após a venda; mesmos limites.
4. **Despesa repetida**: mesma descrição, mesma moeda, valor ±5%, dia do mês ±2, 3 meses seguidos,
   sem assinatura ativa com esse nome → **"Cadastrar como conta fixa"** (cria a assinatura em
   Assinaturas após confirmação; a Parte 1 passa a gerar "A pagar"). Nunca cria despesa.
5. **Categoria por descrição**: ≥ 4 movimentações com a mesma descrição e a mesma categoria →
   regra "aplicar categoria quando a descrição contiver…".

## Interface

- **Minhas regras** (`/rules`), a partir de "Feito pelo Núcleo" e Configurações: sugestão no
  topo; cartões com nome, interruptor, frase-resumo, "Última vez · N vezes · Ver histórico";
  menu: Editar, Duplicar, Subir, Descer, Excluir. Vazio: modelos prontos.
- **Editor** (folha): QUANDO / SE / FAÇA com partes tocáveis em linguagem humana; "Em resumo"
  ao vivo; avisos (moeda, meta fora do saldo, automação pronta que já faz isso).
  "Salvar e ligar" / "Salvar desligada".
- **Modelos** (nenhum ligado): Separe para impostos · Guarde parte do que recebe · Peça avaliação ·
  Acompanhe o cliente · Organize atrasos (Inbox "Reagendar: {tarefa}") · Envie o recibo ·
  Cliente novo · Fechamento do mês.
- **Feito pelo Núcleo**: execuções de regra com as ações (✓/✕ + motivo), link para a regra,
  filtro `?rule=<id>`, Desfazer.
- **Início**: a sugestão do topo (uma), quando houver.

## Dados

- `DB_VERSION` 8 → 9 (33 coleções). Migração `20261019000000_regras.sql`: só acrescenta `rules`
  à lista de `records.collection`. RLS inalterado (vale para toda coleção de `records`).

## Testes

Unitários: detecção de cada gatilho; condições (moeda!); cada ação e seus motivos de falha;
ordem; idempotência; loop (ação de regra não gera evento); limite diário; gatilhos por data e
"não rodou"; desfazer (fp, delta, valor posterior preservado); cascata; sugestões (limiares,
fracas não aparecem, dispensadas não voltam); store: falha do motor não bloqueia a gravação.
Sincronização com mock: dois aparelhos sem duplicata. RLS: `rules` aceita. e2e: criar regra
a partir de modelo, registrar pagamento, ver execução, desfazer.
