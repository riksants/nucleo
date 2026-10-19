# Automações — Parte 2.1 (regras)

Data: 2026-10-19 · Branch: `feature/regras-2-1` · Aprovado pelo usuário (desenho + ajustes de 2026-10-19)

Tudo é opcional e compatível com a 2.0: regras e execuções antigas são lidas e rodam como antes.
Sem migration (campos novos só no JSON de `rules` e `automationRuns`).

1. **Assistente cria regras** (`core/assistant/ruleSentence.ts` lê a frase em rascunho; `ruleReply.ts`
   pergunta o que falta — meta não dita/ambígua/inexistente, moeda, título — e mostra a prévia
   QUANDO/SE/FAÇA). Só "Confirmar e criar regra" grava, pelo mesmo `ruleRecord` do editor
   (`core/rules/build.ts`) e a mesma validação (`ruleProblem`). Leitor determinístico; a IA opcional
   não cria regras.
2. **Testar esta regra** (`core/rules/simulate.ts`): só leitura, cópia em memória. Gatilhos sem
   histórico (mudança de status de projeto/cliente) → "Não há histórico suficiente para simular este
   gatilho."; "projeto concluído" é aproximado (data de conclusão); reservas marcadas "estimativa".
3. **Tentar de novo** (`core/rules/retry.ts`): só a ação não feita, só por motivo que pode mudar
   (sem cotação, sem disponível, meta fora do saldo), só com a definição gravada na execução; cada
   tentativa tem id fixo e fica no histórico; logado, só com a sincronização ociosa e nada pendente
   (na dúvida, bloqueia e diz por quê).
4. **Valores em qualquer moeda**: `compare: 'base'` na condição de valor (opcional). Converte para a
   moeda gravada na condição com as cotações do Financeiro; a execução grava moeda/valor originais,
   moeda/valor convertidos, cotação e momento. Sem cotação → a regra não roda e registra o motivo.
5. **Desfazer só uma ação**: registros marcados com o índice da ação; mesmas proteções do desfazer
   tudo. Execuções da 2.0 só oferecem desfazer tudo.
6. **Cadeias** (`chain: true`, desligada por padrão, aviso ao ligar): só eventos do que a própria
   execução gravou; máx. 3 regras por cadeia; nenhuma regra repetida (sem A→A, A→B→A); nenhuma chave
   de evento repetida; máx. 20 execuções por gravação; limite diário mantido; cadeia registrada.
7. **Sugestões novas**: tarefa após receber de projeto/venda; valor fixo reservado após um tipo de
   entrada; nota após concluir projeto; mesma tarefa no mesmo dia da semana (4 semanas seguidas);
   mesma tarefa perto do mesmo dia do mês (3 meses). Mesmas regras: nunca cria nem ativa sozinho.
