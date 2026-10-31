// Etapa 3: Senhas (cofre: nada aparece nem é copiado sem desbloqueio, migração conferida sem texto puro
// restante, esconde sozinho, bloqueio por inatividade), Anotações (nota de 300 mil caracteres: rápida, busca no
// texto inteiro, nada cortado, rascunho recuperado), Tarefas, Semana e Vida, no iPhone (390/375/320).
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9373)
const TZ = 'America/Sao_Paulo'
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'agenda', 'life', 'week']
const SECRET = 'segredo-antigo-123'
const VAULT = 'minha-senha-do-cofre-1'
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const dialog = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText).join('\\n')`)
const top = (text) => b.eval(`[...[...document.querySelectorAll('[role=dialog]')].pop().querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)})?.click()`)
const width = (w) => b.send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 2, mobile: true })
/** Everything the app keeps on this device (all stores, outbox included, and local storage) as one string. */
const everything = () =>
  b.eval(`new Promise(r => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const db = q.result; const names = [...db.objectStoreNames]; const tx = db.transaction(names); const out = []; let n = 0; for (const s of names) { const g = tx.objectStore(s).getAll(); g.onsuccess = () => { out.push(JSON.stringify(g.result)); if (++n === names.length) { db.close(); r(out.join('') + JSON.stringify({ ...localStorage })) } } } } })`)
const copied = () => b.eval('window.__copied')
const shiftClock = (min) => b.eval(`(() => { const real = Date.now.bind(Date); const at = real(); Date.now = () => real() + ${min} * 60000; return at })()`)

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  // Every copy to the clipboard is recorded (the test checks what was, and wasn't, copied).
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t) }, readText: async () => '' }, configurable: true })` })
  const lines = Array.from({ length: 6000 }, (_, i) => `Linha ${i} de um texto bem comprido, com acentuação, para ver se o app aguenta.`)
  const huge = `${lines.join('\n')}\nfrase-unica-no-final-da-nota`
  await seedExistingUser(
    b,
    {
      accounts: [{ id: 'ac1', name: 'Banco X', clientId: null, projectId: null, link: 'banco.com', email: 'eu@x.com', username: '', password: SECRET, notes: '' }],
      notes: [{ id: 'big', title: 'Livro', body: huge, pinned: false }],
      tasks: [
        { id: 't1', title: 'Pagar contador', projectId: null, dueDate: '2026-01-05', priority: 'none', status: 'todo', completedAt: null },
        { id: 't2', title: 'Enviar proposta', projectId: null, dueDate: '', priority: 'none', status: 'todo', completedAt: null },
        { id: 't3', title: 'Ligar para o banco', projectId: null, dueDate: '', priority: 'none', status: 'todo', completedAt: null },
      ],
    },
    { modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL, timeZone: TZ },
  )

  // ---------- Senhas: sem cofre, a senha antiga não aparece nem é copiada
  await b.goto(BASE + '#/accounts')
  let text = await b.text()
  r.check('sem cofre: senha antiga não aparece na lista', !text.includes(SECRET) && text.includes('Banco X') && text.includes('A proteger'))
  await b.click('Banco X', 'main button')
  await sleep(500)
  text = await dialog()
  r.check('detalhe sem cofre: sem "mostrar" nem "copiar" senha, só "Proteger"', !text.includes(SECRET) && text.includes('Proteger') && !(await b.eval(`!!document.querySelector('[role=dialog] [aria-label="Mostrar senha"], [role=dialog] [aria-label="Copiar senha"]')`)))
  await b.eval(`document.querySelector('[role=dialog] button[aria-label="Fechar"]')?.click()`)
  await sleep(400)
  await b.goto(BASE + '#/search')
  await setValue(b, 'input[type=search], input[aria-label^="Buscar"]', SECRET)
  await sleep(600)
  r.check('busca universal não encontra pela senha', !(await b.text()).includes('Banco X'))
  // Edit form without vault: no password field to read.
  await b.goto(BASE + '#/accounts')
  await b.click('Banco X', 'main button')
  await b.click('Editar', '[role=dialog] button')
  await sleep(500)
  r.check('formulário sem cofre: senha não fica na tela', !(await b.eval(`[...document.querySelectorAll('[role=dialog] input')].some((i) => i.value === ${JSON.stringify(SECRET)})`)) && (await dialog()).includes('Criar o cofre para proteger esta senha'))
  await b.click('Salvar', '[role=dialog] button[type=submit]')
  await sleep(500)
  r.check('salvar sem cofre não apaga nem muda a senha antiga', (await idb(b, 'accounts', 'ac1')).password === SECRET)
  r.check('nada foi copiado até aqui', (await copied()).length === 0)

  // ---------- Criar o cofre: migração conferida, sem texto puro em nenhum lugar do aparelho
  await b.goto(BASE + 'favicon.svg')
  await b.goto(BASE + '#/accounts')
  await sleep(500)
  await b.click('Criar cofre', 'main button')
  await b.fill('Senha do cofre', VAULT)
  await b.fill('Repita a senha do cofre', VAULT)
  await b.eval(`[...document.querySelectorAll('[role=dialog] label')].find((l) => l.textContent.includes('Entendi'))?.querySelector('input')?.click()`)
  await b.click('Criar cofre', 'button[type=submit]')
  await sleep(1500)
  await top('Já guardei')
  await top('Fechar')
  await b.eval(`[...document.querySelectorAll('[role=dialog] button')].find((x) => /guardei|continuar|pronto|fechar/i.test(x.textContent))?.click()`)
  await sleep(600)
  const acc = await idb(b, 'accounts', 'ac1')
  r.check('migrada: senha criptografada, campo antigo vazio', acc.password === '' && acc.secret?.ct)
  const local = await everything()
  r.check('nenhuma cópia em texto puro no aparelho (registros, fila de envio, armazenamento local)', !local.includes(SECRET) && !local.includes(VAULT), `${local.length} bytes conferidos`)

  // ---------- Cofre aberto: mostra e copia; esconde sozinho
  await b.goto(BASE + '#/accounts')
  await b.click('Banco X', 'main button')
  await b.click('Mostrar senha', '[role=dialog] button')
  await sleep(500)
  r.check('cofre aberto: mostrar funciona', (await dialog()).includes(SECRET))
  await b.click('Copiar senha', '[role=dialog] button')
  await sleep(300)
  r.check('cofre aberto: copiar funciona', (await copied()).includes(SECRET))
  await sleep(31_000)
  r.check('senha revelada some sozinha em 30 s', !(await dialog()).includes(SECRET))

  // ---------- Fechar o cofre: nada aparece nem é copiado
  await b.eval(`document.querySelector('[role=dialog] button[aria-label="Fechar"]')?.click()`)
  await sleep(400)
  await b.click('Fechar', 'main button')
  await sleep(300)
  await b.click('Banco X', 'main button')
  const before = (await copied()).length
  await b.click('Copiar senha', '[role=dialog] button')
  await sleep(500)
  r.check('cofre fechado: copiar pede a senha do cofre e não copia', (await dialog()).includes('Desbloquear') && (await copied()).length === before)
  await b.fill('Senha do cofre', 'senha-errada-123')
  await b.eval(`[...[...document.querySelectorAll('[role=dialog]')].pop().querySelectorAll('button[type=submit], button')].find((x) => /desbloquear|abrir/i.test(x.textContent))?.click()`)
  // The answer (a short message) comes after the key derivation, which takes a moment on purpose.
  let page = ''
  for (let i = 0; i < 40 && !/incorreta/i.test(page); i++) {
    await sleep(250)
    page = await b.eval('document.body.innerText')
  }
  r.check('senha do cofre errada: recusada, nada aparece', /incorreta/i.test(page) && !page.includes(SECRET), page.match(/.{0,40}incorreta.{0,20}/i)?.[0] ?? page.slice(-200))
  await b.fill('Senha do cofre', VAULT)
  await b.eval(`[...[...document.querySelectorAll('[role=dialog]')].pop().querySelectorAll('button[type=submit], button')].find((x) => /desbloquear|abrir/i.test(x.textContent))?.click()`)
  await sleep(5000)

  // ---------- Formulário aberto e bloqueio por inatividade: a senha sai da tela
  await b.goto(BASE + '#/accounts')
  await b.click('Banco X', 'main button')
  await b.click('Editar', '[role=dialog] button')
  await sleep(800)
  r.check('formulário com cofre aberto mostra o campo (oculto)', await b.eval(`[...document.querySelectorAll('[role=dialog] input')].some((i) => i.value === ${JSON.stringify(SECRET)})`))
  await shiftClock(20)
  await sleep(11_500)
  r.check('bloqueio por inatividade: cofre fecha e a senha sai do formulário', !(await b.eval(`[...document.querySelectorAll('[role=dialog] input')].some((i) => i.value === ${JSON.stringify(SECRET)})`)) && (await dialog()).includes('Abrir o cofre'))
  await b.eval('location.reload()')
  await sleep(2000)

  // ---------- Anotações: nota de 300 mil caracteres
  const t0 = Date.now()
  await b.goto(BASE + '#/notes')
  const openMs = Date.now() - t0
  r.check('nota enorme: a tela abre rápido', (await b.text()).includes('Livro') && openMs < 6000, `${openMs} ms`)
  await setValue(b, 'input[type=search], input[placeholder^="Buscar"]', 'frase-unica-no-final')
  await sleep(800)
  r.check('busca encontra o fim de uma nota enorme', (await b.text()).includes('Livro'))
  await setValue(b, 'input[type=search], input[placeholder^="Buscar"]', 'nao-existe-em-lugar-nenhum')
  await sleep(600)
  r.check('busca sem resultado responde', !(await b.text()).includes('Livro'))
  await setValue(b, 'input[type=search], input[placeholder^="Buscar"]', '')
  await sleep(500)
  await b.click('Livro', 'main button')
  await sleep(1200)
  const len = await b.eval(`document.querySelector('textarea[aria-label="Texto da nota"]')?.value.length`)
  r.check('editor recebe o texto inteiro', len === huge.length, `${len} / ${huge.length}`)
  await b.eval(`(() => { const el = document.querySelector('textarea[aria-label="Texto da nota"]'); el.setRangeText('\\nlinha nova no fim', el.value.length, el.value.length, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await b.click('Salvar', '[role=dialog] button[type=submit]')
  await sleep(1200)
  const saved = await idb(b, 'notes', 'big')
  r.check('salva sem cortar nada', saved.body.length === huge.length + '\nlinha nova no fim'.length && saved.body.endsWith('linha nova no fim'))
  // Draft: written, app closed without saving, reopened.
  await b.click('Nova anotação', 'button')
  await sleep(500)
  await b.eval(`(() => { const el = document.querySelector('textarea[aria-label="Texto da nota"]'); el.value = 'rascunho importante que não pode sumir'; el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(2500)
  await b.eval('location.reload()')
  await sleep(2000)
  await b.goto(BASE + '#/notes')
  await b.click('Nova anotação', 'button')
  await sleep(600)
  r.check('rascunho não salvo é oferecido de volta', (await dialog()).includes('texto não salvo'))
  await b.click('Recuperar', '[role=dialog] button')
  r.check('recuperar devolve o texto', (await b.eval(`document.querySelector('textarea[aria-label="Texto da nota"]').value`)) === 'rascunho importante que não pode sumir')
  await b.eval(`document.querySelector('[role=dialog] button[aria-label="Fechar"]')?.click()`)
  await sleep(400)

  // ---------- Tarefas: repetição vira recorrente; prioridade; várias de uma vez com desfazer
  await b.goto(BASE + '#/tasks')
  await setValue(b, 'input[aria-label="Adicionar tarefa rápida"]', 'Revisar contrato toda segunda')
  await sleep(300)
  r.check('frase com repetição avisa que vira Recorrente', (await b.text()).includes('Recorrente'))
  await b.eval(`document.querySelector('input[aria-label="Adicionar tarefa rápida"]').form.requestSubmit()`)
  await sleep(600)
  r.check('Enter abre o recorrente para conferir (nenhuma tarefa criada)', (await dialog()).includes('Novo recorrente') && !(await idb(b, 'tasks')).some((t) => /contrato/i.test(t.title)))
  await b.eval(`document.querySelector('[role=dialog] button[aria-label="Fechar"]')?.click()`)
  await sleep(400)
  await b.eval(`[...document.querySelectorAll('main button')].find((x) => (x.getAttribute('aria-label') || '').startsWith('Prioridade de Enviar proposta'))?.click()`)
  await sleep(500)
  r.check('prioridade muda com um toque', (await idb(b, 'tasks', 't2')).priority === 'low')
  await b.click('Selecionar', 'main button[aria-label]')
  await b.click('Selecionar Enviar proposta', 'button')
  await b.click('Selecionar Ligar para o banco', 'button')
  await b.click('Concluir', 'button')
  await sleep(700)
  r.check('várias concluídas de uma vez', (await idb(b, 'tasks', 't2')).status === 'done' && (await idb(b, 'tasks', 't3')).status === 'done')
  await b.eval(`[...document.querySelectorAll('[role=status] button')].find((x) => x.textContent === 'Desfazer')?.click()`)
  await sleep(700)
  r.check('desfazer volta as duas', (await idb(b, 'tasks', 't2')).status === 'todo' && (await idb(b, 'tasks', 't3')).status === 'todo')

  // ---------- Semana e Vida
  await b.goto(BASE + '#/week')
  text = await b.text()
  r.check('Semana: topo novo e pendência real da semana', text.includes('Semana') && (text.includes('Ficou pendente') || text.includes('Avançou') || text.includes('Resumo')))
  await b.goto(BASE + '#/life')
  text = await b.text()
  r.check('Vida: abas Calendário · Projetos · Objetivos · Evolução', ['Calendário', 'Projetos', 'Objetivos', 'Evolução'].every((x) => text.includes(x)))

  // ---------- Larguras
  const bad = []
  for (const w of [320, 375, 390]) {
    await width(w)
    for (const path of ['#/notes', '#/tasks', '#/week', '#/life', '#/accounts']) {
      await b.goto(BASE + path)
      if (!(await noHorizontalScroll(b))) bad.push(`${w}${path}`)
    }
  }
  r.check('320, 375 e 390 px: nenhuma das cinco telas rola para o lado', bad.length === 0, bad.join(' '))
  await width(320)
  for (const p of ['notes', 'tasks', 'week', 'life', 'accounts']) {
    await b.goto(BASE + '#/' + p)
    await b.shot(`e3-${p}-320`)
  }
  const final = await everything()
  r.check('no fim: ainda nenhuma senha em texto puro no aparelho', !final.includes(SECRET))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('e3-erro')
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
