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
const deploy = job('deploy')

describe('PARTE 13: o pipeline bloqueia o deploy sem as etapas críticas', () => {
  it('os três jobs existem (test, build, deploy)', () => {
    expect(test).not.toBe('')
    expect(build).not.toBe('')
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

  it('o deploy só ocorre depois do build (needs: build) — nada publica se testes/build falharem', () => {
    expect(deploy).toMatch(/needs:\s*build/)
  })

  it('`npm run build` executa o TypeScript (tsc) antes do Vite — tsc é obrigatório no gate', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts.build).toMatch(/tsc\b[^&]*&&[^&]*vite build/)
  })
})
