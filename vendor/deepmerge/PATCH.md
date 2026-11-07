# deepmerge 4.3.1 — cópia vendorizada com correção de prototype poisoning

## Por que isto existe

`deepmerge` entra na árvore do Núcleo **apenas em tempo de build**, como dependência
transitiva:

```
vite-plugin-pwa → workbox-build → @rollup/plugin-node-resolve → deepmerge@4.3.1
```

O advisory **CVE-2026-93753 / GHSA-gcqx-w48m-w2h4** ("deepmerge mergeObject() allows
prototype poisoning of returned objects", severidade **Low**, afeta `>=4.2.0 <=4.3.1`)
**não tem release corrigida** publicada no npm, e **não há PR de correção mergeada**
upstream (em 2026-11-07 todos os PRs — #286, #290, #277, #274, #281, #287 — estão
abertos ou fechados sem merge, de autores externos, sem revisão do mantenedor).

Em vez de trocar `vite-plugin-pwa`/`workbox-build` por um pacote de terceiro ou reescrever
o service worker, mantemos uma cópia **mínima, determinística e auditável** do código
**oficial 4.3.1** com uma única correção.

## O que foi alterado (exatamente uma coisa)

Função `getKeys()`, nos três arquivos (`index.js`, `dist/cjs.js`, `dist/umd.js`).

**Antes (oficial 4.3.1):**

```js
function getKeys(target) {
	return Object.keys(target).concat(getEnumerableOwnPropertySymbols(target))
}
```

**Depois (esta cópia):**

```js
function getKeys(target) {
	return Object.keys(target).filter(function (key) {
		return key !== '__proto__'
	}).concat(getEnumerableOwnPropertySymbols(target))
}
```

Nenhuma outra linha de lógica foi tocada (confirmável por `diff` contra o 4.3.1 oficial).

## Por que esta correção fecha o advisory

O vetor do CVE: um objeto `source` com uma propriedade **própria e enumerável**
`__proto__` (produzida, por exemplo, por `JSON.parse('{"__proto__":{...}}')`) escapa do
guard `propertyIsUnsafe` quando o `target` tem protótipo nulo (`Object.create(null)`),
porque `'__proto__' in target` é `false`. O código então executa
`destination['__proto__'] = ...` sobre um objeto comum, trocando o protótipo do objeto
retornado ("prototype poisoning of returned objects").

Filtrar a chave `__proto__` na enumeração (`getKeys`, usada para `target` e `source` em
todos os níveis da recursão) impede que ela seja copiada, fechando o vetor sem afetar o
comportamento normal.

## Por que só `__proto__` (e não `constructor`/`prototype`)

Só `__proto__` atravessa a cadeia de protótipo numa atribuição `obj[key] = value`.
`destination['constructor'] = x` ou `destination['prototype'] = x` criam apenas
propriedades próprias comuns e **não** poluem protótipo. Bloquear `constructor`/`prototype`
quebraria merges legítimos de objetos que tenham essas chaves. Os testes do próprio PR
upstream #286 confirmam que `constructor`, `prototype` e símbolos próprios devem continuar
funcionando — por isso a correção se limita a `__proto__`. A técnica (filtrar `__proto__`
na enumeração de chaves) é a mesma do PR #286; o código aqui é escrito e auditado por nós,
não copiado de fork/PR não revisado.

## Origem exata

- Pacote: **`deepmerge@4.3.1`** (release oficial do npm, por TehShrike), copiado **verbatim**
  (`index.js`, `dist/cjs.js`, `dist/umd.js`, `index.d.ts`, `license.txt`, `readme.md`,
  `changelog.md`). O único arquivo com alteração de lógica é a função `getKeys()`, nos três
  arquivos de código; todo o resto é idêntico ao 4.3.1 (confirmável por `diff`).

## Referência técnica (advisory + commits upstream usados como referência)

- Advisory: https://github.com/advisories/GHSA-gcqx-w48m-w2h4 — **CVE-2026-93753**
- Discussão upstream: https://github.com/TehShrike/deepmerge/issues/285 (e issue #273)
- **Commits upstream do fix, usados como referência de comportamento:**
  - `d0256cd` — "Drop `__proto__` keys regardless of the target's shape"
  - `c5ad573` — mesmo conteúdo (sem o trailer de co-autoria)
  Esses commits adicionam `propertyIsForbidden(key) => key === '__proto__'` e o aplicam
  **nos dois laços** de `mergeObject` (target e source). **Correspondência:** o nosso patch
  filtra `__proto__` no `getKeys()` compartilhado, que alimenta exatamente esses dois laços —
  logo bloqueia a mesma chave, nos mesmos dois pontos, só `__proto__` (nunca
  `constructor`/`prototype`). A **equivalência de saída** com esse algoritmo upstream é
  provada por teste em `tests/deepmerge-proto-patch.test.ts` (bloco "o patch corresponde ao
  fix upstream"), rodado no CI. No momento desta cópia (2026-11-08) nenhum desses commits
  estava mergeado na branch default nem publicado como release — por isso a cópia local.

## Regra de remoção (remover o vendor quando sair uma release oficial corrigida)

Assim que o `deepmerge` publicar no npm uma **versão corrigida** deste advisory (ou o
`@rollup/plugin-node-resolve`/`workbox-build`/`vite-plugin-pwa` deixarem de depender de uma
versão afetada), **remover esta cópia**:

1. apagar a pasta `vendor/deepmerge/`;
2. remover a entrada `"deepmerge"` de `overrides` na raiz `package.json` (ou apontá-la para a
   versão corrigida do registry, se ainda for preciso forçar);
3. remover a exceção de `vendor/deepmerge/dist` no `.gitignore`;
4. `npm install` + `npm ci` limpos e `npm audit` → confirmar 0 e nenhuma cópia afetada na árvore;
5. manter `tests/deepmerge-proto-patch.test.ts` enquanto o `deepmerge` existir na árvore
   (ele passa a validar a versão oficial); só remover o teste junto com a dependência.

## Como está conectado (reproduzível por `git clone` + `npm ci`)

A raiz `package.json` aponta a dependência transitiva para esta pasta:

```json
"overrides": {
  "deepmerge": "file:vendor/deepmerge"
}
```

Não há edição manual de `node_modules`. O `package-lock.json` grava a resolução `file:`,
então qualquer `npm ci` (local ou no GitHub Actions) usa esta cópia corrigida.

## Teste

`tests/deepmerge-proto-patch.test.ts` reproduz o PoC do advisory e prova:
(1) a versão **original** 4.3.1 é vulnerável ao PoC; (2) esta cópia **corrigida** não é;
(3) o comportamento normal de merge (aninhado, arrays, símbolos, chaves `constructor`/
`prototype` próprias, `customMerge`) permanece idêntico ao 4.3.1.
