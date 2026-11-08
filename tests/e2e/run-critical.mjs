// PARTE 13: runner dos E2E CRÍTICOS — as jornadas de autenticação/segurança, contra o mock local do
// Supabase (tests/e2e/mock-supabase.mjs). Nunca toca produção, nunca manda e-mail, nunca gasta com serviço
// externo. Roda cada suíte sequencialmente (estável e com pouca RAM) e sai != 0 se qualquer uma falhar —
// é o que o job de CI usa para bloquear o deploy. Cada suíte sobe e derruba o próprio mock + preview.
import { spawnSync } from 'node:child_process'

// Seleção mínima e de alto valor (cobre as 6 jornadas críticas da PARTE 13):
const CRITICAL = [
  'auth-sessions.e2e.mjs', // login, senha errada, sessão persistente, logout, "sair de todos", 2 abas, reabrir
  'account-switch.e2e.mjs', // criar conta, conta A → B sem misturar dados, persistência
  'password-recovery.e2e.mjs', // recuperação por código → nova senha (senha antiga para de valer)
  'delete-account.e2e.mjs', // excluir conta (confirma senha), dados somem do servidor e do aparelho, conta B intacta
  'session-cleanup.e2e.mjs', // "Sair"/token revogado/sessão expirada: nada vaza; rota privada sem sessão
]

// Pausa síncrona (libera as portas 4318/54399 entre suítes; o preview usa --strictPort).
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

let failed = 0
for (const file of CRITICAL) {
  console.log(`\n=== E2E crítico: ${file} ===`)
  const res = spawnSync(process.execPath, [`tests/e2e/${file}`], { stdio: 'inherit', env: process.env })
  if (res.status !== 0) {
    failed++
    console.log(`FALHOU: ${file} (exit ${res.status ?? res.signal})`)
  }
  pause(2500)
}

console.log(`\nE2E crítico: ${CRITICAL.length - failed}/${CRITICAL.length} suítes ok`)
process.exit(failed ? 1 : 0)
