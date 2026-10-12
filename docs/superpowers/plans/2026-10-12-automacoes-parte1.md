# Automações Parte 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Motor de automação no aparelho + 4 automações prontas (assinante, ferramenta, projeto→cliente, meta com reserva), tela "Feito pelo Núcleo", Saldo/Reservado/Disponível.

**Architecture:** Funções puras em `src/core/automation/` planejam execuções com id fixo a partir dos dados; um executor React (`useAutomations`) grava o que falta num único `commit` (mesmo padrão de `useReceiptReconciler`). Execuções ficam na coleção `automationRuns` (histórico + memória + pendências). Reservado/Disponível são calculados, nunca gravados.

**Tech Stack:** Vite 8, React 19, TypeScript, Tailwind v4, IndexedDB (fake-indexeddb nos testes), vitest, PGlite (RLS), e2e com Edge headless via CDP.

**Spec:** `docs/superpowers/specs/2026-10-12-automacoes-motor-design.md`

## Global Constraints

- "O Núcleo pode automatizar ações, mas nunca inventar fatos." Nenhuma entrada/saída sem `autoPaid` ou confirmação.
- Reservar para meta nunca cria movimentação no Financeiro.
- Valores em centavos; reserva fica na moeda da meta; conversão só para mostrar/calcular, via `makeConverter` (null = sem cotação → nunca inventar).
- Datas "YYYY-MM-DD" no fuso da pessoa (`todayIn(zoneOf(settings))`).
- Ids fixos ≤ 100 caracteres (restrição da tabela `records`).
- Campos novos opcionais; registros antigos não são reescritos.
- Arquivos do repo são CRLF; textos de interface em PT-BR.
- Nada de push/deploy.

## Review Focus

1. Assinante com `nextCharge` muito antiga quando a automação é ativada → nada antes de `since`; a `nextCharge` não é lançada em massa. (teste na Task 3)
2. Dois aparelhos rodando a mesma passada → mesma execução/pagamento/entrada, sem duplicata. (teste na Task 9)
3. Pessoa edita a `nextCharge` à mão depois da automação e então desfaz → edição dela preservada. (teste na Task 6)
4. Meta em USD sem cotação → não reserva e Disponível avisa, não quebra. (testes nas Tasks 2 e 5)
5. Cliente marcado "Concluído" à mão e projeto reaberto → cliente não muda. (teste na Task 7)

---

### Task 1: Tipos, coleção, versão do banco, migração

**Files:**
- Modify: `src/data/types.ts` (AutomationRun, AutomationId, campos novos, `COLLECTION_NAMES`, `ReceiptSource.kind`, `Settings.automations`, `Payment.chargeRun`)
- Modify: `src/data/repository.ts` (`DB_VERSION = 8`)
- Modify: `src/features/account/MigrationOffer.tsx` (`COLLECTION_LABELS.automationRuns = 'Automações'`)
- Create: `supabase/migrations/20261012000000_automacoes.sql`
- Test: `tests/db-version.test.ts` (tabela `32: 8`), `tests/rls.test.ts` (`automationRuns` aceita)

**Produces:**
```ts
export type AutomationId = 'subscriberCharge' | 'toolCharge' | 'projectClient' | 'goalSave'
export type AutomationRunStatus = 'pending' | 'done' | 'undone' | 'skipped'
export interface AutomationRun extends Entity {
  automation: AutomationId
  date: string                      // dia a que a execução se refere
  summary: string                   // "Núcleo reservou €100 para Meta Viagem"
  detail?: string                   // "Previsto: €200 — reservado: €120 — faltaram €80 por saldo insuficiente."
  origin: { collection: CollectionName; id: string; label: string }
  amount?: Cents
  currency?: Currency
  created: { collection: CollectionName; id: string }[]
  changed: { collection: CollectionName; id: string; field: string; before: unknown; after: unknown }[]
  status: AutomationRunStatus
}
// Subscriber: paymentMode?: 'confirm' | 'autoPaid'; chargeDay?: number
// Payment: chargeRun?: string
// Tool: autoPaid?: boolean; chargeDay?: number
// FinanceGoal: inBalance?: boolean; autoSave?: { day: number; mode: 'calculated' | 'fixed'; amount: Cents; since: string }
// ReceiptSource.kind: + 'subscriber' | 'tool'
// Settings.automations?: Partial<Record<AutomationId, { on: boolean; since: string }>>
```

