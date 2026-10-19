/**
 * Suggestions of automations, from what the person already does. Computed on the fly from the last
 * 90 days, never stored; only the answer is (Settings.ruleSuggestions). Strict on purpose — it is
 * better to say nothing than to suggest something weak:
 * - money (reservations): ≥ 4 similar times (±3 points), ≥ 75% of the chances, over ≥ 21 days;
 * - tasks and categories: ≥ 3 (categories ≥ 5) similar times, ≥ 75% of the chances;
 * - repeated expense: 3 months in a row → "Cadastrar como conta fixa" (never a rule that creates it);
 * - the last time within 45 days; never when an equivalent rule (or fixed bill) already exists.
 * Nothing becomes a rule without the person saving it in the editor.
 */
import { isEnabled } from '../../app/modules'
import type { AutomationRun, Cents, Client, Currency, DataState, InsightMark, MoneyOrigin, Rule, Sale, Settings, Transaction, Weekday } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { categoryLabel } from '../financeCategories'
import { dayOf } from '../indexes'
import { addDaysToDate, weekdayOfDate, zoneOf } from '../period'
import { WEEKDAY_LABEL } from './catalog'
import type { RuleDraft } from './templates'
import { normalize } from './text'

export interface RuleSuggestion {
  /** Stable while the pattern is the same ("Não sugerir isso novamente" holds it forever). */
  key: string
  title: string
  /** "Por quê?" with real numbers. */
  why: string
  /** The occurrences behind it ("05/10 · €1.200 → €240"). */
  items: string[]
  /** Opens the editor filled (never saved by itself). */
  draft?: RuleDraft
  /** Repeated expense: offer to register it as a fixed bill (Assinaturas), never a rule creating expenses. */
  fixedExpense?: { name: string; amount: Cents; currency: Currency; day: number }
}

const WINDOW = 90
const RECENT = 45
const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const ruleTask = (id: string) => id.startsWith('rule-')

type Group = { key: string; origin: MoneyOrigin; category?: string; label: string }

function incomeGroup(t: Transaction, settings: Settings): Group | null {
  const kind = t.source?.kind
  if (kind === 'project') return { key: 'project', origin: 'project', label: 'pagamentos de projeto' }
  if (kind === 'sale' || kind === 'saleGeneral') return { key: 'sale', origin: 'sale', label: 'pagamentos de venda' }
  if (kind === 'subscriber') return { key: 'subscriber', origin: 'subscriber', label: 'pagamentos de assinantes' }
  if (!kind && t.category) return { key: `manual:${t.category}`, origin: 'manual', category: t.category, label: `entradas de ${categoryLabel(settings, t.category)}` }
  return null
}

/** Days the goal received money by hand (automations and rules left out), with how much. */
function handSaves(goalId: string, history: { date: string; saved: number }[], runs: AutomationRun[]): { date: string; delta: number }[] {
  const auto = new Set(runs.filter((r) => r.status === 'done' && r.changed.some((c) => c.collection === 'financeGoals' && c.id === goalId)).map((r) => r.date))
  const h = [...history].sort((a, b) => (a.date < b.date ? -1 : 1))
  const out: { date: string; delta: number }[] = []
  for (let i = 1; i < h.length; i++) {
    const delta = h[i].saved - h[i - 1].saved
    if (delta > 0 && !auto.has(h[i].date)) out.push({ date: h[i].date, delta })
  }
  return out
}

const TRIGGER_FOR: Record<string, RuleDraft['trigger']['kind']> = { project: 'projectPayment', sale: 'salePayment', subscriber: 'subscriberPaid' }

