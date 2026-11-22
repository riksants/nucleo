/**
 * PARTE 16 — lógica do last-known-good (sem rede). Reproduz o comportamento real do GitHub Pages:
 * só o deploy ATUAL fica 'success'; o anterior (que foi bom) vira 'inactive'. O resolvedor precisa
 * mesmo assim achar o anterior bom, pular SHAs iguais, e devolver vazio quando não há anterior.
 */
import { describe, expect, it } from 'vitest'
import { resolveLastKnownGood } from '../scripts/deploy/last-known-good.mjs'

type Dep = { id: number; sha: string; ref: string; created_at: string; states: string[] }

// Monta um `gh(path)` falso a partir de uma lista de deployments (novo → antigo).
function fakeGh(deps: Dep[]) {
  return async (path: string) => {
    if (path.includes('/deployments?')) {
      return deps.map(({ id, sha, ref, created_at }) => ({ id, sha, ref, created_at }))
    }
    const m = path.match(/\/deployments\/(\d+)\/statuses/)
    if (m) {
      const d = deps.find((x) => x.id === Number(m[1]))!
      // A API devolve o status mais novo primeiro.
      return d.states.map((state) => ({ state }))
    }
    throw new Error('rota não simulada: ' + path)
  }
}

const dep = (id: number, sha: string, states: string[], created_at = `2026-11-${id}T00:00:00Z`): Dep => ({ id, sha, ref: 'main', created_at, states })

describe('resolveLastKnownGood', () => {
  it('acha o deploy anterior que foi bom, mesmo agora marcado inactive (caso real do Pages)', async () => {
    const gh = fakeGh([dep(22, 'c2dcab9', ['success']), dep(9, 'e661fac', ['inactive', 'success']), dep(8, '4f9a260', ['inactive', 'success'])])
    const out = await resolveLastKnownGood(gh, 'riksants/nucleo')
    expect(out.current).toBe('c2dcab9')
    expect(out.target).toBe('e661fac')
  })

  it('se o deploy atual falhou, volta para o último que deu certo (≠ do atual)', async () => {
    const gh = fakeGh([dep(23, 'badsha0', ['failure']), dep(22, 'c2dcab9', ['inactive', 'success'])])
    const out = await resolveLastKnownGood(gh, 'riksants/nucleo')
    expect(out.current).toBe('badsha0')
    expect(out.current_state).toBe('failure')
    expect(out.target).toBe('c2dcab9')
  })

  it('pula um deploy anterior que tem o MESMO SHA do atual', async () => {
    const gh = fakeGh([dep(24, 'c2dcab9', ['success']), dep(22, 'c2dcab9', ['inactive', 'success']), dep(9, 'e661fac', ['inactive', 'success'])])
    const out = await resolveLastKnownGood(gh, 'riksants/nucleo')
    expect(out.target).toBe('e661fac')
  })

  it('nunca escolhe um deploy que só falhou', async () => {
    const gh = fakeGh([dep(25, 'cur0000', ['success']), dep(24, 'fail000', ['failure', 'error']), dep(9, 'e661fac', ['inactive', 'success'])])
    const out = await resolveLastKnownGood(gh, 'riksants/nucleo')
    expect(out.target).toBe('e661fac')
  })

  it('devolve target vazio quando não há deploy anterior bom', async () => {
    const gh = fakeGh([dep(22, 'c2dcab9', ['success'])])
    const out = await resolveLastKnownGood(gh, 'riksants/nucleo')
    expect(out.current).toBe('c2dcab9')
    expect(out.target).toBe('')
  })
})
