/**
 * The person's records as search entries, only from visible sections. Passwords, vault secrets and the notes of
 * an access are never indexed or shown: an access is found by its name, site, e-mail or user.
 */
import { isEnabled } from '../../app/modules'
import { categoryLabel } from '../../core/financeCategories'
import { mealTitle, typeLabel } from '../../core/meals'
import { PLAN_STATUS_LABEL } from '../../core/plans'
import { saleRemaining } from '../../data/sales'
import type { DataState, ModuleId, Settings } from '../../data/types'
import { formatDateTime, formatDateValue } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { makeEntry, RecordIndex, type RecordEntry } from './search'

const amountWords = (cents: number) => {
  const v = Math.abs(cents) / 100
  return `${v} ${v.toFixed(2).replace('.', ',')}`
}

export function buildRecordIndex(data: DataState, settings: Settings): RecordIndex {
  const on = (id: ModuleId) => isEnabled(settings, id)
  const clientName = new Map(data.clients.map((c) => [c.id, c.name]))
  const projectName = new Map(data.projects.map((p) => [p.id, p.name]))
  const out: RecordEntry[] = []

  if (on('clients'))
    for (const c of data.clients) out.push(makeEntry({ group: 'Clientes', path: '/clients', openId: c.id, title: c.name, subtitle: c.company || c.email || undefined }, [c.company, c.email, c.phone, c.whatsapp, c.location, c.notes]))

  if (on('projects'))
    for (const p of data.projects) {
      const client = p.clientId ? clientName.get(p.clientId) : undefined
      out.push(makeEntry({ group: 'Projetos de trabalho', path: '/projects', openId: p.id, title: p.name, subtitle: client || p.link || undefined }, [client, p.notes, p.link]))
    }

  if (on('tasks'))
    for (const t of data.tasks) {
      const project = t.projectId ? projectName.get(t.projectId) : undefined
      const sub = [t.status === 'done' ? 'Feita' : t.dueDate ? `Até ${formatDateValue(t.dueDate)}` : '', project].filter(Boolean).join(' · ')
      out.push(makeEntry({ group: 'Tarefas', path: '/tasks', openId: t.id, title: t.title, subtitle: sub || undefined }, [t.notes, project]))
    }

  if (on('sales'))
    for (const s of data.sales) {
      const left = saleRemaining(s)
      const title = s.product || s.clientName
      out.push(makeEntry({ group: 'Vendas', path: '/sales', openId: s.id, title, subtitle: [s.product ? s.clientName : '', left > 0 ? `${formatMoney(left, s.currency)} a receber` : 'Pago'].filter(Boolean).join(' · ') }, [s.clientName, s.product, s.notes, amountWords(s.total)]))
    }

  if (on('subscribers')) {
    const plan = new Map(data.subPlans.map((p) => [p.id, p.name]))
    const offering = new Map(data.offerings.map((o) => [o.id, o.name]))
    for (const s of data.subscribers) {
      const where = [offering.get(s.offeringId), plan.get(s.planId)].filter(Boolean).join(' · ')
      out.push(makeEntry({ group: 'Assinantes', path: '/subscribers', openId: s.id, title: s.name, subtitle: where || s.email || undefined }, [s.email, s.notes, where]))
    }
  }

  if (on('tools'))
    for (const t of data.tools) out.push(makeEntry({ group: 'Assinaturas', path: '/tools', openId: t.id, title: t.name, subtitle: t.price ? formatMoney(t.price, t.currency) : t.plan || undefined }, [t.plan, t.notes, t.link]))

  if (on('finance'))
    for (const t of data.transactions) {
      const cat = t.category ? categoryLabel(settings, t.category) : ''
      out.push(
        makeEntry(
          { group: 'Movimentações', path: '/finance', openId: t.id, title: t.reason, subtitle: `${formatMoney(t.baseAmount >= 0 ? t.amount : -t.amount, t.currency, { sign: true })} · ${formatDateTime(t.createdAt)}${cat ? ` · ${cat}` : ''}` },
          [cat, amountWords(t.amount)],
        ),
      )
    }

  if (on('notes'))
    for (const n of data.notes) out.push(makeEntry({ group: 'Anotações', path: '/notes', openId: n.id, title: n.title || n.body.slice(0, 60), subtitle: n.title ? n.body.slice(0, 80) : undefined }, [n.body]))

  // Name, site, e-mail and user only (never the password, the sealed secret or the access notes).
  if (on('accounts'))
    for (const a of data.accounts) out.push(makeEntry({ group: 'Senhas', path: '/accounts', openId: a.id, title: a.name, subtitle: a.email || a.username || undefined }, [a.link, a.email, a.username]))

  if (on('goals'))
    for (const g of data.goals) out.push(makeEntry({ group: 'Metas de compra', path: '/goals', openId: g.id, title: g.name, subtitle: formatMoney(g.price, g.currency) }, [g.note]))

  if (on('portfolio'))
    for (const p of data.portfolio) {
      const client = p.clientId ? clientName.get(p.clientId) : undefined
      out.push(makeEntry({ group: 'Portfólio', path: '/portfolio', openId: p.id, title: p.name, subtitle: client || p.link || undefined }, [p.notes, p.link, client]))
    }

  if (on('agenda'))
    for (const ev of data.events) out.push(makeEntry({ group: 'Compromissos', path: '/agenda', openId: ev.id, title: ev.title, subtitle: `${formatDateValue(ev.date)} · ${ev.start}` }, [ev.notes]))

  if (on('habits'))
    for (const h of data.habits) out.push(makeEntry({ group: 'Hábitos', path: '/habits', openId: h.id, title: h.name, subtitle: h.goal || undefined }, [h.goal]))

  if (on('recurring'))
    for (const x of data.recurring) out.push(makeEntry({ group: 'Recorrentes', path: '/recurring', openId: x.id, title: x.title }, [x.notes]))

  if (on('life')) {
    for (const p of data.lifePlans)
      out.push(makeEntry({ group: p.kind === 'project' ? 'Projetos pessoais' : 'Objetivos', path: '/life', openId: p.id, title: p.title, subtitle: PLAN_STATUS_LABEL[p.status] }, [p.description, p.notes, p.category]))
    // A step opens its project/objective.
    const planTitle = new Map(data.lifePlans.map((p) => [p.id, p.title]))
    for (const s of data.planSteps) {
      const parent = planTitle.get(s.planId)
      if (parent !== undefined) out.push(makeEntry({ group: 'Etapas', path: '/life', openId: s.planId, key: s.id, title: s.title, subtitle: parent }, [s.notes]))
    }
  }

  // Meals by name/description (ingredients alone don't flood the results).
  if (on('meals'))
    for (const m of data.meals) {
      const type = typeLabel(settings, m.type)
      out.push(makeEntry({ group: 'Refeições', path: '/meals', openId: m.id, title: mealTitle(settings, m), subtitle: `${type && m.name ? `${type} · ` : ''}${formatDateValue(m.date)}` }, [m.description, type]))
    }

  if (on('inbox'))
    for (const i of data.inbox) out.push(makeEntry({ group: 'Caixa de entrada', path: '/inbox', openId: i.id, title: i.text.slice(0, 80), subtitle: i.status === 'done' ? 'Organizado' : 'Para organizar' }, [i.text]))

  return new RecordIndex(out)
}