function reserveAfterIncome(data: DataState, settings: Settings, today: string): RuleSuggestion[] {
  const tz = zoneOf(settings)
  const from = addDaysToDate(today, -WINDOW)
  const incomes = data.transactions.filter((t) => t.type === 'in').map((t) => ({ t, day: dayOf(t.createdAt, tz), g: incomeGroup(t, settings) })).filter((x) => x.g && x.day >= from && x.day <= today)
  const out: RuleSuggestion[] = []
  for (const goal of data.financeGoals.filter((g) => g.status === 'active')) {
    const saves = handSaves(goal.id, goal.history ?? [], data.automationRuns)
    if (!saves.length) continue
    const groups = new Map<string, { g: Group; all: typeof incomes; hits: { day: string; amount: number; delta: number; ratio: number }[] }>()
    for (const inc of incomes) {
      if (inc.t.currency !== goal.currency) continue
      const entry = groups.get(inc.g!.key) ?? { g: inc.g!, all: [], hits: [] }
      groups.set(inc.g!.key, entry)
      entry.all.push(inc)
      const save = saves.find((s) => s.date >= inc.day && daysBetween(inc.day, s.date) <= 2)
      if (save && inc.t.amount > 0) entry.hits.push({ day: inc.day, amount: inc.t.amount, delta: save.delta, ratio: save.delta / inc.t.amount })
    }
    for (const { g, all, hits } of groups.values()) {
      if (hits.length < 4) continue
      const m = median(hits.map((h) => h.ratio))
      const close = hits.filter((h) => Math.abs(h.ratio - m) <= 0.03).sort((a, b) => (a.day < b.day ? -1 : 1))
      if (close.length < 4 || close.length / all.length < 0.75) {
        // 2.1: the same AMOUNT each time (±5%) instead of the same share: "reservar valor fixo".
        const md = median(hits.map((h) => h.delta))
        const same = hits.filter((h) => Math.abs(h.delta - md) <= md * 0.05).sort((a, b) => (a.day < b.day ? -1 : 1))
        if (same.length < 4 || same.length / all.length < 0.75) continue
        if (daysBetween(same[0].day, same.at(-1)!.day) < 21 || daysBetween(same.at(-1)!.day, today) > RECENT) continue
        const amount = Math.round(md)
        const fmt = (c: number) => formatMoney(c, goal.currency)
        out.push({
          key: `reserveFixed:${g.key}:${goal.id}:${amount}`,
          title: `Você guardou cerca de ${fmt(amount)} em ${goal.name} depois dos últimos ${same.length} ${g.label}. Quer automatizar?`,
          why: `Em ${same.length} de ${all.length} ${g.label} dos últimos ${WINDOW} dias, você guardou perto de ${fmt(amount)} em ${goal.name} até 2 dias depois.`,
          items: same.map((h) => `${ddmm(h.day)} · ${fmt(h.amount)} → ${fmt(h.delta)}`),
          draft: { name: `Reservar ${fmt(amount)} para ${goal.name}`, trigger: { kind: TRIGGER_FOR[g.origin] ?? 'moneyIn' }, conditions: g.category ? [{ field: 'category', values: [g.category] }] : [], actions: [{ kind: 'reserveFixed', goalId: goal.id, amount }] },
        })
        continue
      }
      if (daysBetween(close[0].day, close.at(-1)!.day) < 21 || daysBetween(close.at(-1)!.day, today) > RECENT) continue
      const pct = Math.round(m * 100)
      if (pct < 1 || pct > 90) continue
      const money = (c: number) => formatMoney(c, goal.currency)
      const draft: RuleDraft = {
        name: `Reservar ${pct}% para ${goal.name}`,
        trigger: { kind: TRIGGER_FOR[g.origin] ?? 'moneyIn' },
        conditions: g.category ? [{ field: 'category', values: [g.category] }] : [],
        actions: [{ kind: 'reservePercent', goalId: goal.id, percent: pct }],
      }
      out.push({
        key: `reserve:${g.key}:${goal.id}:${pct}`,
        title: `Você reservou cerca de ${pct}% dos últimos ${close.length} ${g.label} para ${goal.name}. Quer automatizar?`,
        why: `Em ${close.length} de ${all.length} ${g.label} dos últimos ${WINDOW} dias, você guardou perto de ${pct}% em ${goal.name} até 2 dias depois.`,
        items: close.map((h) => `${ddmm(h.day)} · ${money(h.amount)} → ${money(h.delta)}`),
        draft,
      })
    }
  }
  return out
}

/** "Enviar recibo a Ana" → "Enviar recibo a {cliente}". */
function templateTitle(title: string, swaps: [string | undefined, string][]): string {
  let out = title
  for (const [name, token] of swaps) {
    if (!name || name.trim().length < 3) continue
    const i = out.toLocaleLowerCase('pt-BR').indexOf(name.trim().toLocaleLowerCase('pt-BR'))
    if (i >= 0) out = `${out.slice(0, i)}${token}${out.slice(i + name.trim().length)}`
  }
  return out.trim()
}

