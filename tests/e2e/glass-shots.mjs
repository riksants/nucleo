// Liquid glass — before/after screenshots of the REAL app (local mock server, throwaway data), iPhone size.
//   GLASS_DIST=<build dir> GLASS_TAG=antes|depois node tests/e2e/glass-shots.mjs
// Build: MSYS2_ENV_CONV_EXCL='NUCLEO_BASE' NUCLEO_BASE=/nucleo/ VITE_NUCLEO_IA=on npx vite build --mode e2e-cloud --outDir <dir>
import { spawn } from 'node:child_process'
import { launch } from './cdp.mjs'

const DIST = process.env.GLASS_DIST
const TAG = process.env.GLASS_TAG ?? 'x'
const BASE = 'http://localhost:4319/nucleo/'
const MOCK = 'http://localhost:54399'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const procs = [
  spawn(process.execPath, ['tests/e2e/mock-supabase.mjs'], { stdio: 'ignore' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', DIST, '--port', '4319', '--strictPort'], { stdio: 'ignore', env: { ...process.env, NUCLEO_BASE: '/nucleo/' } }),
]
await sleep(3500)
const B = await launch(9398)
try {
  await B.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
  await B.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await B.goto(BASE)
  for (let i = 0; i < 60 && !/Esqueci minha senha|Entrar ou criar conta/.test(await B.text()); i++) await B.sleep(250)
  if (!(await B.text()).includes('Esqueci minha senha')) await B.click('Entrar ou criar conta')
  await B.click('Criar conta')
  await B.fill('E-mail', `glass${Date.now()}@teste.com`)
  await B.fill('Senha', 'Nucleo-teste-42')
  await B.fill('Repita a senha', 'Nucleo-teste-42')
  await B.click('Criar conta', 'button[type=submit]')
  await B.sleep(800)
  await B.fill('Código do e-mail', '123456')
  await B.click('Confirmar', 'button[type=submit]')
  await B.sleep(2500)
  await B.click('Configurar minha conta')
  await B.click('Continuar')
  await B.click('Continuar')
  await B.click('Entrar')
  await B.sleep(1500)
  const auth = JSON.parse(await B.eval(`localStorage.getItem('nucleo:auth')`))
  const at = new Date().toISOString()
  const row = (collection, id, data) => ({ user_id: auth.user.id, collection, id, data: { id, createdAt: at, updatedAt: at, ...data }, deleted: false, client_updated_at: at })
  const today = at.slice(0, 10)
  const names = ['Mercado', 'Uber', 'Farmácia', 'Restaurante', 'Aluguel', 'Internet', 'Academia', 'Padaria', 'Cinema', 'Livraria', 'Combustível', 'Café', 'Presente', 'Assinatura', 'Feira']
  const seed = [
    ...names.map((n, i) => row('transactions', `t${i}`, { type: i % 5 === 0 ? 'in' : 'out', amount: 2000 + i * 1370, currency: 'BRL', baseAmount: (i % 5 === 0 ? 1 : -1) * (2000 + i * 1370), reason: n, category: i % 5 === 0 ? 'salary' : ['food', 'transport', 'health', 'food', 'housing'][i % 5] })),
    ...names.map((n, i) => row('tasks', `k${i}`, { title: `${n}: resolver pendência ${i + 1}`, projectId: null, dueDate: today, priority: i % 3 === 0 ? 'high' : 'none', status: 'todo', completedAt: null })),
  ]
  await fetch(MOCK + '/rest/v1/records', { method: 'POST', headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(seed) })
  for (const theme of ['dark', 'light']) {
    for (const [name, route, scroll] of [['financeiro', '#/finance', 900], ['tarefas', '#/tasks', 0], ['assistente', '#/assistant', 0]]) {
      await B.goto(`${BASE}?r=${Date.now()}${route}`)
      await sleep(2800)
      await B.eval(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(theme)}; window.scrollTo(0, ${scroll}); return true })()`)
      await sleep(900)
      await B.shot(`glass-${TAG}-${theme}-${name}`)
    }
    // a floating toast (the app's own, from a real action): complete a task
    await B.goto(`${BASE}?r=${Date.now()}#/tasks`)
    await sleep(2500)
    await B.eval(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(theme)}; window.scrollTo(0, 200); const c = document.querySelector('[role=checkbox], button[aria-label^="Concluir"]'); c && c.click(); return !!c })()`)
    await sleep(700)
    await B.shot(`glass-${TAG}-${theme}-aviso`)
  }
  console.log('ok')
} catch (e) {
  console.log('ERRO ' + e.message)
} finally {
  B.close()
  for (const p of procs) p.kill()
}
