# Rollback de emergência — Núcleo (Parte 16)

Runbook curto para quando um deploy quebra a produção (hellonucleo.app). Objetivo: voltar rápido para a
última versão comprovadamente boa, **sem** montar comandos e **sem** mexer no banco.

> Regra de ouro: **rollback aqui é só do frontend.** O banco (Supabase) **nunca** é revertido
> automaticamente. Migrations não são desfeitas. Veja "Quando NÃO fazer rollback" antes de agir.

---

## 1. Como perceber que um deploy quebrou

- O **smoke test** roda sozinho depois de todo deploy (workflow **Deploy** → job `smoke`). Se ele ficar
  **vermelho**, a produção está quebrada (não responde, assets faltando, white screen ou erro de init).
- Sintomas manuais: hellonucleo.app abre em branco, erro no console ao carregar, ou 404 nos assets.
- Sentry (se ligado) mostra um pico de erros novos logo após o deploy, no release = SHA recém-publicado.

## 2. Como executar o rollback (o caminho simples)

1. GitHub → aba **Actions** → workflow **Rollback** → **Run workflow**.
2. Branch: **main** (é o único que o workflow aceita).
3. Campos:
   - **sha**: deixe **vazio** para voltar automaticamente ao *último deploy anterior que deu certo*.
     Ou cole um **SHA específico** (precisa pertencer ao histórico da main).
   - **reason**: um motivo curto (aparece no resumo do run).
4. **Run workflow**. Pronto. O workflow faz sozinho: resolve o alvo → valida que o SHA é da main →
   build com a mesma configuração segura → publica no GitHub Pages → roda o smoke test.

Não é preciso digitar comando nenhum.

## 3. Como identificar a versão restaurada

No run do **Rollback**, abra o **Summary**. Ele registra claramente:

- **SHA que saiu** (o que estava em produção);
- **SHA que entrou** (o publicado agora);
- origem do alvo (input manual ou "último deploy bom" automático) e o motivo.

O **release do Sentry** do site restaurado passa a ser exatamente o **SHA que entrou** (o build usa
`VITE_RELEASE = SHA alvo`), então o monitoramento não fica apontando para a versão errada. Os source maps
correspondem a esse mesmo SHA.

## 4. Como validar o site depois

- O job `smoke` do próprio rollback precisa ficar **verde**: ele confirma que hellonucleo.app responde,
  HTML + assets carregam, o app monta (sem white screen) e não há exceção não capturada. Tudo isso **sem
  login e sem tocar em dados de nenhum usuário**.
- Confirme manualmente: abra hellonucleo.app, veja se carrega normal e entre com uma **conta de teste
  descartável** (nunca dados reais) se quiser exercitar um fluxo.
- Se o smoke do rollback falhar, o problema não era (só) a versão: investigue produção/infra antes de
  seguir tentando versões.

## 5. Quando **NÃO** fazer rollback por causa do banco

O frontend fala com o banco atual de produção, que pode ter migrations novas. O schema do Núcleo é um
**key-value genérico** (`records` com `collection` + `data jsonb`) e as migrations são quase todas
**expand** (ampliam as coleções permitidas), o que torna o rollback de frontend seguro na grande maioria
dos casos — nenhuma coluna lida pelo app é removida ou renomeada.

**A única fonte de perigo** são migrations que adicionam **CHECKs de formato** sobre o `data`
(ex.: `records_money_shape`, de 2026-11-07 / main `75c2d3f`, e `records_accounts_secret_shape`). Elas
**rejeitam gravações no formato antigo**. Isso cria um **"piso de rollback"**:

- ✅ **Pode** voltar para qualquer deploy **posterior** a `75c2d3f` (todos já gravam no formato novo).
- ⛔ **Não** volte para um frontend **anterior** a `75c2d3f`: o banco atual rejeitaria transações no
  formato velho e o app quebraria ao salvar dinheiro.

Como o alvo padrão é sempre o *último deploy anterior* (recente), ele está **acima** desse piso — seguro.
Só há risco se você forçar um SHA antigo manualmente. Na dúvida, prefira **corrigir e avançar** (seção 7)
a voltar para trás do piso.

> **Nunca** rode `supabase db reset`, `down migrations` ou qualquer downgrade de schema em produção para
> acompanhar um rollback de frontend. Reverter dados/estrutura é operação manual, separada e arriscada —
> não faz parte deste procedimento.

## 6. Regra para migrations futuras (manter o rollback seguro)

Toda migration deve ser **backward-compatible durante a janela de rollback** (pelo menos alguns deploys),
usando **expand/contract**:

1. **Expand**: adicione o novo (coluna/coleção/índice) de forma opcional e compatível; o frontend antigo
   continua funcionando. CHECKs de formato novos devem ser **tolerantes** ou só aplicados a dados novos.
2. **Migrate**: faça o frontend novo passar a usar/preencher o novo formato. Deixe rodar.
3. **Contract**: só **depois** que nenhum frontend em janela de rollback dependa do formato antigo,
   remova/aperte o que ficou para trás — numa migration separada.

Nunca faça, numa migration que entra junto com um frontend novo: `DROP COLUMN`/`RENAME COLUMN` de algo
lido pelo app, estreitar tipo, ou um CHECK de formato que rejeite o que o frontend anterior grava, se o
rollback para esse frontend ainda precisa ser possível.

## 7. Como voltar depois para a versão corrigida

Rollback é paliativo. Para retomar o caminho normal:

1. Corrija o bug numa branch, com teste cobrindo a regressão.
2. Merge na **main** → o workflow **Deploy** publica normalmente (com todos os gates + smoke).
3. Confirme o `smoke` verde. A produção volta a seguir a main, e o Sentry passa a apontar para o SHA novo.

Não é preciso "desfazer" o rollback: o próximo deploy da main simplesmente passa por cima com a versão
corrigida.

---

### Resumo de 10 segundos

| Situação | Ação |
|---|---|
| Deploy quebrou agora | Actions → **Rollback** → Run workflow → **sha vazio** → Run |
| Quero um SHA específico | Mesmo caminho, cole o SHA (tem que ser da main) |
| Qual versão entrou? | Summary do run (SHA saiu → SHA entrou) |
| Site OK? | Job `smoke` verde + abrir hellonucleo.app |
| Banco? | **Não se mexe.** Não volte antes de `75c2d3f` (piso de formato) |
| Depois | Corrige na main → Deploy normal passa por cima |