function taskAfterProjectDone(data: DataState, settings: Settings, today: string): RuleSuggestion[] {
  const tz = zoneOf(settings)
  const from = addDaysToDate(today, -WINDOW)
  const done = data.projects.filter((p) => p.status === 'done' && p.endDate && p.endDate >= from && p.endDate <= today)
  if (done.length < 3) return []
  const clients = new Map(data.clients.map((c) => [c.id, c.name]))
  const hits: { project: string; day: string; title: string; template: string; due: number | null }[] = []
  for (const p of done) {
    const t = data.tasks
      .filter((x) => x.projectId === p.id && !ruleTask(x.id))
      .map((x) => ({ x, day: dayOf(x.createdAt, tz) }))
      .filter(({ day }) => day >= p.endDate && daysBetween(p.endDate, day) <= 3)
      .sort((a, b) => (a.x.createdAt < b.x.createdAt ? -1 : 1))[0]
    if (!t) continue
    const template = templateTitle(t.x.title, [[clients.get(p.clientId ?? ''), '{cliente}'], [p.name, '{projeto}']])
    hits.push({ project: p.name, day: p.endDate, title: t.x.title, template, due: t.x.dueDate ? Math.max(0, daysBetween(t.day, t.x.dueDate)) : null })
  }
  if (hits.length < 3 || hits.length / done.length < 0.75) return []
  hits.sort((a, b) => (a.day < b.day ? -1 : 1))
  if (daysBetween(hits.at(-1)!.day, today) > RECENT) return []
  const latest = hits.at(-1)!
  const dues = hits.map((h) => h.due).filter((d): d is number => d !== null)
  const due = dues.length >= hits.length / 2 ? Math.round(median(dues)) : null
  return [
    {
      key: `taskAfterProject:${normalize(latest.template)}`,
      title: 'Você cria uma tarefa sempre que conclui um projeto. Quer transformar isso em uma regra?',
      why: `Em ${hits.length} dos ${done.length} projetos concluídos nos últimos ${WINDOW} dias, você criou uma tarefa do projeto até 3 dias depois.`,
      items: hits.map((h) => `${ddmm(h.day)} · ${h.project}: “${h.title}”`),
      draft: { name: 'Tarefa ao concluir projeto', trigger: { kind: 'projectDone' }, conditions: [], actions: [{ kind: 'createTask', title: latest.template, dueDays: due, linkProject: true, priority: 'none' }] },
    },
  ]
}

function taskAfterSale(data: DataState, settings: Settings, today: string): RuleSuggestion[] {
  const tz = zoneOf(settings)
  const from = addDaysToDate(today, -WINDOW)
  const clients = new Map(data.clients.map((c: Client) => [c.id, c.name]))
  const buyer = (s: Sale) => (s.clientId ? (clients.get(s.clientId) ?? '') : s.clientName).trim()
  const sales = data.sales.map((s) => ({ s, day: dayOf(s.createdAt, tz) })).filter(({ day }) => day >= from && day <= today)
  if (sales.length < 3) return []
  const hits: { day: string; who: string; title: string; template: string; due: number | null }[] = []
  for (const { s, day } of sales) {
    const who = buyer(s)
    const names = [who, s.product].filter((n) => n.length >= 3).map(normalize)
    if (!names.length) continue
    const t = data.tasks
      .filter((x) => !ruleTask(x.id) && names.some((n) => normalize(x.title).includes(n)))
      .map((x) => ({ x, tday: dayOf(x.createdAt, tz) }))
      .filter(({ tday }) => tday >= day && daysBetween(day, tday) <= 3)[0]
    if (!t) continue
    hits.push({ day, who: who || s.product, title: t.x.title, template: templateTitle(t.x.title, [[who, '{cliente}'], [s.product, '{venda}']]), due: t.x.dueDate ? Math.max(0, daysBetween(t.tday, t.x.dueDate)) : null })
  }
  if (hits.length < 3 || hits.length / sales.length < 0.75) return []
  hits.sort((a, b) => (a.day < b.day ? -1 : 1))
  if (daysBetween(hits.at(-1)!.day, today) > RECENT) return []
  const latest = hits.at(-1)!
  const dues = hits.map((h) => h.due).filter((d): d is number => d !== null)
  const due = dues.length >= hits.length / 2 ? Math.round(median(dues)) : null
  return [
    {
      key: `taskAfterSale:${normalize(latest.template)}`,
      title: 'Você cria uma tarefa de acompanhamento depois das vendas. Quer automatizar?',
      why: `Em ${hits.length} das ${sales.length} vendas dos últimos ${WINDOW} dias, você criou uma tarefa citando o comprador ou o produto até 3 dias depois.`,
      items: hits.map((h) => `${ddmm(h.day)} · ${h.who}: “${h.title}”`),
      draft: { name: 'Acompanhar depois da venda', trigger: { kind: 'saleCreated' }, conditions: [], actions: [{ kind: 'createTask', title: latest.template, dueDays: due, linkProject: false, priority: 'none' }] },
    },
  ]
}

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7))