- [ ] Step 1: atualizar `tests/db-version.test.ts` (`32: 8`) e adicionar `'automationRuns'` à lista NEW do teste de RLS; rodar → falha.
- [ ] Step 2: tipos + `COLLECTION_NAMES` (+`automationRuns` no fim) + `DB_VERSION = 8` + label + migração (lista da Etapa 5 + `'automationRuns'`, com cabeçalho no mesmo estilo).
- [ ] Step 3: `npx vitest run tests/db-version.test.ts tests/rls.test.ts` → PASS.
- [ ] Step 4: commit "Automações: coleção automationRuns, banco v8, migração".

### Task 2: Reservado / Disponível + alinhar "Teste" das ferramentas

**Files:**
- Create: `src/core/reserved.ts`
- Modify: `src/data/selectors.ts` (`isPaidTool` exige `status === 'active'`)
- Test: `tests/automation-reserved.test.ts`

**Produces:**
```ts
export interface ReserveSummary { balance: Cents; reserved: Cents; available: Cents; currency: Currency; missing: Currency[]; hasReserve: boolean }
/** Em `currency` (normalmente a base). Só metas active + inBalance. Sem cotação → fora da soma, em `missing`. */
export function reserveSummary(goals: FinanceGoal[], balanceBase: Cents, base: Currency, convert: Converter): ReserveSummary
```
Testes: só `inBalance` e `active` contam; meta em USD convertida sem alterar `saved`; sem cotação → `missing: ['USD']` e fora da soma; `available = balance − reserved`; `isPaidTool` falso para `trial`.

- [ ] Step 1: testes → falham. Step 2: implementar. Step 3: PASS + suíte de finanças (`tests/finance.test.ts`) continua verde. Step 4: commit.

### Task 3: Planejamento — assinante

**Files:**
- Create: `src/core/automation/types.ts`, `src/core/automation/dates.ts`, `src/core/automation/subscriberCharge.ts`
- Modify: `src/data/receipts.ts` (`subscriberReceipts`, incluída em `allReceipts`; `receiptTxId('subscriber', id)`)
- Test: `tests/automation-subscriber.test.ts`

**Produces:**
```ts
// types.ts
export interface AutomationCtx { data: DataState; settings: Settings; today: string; convert: Converter; now: Date }
export interface ItemPlan { runs: AutomationRun[]; ops: BatchOp[] }   // ops já incluem os puts das runs
export const MAX_RUNS_PER_ITEM = 36
// dates.ts
export function cycleDates(start: string, anchorDay: number, stepMonths: number, since: string, today: string, max: number): { due: string[]; next: string }
// subscriberCharge.ts
export const subscriberRunId = (subscriberId: string, date: string) => `auto-sub-${subscriberId}-${date}`
export function planSubscriberCharges(ctx: AutomationCtx, since: string): ItemPlan[]
export function confirmSubscriberCharge(run: AutomationRun, input: { amount: Cents; date: string }, ctx: AutomationCtx): BatchOp[]
export function declineRun(run: AutomationRun): BatchOp[]   // status 'skipped'
// receipts.ts
export function subscriberReceipts(subscribers: Subscriber[], plans: SubPlan[]): Receipt[]
```
Regras: datas `< since` são puladas sem gerar (e a `nextCharge` só avança quando há execução); confirm → run `pending` + `nextCharge` avançada; autoPaid → pagamento `id = runId`, `finance: true`, `chargeRun`, entrada `rcv-subscriber-<runId>` (categoria `sales`), run `done`; sem cotação no autoPaid → pagamento gravado e entrada criada depois pelo reconciliador (mesma regra de recebimentos). Execução existente (qualquer status) nunca é replanejada.
Testes: confirm não cria transação (regra geral); autoPaid cria 1 pagamento + 1 entrada; 3 meses atrasados → 3 runs com datas certas; âncora 31 → 28/02 → 31/03; anual; trial/paused/cancelled → nada; `nextCharge` 2024 com `since` hoje → nada antes de hoje; idempotente (replanejar com as runs gravadas → vazio); máx. 36.

