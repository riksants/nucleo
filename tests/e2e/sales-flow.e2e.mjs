// Vendas: a barra única (buscar ou contar o que vendeu), ficha conferida antes de salvar, nomes iguais, cadastro
// simples, detalhe com Recebi / Cobrar / Vender novamente / Editar, pagamento parcial e total (uma entrada no
// Financeiro, sem duplicar com toque duplo), correção e remoção, valor acima do pendente, parcelas, cobrança pelo
// WhatsApp (sem marcar nada), venda recorrente (gera cobrança, nunca pagamento). Celular pequeno. Modo local.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9671)
const TZ = 'America/Sao_Paulo'
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const type = (selector, value) =>
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
const fillIn = (labelText, value) =>
  b.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.trim().startsWith(${JSON.stringify(labelText)})); const el = l && l.querySelector('input, textarea'); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
const dialogText = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].pop()?.innerText ?? ''`)
const bar = 'textarea[aria-label="Busque uma venda ou conte o que vendeu"]'
const waitFor = async (fn, ms = 6000) => {
  for (let t = 0; t < ms; t += 250) {
    if (await fn()) return true
    await sleep(250)
  }
  return false
}
const fieldValue = (label) => b.eval(`(() => { const l = [...[...document.querySelectorAll('[role=dialog]')].pop().querySelectorAll('label')].find(x => x.textContent.trim().startsWith(${JSON.stringify(label)})); return l?.querySelector('input')?.value ?? null })()`)
const salesIncomes = async () => (await idb(b, 'transactions')).filter((t) => t.type === 'in' && t.source?.kind === 'sale')

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await b.goto(BASE + 'favicon.svg')
  const today = await b.eval(`(() => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:${JSON.stringify(TZ)},year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value])); return p.year+'-'+p.month+'-'+p.day })()`)
  const add = (n) => new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + n)).toISOString().slice(0, 10)
  await seedExistingUser(
    b,
    {
      clients: [
        { id: 'c1', name: 'João Silva', company: '', phone: '', whatsapp: '', email: '', location: '', notes: '', status: 'active' },
        { id: 'c2', name: 'João Pereira', company: '', phone: '', whatsapp: '5511988887777', email: '', location: '', notes: '', status: 'active' },
      ],
      sales: [
        { id: 'old', clientId: 'c1', clientName: '', product: 'Bolo de chocolate', quantity: 2, date: add(-6), total: 16000, currency: 'BRL', dueDate: add(-1), payments: [], notes: '' },
        { id: 'inst', clientId: null, clientName: 'Ana', product: 'Bolsa', quantity: 1, date: add(-40), total: 30000, currency: 'BRL', dueDate: add(20), payments: [], notes: '', installments: [{ id: 'i1', due: add(-10), amount: 10000 }, { id: 'i2', due: add(20), amount: 10000 }, { id: 'i3', due: add(50), amount: 10000 }] },
        { id: 'rep', clientId: null, clientName: 'Rita', product: 'Aula de inglês', quantity: 1, date: add(-30), total: 20000, currency: 'BRL', dueDate: add(-30), payments: [{ id: 'rp', date: add(-30), amount: 20000, note: '' }], notes: '', recurring: { every: 'month', status: 'active' }, recurNext: today },
      ],
    },
    { modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL, timeZone: TZ },
  )
  await b.goto(BASE + '#/sales')
  await sleep(1800)

  // ---------- Recorrente: abriu o app na data → cobrança gerada, sem pagamento (as automações rodam em passadas)
  let sales = await idb(b, 'sales')
  for (let i = 0; i < 40 && !sales.some((s) => s.recurOf === 'rep'); i++) {
    await sleep(300)
    sales = await idb(b, 'sales')
  }
  const charge = sales.find((s) => s.recurOf === 'rep')
  r.check('venda recorrente gera a cobrança do dia (a receber, sem pagamento)', !!charge && charge.date === today && charge.payments.length === 0 && charge.total === 20000, JSON.stringify(charge))
  r.check('…e avança a próxima data da repetição', sales.find((s) => s.id === 'rep').recurNext > today)

  // ---------- Frase → ficha
  await type(bar, 'Vendi um tênis pra João por 300, ele deu 100 e paga o resto sexta.')
  await waitFor(async () => (await b.text()).includes('Entendi assim'))
  let text = await b.text()
  await b.shot('vendas-ficha-frase')
  const card = await b.eval(`document.querySelector('[aria-label="Nova venda pronta para conferir"]')?.innerText ?? ''`)
  r.check('frase vira ficha "Entendi assim" com cliente, produto, total, recebido e restante', /Cliente\s+João/.test(card) && /Produto\s+tênis/.test(card) && /Total\s+R\$\s300,00/.test(card) && /Já recebido\s+R\$\s100,00/.test(card) && /Restante\s+R\$\s200,00/.test(card), card.replaceAll(String.fromCharCode(10), ' | '))
  r.check('vencimento mostrado com a data exata (sexta-feira)', /sexta-feira, \d{2}\/\d{2}/.test(text))
  r.check('nada salvo só por digitar', (await idb(b, 'sales')).length === sales.length)
  await b.click('Conferir e registrar')
  await sleep(700)
  let dlg = await dialogText()
  r.check('ficha abre preenchida com "Registrar venda"', dlg.includes('Nova venda') && dlg.includes('Registrar venda'))
  r.check('nomes iguais: pede para escolher qual João', dlg.includes('Há 2 pessoas com esse nome') || dlg.includes('Qual é?') || (dlg.includes('João Silva') && dlg.includes('João Pereira')), dlg.slice(0, 200))
  // Trying to save without choosing is blocked
  await b.click('Registrar venda', '[role=dialog] button[type=submit]')
  await sleep(400)
  r.check('sem escolher, não salva', (await idb(b, 'sales')).length === sales.length)
  await b.click('João Pereira', '[role=dialog] button')
  await sleep(300)
  // Double tap on Registrar: one sale, one income
  await b.eval(`(() => { const btn = [...document.querySelectorAll('[role=dialog] button[type=submit]')].pop(); btn.click(); btn.click() })()`)
  await sleep(1500)
  sales = await idb(b, 'sales')
  const tenis = sales.filter((s) => /t[êe]nis/i.test(s.product))
  r.check('venda registrada uma vez, ligada ao João escolhido', tenis.length === 1 && tenis[0].clientId === 'c2' && tenis[0].total === 30000, JSON.stringify(tenis.map((s) => s.clientId)))
  r.check('entrada de 100 registrada uma vez (venda + Financeiro)', tenis[0]?.payments.length === 1 && tenis[0].payments[0].amount === 10000 && (await salesIncomes()).filter((t) => t.amount === 10000).length === 1)
  r.check('texto sai da barra depois de registrar', (await b.eval(`document.querySelector(${JSON.stringify(bar)}).value`)) === '')

  // ---------- Busca
  await type(bar, 'joão')
  await sleep(400)
  text = await b.text()
  r.check('buscar "joão" mostra todas as vendas dos Joões', text.includes('2 vendas') && text.includes('Bolo de chocolate') && text.includes('tênis'))
  await type(bar, 'vendas atrasadas')
  await sleep(400)
  text = await b.text()
  r.check('"vendas atrasadas" filtra e mostra o filtro aplicado', text.includes('atrasadas') && text.includes('Bolo de chocolate') && text.includes('Bolsa') && !text.includes('tênis'))
  await type(bar, 'João 300')
  await waitFor(async () => (await b.text()).includes('Criar uma venda'))
  text = await b.text()
  r.check('ambígua: oferece "Buscar vendas" e "Criar uma venda" mantendo o texto', text.includes('Buscar vendas') && text.includes('Criar uma venda') && (await b.eval(`document.querySelector(${JSON.stringify(bar)}).value`)) === 'João 300')
  await type(bar, '')
  await sleep(300)

  // ---------- Detalhe e Recebi (parcial), toque duplo, correção, valor acima
  await b.click('João Pereira', 'main button')
  await sleep(700)
  dlg = await dialogText()
  r.check('tocar abre detalhes (não edição) com Recebi, Cobrar, Vender novamente e Editar venda', dlg.includes('Recebi') && dlg.includes('Cobrar') && dlg.includes('Vender novamente') && dlg.includes('Editar venda') && !dlg.includes('Registrar venda'))
  await b.click('Recebi', '[role=dialog] button')
  await sleep(600)
  await waitFor(async () => (await fieldValue('Valor recebido')) !== null)
  r.check('"Recebi" já vem com o valor pendente e a data de hoje', /^200(,00)?\|/.test(`${await fieldValue('Valor recebido')}|`) && (await fieldValue('Data')) === today, `${await fieldValue('Valor recebido')}|${await fieldValue('Data')}`)
  await fillIn('Valor recebido', '9999')
  await b.click('Confirmar recebimento', '[role=dialog] button')
  await sleep(400)
  r.check('valor acima do pendente é bloqueado com explicação', (await dialogText()).includes('O valor passa do que falta'))
  await fillIn('Valor recebido', '50')
  await b.eval(`(() => { const btn = [...[...document.querySelectorAll('[role=dialog]')].pop().querySelectorAll('button')].find(x => x.textContent.includes('Confirmar recebimento')); btn.click(); btn.click() })()`)
  await sleep(1500)
  let t1 = (await idb(b, 'sales')).find((s) => s.id === tenis[0].id)
  r.check('pagamento parcial: 1 pagamento de 50 (toque duplo não duplica), falta 150', t1.payments.length === 2 && t1.payments.some((p) => p.amount === 5000), JSON.stringify(t1.payments))
  r.check('Financeiro recebe a entrada de 50 uma vez', (await salesIncomes()).filter((t) => t.amount === 5000).length === 1)
  // Correct the payment: 50 → 60 (same Financeiro entry, updated)
  await b.click('Toque para corrigir ou remover', '[role=dialog] button')
  await sleep(600)
  await fillIn('Valor recebido', '60')
  await b.click('Salvar correção', '[role=dialog] button')
  await sleep(1200)
  const incomes = await salesIncomes()
  r.check('corrigir o pagamento atualiza a mesma entrada do Financeiro (60, sem sobrar 50)', incomes.some((t) => t.amount === 6000) && !incomes.some((t) => t.amount === 5000))
  // Remove it
  await b.click('Toque para corrigir ou remover', '[role=dialog] button')
  await sleep(600)
  await b.click('Remover pagamento', '[role=dialog] button')
  await sleep(500)
  await b.click('Remover', '[role=dialog] button')
  await sleep(1200)
  t1 = (await idb(b, 'sales')).find((s) => s.id === tenis[0].id)
  r.check('remover o pagamento: venda volta a ter 200 a receber e a entrada sai do Financeiro', t1.payments.length === 1 && !(await salesIncomes()).some((t) => t.amount === 6000))

  // ---------- Recebi total → quitada
  await b.click('Recebi', '[role=dialog] button')
  await sleep(500)
  await b.click('Confirmar recebimento', '[role=dialog] button')
  await sleep(1200)
  t1 = (await idb(b, 'sales')).find((s) => s.id === tenis[0].id)
  r.check('pagamento total quita a venda', t1.payments.reduce((s, p) => s + p.amount, 0) === 30000)

  // ---------- Cobrar (sem telefone → pede só o número; link do WhatsApp; nada marcado)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(500)
  await b.goto(BASE + '#/sales?open=old')
  await sleep(1200)
  await waitFor(async () => (await dialogText()).includes('Cobrar'))
  await b.click('Cobrar', '[role=dialog] button')
  await waitFor(async () => (await dialogText()).includes('Mensagem'))
  dlg = await dialogText()
  r.check('cobrar sem telefone pede só o WhatsApp', dlg.includes('WhatsApp de João Silva') && !dlg.includes('O que vendeu'))
  const msg = await b.eval(`[...document.querySelectorAll('[role=dialog] textarea')].pop()?.value ?? ''`)
  r.check('mensagem com nome, referência, valor pendente e vencimento', msg.includes('Oi, João!') && msg.includes('Bolo de chocolate') && msg.includes('160,00') && msg.includes('venceu'), msg.replaceAll(String.fromCharCode(10), ' | '))
  await fillIn('WhatsApp de João Silva', '55 11 97777-6666')
  await sleep(300)
  const href = await b.eval(`[...document.querySelectorAll('[role=dialog] a')].find(a => a.textContent.includes('Abrir WhatsApp'))?.href ?? ''`)
  r.check('abre o WhatsApp com a mensagem preenchida (a pessoa envia)', href.startsWith('https://wa.me/5511977776666?text=') && decodeURIComponent(href).includes('Bolo de chocolate'))
  await b.click('Salvar número', '[role=dialog] button')
  await sleep(800)
  r.check('número salvo no cliente; venda não muda de status', (await idb(b, 'clients', 'c1')).whatsapp === '55 11 97777-6666' && (await idb(b, 'sales', 'old')).payments.length === 0)

  // ---------- Parcelas
  await b.goto(BASE + '#/sales?open=inst')
  await waitFor(async () => (await dialogText()).includes('Parcelas'))
  dlg = await dialogText()
  r.check('parcelas com estado (atrasada, a vencer)', dlg.includes('Parcelas · 0 de 3 pagas') && dlg.includes('Atrasada') && dlg.includes('A vencer'))
  await b.click('Recebi', '[role=dialog] button')
  await sleep(500)
  await fillIn('Valor recebido', '150')
  await sleep(300)
  r.check('ao receber, mostra quais parcelas serão abatidas', (await dialogText()).includes('Abate: 1ª parcela, 2ª parcela (parte'))
  await b.click('Confirmar recebimento', '[role=dialog] button')
  await sleep(1200)
  dlg = await dialogText()
  r.check('depois: 1ª paga, 2ª parcial', dlg.includes('Parcelas · 1 de 3 pagas') && dlg.includes('Parcial'))

  // ---------- Vender novamente
  await b.click('Vender novamente', '[role=dialog] button')
  await sleep(700)
  dlg = await dialogText()
  r.check('vender novamente: cliente e item preenchidos, sem pagamentos antigos', dlg.includes('Nova venda') && (await b.eval(`(() => { const v = [...[...document.querySelectorAll('[role=dialog]')].pop().querySelectorAll('input')].map(i => i.value); return v.includes('Ana') && v.includes('Bolsa') })()`)))
  await b.click('Registrar venda', '[role=dialog] button[type=submit]')
  await sleep(1200)
  const again = (await idb(b, 'sales')).filter((s) => s.product === 'Bolsa' && s.id !== 'inst')
  r.check('nova venda criada sem pagamentos, parcelas ou vencimento antigos', again.length === 1 && again[0].payments.length === 0 && !again[0].installments && again[0].dueDate === '')

  // ---------- Cadastro manual simples + produto lembrado + parte recebida + parcelas
  await b.click('Nova venda', 'button')
  await sleep(700)
  await fillIn('Cliente', 'Carla')
  await sleep(300)
  await b.click('Bolo de chocolate', '[role=dialog] button')
  await sleep(300)
  r.check('produto lembrado preenche o preço (80,00)', (await b.eval(`[...[...document.querySelectorAll('[role=dialog]')].pop().querySelectorAll('input')].some(i => /^80(,00)?$/.test(i.value))`)))
  await b.click('Uma parte', '[role=dialog] [role=radio]')
  await fillIn('Quanto recebeu', '20')
  await b.click('Mais opções', '[role=dialog] button')
  await sleep(300)
  await b.eval(`(() => { const box = [...document.querySelectorAll('[role=dialog] label')].find(l => l.textContent.includes('Parcelar o que falta'))?.querySelector('input'); box?.click() })()`)
  await sleep(300)
  await fillIn('Parcelas', '3')
  await fillIn('1ª parcela', add(10))
  await sleep(400)
  dlg = await dialogText()
  r.check('resumo das parcelas: 3× somando exatamente o que falta (60,00)', dlg.includes('3× · soma R$ 60,00') && dlg.includes('depois da entrada'))
  await b.click('Registrar venda', '[role=dialog] button[type=submit]')
  await sleep(1300)
  const carla = (await idb(b, 'sales')).find((s) => s.clientName === 'Carla')
  r.check('cadastro manual salvo: entrada 20, 3 parcelas exatas', !!carla && carla.payments.length === 1 && carla.installments?.length === 3 && carla.installments.reduce((s, i) => s + i.amount, 0) === 6000, JSON.stringify(carla?.installments))

  r.check('sem rolagem horizontal (390px)', await noHorizontalScroll(b))
  // Small phone with the keyboard open: the form still fits and its button is reachable
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 420, deviceScaleFactor: 2, mobile: true })
  await b.click('Nova venda', 'button')
  await sleep(700)
  const fits = await b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].pop(); const r = d.getBoundingClientRect(); const btn = [...d.querySelectorAll('button[type=submit]')].pop()?.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.height <= innerHeight + 1 && !!btn && btn.bottom <= innerHeight + 1 })()`)
  r.check('tela pequena (320×420, como com teclado aberto): ficha cabe e o botão fica alcançável', fits)
  r.check('sem rolagem horizontal (320px)', await noHorizontalScroll(b))
  await b.shot('vendas-ficha-pequena')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('vendas-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
