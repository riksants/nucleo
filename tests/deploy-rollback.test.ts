/**
 * PARTE 16: contrato do deploy protegido e do rollback. Falha se alguém enfraquecer as proteções —
 * publicar fora da main, cancelar deploy no meio, remover o smoke, aceitar SHA fora da história da main,
 * apontar o release do Sentry para o commit errado, ou fazer o rollback mexer no banco. Lê só o repo.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const deploy = read('.github/workflows/deploy.yml')
const rollback = read('.github/workflows/rollback.yml')
const smoke = read('scripts/deploy/smoke.mjs')
const lkg = read('scripts/deploy/last-known-good.mjs')

describe('deploy protegido: só a main publica, com todos os gates antes', () => {
  it('produção só a partir da main (push + guarda contra dispatch de feature branch)', () => {
    expect(deploy).toMatch(/push:\n\s*branches:\s*\[main\]/)
    // A guarda de ref aparece em todos os jobs (test, build, e2e, deploy, smoke).
    const guards = deploy.match(/github\.ref == 'refs\/heads\/main'/g) || []
    expect(guards.length).toBeGreaterThanOrEqual(5)
  })
  it('deploy só depois de install, lint, testes, build (tsc) e E2E crítico', () => {
    expect(deploy).toMatch(/npm ci/)
    expect(deploy).toMatch(/npm run lint/)
    expect(deploy).toMatch(/npm test/)
    expect(deploy).toMatch(/npm run build\b/)
    expect(deploy).toMatch(/e2e:critical/)
    // O job de publicação depende de build E e2e.
    expect(deploy).toMatch(/deploy:\n\s*needs:\s*\[build, e2e\]/)
  })
  it('impede deploys concorrentes e NÃO cancela um em andamento', () => {
    expect(deploy).toMatch(/concurrency:\n\s*group:\s*pages\n\s*cancel-in-progress:\s*false/)
  })
  it('permissões mínimas: contents:read no topo; só o deploy escreve no Pages', () => {
    expect(deploy).toMatch(/^permissions:\n\s*contents:\s*read/m)
    expect(deploy).toMatch(/pages:\s*write/)
    expect(deploy).toMatch(/id-token:\s*write/)
  })
  it('usa o environment do GitHub Pages', () => {
    expect(deploy).toMatch(/environment:\n\s*name:\s*github-pages/)
  })
})

describe('verificação pós-deploy: smoke test real', () => {
  it('o deploy roda o smoke depois de publicar', () => {
    expect(deploy).toMatch(/smoke:\n\s*needs:\s*deploy/)
    expect(deploy).toMatch(/node scripts\/deploy\/smoke\.mjs/)
  })
  it('o smoke carrega a página de verdade, sem login e sem tocar dados', () => {
    expect(smoke).toMatch(/hellonucleo\.app/)
    expect(smoke).toMatch(/#root/) // white screen = #root vazio
    expect(smoke).toMatch(/Núcleo/) // título
    // Não autentica nem escreve nada: não deve chamar login/fill/click de formulário.
    expect(smoke).not.toMatch(/\.fill\(|\.click\(|signIn|signUp|password/i)
  })
})

describe('last-known-good: descobre a última versão boa sem anotação manual', () => {
  it('usa o histórico de deployments do github-pages e resolve um alvo', () => {
    expect(lkg).toMatch(/environment=github-pages|github-pages/)
    expect(lkg).toMatch(/deployments/)
    expect(lkg).toMatch(/TARGET=/)
    expect(lkg).toMatch(/CURRENT=/)
  })
})

describe('rollback: manual, seguro, só commits da main, sem mexer no banco', () => {
  it('é manual (workflow_dispatch) com SHA opcional e motivo', () => {
    expect(rollback).toMatch(/on:\n\s*workflow_dispatch:/)
    expect(rollback).toMatch(/inputs:/)
    expect(rollback).toMatch(/sha:/)
    expect(rollback).toMatch(/reason:/)
  })
  it('só roda a partir da main', () => {
    expect(rollback).toMatch(/github\.ref == 'refs\/heads\/main'/)
  })
  it('por padrão volta ao último deploy bom; aceita SHA específico', () => {
    expect(rollback).toMatch(/last-known-good\.mjs/)
    expect(rollback).toMatch(/INPUT_SHA/)
  })
  it('PROVA que o SHA pertence à história da main antes de publicar (anti-branch maliciosa)', () => {
    expect(rollback).toMatch(/merge-base --is-ancestor/)
    expect(rollback).toMatch(/rev-parse --verify/)
    expect(rollback).toMatch(/ref:\s*\$\{\{\s*needs\.resolve\.outputs\.target\s*\}\}/)
  })
  it('o release do Sentry é o SHA realmente publicado (não o HEAD da main)', () => {
    expect(rollback).toMatch(/VITE_RELEASE:\s*\$\{\{\s*needs\.resolve\.outputs\.target\s*\}\}/)
  })
  it('compartilha a trava do deploy (group: pages) e não cancela em andamento', () => {
    expect(rollback).toMatch(/concurrency:\n\s*group:\s*pages\n\s*cancel-in-progress:\s*false/)
  })
  it('registra claramente qual SHA saiu e qual entrou', () => {
    expect(rollback).toMatch(/SHA que saiu/)
    expect(rollback).toMatch(/SHA que entrou/)
  })
  it('NÃO faz downgrade de banco/migrations automaticamente', () => {
    expect(rollback).not.toMatch(/migration|db push|db reset|psql|supabase db/i)
    expect(rollback).toMatch(/não.*(tocad|alterad)/i) // declara explicitamente que o banco não é tocado
  })
  it('roda o smoke depois do rollback', () => {
    expect(rollback).toMatch(/smoke:\n\s*needs:\s*deploy/)
    expect(rollback).toMatch(/node scripts\/deploy\/smoke\.mjs/)
  })
  it('permissões mínimas e nenhum secret novo (reusa GITHUB_TOKEN e o do Sentry)', () => {
    expect(rollback).toMatch(/^permissions:\n\s*contents:\s*read/m)
    const secretsUsed = [...rollback.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1])
    for (const s of secretsUsed) expect(['GITHUB_TOKEN', 'SENTRY_AUTH_TOKEN']).toContain(s)
  })
})
