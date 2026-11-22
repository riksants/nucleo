// PARTE 16 — smoke test pós-deploy (produção), seguro e reutilizável pelo deploy e pelo rollback.
//
// O que prova, SEM login e SEM tocar em dados de nenhum usuário (só carrega a página pública):
//   1) produção responde (HTTP 200) — com espera de propagação do GitHub Pages;
//   2) o HTML principal carrega e traz o ponto de montagem (#root) e o bundle;
//   3) os assets principais (JS/CSS do Vite) respondem 200 com o content-type certo;
//   4) não há white screen: o React monta de verdade (#root ganha filhos) e o título é "Núcleo";
//   5) não há erro de inicialização: nenhuma exceção não capturada na carga.
// Falha com mensagem clara (exit != 0) em qualquer um desses pontos — é o que bloqueia/sinaliza o deploy.
//
// Uso: SMOKE_URL=https://hellonucleo.app node scripts/deploy/smoke.mjs
// Em CI o Chromium vem via EDGE_PATH (mesmo do E2E crítico); CI=1 liga --no-sandbox no cdp.mjs.
import { launch } from '../../tests/e2e/cdp.mjs'

const URL = (process.env.SMOKE_URL || 'https://hellonucleo.app').replace(/\/$/, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function fail(msg) {
  console.error(`\n❌ SMOKE FALHOU: ${msg}`)
  process.exit(1)
}

// GitHub Pages pode levar alguns segundos para servir a versão nova; tenta por até ~90 s.
async function getWithRetry(url, { tries = 30, gap = 3000 } = {}) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
      if (res.ok) return res
      last = `HTTP ${res.status}`
    } catch (e) {
      last = e.message
    }
    await sleep(gap)
  }
  throw new Error(`${url} não respondeu 200 (${last})`)
}

async function main() {
  console.log(`== Smoke test de produção: ${URL} ==`)

  // 1) HTML principal responde e traz o ponto de montagem + o bundle.
  const res = await getWithRetry(`${URL}/`)
  const html = await res.text()
  if (!/id=["']root["']/.test(html)) fail('o HTML não contém o ponto de montagem #root')
  console.log('✓ HTML 200 e com #root')

  // 2) Assets principais que o Vite injeta no HTML (JS de módulo + CSS) respondem 200 com o tipo certo.
  const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map((m) => m[1])
  const uniq = [...new Set(assets)]
  if (uniq.length === 0) fail('nenhum asset /assets/*.js|css encontrado no HTML (build quebrado?)')
  for (const path of uniq) {
    const a = await getWithRetry(`${URL}${path}`, { tries: 10, gap: 2000 })
    const ct = a.headers.get('content-type') || ''
    const okType = path.endsWith('.js') ? /javascript|ecmascript/i.test(ct) : /css/i.test(ct)
    if (!okType) fail(`asset ${path} veio com content-type inesperado: "${ct}"`)
  }
  console.log(`✓ ${uniq.length} asset(s) principal(is) 200 com content-type correto`)

  // 3) Carga headless real: pega white screen e erro de inicialização.
  let page
  try {
    page = await launch(9344)
  } catch (e) {
    fail(`não foi possível abrir o navegador headless: ${e.message}`)
  }
  try {
    await page.goto(`${URL}/`)

    // O React monta no #root já na carga; se o JS quebrar, o #root fica vazio (white screen).
    let mounted = 0
    for (let i = 0; i < 40; i++) {
      mounted = (await page.eval(`document.querySelector('#root')?.childElementCount || 0`).catch(() => 0)) ?? 0
      if (mounted > 0) break
      await sleep(500)
    }
    if (mounted < 1) fail('white screen: o #root continuou vazio após 20 s (o app não montou)')

    const title = await page.eval('document.title').catch(() => '')
    if (title !== 'Núcleo') fail(`título inesperado: "${title}" (esperado "Núcleo" — página 404 do Pages?)`)

    const bodyLen = (await page.eval('document.body.innerText.trim().length').catch(() => 0)) ?? 0
    if (bodyLen < 1) fail('a página renderizou sem texto visível algum')

    // Exceções não capturadas durante a carga = erro de inicialização.
    const exceptions = page.logs.filter((l) => l.startsWith('EXC '))
    const consoleErrors = page.logs.filter((l) => l.startsWith('error '))
    if (consoleErrors.length) console.log(`(aviso) ${consoleErrors.length} console.error na carga:\n  ` + consoleErrors.slice(0, 5).join('\n  '))
    if (exceptions.length) fail(`erro de inicialização — exceção não capturada:\n  ` + exceptions.slice(0, 5).join('\n  '))

    try {
      await page.shot('smoke-prod')
    } catch {}
    console.log(`✓ app montou (#root com ${mounted} filho[s]), título "Núcleo", sem exceção não capturada`)
  } finally {
    page?.close()
  }

  console.log('\n✅ SMOKE OK — produção respondendo, assets e app carregando, sem white screen.')
  process.exit(0)
}

main().catch((e) => fail(e.stack || e.message))
