-- PARTE 6 (validação no servidor): valores em dinheiro dos registros.
--
-- O app guarda cada item como JSON em records.data. Até aqui o banco conferia a coleção, o id, o tamanho
-- e a senha do cofre, mas aceitava qualquer coisa nos valores: um movimento com valor "abc", 1e300 ou um
-- objeto, ou um tipo inventado, chegava aos outros aparelhos e derrubava Início, Finanças, Projetos,
-- Assinaturas, Metas e Vendas ("Algo deu errado" ou NaN no saldo). Só a própria conta escreve nas próprias
-- linhas (RLS), mas um app antigo, um bug ou uma ação automática bastariam para travar a conta.
--
-- Regra (só nas linhas não apagadas; a "lápide" {} de um item apagado continua valendo):
--   - dinheiro (centavos): número inteiro de 0 a 10^13; baseAmount de transactions pode ser negativo;
--   - transactions: type in/out/adjust, moeda ISO de 3 letras, amount e baseAmount obrigatórios;
--   - quantidades de vendas: número de 0 a 1.000.000 (pode ter casas decimais);
--   - listas (pagamentos, itens, parcelas, histórico), quando existem, são listas.
-- Campos opcionais ausentes ou null continuam aceitos. Nenhuma outra coleção muda.
--
-- Dados existentes conferidos em 2026-11-07 (somente leitura, contagens): todos já obedecem.
-- A constraint entra NOT VALID e é validada em seguida: se alguma linha antiga não obedecer, a migração
-- inteira falha sem mudar nada.
--
-- Desfazer: alter table public.records drop constraint if exists records_money_shape;

begin;

set local lock_timeout = '10s';

alter table public.records
  add constraint records_money_shape check (
    deleted or (
      -- movimentações: tipo, moeda e os dois valores obrigatórios (coalesce: um CHECK que dá NULL passaria)
      (collection <> 'transactions' or (
        coalesce(data ->> 'type', '') in ('in', 'out', 'adjust')
        and coalesce(data ->> 'currency', '') ~ '^[A-Z]{3}$'
        and coalesce(jsonb_typeof(data -> 'amount'), '') = 'number'
        and coalesce(jsonb_typeof(data -> 'baseAmount'), '') = 'number'
        and not jsonb_path_exists(data, '$ ? (@.amount < 0 || @.amount.floor() != @.amount || @.amount > 10000000000000)')
        and not jsonb_path_exists(data, '$ ? (@.baseAmount.floor() != @.baseAmount || @.baseAmount.abs() > 10000000000000)')
      ))
      -- listas que o app percorre: quando existem, são listas
      and (collection not in ('projects', 'sales', 'financeGoals') or (
        coalesce(jsonb_typeof(data -> 'payments'), 'array') in ('array', 'null')
        and coalesce(jsonb_typeof(data -> 'items'), 'array') in ('array', 'null')
        and coalesce(jsonb_typeof(data -> 'installments'), 'array') in ('array', 'null')
        and coalesce(jsonb_typeof(data -> 'history'), 'array') in ('array', 'null')
      ))
      -- dinheiro: número inteiro de 0 a 10^13 quando presente; itens das listas são objetos.
      -- O filtro fica no objeto pai e usa .type() (que não desembrulha listas no modo lax: [1] não vale como 1).
      and not coalesce(case collection
        when 'projects' then jsonb_path_exists(data, '$ ? (exists(@.charged) && @.charged.type() != "null" && (@.charged.type() != "number" || @.charged < 0 || @.charged.floor() != @.charged || @.charged > 10000000000000))')
          or jsonb_path_exists(data, '$ ? (exists(@.received) && @.received.type() != "null" && (@.received.type() != "number" || @.received < 0 || @.received.floor() != @.received || @.received > 10000000000000))')
          or jsonb_path_exists(data, '$.payments[*] ? (@.type() != "object")')
          or jsonb_path_exists(data, '$.payments[*] ? (exists(@.amount) && @.amount.type() != "null" && (@.amount.type() != "number" || @.amount < 0 || @.amount.floor() != @.amount || @.amount > 10000000000000))')
        when 'sales' then jsonb_path_exists(data, '$ ? (exists(@.total) && @.total.type() != "null" && (@.total.type() != "number" || @.total < 0 || @.total.floor() != @.total || @.total > 10000000000000))')
          or jsonb_path_exists(data, '$ ? (exists(@.discount) && @.discount.type() != "null" && (@.discount.type() != "number" || @.discount < 0 || @.discount.floor() != @.discount || @.discount > 10000000000000))')
          or jsonb_path_exists(data, '$ ? (exists(@.quantity) && @.quantity.type() != "null" && (@.quantity.type() != "number" || @.quantity < 0 || @.quantity > 1000000))')
          or jsonb_path_exists(data, '$.items[*] ? (@.type() != "object")')
          or jsonb_path_exists(data, '$.items[*] ? (exists(@.price) && @.price.type() != "null" && (@.price.type() != "number" || @.price < 0 || @.price.floor() != @.price || @.price > 10000000000000))')
          or jsonb_path_exists(data, '$.items[*] ? (exists(@.quantity) && @.quantity.type() != "null" && (@.quantity.type() != "number" || @.quantity < 0 || @.quantity > 1000000))')
          or jsonb_path_exists(data, '$.payments[*] ? (@.type() != "object")')
          or jsonb_path_exists(data, '$.payments[*] ? (exists(@.amount) && @.amount.type() != "null" && (@.amount.type() != "number" || @.amount < 0 || @.amount.floor() != @.amount || @.amount > 10000000000000))')
          or jsonb_path_exists(data, '$.installments[*] ? (@.type() != "object")')
          or jsonb_path_exists(data, '$.installments[*] ? (exists(@.amount) && @.amount.type() != "null" && (@.amount.type() != "number" || @.amount < 0 || @.amount.floor() != @.amount || @.amount > 10000000000000))')
        when 'financeGoals' then jsonb_path_exists(data, '$ ? (exists(@.target) && @.target.type() != "null" && (@.target.type() != "number" || @.target < 0 || @.target.floor() != @.target || @.target > 10000000000000))')
          or jsonb_path_exists(data, '$ ? (exists(@.saved) && @.saved.type() != "null" && (@.saved.type() != "number" || @.saved < 0 || @.saved.floor() != @.saved || @.saved > 10000000000000))')
          or jsonb_path_exists(data, '$.history[*] ? (@.type() != "object")')
          or jsonb_path_exists(data, '$.history[*] ? (exists(@.saved) && @.saved.type() != "null" && (@.saved.type() != "number" || @.saved < 0 || @.saved.floor() != @.saved || @.saved > 10000000000000))')
        when 'tools' then jsonb_path_exists(data, '$ ? (exists(@.price) && @.price.type() != "null" && (@.price.type() != "number" || @.price < 0 || @.price.floor() != @.price || @.price > 10000000000000))')
        when 'goals' then jsonb_path_exists(data, '$ ? (exists(@.price) && @.price.type() != "null" && (@.price.type() != "number" || @.price < 0 || @.price.floor() != @.price || @.price > 10000000000000))')
        when 'subPlans' then jsonb_path_exists(data, '$ ? (exists(@.price) && @.price.type() != "null" && (@.price.type() != "number" || @.price < 0 || @.price.floor() != @.price || @.price > 10000000000000))')
        else false
      end, false)
    )
  ) not valid;

alter table public.records validate constraint records_money_shape;

commit;
