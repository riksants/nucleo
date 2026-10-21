# Automações — Parte 3: importação de extratos + categoria automática

Data: 2026-10-21 · Branch: `feature/importacao-extratos` · Decisões tomadas sem pausa (pedido do usuário), sempre pela
opção mais segura, simples, compatível com offline/sync, que preserva dados e evita duplicidade.

## Arquitetura (sem migration)

- **Nenhuma coleção nova.** Cada importação é um registro em `automationRuns` (`automation: 'bankImport'`, id
  `import-<uuid>`, campo `bankImport` com arquivo, conta, modelo e contagens). Aparece em "Feito pelo Núcleo" (resumo + "Ver
  importação") e na tela **Importações** (`/imports`), que é onde se desfaz.
- **Movimentações** ganham o campo opcional `bank` (`BankRef`): importId, dia, data e descrição originais, memo, FITID,
  conta, modelo, `autoCategory` (categoria aplicada pelo Núcleo), `reconciled` + `line` (conciliação), `fp` (como foi
  gravada — editar depois muda e o desfazer preserva).
- **Modelos de CSV** em `settings.importTemplates` (sincroniza por chave, como as outras configurações).
- `MoneyOrigin` ganhou `'import'` (regras podem filtrar "importada de extrato"); regras antigas sem condição de origem
  respondem às entradas importadas como a qualquer entrada.
- Sem DB_VERSION nova, sem SQL. RLS: as mesmas linhas de `records` (teste novo em `rls.test.ts`).

## Fluxo

Financeiro → "Importar extrato" (`/import`): escolher arquivo → leitura no aparelho (`core/import/decode.ts`: UTF-8 /
Windows-1252 / UTF-16, recusa PDF/Excel/imagem/QIF com mensagem humana) → CSV (`csv.ts`: separador , ; tab |, cabeçalho
pt/es/en depois de linhas de preâmbulo, débito/crédito, coluna D/C, decimal por coluna, ordem de data por coluna, linhas
de saldo ignoradas) ou OFX (`ofx.ts`: SGML e XML, FITID, NAME/MEMO, CURDEF, conta mascarada) → tela de colunas quando
algo não é seguro (com leitura ao vivo das primeiras linhas e "Salvar como modelo") → prévia → confirmação → **uma**
gravação (`commit`, uma transação no aparelho, entra junto na fila de sync).

## Prévia (`analyze.ts`)

Ordem de força: (1) mesmo FITID/id de linha → Duplicada; (2) mesmo dia+valor+moeda+descrição normalizada de linha já
importada, contando cada existente uma vez (cafés iguais no mesmo dia continuam dois) → Duplicada (outra conta →
Possível); (3) parecida (mesmo valor, ≤1 dia com texto parecido ou ≤3 dias mesmo estabelecimento) → Possível duplicada;
(4) conciliação com o que o Núcleo já tem (pagamento de projeto/venda, assinante, ferramenta, lançada à mão): mesmo
valor, moeda e direção; **automática só com texto compatível, ≤3 dias e candidato único nos dois sentidos**; senão
Precisa revisar com "Parece corresponder a…"; (5) anterior ao início do Núcleo → Precisa revisar (o saldo inicial já
conta); (6) Nova. Tudo que é incerto fica de fora por padrão até a pessoa decidir.

Ids fixos: `bank-<hash16(conta|FITID)>` ou `bank-<hash16(conta|dia|valor|moeda|descrição|ocorrência)>` — o mesmo arquivo
(no mesmo ou em outro aparelho) gera os mesmos ids; a gravação confere de novo no momento de gravar.

## Categoria (`categorize.ts`)

1) regras da Parte 2 com "Aplicar categoria" (a importação aplica e essas regras não rodam de novo); 2) aprendizado
derivado das movimentações (nada guardado): só escolhas da pessoa contam — categoria deixada como o Núcleo aplicou não
reforça a si mesma; 1 escolha = dica (não aplicada), ≥2 consistentes e ≥75 % = aplicada; conflito reduz; escolha da
pessoa vence nome conhecido; 3) nomes conhecidos (Mercadona, Uber, Netflix…). Normalização em `normalize.ts`
(estabelecimento: "CARREFOUR 1234 DUBAI" = "POS CARREFOUR" = carrefour). Prévia: corrigir linha, selecionar várias /
buscar e aplicar em lote, aceitar todas as sugestões.

## Regras, desfazer, desempenho

- Movimentações **criadas** disparam as regras na mesma gravação (limite por gravação = 3× as linhas; limite diário por
  regra mantido; regras só rodam para datas desde que foram ligadas). Conciliada é atualização → não dispara. Duplicada
  não é gravada → não dispara.
- Desfazer (`undo.ts`): remove só as criadas por aquela importação e ainda como gravadas (`fp`); desfaz junto o que
  regras fizeram por causa delas; conciliadas só perdem o vínculo; registra o que foi mantido e por quê. Logado, só com a
  sincronização em dia.
- `applyOps` (store + regras) passou a aplicar uma gravação grande em uma passada por coleção (mesmo resultado).
  Medido: 5.000 linhas → análise ~350 ms, gravação ~230 ms (Node); prévia mostra 100 por vez.