function repeatedExpense(data: DataState, settings: Settings, today: string): RuleSuggestion[] {
  if (!isEnabled(settings, 'tools')) return []
  const tz = zoneOf(settings)
  const from = addDaysToDate(today, -150)
  const tools = data.tools.filter((t) => t.status !== 'cancelled').map((t) => normalize(t.name)).filter(Boolean)
  const groups = new Map<string, { t: Transaction; day: string }[]>()
  for (const t of data.transactions) {
    if (t.type !== 'out' || t.source || !t.reason.trim()) continue
    const day = dayOf(t.createdAt, tz)
    if (day < from || day > today) continue
    const key = `${normalize(t.reason)}|${t.currency}`
    groups.set(key, [...(groups.get(key) ?? []), { t, day }])
  }
  const out: RuleSuggestion[] = []
  for (const [key, list] of groups) {
    if (list.length < 3) continue
    const norm = key.split('|')[0]
    if (tools.some((n) => n === norm || norm.includes(n) || n.includes(norm))) continue
    const amount = median(list.map((x) => x.t.amount))
    const day = Math.round(median(list.map((x) => Number(x.day.slice(8, 10)))))
    const fits = list.filter((x) => Math.abs(x.t.amount - amount) <= amount * 0.05 && Math.abs(Number(x.day.slice(8, 10)) - day) <= 2).sort((a, b) => (a.day < b.day ? -1 : 1))
    // One per month, three months in a row.
    const byMonth = new Map<number, (typeof fits)[number]>()
    for (const f of fits) if (!byMonth.has(monthIndex(f.day))) byMonth.set(monthIndex(f.day), f)
    const months = [...byMonth.keys()].sort((a, b) => a - b)
    let run: number[] = []
    let best: number[] = []
    for (const m of months) {
      run = run.length && m === run.at(-1)! + 1 ? [...run, m] : [m]
      if (run.length > best.length) best = run
    }
    if (best.length < 3) continue
    const shown = best.map((m) => byMonth.get(m)!)
    if (daysBetween(shown.at(-1)!.day, today) > RECENT) continue
    const { t } = shown.at(-1)!
    const money = (c: number) => formatMoney(c, t.currency)
    out.push({
      key: `expense:${norm}:${t.currency}`,
      title: `Você registra “${t.reason}” todo mês, perto do dia ${day}. Quer cadastrar como conta fixa?`,
      why: `${best.length} meses seguidos, com valor parecido (${money(Math.round(amount))}). Como conta fixa, o Núcleo cria “A pagar” no dia — você confirma quando pagar. Nenhuma despesa é lançada sozinha.`,
      items: shown.map((x) => `${ddmm(x.day)} · ${money(x.t.amount)}`),
      fixedExpense: { name: t.reason.trim(), amount: Math.round(amount), currency: t.currency, day },
    })
  }
  return out
}

