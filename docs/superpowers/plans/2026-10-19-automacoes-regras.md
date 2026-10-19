# Automações Parte 2.0 (Regras) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regras "quando X → se Y → faça Z" com editor, modelos, sugestões, travas de loop/duplicidade e desfazer, sobre o motor da Parte 1.

**Architecture:** Funções puras em `src/core/rules/` detectam eventos comparando antes/depois de cada gravação (`save`/`commit` do store, com autor) e planejam as ações como `BatchOp[]` acrescentadas à mesma gravação; gatilhos por data rodam no executor da Parte 1. Execuções vão para `automationRuns` (`automation: 'rule'`). Regras na coleção nova `rules`.

**Tech Stack:** Vite 8, React 19, TypeScript, Tailwind v4, IndexedDB (fake-indexeddb nos testes), vitest, PGlite (RLS), e2e com Edge headless via CDP.

**Spec:** `docs/superpowers/specs/2026-10-19-automacoes-regras-design.md`

## Global Constraints

- "O Núcleo pode automatizar ações, mas nunca inventar fatos": nenhuma ação cria `transactions`, marca pagamento ou remove registros da pessoa.
- Ação de regra nunca gera evento (autor `rule`); desfazer também não (autor `undo`).
- Falha do motor nunca bloqueia a gravação da pessoa.
- Nenhuma regra pronta ligada; nenhuma sugestão vira regra sem confirmação.
- Ids ≤ 100 caracteres; execução `rule-<ruleId>-<hash16>`; criados `<runId>-<n>`.
- Valores em centavos; condição de valor só combina com a mesma moeda; conversão via `Converter` (null = não feita).
- Datas no fuso da pessoa (`todayIn(zoneOf(settings))`, `dayOf`).
- Textos PT-BR, sem nomes técnicos na tela. Repo CRLF. Nada de push/deploy.

## Review Focus

1. Pagamento de projeto em moeda sem cotação: a entrada nasce depois, numa passada `automation` — a regra roda uma vez só, e não roda se a data do pagamento for anterior ao `since`. (Task 3)
2. Regra "tarefa criada → criar tarefa": cria uma única tarefa, sem cascata. (Task 3)
3. Tarefa criada pela regra e depois editada/concluída pela pessoa, e então desfazer → a tarefa fica. (Task 5)
4. Condição "maior que €500" com entrada de R$ 800 → não dispara. (Task 2)
5. Motor lança exceção dentro de `commit` → a gravação da pessoa acontece. (Task 4)

---

### Task 1: Tipos, coleção, versão do banco, migração

**Files:** Modify `src/data/types.ts`, `src/data/repository.ts` (`DB_VERSION = 9`), `src/features/account/MigrationOffer.tsx` (rótulo), `tests/db-version.test.ts` (33 → 9), `tests/rls.test.ts` (`rules` em NEW). Create `supabase/migrations/20261019000000_regras.sql`.

**Produces:** `Rule`, `RuleTrigger`, `RuleTriggerKind`, `RuleCondition`, `RuleAction`, `MoneyOrigin`; `AutomationId` inclui `'rule'`; `AutomationRun.rule?`, `.cause?`, `.actions?`; `created[].fp?`, `changed[].delta?`; `Settings.ruleSuggestions?: Record<string, InsightMark>`.

- [ ] Tipos + `COLLECTION_NAMES` com `'rules'`; migração (ALTER TABLE único, comentado como a da Parte 1)
- [ ] `npx vitest run tests/db-version.test.ts tests/rls.test.ts` → PASS; `npx tsc -b` limpo
- [ ] Commit

### Task 2: Catálogo, condições, marcadores, frase

**Files:** Create `src/core/rules/catalog.ts`, `conditions.ts`, `text.ts` (marcadores + normalização), `sentence.ts`, `hash.ts`. Test `tests/rules-conditions.test.ts`.

**Produces:**
- `TRIGGERS: { kind, label, group, base: EventKind, money?: 'in'|'out', origin?: MoneyOrigin, scheduled?: boolean }[]`, `conditionsFor(kind): ConditionField[]`, `actionsFor(kind): RuleAction['kind'][]`
- `matches(rule: Rule, ev: RuleEvent): boolean` (gatilho + todas as condições)
- `fillTokens(text, ev): string`
- `describeRule(rule, names): { when: string; ifs: string[]; dos: string[]; summary: string }`
- `hash16(s): string` (FNV-1a 64 bits em hex, determinístico)

Testes: valor com moeda (EUR > 500 não combina com BRL 800), entre, categoria múltipla (OR), texto sem acento, origem, status/antes, dia da semana, gatilho atalho (projectPayment só origem projeto), marcadores com item ausente → texto neutro.

### Task 3: Eventos e motor de execução

**Files:** Create `src/core/rules/types.ts` (`RuleEvent`, `WriteActor`, `RuleCtx`), `events.ts`, `actions.ts`, `engine.ts`. Test `tests/rules-engine.test.ts`.

