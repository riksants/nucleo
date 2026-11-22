// PARTE 16 — descobre, sem anotação manual, qual commit é o último deploy comprovadamente saudável.
//
// Usa o histórico de deployments do ambiente github-pages (API do GitHub). Define:
//   current = SHA do deployment mais recente (o que está "saindo", seja ele são ou quebrado);
//   target  = SHA do deployment anterior (mais recente primeiro) que JÁ foi publicado com sucesso e
//             tem SHA diferente do current — o "último anterior que deu certo".
// O Pages rebaixa o deploy anterior para 'inactive' quando um novo entra; por isso olhamos se ALGUM
// status do deployment foi 'success' (um que falhou nunca teve), não apenas o estado atual.
//
// Saída: imprime JSON e, em CI, escreve current/target em $GITHUB_OUTPUT.
// Env: GITHUB_TOKEN (leitura), GITHUB_REPOSITORY (owner/repo). Não cria nada, não exige token novo.
import { appendFileSync } from 'node:fs'

const API = 'https://api.github.com'

/** Resolve current/target usando um `gh(path)` injetável (facilita teste). Lazy: para ao achar o alvo. */
export async function resolveLastKnownGood(gh, repo) {
  const deployments = await gh(`/repos/${repo}/deployments?environment=github-pages&per_page=30`)
  if (!Array.isArray(deployments) || deployments.length === 0) throw new Error('nenhum deployment do github-pages encontrado')

  const everSuccess = async (d) => {
    const statuses = await gh(`/repos/${repo}/deployments/${d.id}/statuses?per_page=20`)
    return { state: statuses[0]?.state || 'unknown', ok: statuses.some((s) => s.state === 'success') }
  }

  const head = deployments[0]
  const cur = await everSuccess(head)
  const current = { sha: head.sha, ref: head.ref, created_at: head.created_at, ...cur }
  const log = [`  ${current.created_at}  ${current.sha.slice(0, 7)}  ${current.ref}  [${current.state}]${current.ok ? ' ✓bom' : ''}  (atual)`]

  let target = null
  for (let i = 1; i < deployments.length; i++) {
    const d = deployments[i]
    const st = await everSuccess(d)
    log.push(`  ${d.created_at}  ${d.sha.slice(0, 7)}  ${d.ref}  [${st.state}]${st.ok ? ' ✓bom' : ''}`)
    if (st.ok && d.sha !== current.sha) {
      target = { sha: d.sha, created_at: d.created_at }
      break
    }
  }

  return {
    log,
    current: current.sha,
    current_state: current.state,
    target: target?.sha || '',
    target_created_at: target?.created_at || '',
  }
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || 'riksants/nucleo'
  const token = process.env.GITHUB_TOKEN || ''
  const gh = async (path) => {
    const res = await fetch(`${API}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'nucleo-rollback',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status} ${await res.text()}`)
    return res.json()
  }

  const out = await resolveLastKnownGood(gh, repo)
  console.log('Histórico github-pages (novo → antigo):')
  for (const line of out.log) console.log(line)
  console.log('\nResolvido:', JSON.stringify({ current: out.current, current_state: out.current_state, target: out.target, target_created_at: out.target_created_at }, null, 2))
  if (!out.target) console.log('(aviso) não há um deploy de sucesso anterior diferente do atual; só serve rollback com SHA explícito.')

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `current=${out.current}\ntarget=${out.target}\n`)
  }
  console.log(`CURRENT=${out.current}`)
  console.log(`TARGET=${out.target}`)
}

// Só roda o CLI quando executado diretamente (não quando importado por um teste).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('last-known-good.mjs')) {
  main().catch((e) => {
    console.error('last-known-good falhou:', e.message)
    process.exit(1)
  })
}
