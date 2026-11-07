/**
 * PARTE 11 — PoC do advisory CVE-2026-93753 / GHSA-gcqx-w48m-w2h4 ("deepmerge mergeObject()
 * allows prototype poisoning of returned objects") e prova da correção vendorizada.
 *
 * `deepmerge` entra no Núcleo só em tempo de build (vite-plugin-pwa → workbox-build →
 * @rollup/plugin-node-resolve → deepmerge). Não há release corrigida upstream, então
 * mantemos uma cópia do código oficial 4.3.1 com um único guard em getKeys() — ver
 * vendor/deepmerge/PATCH.md. Este teste roda com `npm ci` (reprodutível) e prova:
 *   1. a implementação ORIGINAL 4.3.1 é vulnerável ao PoC;
 *   2. a cópia VENDORIZADA (a que o build realmente usa) não é;
 *   3. o comportamento normal de merge continua idêntico ao 4.3.1.
 */
import { describe, expect, it, afterEach } from 'vitest'
// A cópia vendorizada é exatamente o arquivo que o resolver do workbox carrega.
import vendored from '../vendor/deepmerge/dist/cjs.js'

// ---------------------------------------------------------------------------------------
// Reprodução fiel do mergeObject/getKeys ORIGINAL do deepmerge 4.3.1 (SEM o guard), para
// demonstrar que o PoC realmente reproduz o comportamento reportado. É o mesmo algoritmo
// do pacote oficial; a ÚNICA diferença para a cópia vendorizada é o filtro de __proto__.
// ---------------------------------------------------------------------------------------
function isMergeableObject(value: any): boolean {
  if (!value || typeof value !== 'object') return false
  const s = Object.prototype.toString.call(value)
  return s !== '[object RegExp]' && s !== '[object Date]'
}
function emptyTarget(val: any) { return Array.isArray(val) ? [] : {} }
function cloneUnless(value: any, opts: any) {
  return opts.isMergeableObject(value) ? originalDeepmerge(emptyTarget(value), value, opts) : value
}
function getKeysOriginal(target: any): (string | symbol)[] {
  return (Object.keys(target) as (string | symbol)[]).concat(
    Object.getOwnPropertySymbols(target).filter((s) => Object.propertyIsEnumerable.call(target, s)),
  )
}
function propertyIsOnObject(object: any, property: any) { try { return property in object } catch { return false } }
function propertyIsUnsafe(target: any, key: any) {
  return propertyIsOnObject(target, key) &&
    !(Object.hasOwnProperty.call(target, key) && Object.propertyIsEnumerable.call(target, key))
}
function mergeObjectOriginal(target: any, source: any, opts: any) {
  const destination: any = {}
  if (opts.isMergeableObject(target)) getKeysOriginal(target).forEach((k) => { destination[k] = cloneUnless(target[k], opts) })
  getKeysOriginal(source).forEach((k) => {
    if (propertyIsUnsafe(target, k)) return
    if (propertyIsOnObject(target, k) && opts.isMergeableObject(source[k])) destination[k] = originalDeepmerge(target[k], source[k], opts)
    else destination[k] = cloneUnless(source[k], opts)
  })
  return destination
}
function originalDeepmerge(target: any, source: any, opts: any = {}): any {
  opts.isMergeableObject = opts.isMergeableObject || isMergeableObject
  const sa = Array.isArray(source), ta = Array.isArray(target)
  if (sa !== ta) return cloneUnless(source, opts)
  if (sa) return target.concat(source).map((e: any) => cloneUnless(e, opts))
  return mergeObjectOriginal(target, source, opts)
}

// PoC do advisory: um source com __proto__ PRÓPRIO e enumerável (como JSON.parse produz)
// e um target de protótipo nulo, que escapa do guard propertyIsUnsafe.
const pocPayload = () => JSON.parse('{"' + '__proto__' + '":{"polluted":"yes"}}')

