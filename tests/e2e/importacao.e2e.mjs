// Parte 3, modo local: "Importar extrato" no Financeiro → CSV lido no aparelho → prévia (nova, duplicada,
// conciliada, precisa revisar, categorias) → categoria em lote → confirmar grava tudo de uma vez (regra roda
// na entrada nova, não na conciliada) → o mesmo arquivo de novo não duplica nada → CSV desconhecido passa
// pela tela de colunas e vira modelo, aplicado sozinho no próximo → OFX → Importações → desfazer.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9471)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'notes', 'sales', 'subscribers', 'inbox']
const freshRates = { values: { EUR: 1, BRL: 6, USD: 1.1 }, fetchedAt: new Date().toISOString(), source: 'teste' }
const mainText = () => b.eval(`document.querySelector('main')?.innerText ?? ''`)
const dialog = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].at(-1)?.innerText ?? ''`)
const clickIn = (text) => b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = d && [...d.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.click(); return true })()`)
const clickMain = (text) => b.eval(`(() => { const el = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true })()`)
const dbReady = `indexedDB.databases().then((l) => l.some((d) => d.name === 'nucleo' && d.version >= 9))`
const T = new Date().toISOString()
const putAll = (store, items) => b.eval(`new Promise((res) => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const tx = q.result.transaction(${JSON.stringify(store)}, 'readwrite'); for (const it of ${JSON.stringify(items)}) tx.objectStore(${JSON.stringify(store)}).put(it); tx.oncomplete = () => { q.result.close(); res(true) } } })`)
const dayIso = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
const br = (n) => dayIso(n).split('-').reverse().join('/')
/** Picks a file in the page's file input (as if chosen by the person). */
const pickFile = (name, text) =>
  b.eval(`(() => { const input = document.querySelector('input[type=file]'); const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: 'text/plain' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
const selectIn = (label, value) => b.eval(`(() => { const el = document.querySelector('select[aria-label=${JSON.stringify(label)}]'); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
async function waitFor(check, label, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await b.eval(check).catch(() => false)) return true
    await sleep(400)
  }
  r.results.push('WAIT timeout: ' + label)
  return false
}

const FILE = `Fecha;Concepto;Importe;Saldo
${br(5)};MERCADONA VALENCIA 1234;-45,30;1.954,70
${br(4)};PERFECT CLEAN BCN;200,00;2.154,70
${br(3)};NOMINA OCTUBRE;1.000,00;3.154,70
${br(2)};CAFE BAR PEPE;-2,00;3.152,70
${br(2)};CAFE BAR PEPE;-2,00;3.150,70
${br(1)};REST XPTO 12;-12,00;3.138,70
`

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(
    b,
    {
      clients: [{ id: 'c1', name: 'Perfect Clean', company: '', phone: '', whatsapp: '', email: '', location: '', notes: '', status: 'active' }],
      projects: [{ id: 'p1', name: 'Perfect Clean BCN', clientId: 'c1', kind: 'site', status: 'inProgress', startDate: '', dueDate: '', endDate: '', charged: 100000, received: 0, currency: 'EUR', link: '', notes: '', payments: [{ id: 'pay1', date: dayIso(4), amount: 20000, currency: 'EUR', note: '' }] }],
      transactions: [
        { id: 'rcv-project-pay1', type: 'in', amount: 20000, currency: 'EUR', baseAmount: 20000, reason: 'Site · Pagamento de projeto', category: 'freelance', source: { kind: 'project', parentId: 'p1', paymentId: 'pay1' }, createdAt: `${dayIso(4)}T12:00:00.000Z`, updatedAt: T },
        { id: 'm1', type: 'out', amount: 1200, currency: 'EUR', baseAmount: -1200, reason: 'Almoço', createdAt: `${dayIso(1)}T13:00:00.000Z`, updatedAt: T },
      ],
    },
    { baseCurrency: 'EUR', displayCurrency: 'EUR', initialBalance: 300000, startedAt: '2026-01-01T00:00:00.000Z', rates: freshRates, timeZone: 'Europe/Madrid', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: [...ALL, 'accounts', 'portfolio', 'routine', 'meals', 'habits', 'recurring', 'agenda', 'week', 'life'] },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })
  await b.goto(BASE + '#/finance')
  await waitFor(dbReady, 'banco v9')
  await sleep(800)
  await putAll('financeGoals', [{ id: 'imp', createdAt: T, updatedAt: T, name: 'Impostos', target: 1000000, saved: 0, deadline: '2027-12-31', currency: 'EUR', note: '', status: 'active', history: [], inBalance: true }])
  await putAll('rules', [{ id: 'r1', createdAt: T, updatedAt: T, name: 'Guardar 20% do salário', on: true, since: dayIso(30), order: 0, trigger: { kind: 'moneyIn' }, conditions: [{ field: 'category', values: ['salary'] }], actions: [{ kind: 'reservePercent', goalId: 'imp', percent: 20 }] }])
  await b.eval('location.reload()').catch(() => {})
  await sleep(2500)

  // ---------- Entrada no Financeiro
  r.check('Financeiro tem “Importar extrato”', await clickMain('Importar extrato'))
  await sleep(1200)
  let text = await mainText()
  r.check('tela de importação: escolher arquivo e aviso de privacidade', text.includes('Escolher arquivo') && text.includes('lido só neste aparelho'))

  // ---------- CSV: prévia
  await pickFile('sabadell-outubro.csv', FILE)
  await waitFor(`document.querySelector('main')?.innerText.includes('não diz em que moeda')`, 'pede a moeda')
  r.check('CSV sem moeda: pede a moeda antes da prévia (não adivinha)', (await mainText()).includes('Escolha a moeda acima'))
  await clickMain('EUR')
  await waitFor(`document.querySelector('main')?.innerText.includes('lidas')`, 'prévia')
  text = await mainText()
  r.check('prévia: 6 lidas, conciliada com o pagamento de projeto, revisão para a sugestão de baixa confiança', /6\s*lidas/.test(text) && text.includes('Corresponde a Pagamento de projeto — Perfect Clean BCN') && text.includes('Parece corresponder a Almoço') && text.includes('Precisa revisar'), text.slice(0, 900).replace(/\n/g, ' | '))
  r.check('prévia: categorias sugeridas (Mercadona → Alimentação, Nómina → Salário)', text.includes('costuma ser Alimentação') && text.includes('costuma ser Salário'))
  if (process.env.SHOTS) await b.shot('import-1-preview')
  r.check('nada foi gravado antes de confirmar', (await idb(b, 'transactions')).length === 2)

  // ---------- Categoria em lote: os dois cafés → Lazer
  const { setValue } = await import('./helpers.mjs')
  await setValue(b, 'input[placeholder^="Buscar"]', 'cafe')
  await sleep(500)
  r.check('busca deixa só os dois cafés', (await b.eval(`document.querySelectorAll('[data-line]').length`)) === 2)
  await clickMain('Selecionar')
  await sleep(300)
  r.check('lote: categoria para as selecionadas', await selectIn('Aplicar categoria às selecionadas', 'leisure'))
  await sleep(400)
  r.check('as duas linhas ficaram com Lazer', (await b.eval(`[...document.querySelectorAll('select[aria-label^="Categoria de"]')].map((s) => s.value).join(',')`)) === 'leisure,leisure')
  await setValue(b, 'input[placeholder^="Buscar"]', '')
  await sleep(400)

  // ---------- Confirmar
  await clickMain('Importar 4 movimentações e conciliar 1')
  await sleep(500)
  r.check('confirmação antes de gravar', (await dialog()).includes('Importar agora?'))
  await clickIn('Importar')
  await waitFor(`document.querySelector('main')?.innerText.includes('Núcleo importou')`, 'conclusão')
  text = await mainText()
  if (process.env.SHOTS) await b.shot('import-2-done')
  r.check('conclusão: 4 importadas, 1 conciliada', text.includes('Núcleo importou 4 movimentações') && /Conciliadas com o que já existia\s*1/.test(text), text.slice(0, 500).replace(/\n/g, ' | '))
  let txs = await idb(b, 'transactions')
  const proj = txs.find((t) => t.id === 'rcv-project-pay1')
  r.check('uma movimentação por linha (6 = 2 antigas + 4 novas), conciliada sem mudar o valor', txs.length === 6 && proj.amount === 20000 && proj.bank?.reconciled === true, JSON.stringify(txs.map((t) => [t.reason, t.amount, t.category])))
  const cafes = txs.filter((t) => t.reason === 'Cafe Bar Pepe')
  r.check('cafés iguais no mesmo dia continuam dois, com a categoria em lote e a descrição original', cafes.length === 2 && cafes.every((t) => t.category === 'leisure' && t.bank?.raw === 'CAFE BAR PEPE'))
  const goal = await idb(b, 'financeGoals', 'imp')
  const runs = await idb(b, 'automationRuns')
  r.check('regra rodou na entrada nova (20% de €1.000 = €200), não na conciliada', goal.saved === 20000 && runs.filter((x) => x.automation === 'rule' && x.status === 'done').length === 1, `${goal.saved} ${JSON.stringify(runs.map((x) => x.summary))}`)

  // ---------- O mesmo arquivo de novo
  await clickMain('Importar outro arquivo')
  await sleep(600)
  await pickFile('sabadell-outubro.csv', FILE)
  await sleep(800)
  await clickMain('EUR')
  await waitFor(`document.querySelector('main')?.innerText.includes('lidas')`, 'prévia 2')
  text = await mainText()
  r.check('mesmo arquivo de novo: tudo duplicado, nada para importar', /5\s*duplicadas/.test(text) && text.includes('Nada para importar'), text.slice(0, 600).replace(/\n/g, ' | '))

  // ---------- CSV desconhecido → colunas → modelo
  // Two number columns and names the Núcleo doesn't know: it can't tell which one is the value.
  const UNKNOWN = `Quando|O que|Quanto|Codigo\n${br(6)}|LIDL 22|-30,00|12345\n${br(6)}|UBER TRIP|-9,90|12346\n`
  await pickFile('banco-x.csv', UNKNOWN)
  await waitFor(`document.querySelector('main')?.innerText.includes('Diga o que cada coluna é')`, 'tela de colunas')
  r.check('arquivo desconhecido abre a tela de colunas', (await mainText()).includes('Não consegui identificar a coluna de valor.'))
  await selectIn('Data', '0')
  await selectIn('Descrição', '1')
  await selectIn('Valor', '2')
  await sleep(400)
  text = await mainText()
  r.check('primeiras linhas lidas com a escolha', text.includes('LIDL 22') && text.includes('−30,00'), text.slice(0, 1200).replace(/\n/g, ' | '))
  if (process.env.SHOTS) await b.shot('import-3-columns')
  await b.click('Salvar como modelo')
  await sleep(200)
  await setValue(b, 'input[placeholder="Meu Sabadell"]', 'Meu banco')
  await sleep(200)
  await clickMain('Continuar')
  await waitFor(`document.querySelector('main')?.innerText.includes('não diz em que moeda')`, 'prévia 3')
  r.check('modelo salvo nas configurações', (await idb(b, 'meta', 'settings')).importTemplates?.[0]?.name === 'Meu banco')
  r.check('arquivo sem moeda: pede a moeda antes da prévia', (await mainText()).includes('não diz em que moeda'))
  await clickMain('EUR')
  await sleep(600)
  await clickMain('Importar 2 movimentações')
  await sleep(400)
  await clickIn('Importar')
  await waitFor(`document.querySelector('main')?.innerText.includes('Núcleo importou')`, 'conclusão 2')
  await clickMain('Importar outro arquivo')
  await sleep(500)
  await pickFile('banco-x-novembro.csv', `Quando|O que|Quanto|Codigo\n${br(0)}|LIDL 23|-15,00|12347\n`)
  await waitFor(`document.querySelector('main')?.innerText.includes('lidas')`, 'prévia 4')
  r.check('próximo arquivo igual: modelo aplicado sozinho', (await mainText()).includes('Modelo “Meu banco” aplicado'))

  // ---------- OFX
  const OFX = `OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>ES1200810001234567</BANKACCTFROM><BANKTRANLIST>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${dayIso(7).replace(/-/g, '')}<TRNAMT>-15.99<FITID>NF1<NAME>NETFLIX.COM\n</STMTTRN>\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
  await pickFile('wise.ofx', OFX)
  await waitFor(`document.querySelector('main')?.innerText.includes('lidas')`, 'prévia OFX')
  text = await mainText()
  r.check('OFX: lido, conta pela agência, Netflix → Assinaturas', text.includes('Arquivo OFX') && text.includes('costuma ser Assinaturas') && (await b.eval(`document.querySelector('input[list="import-accounts"]').value`)) === '•••4567', text.slice(0, 900).replace(/\n/g, ' | '))

  // ---------- Formato não aceito
  await pickFile('extrato.pdf', '%PDF-1.4 x')
  await sleep(800)
  r.check('PDF: mensagem humana', (await mainText()).includes('Este arquivo é um PDF'))

  // ---------- Importações + desfazer
  await b.goto(BASE + '#/imports')
  await sleep(1500)
  text = await mainText()
  r.check('Importações: histórico com arquivo, contagens e modelo', text.includes('sabadell-outubro.csv') && text.includes('4 importadas') && text.includes('1 conciliada') && text.includes('Meu banco'), text.slice(0, 700).replace(/\n/g, ' | '))
  // Edit one imported movement: it must survive the undo.
  txs = await idb(b, 'transactions')
  const merc = txs.find((t) => t.reason.startsWith('Mercadona'))
  await putAll('transactions', [{ ...merc, reason: 'Mercado do mês', updatedAt: new Date().toISOString() }])
  await b.eval('location.reload()').catch(() => {})
  await sleep(2500)
  const firstRun = (await idb(b, 'automationRuns')).find((x) => x.bankImport?.file === 'sabadell-outubro.csv' && x.status === 'done')
  await b.eval(`(() => { const rows = [...document.querySelectorAll('main .card > div')]; const row = rows.find((x) => x.innerText.includes('sabadell-outubro.csv') && x.innerText.includes('4 importadas')); [...row.querySelectorAll('button')].find((x) => x.textContent.includes('Desfazer importação')).click() })()`)
  await sleep(500)
  r.check('confirmação explica o que acontece', (await dialog()).includes('as que você editou depois ficam'))
  await clickIn('Desfazer importação')
  await sleep(1500)
  txs = await idb(b, 'transactions')
  const after = await idb(b, 'automationRuns')
  const undone = after.find((x) => x.id === firstRun.id)
  r.check('desfeito: só ficaram as antigas, a editada e as do outro arquivo; conciliada sem o vínculo', txs.some((t) => t.reason === 'Mercado do mês') && !txs.some((t) => t.reason === 'Cafe Bar Pepe') && txs.find((t) => t.id === 'rcv-project-pay1')?.bank === undefined && txs.some((t) => t.reason === 'Lidl 22'), JSON.stringify(txs.map((t) => t.reason)))
  r.check('desfazer devolveu a reserva da regra e registrou o que foi mantido', (await idb(b, 'financeGoals', 'imp')).saved === 0 && undone.status === 'undone' && undone.bankImport.undone.kept.length === 1)
  text = await mainText()
  if (process.env.SHOTS) await b.shot('import-4-history')
  r.check('Importações mostra o que foi mantido', text.includes('Mantida: Mercado do mês (editada depois da importação)'))

  // ---------- Feito pelo Núcleo
  await b.goto(BASE + '#/automations')
  await sleep(1500)
  text = await mainText()
  r.check('Feito pelo Núcleo: resumo da importação com link, sem desfazer duplicado', text.includes('Núcleo importou 4 movimentações') && text.includes('Ver importação') && text.includes('categorias aplicadas automaticamente'), text.slice(0, 800).replace(/\n/g, ' | '))
  r.check('sem rolagem horizontal', await noHorizontalScroll(b))
  r.check('sem erros no console', !b.logs.some((l) => l.startsWith('EXC') || l.startsWith('error')), b.logs.slice(0, 5).join(' / '))
} catch (err) {
  r.results.push('FAIL exceção: ' + (err?.stack ?? err))
} finally {
  const failed = r.print(b)
  await b.close()
  process.exit(failed ? 1 : 0)
}
