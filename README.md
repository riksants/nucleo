# Núcleo

Painel pessoal (PWA) para dinheiro, projetos, clientes, tarefas, ferramentas, contas e anotações.

```bash
npm install
npm run dev       # desenvolvimento
npm run build     # gera dist/ (com service worker e manifest)
npm run preview   # serve o build em http://localhost:4173
```

## Estrutura

- `src/data/` — tipos, `repository.ts` (IndexedDB, trocável por um backend), `store.tsx` (estado + ações), `selectors.ts` (cálculos: saldo, metas, gastos)
- `src/lib/` — dinheiro (valores em centavos), câmbio, datas, backup, preferências (localStorage)
- `src/ui/` — design system: botões, sheets, campos, toasts, confirmação
- `src/features/` — uma pasta por seção do app
- `src/app/` — rotas (hash), navegação (bottom nav no celular, sidebar no desktop)

## Câmbio

Cotação de `open.er-api.com` (reserva: `fawazahmed0/currency-api`), atualizada a cada 6 h, salva localmente e usada offline. Taxas manuais em Configurações.

## Instalar no iPhone

O app precisa estar publicado em HTTPS (ex.: GitHub Pages, Netlify, Vercel). Abra no Safari → Compartilhar → Adicionar à Tela de Início.