describe('CVE-2026-93753: PoC de prototype poisoning no deepmerge', () => {
  afterEach(() => {
    // segurança do próprio teste: garantir que nada vazou para o Object.prototype global
    delete (Object.prototype as any).polluted
    expect(({} as any).polluted).toBeUndefined()
  })

  it('ANTES (implementação oficial 4.3.1): o PoC É reproduzível — o objeto retornado é envenenado', () => {
    const out = originalDeepmerge(Object.create(null), pocPayload())
    // o protótipo do objeto retornado foi trocado pelo payload do atacante
    expect((out as any).polluted).toBe('yes')
    expect(Object.getPrototypeOf(out)).not.toBe(Object.prototype)
    expect((Object.getPrototypeOf(out) as any).polluted).toBe('yes')
  })

  it('DEPOIS (cópia vendorizada corrigida): o PoC NÃO reproduz — nada é envenenado', () => {
    const out = vendored(Object.create(null), pocPayload())
    expect((out as any).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
  })

  it('DEPOIS: o vetor também não passa por merge aninhado/recursivo', () => {
    const out: any = vendored({ a: Object.create(null) }, { a: pocPayload(), b: 1 })
    expect(out.b).toBe(1)
    expect(out.a.polluted).toBeUndefined()
    expect(Object.getPrototypeOf(out.a)).toBe(Object.prototype)
  })

  it('DEPOIS: __proto__ próprio num target comum também é ignorado (não vira protótipo)', () => {
    const out: any = vendored({}, pocPayload())
    expect(out.polluted).toBeUndefined()
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
  })
})

describe('a correção não muda o comportamento normal do deepmerge 4.3.1', () => {
  it('merge aninhado simples', () => {
    const r = vendored({ a: { x: 1 }, keep: true }, { a: { y: 2 } })
    expect(r).toEqual({ a: { x: 1, y: 2 }, keep: true })
  })

  it('arrays são concatenados (padrão)', () => {
    expect(vendored({ list: [1] }, { list: [2, 3] })).toEqual({ list: [1, 2, 3] })
  })

  it('símbolos próprios enumeráveis são preservados', () => {
    const s = Symbol('k')
    const r = vendored({}, { [s]: 'v' }) as any
    expect(r[s]).toBe('v')
  })

  it('chaves "constructor"/"prototype" são tratadas exatamente como no 4.3.1 (só __proto__ muda)', () => {
    // No 4.3.1, "constructor"/"prototype" vindas do source sobre um target {} comum são puladas
    // por propertyIsUnsafe (estão na cadeia de protótipo). Provamos PARIDADE com o original — a
    // correção não alterou esse comportamento; ela só filtra __proto__.
    const src = { constructor: 'c', prototype: 'p', normal: 1 }
    expect(vendored({}, { ...src })).toEqual(originalDeepmerge({}, { ...src }))
    // e nada de poluição: o objeto retornado mantém o protótipo normal
    const r = vendored({}, { ...src }) as any
    expect(r.normal).toBe(1)
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype)
  })

  it('customMerge e clone:false continuam funcionando', () => {
    // customMerge só dispara quando ambos os valores da chave são objetos mescláveis
    const r = vendored(
      { n: { a: 1 } },
      { n: { a: 10 } },
      { customMerge: (key: string) => (key === 'n' ? (x: any, y: any) => ({ a: x.a + y.a }) : undefined) },
    ) as any
    expect(r.n).toEqual({ a: 11 })
    const shared = { ref: true }
    const r2 = vendored({}, { shared }, { clone: false }) as any
    expect(r2.shared).toBe(shared)
  })

  it('deepmerge.all funciona', () => {
    expect((vendored as any).all([{ a: 1 }, { b: 2 }, { c: 3 }])).toEqual({ a: 1, b: 2, c: 3 })
  })

  it('paridade com o 4.3.1 oficial para dados seguros (mesma saída)', () => {
    const cases: Array<[any, any]> = [
      [{ a: 1, deep: { x: [1] } }, { b: 2, deep: { y: 2, x: [2] } }],
      [{ only: 'target' }, {}],
      [{}, { only: 'source', nested: { k: 'v' } }],
    ]
    for (const [t, s] of cases) {
      expect(vendored(structuredClone(t), structuredClone(s))).toEqual(
        originalDeepmerge(structuredClone(t), structuredClone(s)),
      )
    }
  })
})

