/**
 * PARTE 13: regressão de segredos (reforça a PARTE 5). Garante que nenhum segredo real fica no código-fonte
 * do cliente e que só variáveis de ambiente PÚBLICAS entram no bundle (o Vite expõe tudo que começa com
 * VITE_). Falha se alguém colar uma chave privada/token ou referenciar uma env não-pública. Lê só o repo.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|mjs|cjs|json|html)$/.test(e.name)) out.push(p)
  }
  return out
}

const SRC = walk('src')
const read = (f: string) => readFileSync(f, 'utf8')

// O que o cliente pode ler do ambiente. Tudo aqui é público por natureza (URL, chave anon protegida por
// RLS, chave pública VAPID, site key do Turnstile, flags). Nenhum segredo de servidor entra nesta lista.
const PUBLIC_ENV = new Set([
  'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_NUCLEO_IA',
  'VITE_PLANNER_AI', 'VITE_VAPID_PUBLIC_KEY', 'VITE_TURNSTILE_SITE_KEY',
])

describe('PARTE 13: nenhum segredo real no código do cliente', () => {
  it('não há chave privada / token hardcoded em src', () => {
    const patterns: Array<[string, RegExp]> = [
      ['PEM private key', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
      ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{16,}/],
      ['age secret key', /AGE-SECRET-KEY-1[0-9A-Z]{20,}/],
      ['JWT literal (service/anon key colada no código)', /["'`]eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}["'`]/],
    ]
    const hits: string[] = []
    for (const f of SRC) {
      const t = read(f)
      for (const [name, re] of patterns) if (re.test(t)) hits.push(`${name} em ${f}`)
    }
    expect(hits).toEqual([])
  })

  it('só variáveis de ambiente públicas (allowlist) são lidas no código do cliente', () => {
    const used = new Set<string>()
    for (const f of SRC) for (const m of read(f).matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) used.add(m[1])
    const notAllowed = [...used].filter((v) => !PUBLIC_ENV.has(v))
    expect(notAllowed).toEqual([]) // uma env nova não-pública entraria no bundle: precisa de revisão
    expect(used.size).toBeGreaterThan(0) // sanidade: o scanner realmente encontrou as envs
  })

  it('nenhum segredo de servidor é atribuído a um valor literal em src', () => {
    // Os NOMES podem aparecer em comentários (ex.: "service_role nunca vai ao front"); o proibido é um VALOR.
    const assign = /(SERVICE_ROLE_KEY|ANTHROPIC_API_KEY|VAPID_PRIVATE_KEY|IA_TURN_SECRET|DISPATCH_SECRET)\s*[:=]\s*["'`][^"'`\s]{12,}["'`]/
    const hits = SRC.filter((f) => assign.test(read(f)))
    expect(hits).toEqual([])
  })
})