**Interfaces:**
- `detectEvents(before: DataState, ops: BatchOp[], ctx: RuleCtx): RuleEvent[]`
- `planActions(rule, ev, work: DataState, ctx, runId): { ops: BatchOp[]; results: {text, ok}[]; created; changed }`
- `planRulesForWrite(before: DataState, ops: BatchOp[], actor: WriteActor, ctx: RuleCtx): BatchOp[]` (só as ops extras; `[]` para `rule`/`undo`)
- `runRules(events, data, ctx): BatchOp[]` (comum às duas entradas; aplica ordem, dedupe, limite diário, pausa)
- `RuleCtx = { settings, today, convert, now }`

Testes: cada gatilho detectado (criado vs atualizado; status de/para; meta atingida uma vez por alvo; ajuste não conta; `fromRoutine` não conta); `since` (pagamento antigo); ordem e Disponível compartilhado; percentual com conversão e sem cotação; reserva limitada ao que falta; categoria só se vazia; projeto/cliente do evento; projeto → cliente da Parte 1 encadeado na ação; regra desligada/pausada; mesma execução não repete (id conhecido); "tarefa criada → criar tarefa" gera 1; 31ª execução no dia pausa; nenhuma op em `transactions` que não seja `setCategory` (put do mesmo registro, só categoria).

### Task 4: Store com autor e falha isolada

**Files:** Modify `src/data/store.tsx` (`SaveOptions.by` ganha `'automation' | 'rule' | 'undo'`; `commit(ops, opts?)`; rules via `planRulesForWrite` dentro de try/catch; ref do conversor), `src/data/useAutomations.ts` (passa `automation`/`undo`), `src/data/useReceipts.ts` (reconciliador `automation`), `src/core/assistant/proposal.ts`/`useApply.ts` só se necessário (undo do Assistente → `keepMark` = `undo`). Test `tests/rules-store.test.tsx`.

Testes (StoreProvider + repositório IndexedDB falso): salvar tarefa concluída com regra ligada grava tarefa + execução + tarefa nova numa gravação; motor lançando exceção (regra corrompida) → gravação acontece e execução de erro é registrada; `commit(…, { by: 'undo' })` não gera execução.

### Task 5: Por data + desfazer de regras + cascata

**Files:** Create `src/core/rules/schedule.ts`. Modify `src/core/automation/engine.ts` (nada nos toggles), `src/data/useAutomations.ts` (soma `planScheduledRules` na passada; `undo` com autor `undo`; `linkedRuleRuns`), `src/core/automation/undo.ts` (`fp`, `delta`). Test `tests/rules-schedule.test.ts`, `tests/rules-undo.test.ts`.

**Produces:** `planScheduledRules(ctx: AutomationCtx): BatchOp[]`; `linkedRuleRuns(run, runs): AutomationRun[]`; `fingerprint(item): string`.

Testes: dia 31 em fevereiro; só a mais recente roda, anteriores "não rodou" (máx. 5, ≤ 31 dias, ≥ since); semana; atraso uma vez por prazo e só após `since`; reserva proibida em gatilho por data; desfazer remove criados intactos, mantém editados (`partial`), devolve `delta`, preserva status mudado depois; cascata encontra execuções pela `cause.txId`.

### Task 6: Modelos e sugestões

**Files:** Create `src/core/rules/templates.ts`, `src/core/rules/suggestions.ts`. Test `tests/rules-suggestions.test.ts`.

**Produces:** `TEMPLATES: { id, name, text, draft(): RuleDraft, needsGoal: boolean }[]`; `ruleSuggestions(data, settings, today): RuleSuggestion[]` (`{ key, title, why, items: string[], draft?: RuleDraft, fixedExpense?: { name, amount, currency, day } }`); `visibleSuggestion(list, state, today, rules)`.

Testes: 4 reservas ~20% → sugere; 3 → não; percentuais espalhados → não; reservas da automação não contam; projeto concluído + tarefa ≥3/75% → sugere; despesa 3 meses seguidos → conta fixa (não regra); já existe assinatura com o nome → não; dispensada → não volta; adiada → volta após 30 dias; regra equivalente existente → não.

### Task 7: Telas

**Files:** Create `src/features/rules/RulesPage.tsx`, `RuleBuilder.tsx`, `pickers.tsx`, `SuggestionCard.tsx`, `FixedExpenseSheet.tsx`, `useRules.ts`. Modify `src/app/router.ts` + `src/App.tsx` (`/rules`), `src/features/automations/AutomationsPage.tsx` (linhas de regra, filtro, link "Minhas regras", cascata), `src/features/automations/runs.ts`, `src/features/settings/SettingsPage.tsx` (entrada), `src/features/home/HomePage.tsx` (sugestão).

- [ ] `npx tsc -b`, `npm test`, build
- [ ] Commit

### Task 8: Sincronização e e2e

**Files:** Create `tests/rules-sync.test.ts` (mock de sincronização: aparelho A executa regra offline, B baixa e não executa; gatilho por data nos dois → um registro), `tests/e2e/regras.e2e.mjs` (modelo "Envie o recibo" → registrar pagamento de projeto → execução no Feito pelo Núcleo → desfazer remove a tarefa).

- [ ] `npm test` inteiro; build e2e (`NUCLEO_BASE=/nucleo/`, Supabase vazio) + preview 4317 + e2e de regras e de automações (regressão)
- [ ] Commit
