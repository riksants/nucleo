/**
 * PARTE 13: contrato do pipeline de deploy (.github/workflows/deploy.yml + package.json). Garante que nada
 * vai a produção sem npm ci, lint, testes, TypeScript (via build) e build — e que deploy depende de build,
 * que depende dos testes. Falha se alguém enfraquecer o gate (ex.: remover `needs: test`). Lê só o repo.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const yml = readFileSync('.github/workflows/deploy.yml', 'utf8').replace(/\r\n/g, '\n')

/** Recorta o bloco de um job pelo nome (indentação de 2 espaços), até o próximo job do mesmo nível. */
function job(name: string): string {
  const m = yml.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z_]+:\\n|$)`))
  return m ? m[1] : ''
}

const test = job('test')
const build = job('build')
const e2e = job('e2e')
const deploy = job('deploy')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

describe('PARTE 13: o pipeline bloqueia o deploy sem as etapas críticas', () => {
  it('os quatro jobs existem (test, build, e2e, deploy)', () => {
    expect(test).not.toBe('')
    expect(build).not.toBe('')
    expect(e2e).not.toBe('')
    expect(deploy).not.toBe('')
  })

  it('o job de testes roda npm ci, lint e os testes', () => {
    expect(test).toMatch(/run:\s*npm ci/)
    expect(test).toMatch(/run:\s*npm run lint/)
    expect(test).toMatch(/run:\s*npm test\b/)
  })

  it('o build roda `npm run build` e só depois dos testes (needs: test)', () => {
    expect(build).toMatch(/run:\s*npm run build/)
    expect(build).toMatch(/needs:\s*test/)
  })

  it('o gate E2E crítico roda build:e2e-cloud + e2e:critical e depende dos testes', () => {
    expect(e2e).toMatch(/needs:\s*test/)
    expect(e2e).toMatch(/run:\s*npm run build:e2e-cloud/)
    expect(e2e).toMatch(/run:\s*npm run e2e:critical/)
    // o runner e o script existem
    expect(pkg.scripts['e2e:critical']).toMatch(/run-critical\.mjs/)
  })

  it('o deploy depende de TODOS os gates: build E e2e (não publica se qualquer um falhar)', () => {
    const needs = (deploy.match(/needs:\s*(.+)/)?.[1] ?? '').trim()
    expect(needs).toMatch(/build/)
    expect(needs).toMatch(/e2e/)
    // precisa ser a forma de lista [build, e2e] — um `needs: build` sozinho não cobriria o e2e
    expect(needs).toMatch(/\[.*\]/)
  })

  it('`npm run build` executa o TypeScript (tsc) antes do Vite — tsc é obrigatório no gate', () => {
    expect(pkg.scripts.build).toMatch(/tsc\b[^&]*&&[^&]*vite build/)
  })
})
