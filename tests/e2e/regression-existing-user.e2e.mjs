import { launch } from './cdp.mjs'

const BASE = 'http://localhost:4317/nucleo/'
const b = await launch(9333)
const results = []
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await b.goto(BASE + 'favicon.svg')
  // Old-format database (v1, 9 stores) exactly like the published app creates it.
  await b.eval(`new Promise((resolve, reject) => {
    const req = indexedDB.open('nucleo', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const n of ['transactions','goals','clients','projects','tasks','tools','accounts','notes','portfolio']) db.createObjectStore(n, { keyPath: 'id' })
      db.createObjectStore('meta')
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['transactions','tasks','accounts','tools','notes','meta'], 'readwrite')
      const now = new Date().toISOString()
      const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
      tx.objectStore('meta').put({ onboarded: true, baseCurrency: 'EUR', initialBalance: 100000, startedAt: now, rates: { values: { EUR: 1, BRL: 6.2, AED: 4.3 }, fetchedAt: now, source: 'teste' }, manualRates: {}, lastBackupAt: null }, 'settings')
      tx.objectStore('transactions').put({ id: 'tx1', createdAt: now, updatedAt: now, type: 'in', amount: 5000, currency: 'BRL', baseAmount: 806, reason: 'Venda antiga' })
      tx.objectStore('tasks').put({ id: 'tk1', createdAt: now, updatedAt: now, title: 'Tarefa de hoje', projectId: null, dueDate: d(0), priority: 'high', status: 'todo', completedAt: null })
      tx.objectStore('tasks').put({ id: 'tk2', createdAt: now, updatedAt: now, title: 'Tarefa atrasada', projectId: null, dueDate: d(-2), priority: 'none', status: 'todo', completedAt: null })
      tx.objectStore('accounts').put({ id: 'ac1', createdAt: now, updatedAt: now, name: 'Banco X', clientId: null, projectId: null, link: '', email: 'eu@x.com', username: '', password: 'segredo123', notes: '' })
      tx.objectStore('tools').put({ id: 'tl1', createdAt: now, updatedAt: now, name: 'Figma', link: '', plan: 'Pro', price: 1500, currency: 'USD', billing: 'monthly', nextCharge: d(3), notes: '', status: 'active' })
      tx.objectStore('notes').put({ id: 'nt1', createdAt: now, updatedAt: now, title: 'Nota', body: 'texto', pinned: false })
      tx.oncomplete = () => { db.close(); resolve(true) }
      tx.onerror = () => reject(tx.error)
    }
  })`)
  await b.eval(`localStorage.setItem('nucleo:displayCurrency', '"EUR"')`)
  await b.goto(BASE)
  await b.sleep(1500)
  let text = await b.text()
  check('painel abre com dados antigos', text.includes('Saldo') && text.includes('Tarefa de hoje'))
  check('saldo continua em euro (1.000 + 8,06)', text.includes('1.008') && text.includes('€'))
  check('apresentação das novas seções aparece', text.includes('Novas seções disponíveis'))
  await b.shot('t1-novas-secoes')
  const nav = await b.eval(`[...document.querySelectorAll('nav[aria-label="Navegação principal"] a')].map(a => a.textContent.trim())`)
  check('abas inferiores iguais às de antes', JSON.stringify(nav) === JSON.stringify(['Início', 'Financeiro', 'Projetos', 'Tarefas', 'Mais']), JSON.stringify(nav))
  await b.click('Pronto')
  await b.shot('t1-home')
  const db = await b.eval(`new Promise(r => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const db = q.result; const v = db.version; const names = [...db.objectStoreNames]; const tx = db.transaction(['tasks','accounts','transactions'], 'readonly'); const out = { v, names: names.length }; let n = 0; for (const s of ['tasks','accounts','transactions']) { const g = tx.objectStore(s).count(); g.onsuccess = () => { out[s] = g.result; if (++n === 3) { db.close(); r(out) } } } } })`)
  check('IndexedDB atualizado (v3) sem perder registros', db.v === 3 && db.tasks === 2 && db.accounts === 1 && db.transactions === 1, JSON.stringify(db))

  // Currency picker in the balance card: old quick list kept (EUR/BRL/AED) + search button.
  const seg = await b.eval(`[...document.querySelectorAll('[aria-label="Moeda de exibição"] [role=radio]')].map(x => x.textContent)`)
  check('moedas rápidas antigas preservadas', JSON.stringify(seg) === JSON.stringify(['EUR', 'BRL', 'AED']), JSON.stringify(seg))
  await b.click('BRL', '[role=radio]')
  text = await b.text()
  await b.sleep(1200); const fig = await b.eval("[...document.querySelectorAll('span.num[aria-label]')].map(e=>e.getAttribute('aria-label')).join()"); check('ver em BRL converte sem alterar o registro', fig.includes('6.249,97'), fig)
  const stored = await b.eval(`new Promise(r => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const g = q.result.transaction('transactions').objectStore('transactions').get('tx1'); g.onsuccess = () => { q.result.close(); r(g.result) } } })`)
  check('movimentação original intacta', stored.amount === 5000 && stored.currency === 'BRL' && stored.baseAmount === 806)
  await b.click('EUR', '[role=radio]')

  // Accounts: plain password is hidden by default and the vault banner offers protection.
  await b.goto(BASE + '#/accounts')
  text = await b.text()
  check('senha antiga oculta por padrão', !text.includes('segredo123') && text.includes('••••'))
  check('aviso de senhas sem cofre', text.includes('Senhas sem cofre'))
  await b.click('Criar cofre')
  await b.fill('Senha do cofre', 'minha-senha-cofre-1')
  await b.fill('Repita a senha do cofre', 'minha-senha-cofre-1')
  await b.click('Entendi', 'label')
  await b.shot('t1-criar-cofre')
  await b.click('Criar cofre', 'button[type=submit]')
  await b.sleep(2500)
  text = await b.text()
  const code = text.match(/[A-Z2-9]{4}(-[A-Z2-9]{4}){7}/)?.[0]
  check('código de recuperação mostrado uma vez', Boolean(code))
  await b.shot('t1-codigo')
  await b.click('Já guardei')
  await b.click('Sim, guardei')
  const acc = await b.eval(`new Promise(r => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const g = q.result.transaction('accounts').objectStore('accounts').get('ac1'); g.onsuccess = () => { q.result.close(); r(g.result) } } })`)
  check('senha antiga migrada para o cofre (sem texto aberto)', acc.password === '' && acc.secret?.ct && !JSON.stringify(acc).includes('segredo123'))
  const metaStr = await b.eval(`new Promise(r => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const g = q.result.transaction('meta').objectStore('meta').get('settings'); g.onsuccess = () => { q.result.close(); r(JSON.stringify(g.result.vault)) } } })`)
  check('cofre não guarda a senha nem a chave aberta', !metaStr.includes('minha-senha-cofre-1') && !metaStr.includes(code ?? 'x'))
  // Reveal while unlocked
  await b.click('Mostrar senha')
  text = await b.text()
  check('revelar exige ação e funciona com cofre aberto', text.includes('segredo123'))
  await b.click('Fechar', 'button')
  text = await b.text()
  check('ao fechar o cofre a senha volta a ficar oculta', !text.includes('segredo123') && text.includes('Cofre fechado'))
  await b.click('Mostrar senha')
  text = await b.text()
  check('com cofre fechado, revelar pede a senha do cofre', text.includes('Desbloquear cofre') && !text.includes('segredo123'))
  await b.fill('Senha do cofre', 'senha-errada-123')
  await b.click('Desbloquear', 'button[type=submit]')
  await b.sleep(1500)
  text = await b.text()
  check('senha do cofre errada é recusada', text.includes('incorreta'))
  await b.shot('t1-cofre-errado')
} catch (err) {
  results.push('ERROR ' + err.message)
} finally {
  console.log(results.join('\n'))
  console.log('LOGS:\n' + b.logs.slice(0, 15).join('\n'))
  b.close()
}