// ---------------------------------------------------------------------------------------
// Correspondência com o fix UPSTREAM (commits TehShrike/deepmerge d0256cd / c5ad573):
// "Drop __proto__ keys regardless of the target's shape". O upstream adiciona
// propertyIsForbidden(key) => key === '__proto__' e o aplica NOS DOIS laços de mergeObject.
// Nosso patch filtra __proto__ no getKeys() compartilhado (que alimenta os dois laços) — ou
// seja, bloqueia exatamente a mesma chave, nos mesmos dois laços. Este bloco reproduz o
// algoritmo upstream fielmente e prova que a SAÍDA é idêntica à da cópia vendorizada.
// ---------------------------------------------------------------------------------------
function propertyIsForbidden(key: any) { return key === '__proto__' }
function cloneUnlessUp(value: any, opts: any): any {
  return opts.isMergeableObject(value) ? upstreamDeepmerge(emptyTarget(value), value, opts) : value
}
function mergeObjectUpstream(target: any, source: any, opts: any) {
  const destination: any = {}
  if (opts.isMergeableObject(target)) getKeysOriginal(target).forEach((k) => {
    if (propertyIsForbidden(k)) return // guard adicionado pelo upstream no laço do target
    destination[k] = cloneUnlessUp(target[k], opts)
  })
  getKeysOriginal(source).forEach((k) => {
    if (propertyIsForbidden(k) || propertyIsUnsafe(target, k)) return // guard upstream no laço do source
    if (propertyIsOnObject(target, k) && opts.isMergeableObject(source[k])) destination[k] = upstreamDeepmerge(target[k], source[k], opts)
    else destination[k] = cloneUnlessUp(source[k], opts)
  })
  return destination
}
function upstreamDeepmerge(target: any, source: any, opts: any = {}): any {
  opts.isMergeableObject = opts.isMergeableObject || isMergeableObject
  const sa = Array.isArray(source), ta = Array.isArray(target)
  if (sa !== ta) return cloneUnlessUp(source, opts)
  if (sa) return target.concat(source).map((e: any) => cloneUnlessUp(e, opts))
  return mergeObjectUpstream(target, source, opts)
}

describe('o patch corresponde ao fix upstream (d0256cd / c5ad573) para o vetor __proto__', () => {
  afterEach(() => { delete (Object.prototype as any).polluted; expect(({} as any).polluted).toBeUndefined() })

  // Vetores do próprio teste upstream (test/prototype-poisoning.js do commit) + casos normais.
  const vectors: Array<[string, () => [any, any]]> = [
    ['target de protótipo nulo', () => [Object.create(null), pocPayload()]],
    ['target {} comum', () => [{}, pocPayload()]],
    ['__proto__ aninhado (merge recursivo)', () => [{ a: Object.create(null) }, { a: pocPayload(), b: 1 }]],
    ['__proto__ dentro de elemento de array', () => [{ list: [{}] }, { list: [pocPayload()] }]],
    ['__proto__ próprio no target', () => [JSON.parse('{"' + '__proto__' + '":{"t":1},"keep":1}'), { s: 2 }]],
    ['merge normal aninhado', () => [{ a: { x: 1 }, keep: true }, { a: { y: 2 } }]],
    ['arrays', () => [{ list: [1] }, { list: [2, 3] }]],
    ['chaves constructor/prototype', () => [{}, { constructor: 'c', prototype: 'p', n: 1 }]],
  ]

  for (const [name, make] of vectors) {
    it(`saída idêntica ao upstream: ${name}`, () => {
      const [t1, s1] = make()
      const [t2, s2] = make()
      const ours = vendored(t1, s1)
      const up = upstreamDeepmerge(t2, s2)
      // mesma saída estrutural
      expect(ours).toEqual(up)
      // e, nos vetores de ataque, nenhum dos dois envenena o protótipo do retorno
      expect(Object.getPrototypeOf(ours)).toBe(Object.getPrototypeOf(up))
      expect((ours as any).polluted).toBe((up as any).polluted) // ambos undefined nos PoCs
    })
  }

  it('bloqueia a mesma chave que o upstream: só __proto__ é "forbidden"', () => {
    // o predicado upstream (propertyIsForbidden) e o nosso filtro usam o mesmo critério literal
    expect(['__proto__', 'constructor', 'prototype', 'x'].filter(propertyIsForbidden)).toEqual(['__proto__'])
  })
})