function categoryByText(data: DataState, settings: Settings, today: string): RuleSuggestion[] {
  const tz = zoneOf(settings)
  const from = addDaysToDate(today, -WINDOW)
  const groups = new Map<string, Transaction[]>()
  for (const t of data.transactions) {
    if ((t.type !== 'in' && t.type !== 'out') || t.source || !t.reason.trim()) continue
    const day = dayOf(t.createdAt, tz)
    if (day < from || day > today) continue
    const key = `${t.type}|${normalize(t.reason)}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const out: RuleSuggestion[] = []
  for (const [key, list] of groups) {
    if (list.length < 5) continue
    const cats = new Set(list.map((t) => t.category))
    const cat = list[0].category
    if (cats.size !== 1 || !cat) continue
    const [type, text] = key.split('|') as ['in' | 'out', string]
    const reason = list[0].reason.trim()
    const label = categoryLabel(settings, cat)
    out.push({
      key: `category:${type}:${text}:${cat}`,
      title: `Você sempre coloca “${reason}” em ${label}. Quer que o Núcleo aplique sozinho quando faltar?`,
      why: `${list.length} movimentações com essa descrição nos últimos ${WINDOW} dias, todas em ${label}. A regra só preenche quando a movimentação estiver sem categoria.`,
      items: list.slice(0, 6).map((t) => `${ddmm(dayOf(t.createdAt, tz))} · ${formatMoney(t.amount, t.currency)}`),
      draft: { name: `Categoria ${label} para “${reason}”`, trigger: { kind: type === 'in' ? 'moneyIn' : 'moneyOut' }, conditions: [{ field: 'text', contains: reason }], actions: [{ kind: 'setCategory', category: cat }] },
    })
  }
  return out
}

/** 2.1: a task created right after money came in from a project/sale (linked to it or naming the client). */
function taskAfterPayment(data: DataState, settings: Settings, today: string): RuleSuggestion[] {
  const tz = zoneOf(settings)
  const from = addDaysToDate(today, -WINDOW)
  const clients = new Map(data.clients.map((c) => [c.id, c.name]))
  const out: RuleSuggestion[] = []
  for (const origin of ['project', 'sale'] as const) {
    const incomes = data.transactions
      .filter((t) => t.type === 'in' && (origin === 'project' ? t.source?.kind === 'project' : t.source?.kind === 'sale' || t.source?.kind === 'saleGeneral'))
      .map((t) => ({ t, day: dayOf(t.createdAt, tz) }))
      .filter(({ day }) => day >= from && day <= today)
    if (incomes.length < 3) continue
    const hits: { day: string; who: string; title: string; template: string }[] = []
    for (const { t, day } of incomes) {
      const project = origin === 'project' ? data.projects.find((p) => p.id === t.source!.parentId) : undefined
      const sale = origin === 'sale' ? data.sales.find((x) => x.id === t.source!.parentId) : undefined
      const who = ((project ? clients.get(project.clientId ?? '') : sale ? (sale.clientId ? clients.get(sale.clientId) : sale.clientName) : '') ?? '').trim()
      const task = data.tasks
        .filter((x) => !ruleTask(x.id) && ((project && x.projectId === project.id) || (who.length >= 3 && normalize(x.title).includes(normalize(who)))))
        .map((x) => ({ x, tday: dayOf(x.createdAt, tz) }))
        .filter(({ tday }) => tday >= day && daysBetween(day, tday) <= 2)[0]
      if (!task) continue
      hits.push({ day, who: who || project?.name || 'cliente', title: task.x.title, template: templateTitle(task.x.title, [[who, '{cliente}'], [project?.name, '{projeto}']]) })
    }
    if (hits.length < 3 || hits.length / incomes.length < 0.75) continue
    hits.sort((a, b) => (a.day < b.day ? -1 : 1))
    if (daysBetween(hits.at(-1)!.day, today) > RECENT) continue
    const latest = hits.at(-1)!
    out.push({
      key: `taskAfterPayment:${origin}:${normalize(latest.template)}`,
      title: `Você cria uma tarefa sempre que recebe de ${origin === 'project' ? 'um projeto' : 'uma venda'}. Quer transformar isso em uma regra?`,
      why: `Em ${hits.length} dos ${incomes.length} recebimentos dos últimos ${WINDOW} dias, você criou uma tarefa sobre aquele cliente ou projeto até 2 dias depois.`,
      items: hits.map((h) => `${ddmm(h.day)} · ${h.who}: “${h.title}”`),
      draft: { name: 'Tarefa ao receber', trigger: { kind: origin === 'project' ? 'projectPayment' : 'salePayment' }, conditions: [], actions: [{ kind: 'createTask', title: latest.template, dueDays: 0, linkProject: origin === 'project', priority: 'none' }] },
    })
  }
  return out
}

/** 2.1: a note naming the project, written up to 3 days after it was concluded. */
function noteAfterProjectDone(data: DataState, settings: Settings, today: string): RuleSuggestion[] {
  const tz = zoneOf(settings)
  const from = addDaysToDate(today, -WINDOW)
  const done = data.projects.filter((p) => p.status === 'done' && p.endDate && p.endDate >= from && p.endDate <= today && p.name.trim().length >= 3)
  if (done.length < 3) return []
  const hits: { day: string; project: string; title: string; template: string }[] = []
  for (const p of done) {
    const n = data.notes
      .filter((x) => !ruleTask(x.id) && (normalize(x.title).includes(normalize(p.name)) || normalize(x.body).includes(normalize(p.name))))
      .map((x) => ({ x, day: dayOf(x.createdAt, tz) }))
      .filter(({ day }) => day >= p.endDate && daysBetween(p.endDate, day) <= 3)[0]
    if (n) hits.push({ day: p.endDate, project: p.name, title: n.x.title, template: templateTitle(n.x.title, [[p.name, '{projeto}']]) })
  }
  if (hits.length < 3 || hits.length / done.length < 0.75) return []
  hits.sort((a, b) => (a.day < b.day ? -1 : 1))
  if (daysBetween(hits.at(-1)!.day, today) > RECENT) return []
  const latest = hits.at(-1)!
  const title = latest.template.includes('{projeto}') ? latest.template : `${latest.template} · {projeto}`
  return [
    {
      key: `noteAfterProject:${normalize(title)}`,
      title: 'Você escreve uma nota sempre que conclui um projeto. Quer que o Núcleo já crie a nota?',
      why: `Em ${hits.length} dos ${done.length} projetos concluídos nos últimos ${WINDOW} dias, você criou uma nota citando o projeto até 3 dias depois.`,
      items: hits.map((h) => `${ddmm(h.day)} · ${h.project}: “${h.title}”`),
      draft: { name: 'Nota ao concluir projeto', trigger: { kind: 'projectDone' }, conditions: [], actions: [{ kind: 'createNote', title, body: '' }] },
    },
  ]
}

/** Tasks the person makes by hand (not by rules, plans or the routine), grouped by a comparable title. */
function handTasks(data: DataState, settings: Settings, from: string, today: string) {
  const tz = zoneOf(settings)
  const core = (title: string) => normalize(title).replace(/\d+([/.-]\d+)*/g, '').replace(/\s+/g, ' ').trim()
  const groups = new Map<string, { title: string; day: string }[]>()
  for (const t of data.tasks) {
    if (ruleTask(t.id) || t.planId || t.fromRoutine) continue
    const day = dayOf(t.createdAt, tz)
    if (day < from || day > today) continue
    const key = core(t.title)
    if (key.length < 3) continue
    groups.set(key, [...(groups.get(key) ?? []), { title: t.title, day }])
  }
  return groups
}

/** Weeks counted from a Monday (1970-01-05), so consecutive Mondays are consecutive numbers. */
const weekIndex = (date: string) => Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse('1970-01-05T00:00:00Z')) / (7 * 86_400_000))

const longestRun = (xs: number[]) => {
  let run = 1
  let best = xs.length ? 1 : 0
  for (let k = 1; k < xs.length; k++) {
    run = xs[k] === xs[k - 1] + 1 ? run + 1 : 1
    best = Math.max(best, run)
  }
  return best
}

/** 2.1: the same task created by hand on the same weekday, 4 weeks in a row. */
function weeklyTask(data: DataState, settings: Settings, today: string): RuleSuggestion[] {
  const out: RuleSuggestion[] = []
  for (const [key, list] of handTasks(data, settings, addDaysToDate(today, -WINDOW), today)) {
    for (const wd of [1, 2, 3, 4, 5, 6, 0] as Weekday[]) {
      const days = list.filter((x) => weekdayOfDate(x.day) === wd).sort((a, b) => (a.day < b.day ? -1 : 1))
      const best = longestRun([...new Set(days.map((x) => weekIndex(x.day)))].sort((a, b) => a - b))
      if (best < 4 || daysBetween(days.at(-1)!.day, today) > 14) continue
      const latest = days.at(-1)!
      out.push({
        key: `weeklyTask:${wd}:${key}`,
        title: `Toda ${WEEKDAY_LABEL[wd]} você cria “${latest.title}”. Quer que o Núcleo crie essa tarefa sozinho?`,
        why: `${best} semanas seguidas você criou essa tarefa numa ${WEEKDAY_LABEL[wd]}. A regra só cria a tarefa no dia; você continua decidindo quando fazer.`,
        items: days.slice(-6).map((x) => `${ddmm(x.day)} · “${x.title}”`),
        draft: { name: latest.title, trigger: { kind: 'weekDay', weekdays: [wd] }, conditions: [], actions: [{ kind: 'createTask', title: latest.title, dueDays: 0, linkProject: false, priority: 'none' }] },
      })
    }
  }
  return out
}

/** 2.1: the same task created by hand around the same day of the month, 3 months in a row. */
function monthlyTask(data: DataState, settings: Settings, today: string): RuleSuggestion[] {
  const out: RuleSuggestion[] = []
  for (const [key, list] of handTasks(data, settings, addDaysToDate(today, -120), today)) {
    if (list.length < 3) continue
    const day = Math.round(median(list.map((x) => Number(x.day.slice(8, 10)))))
    const fits = list.filter((x) => Math.abs(Number(x.day.slice(8, 10)) - day) <= 1).sort((a, b) => (a.day < b.day ? -1 : 1))
    const best = longestRun([...new Set(fits.map((x) => monthIndex(x.day)))].sort((a, b) => a - b))
    if (best < 3 || daysBetween(fits.at(-1)!.day, today) > RECENT) continue
    const latest = fits.at(-1)!
    out.push({
      key: `monthlyTask:${day}:${key}`,
      title: `Todo mês, perto do dia ${day}, você cria “${latest.title}”. Quer automatizar?`,
      why: `${best} meses seguidos você criou essa tarefa perto do dia ${day}.`,
      items: fits.slice(-4).map((x) => `${ddmm(x.day)} · “${x.title}”`),
      draft: { name: latest.title, trigger: { kind: 'monthDay', day }, conditions: [], actions: [{ kind: 'createTask', title: latest.title, dueDays: 0, linkProject: false, priority: 'none' }] },
    })
  }
  return out
}

/** A rule already doing the same (same trigger and same kind of action on the same target). */
function covered(s: RuleSuggestion, rules: Rule[]): boolean {
  const d = s.draft
  if (!d) return false
  const target = (a: RuleDraft['actions'][number]) => ('goalId' in a ? a.goalId : 'category' in a ? a.category : 'title' in a ? normalize(a.title) : a.kind)
  return rules.some((r) => r.trigger.kind === d.trigger.kind && r.actions.some((a) => d.actions.some((b) => a.kind === b.kind && target(a) === target(b))))
}

/** Every suggestion that holds now, strongest first (money, then tasks, bills, categories). */
export function ruleSuggestions(data: DataState, settings: Settings, today: string): RuleSuggestion[] {
  const all = [
    ...reserveAfterIncome(data, settings, today),
    ...taskAfterProjectDone(data, settings, today),
    ...taskAfterSale(data, settings, today),
    ...taskAfterPayment(data, settings, today),
    ...noteAfterProjectDone(data, settings, today),
    ...repeatedExpense(data, settings, today),
    ...weeklyTask(data, settings, today),
    ...monthlyTask(data, settings, today),
    ...categoryByText(data, settings, today),
  ]
  return all.filter((s) => !covered(s, data.rules ?? []))
}

/** The one suggestion to show (one at a time), or null. */
export function visibleSuggestion(list: RuleSuggestion[], state: Settings['ruleSuggestions'], today: string): RuleSuggestion | null {
  return (
    list.find((s) => {
      const m = state?.[s.key]
      if (!m) return true
      return m.s === 'snoozed' && Boolean(m.until && m.until <= today)
    }) ?? null
  )
}

export const SNOOZE_DAYS = 30

/** "Não sugerir isso novamente" is kept for good; "Agora não" for 30 days. At most 200 answers. */
export function markSuggestion(state: Settings['ruleSuggestions'], key: string, mark: Omit<InsightMark, 'at'>, now = new Date()): Record<string, InsightMark> {
  const today = now.toISOString().slice(0, 10)
  const next = Object.entries({ ...(state ?? {}), [key]: { ...mark, at: now.toISOString() } })
    .filter(([, m]) => m.s !== 'snoozed' || !m.until || m.until > today)
    .sort((a, b) => (a[1].at < b[1].at ? 1 : -1))
    .slice(0, 200)
  return Object.fromEntries(next)
}