- [ ] Steps: testes → falham → implementar → PASS → commit.

### Task 4: Planejamento — ferramenta

**Files:**
- Create: `src/core/automation/toolCharge.ts`
- Test: `tests/automation-tool.test.ts`

**Produces:**
```ts
export const toolRunId = (toolId: string, date: string) => `auto-tool-${toolId}-${date}`
export const toolTxId = (runId: string) => `tx-${runId}`
export function planToolCharges(ctx: AutomationCtx, since: string): ItemPlan[]
export function confirmToolCharge(run: AutomationRun, input: { amount: Cents; date: string }, ctx: AutomationCtx): BatchOp[] | null  // null = sem cotação
```
Regras: só `active`, `price > 0`, `nextCharge` válida; `once` gera uma vez, sem avançar; `autoPaid` → saída (categoria `subscriptions`, `source: { kind: 'tool', parentId, paymentId: runId }`) — sem cotação, o item espera (nenhuma run); desligado → run `pending` "A pagar".
Testes: desligado não cria saída; ligado cria saída com `baseAmount` negativo; trial/free/cancelled nada; once só uma vez; mensal avança com âncora; sem cotação no autoPaid → nenhuma run.

- [ ] Steps: testes → falham → implementar → PASS → commit.

### Task 5: Planejamento — meta (reserva)

**Files:**
- Create: `src/core/automation/goalSave.ts`
- Test: `tests/automation-goal.test.ts`

**Produces:**
```ts
export const goalRunId = (goalId: string, month: string) => `auto-goal-${goalId}-${month}`
export function planGoalSaves(ctx: AutomationCtx, since: string): ItemPlan[]
export function changeGoalMonth(run: AutomationRun, newAmount: Cents, ctx: AutomationCtx): BatchOp[] | string   // string = erro ("Maior que o disponível")
```
Regras: dia 29–31 → último dia de mês curto; `calculated` = `ceil(falta / n)`, n = dias de reserva de hoje até o prazo inclusive; `fixed` limitado ao que falta; reserva = min(previsto, Disponível convertido); Disponível vai diminuindo entre metas na mesma passada; 0 → run `skipped` com `detail`; parcial → `detail` "Previsto: … — reservado: … — faltaram … por saldo insuficiente."; para em atingida, prazo passado, arquivada, `inBalance` falso; sem cotação → espera; nunca cria transação.
Testes: cada regra acima; recalcula após mês pulado; meta em USD com cotação reserva em USD.

- [ ] Steps: testes → falham → implementar → PASS → commit.

### Task 6: Motor + desfazer

**Files:**
- Create: `src/core/automation/engine.ts`, `src/core/automation/undo.ts`, `src/core/automation/index.ts`
- Test: `tests/automation-engine.test.ts`

**Produces:**
```ts
export const AUTOMATIONS: { id: AutomationId; title: string; text: string }[]
export function automationSince(settings: Settings, id: AutomationId): string | null   // null = desligada
export function sinceDefaults(settings: Settings, today: string): Settings['automations'] | null  // preenche o que falta; null = nada a gravar
export function planAll(ctx: AutomationCtx): ItemPlan[]   // filtra execuções já gravadas
export function undoRun(run: AutomationRun, data: DataState, nextStatus?: 'undone' | 'skipped'): { ops: BatchOp[]; partial: boolean }
```
Desfazer: remove `created`; volta `changed` só se o valor atual for o `after`; meta subtrai `amount` de `saved` (≥ 0) com `withSaved`; assinante remove o pagamento `run.id`.
Testes: `planAll` duas vezes com o resultado aplicado → segunda vazia; automação desligada → nada; desfazer autoPaid remove pagamento+entrada e volta `nextCharge`; `nextCharge` editada à mão depois → não volta, `partial: true`; meta com "Guardei" manual depois → só o valor da execução sai.

- [ ] Steps: testes → falham → implementar → PASS → commit.

