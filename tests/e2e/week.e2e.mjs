// Etapa 2 — Semana: summary, goals, challenges, streaks, check-in, Score, planning and snapshots,
// all reading the same records. Local mode (no Supabase).
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9371)
const TZ = 'America/Sao_Paulo'
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'agenda', 'week']
const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10)
const weekday = (d) => new Date(`${d}T12:00:00Z`).getUTCDay()
const monday = (d) => addDays(d, -((weekday(d) + 6) % 7))

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await b.goto(BASE + 'favicon.svg')
  const today = await b.eval(`(() => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:${JSON.stringify(TZ)},year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value])); return p.year+'-'+p.month+'-'+p.day })()`)
  const week = monday(today)
  const lastWeek = addDays(week, -7)
  const nextWeek = addDays(week, 7)
  // Two training days this week before today (if the week already has them) + one last week.
  const thisWeekDays = [addDays(today, -1), addDays(today, -2)].filter((d) => d >= week)
  const c = (id, date, status = 'done') => ({ id: `habit:${id}:${date}`, source: 'habit', sourceId: id, date, status })
  await seedExistingUser(
    b,
    {
      habits: [
        { id: 'treino', name: 'Treinar', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: addDays(lastWeek, 0), category: 'training' },
        { id: 'ler', name: 'Ler', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: addDays(lastWeek, 0), category: 'reading' },
      ],
      completions: [...thisWeekDays.map((d) => c('treino', d)), ...thisWeekDays.map((d) => c('ler', d)), c('ler', addDays(today, -3) >= week ? addDays(today, -3) : addDays(lastWeek, 6)), c('treino', addDays(lastWeek, 2)), c('ler', addDays(lastWeek, 2))],
      tasks: [
        { id: 'solta', title: 'Comprar presente', projectId: null, dueDate: '', priority: 'none', status: 'todo', completedAt: null },
        { id: 'feita', title: 'Pagar conta', projectId: null, dueDate: addDays(today, -1) >= week ? addDays(today, -1) : today, priority: 'none', status: 'done', completedAt: new Date().toISOString() },
      ],
    },
    { modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL, startedAt: `${lastWeek}T12:00:00Z` },
  )

  await b.goto(BASE + '#/week')
  await b.sleep(2500) // closer runs ~1.5s after opening
  let text = await b.text()
  r.check('Semana abre com "Sua semana" e resumo com dados reais', text.toUpperCase().includes('SUA SEMANA') && /Treinou \d+ (vez|vezes)/.test(text))
  r.check('Score aparece com áreas (ou dados insuficientes), sem ranking', text.toUpperCase().includes('NÚCLEO SCORE') && !/ranking|outros usuários/i.test(text))
  await b.shot('semana')

  // Snapshot of last week: created once, with versions
  let snap = await idb(b, 'weekSnapshots', lastWeek)
  r.check('semana anterior fechada automaticamente (foto com versões)', snap?.week === lastWeek && snap.metricsVersion === 1 && snap.scoreVersion === 1 && snap.metrics['training.done'] >= 1)
  const closedAt = snap?.closedAt
  await b.send('Page.reload', { ignoreCache: true })
  await b.sleep(3000)
  snap = await idb(b, 'weekSnapshots', lastWeek)
  r.check('foto não é refeita ao abrir de novo', snap?.closedAt === closedAt)
  r.check('semana atual ainda não tem foto', (await idb(b, 'weekSnapshots', week)) === null)

  // Goal "Treinar 4 vezes" — automatic progress
  await b.goto(BASE + '#/week')
  await b.click('Nova meta')
  await b.fill('Nome', 'Treinar 4 vezes')
  await b.click('Criar', 'button[type=submit]').catch(async () => b.click('Salvar', 'button[type=submit]'))
  await b.sleep(500)
  const goals = await idb(b, 'weeklyGoals')
  r.check('meta criada para esta semana medindo dias de treino', goals.length === 1 && goals[0].metric === 'training.days' && goals[0].target === 4 && goals[0].week === week)
  text = await b.text()
  r.check(`meta mostra ${thisWeekDays.length}/4 automaticamente`, text.includes(`${thisWeekDays.length} / 4`))

  // Challenge from template: 5 trainings
  await b.click('Escolher')
  await b.click('5 treinos em uma semana', 'button')
  await b.fill('Começa em', week)
  await b.click('Começar desafio')
  await b.sleep(500)
  text = await b.text()
  r.check('desafio de treinos usa os mesmos treinos (sem registro novo)', text.includes(`${thisWeekDays.length} de 5`) && (await idb(b, 'completions')).length === thisWeekDays.length * 2 + 3)

  // Do today's training in Habits → goal and challenge move together
  await b.goto(BASE + '#/habits')
  await b.click('Concluir Treinar')
  await b.sleep(400)
  await b.goto(BASE + '#/week')
  text = await b.text()
  r.check('treino de hoje atualiza meta e desafio juntos', text.includes(`${thisWeekDays.length + 1} / 4`) && text.includes(`${thisWeekDays.length + 1} de 5`))
  r.check('sequência aparece (hábito diário feito em dias seguidos)', text.toUpperCase().includes('SEQUÊNCIAS') && text.includes('Treinar'))

  // Repeat goal next week (same repeatKey)
  await b.click('Treinar 4 vezes', 'button')
  await b.click('Repetir na próxima semana')
  await b.sleep(400)
  const all = await idb(b, 'weeklyGoals')
  r.check('repetir cria a meta da próxima semana ligada à atual', all.length === 2 && all.some((g) => g.week === nextWeek && g.repeatKey === all[0].repeatKey))

  // Check-in
  await b.click('Como foi sua semana?')
  await b.eval(`[...document.querySelectorAll('[role=radiogroup][aria-label="Como ficou sua energia?"] [role=radio]')][3].click()`)
  await b.eval(`(() => { const el = document.querySelector('[role=dialog] textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Semana corrida, mas boa'); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await b.click('Salvar', '[role=dialog] button')
  await b.sleep(400)
  const ci = await idb(b, 'weekCheckins', week)
  r.check('check-in salvo para esta semana (id = semana), só o que foi respondido', ci?.week === week && ci.answers.energy === 4 && Object.keys(ci.answers).filter((k) => ci.answers[k]).length === 1 && ci.note === 'Semana corrida, mas boa')
  // Last week's check-in is a separate record
  await b.click('Semana anterior')
  await b.click('Como foi sua semana?')
  await b.eval(`[...document.querySelectorAll('[role=radiogroup][aria-label="Como foi seu sono?"] [role=radio]')][1].click()`)
  await b.click('Salvar', '[role=dialog] button')
  await b.sleep(400)
  r.check('check-in de outra semana não sobrescreve o desta', (await idb(b, 'weekCheckins', week))?.answers.energy === 4 && (await idb(b, 'weekCheckins', lastWeek))?.answers.sleep === 2)
  text = await b.text()
  r.check('semana fechada mostra a foto ("fechada")', text.includes('fechada'))

  // Hide Score
  await b.goto(BASE + '#/settings')
  await b.click('Mostrar o NÚCLEO Score', '[role=switch]')
  await b.goto(BASE + '#/week')
  r.check('opção de esconder o Score funciona', !(await b.text()).toUpperCase().includes('NÚCLEO SCORE') && (await b.text()).toUpperCase().includes('SUA SEMANA'))

  // Plan next week: move a loose task to Tuesday → original task changes
  await b.goto(BASE + '#/week?view=plan')
  await b.sleep(600)
  text = await b.text()
  r.check('planejamento mostra os 7 dias da próxima semana e tarefas sem data', text.includes('Comprar presente') && (await b.eval(`document.querySelectorAll('[aria-label^="Nova tarefa em"]').length`)) === 7)
  await b.click('Marcar como prioridade')
  await b.eval(`(() => { const row = [...document.querySelectorAll('main .card > div')].find(el => el.innerText.includes('Comprar presente')); [...row.querySelectorAll('button')].find(x => /^ter/i.test(x.textContent.trim())).click() })()`)
  await b.sleep(500)
  const moved = await idb(b, 'tasks', 'solta')
  r.check('mover para terça altera a data da tarefa original', moved.dueDate === addDays(nextWeek, 1) && moved.priority === 'high')
  r.check('tarefa aparece no dia, sem duplicar', (await idb(b, 'tasks')).length === 2 && (await b.text()).includes('Comprar presente'))
  await b.shot('planejar')
  r.check('sem rolagem horizontal (390px)', await noHorizontalScroll(b))

  await b.desktop()
  await b.goto(BASE + '#/week')
  await b.sleep(800)
  r.check('sem rolagem horizontal (1366px)', await noHorizontalScroll(b))
  await b.shot('semana-desktop')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('semana-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
