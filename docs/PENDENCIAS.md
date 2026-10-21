# Pendências

## e2e de sincronização falhando (anterior à 2.1)

Registrado em 2026-10-21, na publicação da Parte 2.1. Não bloqueia publicação; corrigir depois.

Falham igualmente no `main` antes da 2.1 (`d7ff739`) e com a 2.1 — não são causados pelas regras:

- `tests/e2e/finance-sync.e2e.mjs` e `tests/e2e/assistant-sync.e2e.mjs`: `click: not found Entrar ou criar conta`
  (o botão de entrada não é encontrado no fluxo do teste).
- `tests/e2e/regression-account-sync.e2e.mjs`: `SecurityError` ao acessar o IndexedDB.

`receipts-sync` passa (11/11). Provável causa: o teste (seletor/fluxo de entrada ou origem do IndexedDB), não o app —
a confirmar.
