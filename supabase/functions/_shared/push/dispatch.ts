/**
 * Sends due reminders. `claim` reserves rows atomically (sent_at set in the same
 * UPDATE), so overlapping cron runs never send the same reminder twice.
 */
export interface DueRow {
  user_id: string
  key: string
  title: string
  body: string
  url: string
}

export interface Subscription {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface DispatchDeps {
  claim(limit: number): Promise<DueRow[]>
  subscriptionsFor(userIds: string[]): Promise<Subscription[]>
  send(sub: Subscription, payload: string): Promise<{ gone: boolean }>
  removeSubscription(id: string): Promise<void>
}

export async function dispatch(deps: DispatchDeps, limit = 200) {
  const due = await deps.claim(limit)
  if (!due.length) return { due: 0, sent: 0, removed: 0 }
  const subs = await deps.subscriptionsFor([...new Set(due.map((d) => d.user_id))])
  let sent = 0
  let removed = 0
  const gone = new Set<string>()
  for (const row of due) {
    const payload = JSON.stringify({ title: row.title, body: row.body, url: row.url, key: row.key })
    for (const sub of subs.filter((s) => s.user_id === row.user_id && !gone.has(s.id))) {
      try {
        const res = await deps.send(sub, payload)
        if (res.gone) {
          gone.add(sub.id)
          await deps.removeSubscription(sub.id)
          removed++
        } else sent++
      } catch {
        // One failing device must not block the others; the row stays claimed (no retries → no duplicates).
      }
    }
  }
  return { due: due.length, sent, removed }
}
