// Seções: ativar/desativar depois do início (Configurações → Seções visíveis). Desativar não apaga nada;
// reativar traz tudo de volta; navegação atualiza na hora; escolha de quem já usava o app é preservada. Modo local.
import { launch } from './cdp.mjs'
import { BASE, idb, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9385)
const sidebar = () => b.eval(`[...document.querySelectorAll('aside a')].map(a => a.textContent.trim())`)
const moreLinks = () => b.eval(`[...document.querySelectorAll('main a, main button')].map(a => a.textContent.trim())`)
const settings = () => idb(b, 'meta', 'settings')
async function toggle(label) {
  await b.goto(BASE + '#/settings')
  await b.sleep(700)
  await b.click('Seções visíveis')
  await b.sleep(500)
  const ok = await b.eval(`(() => { const sw = [...document.querySelectorAll('[role=dialog] [role=switch]')].find((x) => x.querySelector('.font-medium')?.textContent.trim() === ${JSON.stringify(label)}); if (!sw) return false; sw.click(); return true })()`)
  await b.sleep(400)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await b.sleep(400)
  return ok
}
const switchState = async (label) => {
  await b.goto(BASE + '#/settings')
  await b.sleep(600)
  await b.click('Seções visíveis')
  await b.sleep(400)
  const v = await b.eval(`[...document.querySelectorAll('[role=dialog] [role=switch]')].find((x) => x.querySelector('.font-medium')?.textContent.trim() === ${JSON.stringify(label)})?.getAttribute('aria-checked')`)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await b.sleep(300)
  return v
}

try {
  await b.desktop()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  // Someone who already used the app: chose Vendas on and Notas on, Hoje off; never touched the newer sections.
  const chosen = { sales: true, notes: true, today: false }
  await seedExistingUser(
    b,
    {
      sales: [{ id: 's1', clientId: null, clientName: 'Maria', product: 'Bolo', quantity: 1, date: '2026-09-01', total: 5000, currency: 'BRL', dueDate: '', payments: [{ id: 'p1', date: '2026-09-02', amount: 2000, note: '' }], notes: '' }],
      notes: [{ id: 'n1', title: 'Ideia guardada', body: 'texto', pinned: false }],
    },
    { baseCurrency: 'BRL', modules: chosen, modulesSeen: ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'agenda', 'week', 'life'] },
  )
  await b.goto(BASE + '#/sales')
  await b.sleep(1500)
  r.check('usuário existente: escolha preservada ao abrir (nada ligado/desligado sozinho)', JSON.stringify((await settings()).modules) === JSON.stringify(chosen), JSON.stringify((await settings()).modules))
  r.check('Vendas visível no menu e com os dados', (await sidebar()).includes('Vendas') && (await b.text()).includes('Maria'))
  r.check('Hoje continua desligado (não é obrigatório)', !(await sidebar()).includes('Hoje') && (await switchState('Hoje')) === 'false')

  // Turn Vendas off
  r.check('desativar Vendas', await toggle('Vendas'))
  r.check('Vendas some do menu na hora', !(await sidebar()).includes('Vendas'))
  await b.goto(BASE + '#/more')
  await b.sleep(600)
  r.check('Vendas some também de "Mais"', !(await moreLinks()).some((t) => t.startsWith('Vendas')))
  await b.goto(BASE + '#/sales')
  await b.sleep(800)
  r.check('endereço de seção desativada não abre a seção', !(await b.text()).includes('Total vendido'))
  const sale = await idb(b, 'sales', 's1')
  r.check('desativar NÃO apaga: venda e pagamento continuam salvos', sale?.product === 'Bolo' && sale.payments.length === 1 && sale.payments[0].amount === 2000)

  // Notes off too, then both back on
  await toggle('Anotações')
  r.check('Anotações desativada some do menu', !(await sidebar()).includes('Anotações'))
  r.check('nota continua salva', (await idb(b, 'notes', 'n1'))?.title === 'Ideia guardada')
  await toggle('Vendas')
  await toggle('Anotações')
  r.check('reativar: seções voltam na hora', (await sidebar()).includes('Vendas') && (await sidebar()).includes('Anotações'))
  await b.goto(BASE + '#/sales')
  await b.sleep(1000)
  let text = await b.text()
  r.check('reativar: Vendas volta exatamente como estava (Maria, falta R$ 30,00)', text.includes('Maria') && text.includes('R$ 30,00'))
  await b.goto(BASE + '#/notes')
  await b.sleep(800)
  r.check('reativar: nota volta', (await b.text()).includes('Ideia guardada'))

  // Hoje can be turned on (and off again) — not mandatory
  await toggle('Hoje')
  r.check('Hoje pode ser ligado', (await sidebar()).includes('Hoje'))
  await toggle('Hoje')
  r.check('…e desligado de novo', !(await sidebar()).includes('Hoje'))

  // Always available: Início, Mais/Configurações, Busca are not sections
  await b.goto(BASE + '#/settings')
  await b.sleep(600)
  await b.click('Seções visíveis')
  await b.sleep(400)
  const labels = await b.eval(`[...document.querySelectorAll('[role=dialog] [role=switch] .font-medium')].map(x => x.textContent.trim())`)
  r.check('Início e Configurações não aparecem para desligar', !labels.includes('Início') && !labels.includes('Configurações') && labels.includes('Vendas'), labels.join(', '))
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await b.sleep(300)
  const final = (await settings()).modules
  r.check('preferência salva no aparelho (só o que foi mexido mudou)', final.sales === true && final.notes === true && final.today === false, JSON.stringify(final))

  // Phone layout: bottom navigation follows too
  await b.mobile()
  await toggle('Vendas')
  await b.goto(BASE + '#/more')
  await b.sleep(600)
  r.check('celular: Vendas desativada não aparece em Mais', !(await moreLinks()).some((t) => t.startsWith('Vendas')))
  await toggle('Vendas')
  await b.goto(BASE + '#/more')
  await b.sleep(600)
  text = await b.text()
  r.check('celular: Vendas reativada aparece de novo', text.includes('Vendas'))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('secoes-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