### Task 7: Projeto concluído → cliente

**Files:**
- Create: `src/core/automation/projectClient.ts`
- Modify: `src/data/useReceipts.ts` (`saveProject` aceita projeto novo e inclui as ops), `src/features/projects/ProjectForm.tsx` (projeto novo via `saveProject`)
- Test: `tests/automation-project-client.test.ts`

**Produces:**
```ts
export function projectClientPlan(before: Project | undefined, next: Project, data: DataState, settings: Settings, now: Date): ItemPlan | null
```
Testes: último projeto concluído → cliente `done` + run; outro projeto em andamento → nada; cliente `potential`/`archived` → nada; pausado conta como fechado; reabrir com `done` posto pelo Núcleo → `active`; `done` manual → nada; automação desligada → nada.

- [ ] Steps: testes → falham → implementar → PASS → commit.

### Task 8: Executor + ações no store

**Files:**
- Create: `src/data/useAutomations.ts`
- Modify: `src/App.tsx` (montar `useAutomations()` ao lado de `useReceiptReconciler()`)

**Produces:**
```ts
export function useAutomations(): void   // passada com sync ociosa, ao abrir, a cada minuto se o dia virou, ao voltar visível; serializada
export function useAutomationActions(): {
  confirm(run: AutomationRun, input: { amount: Cents; date: string }): Promise<string | null>  // erro ou null
  decline(run: AutomationRun): Promise<void>
  undo(run: AutomationRun): Promise<{ partial: boolean }>
  changeMonth(run: AutomationRun, amount: Cents): Promise<string | null>
  setEnabled(id: AutomationId, on: boolean): Promise<void>
}
```
- [ ] Step 1: implementar; `npx tsc -b` sem erros. Step 2: commit.

### Task 9: Sincronização entre aparelhos

**Files:** Test: `tests/automation-sync.test.ts` (padrão de `tests/receipts-sync.test.ts`)
Testes: dois aparelhos rodam `planAll` + `batch` com os mesmos dados → servidor tem 1 run, 1 pagamento, 1 entrada; um confirma enquanto outro está offline → convergem.
- [ ] Steps: escrever → rodar → PASS → commit.

### Task 10: Telas

**Files:**
- Create: `src/features/automations/AutomationsPage.tsx` ("Feito pelo Núcleo" + pendências), `src/features/automations/ConfirmChargeSheet.tsx`, `src/features/automations/AutomationSettings.tsx`, `src/features/automations/PendingCharges.tsx`
- Modify: `src/app/router.ts` (`'/automations'`), `src/App.tsx` (rota), `src/features/settings/SettingsPage.tsx` (grupo Automações), `src/features/home/HomePage.tsx` (pendências + últimos 7 dias), `src/features/finance/BalanceCard.tsx` (Reservado/Disponível), `src/features/week/MoneyCard.tsx` (Disponível), `src/features/finance/FinanceGoals.tsx` (inBalance com confirmação + Guardar todo mês), `src/features/subscribers/SubscriberForms.tsx` + `SubscribersPage.tsx` (modo de recebimento, a receber, texto "Recebido de verdade"), `src/features/tools/ToolForm.tsx` + `ToolsPage.tsx` (autoPaid, data p/ única, "A pagar")
- [ ] Step 1: implementar; `npx tsc -b` e `npx oxlint` limpos. Step 2: commit.

### Task 11: e2e + verificação final

**Files:** Create: `tests/e2e/automacoes.e2e.mjs` (padrão de `tests/e2e/receipts.e2e.mjs`)
Fluxo: semear assinante confirm com cobrança vencida + ferramenta autoPaid vencida + meta inBalance com autoSave → abrir app → "Feito pelo Núcleo" mostra saída da ferramenta, reserva da meta e "A receber"; confirmar → entrada aparece no Financeiro; desfazer saída → some do Financeiro; card de saldo mostra Reservado/Disponível.
- [ ] Step 1: `npm run build` (dist-e2e), rodar e2e novo + regressões `receipts`, `finance`, `regression-existing-user`. Step 2: `npx vitest run` completo. Step 3: commit.
