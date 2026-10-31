/**
 * Sends due reminders. `claim` reserves rows atomically (sent_at set in the same
 * UPDATE), so overlapping cron runs never send the same reminder twice.
 *
 * Etapa 5:
 * - Automatic reminders of the same person and the same minute go as ONE notification that lists
 *   each of them (the center keeps every one, with its own link). Reminders the person set on a
 *   record (`custom`) and the app's own notices always go alone.
 * - Each reminder gets its result: sent (a push service accepted it — not proof it was seen),
 *   failed, or nodevice (nobody subscribed). Never retried, so never duplicated.
 * - Sends run a few at a time (a 9:00 peak doesn't queue for minutes).
 */
export interface DueRow {
  user_id: string
  key: string
  title: string
  body: string
  url: string
  /** Etapa 5 (older servers don't send them: everything then goes alone, as before). */
  kind?: string
  custom?: boolean
  fire_at?: string
}

export interface Subscription {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface RowResult {
  user_id: string
  key: string
  status: 'sent' | 'failed' | 'nodevice'
  sent: number
  failed: number
  error: string | null
  grouped: boolean
}

export interface DispatchDeps {
  claim(limit: number): Promise<DueRow[]>
  subscriptionsFor(userIds: string[]): Promise<Subscription[]>
  send(sub: Subscription, payload: string): Promise<{ gone: boolean }>
  removeSubscription(id: string): Promise<void>
  /** Stores each reminder's result (optional: an older database has nowhere to keep it). */
  record?(results: RowResult[]): Promise<void>
  /** A send failed (logged by the caller; never retried, so never duplicated). */
  onError?(err: unknown): void
}

/** One notification to deliver: a single reminder or a group of the same minute. */
export interface Message {
  user_id: string
  rows: DueRow[]
  payload: { title: string; body: string; url: string; key: string }
}

const MAX_LINES = 4

/** Groups what can be grouped; the rest goes alone, in the order it was claimed. */
export function compose(due: DueRow[]): Message[] {
  const out: Message[] = []
  const groups = new Map<string, DueRow[]>()
  for (const row of due) {
    const groupable = row.custom === false && row.kind !== 'app' && !!row.fire_at
    if (!groupable) {
      out.push({ user_id: row.user_id, rows: [row], payload: { title: row.title, body: row.body, url: row.url, key: row.key } })
      continue
    }
    const minute = new Date(row.fire_at!).toISOString().slice(0, 16)
    const id = `${row.user_id}|${minute}`
    groups.set(id, [...(groups.get(id) ?? []), row])
  }
  for (const [id, rows] of groups) {
    const [user_id, minute] = id.split('|')
    if (rows.length === 1) {
      const [row] = rows
      out.push({ user_id, rows, payload: { title: row.title, body: row.body, url: row.url, key: row.key } })
      continue
    }
    // Each line is that reminder's own lock-screen text (already following the privacy choice).
    const lines = rows.map((r) => (r.title && r.title !== 'Núcleo' ? `${r.title}: ${r.body}` : r.body))
    const shown = lines.slice(0, MAX_LINES)
    if (lines.length > MAX_LINES) shown.push(`+ ${lines.length - MAX_LINES} na central`)
    out.push({
      user_id,
      rows,
      payload: {
        title: `Núcleo · ${rows.length} lembretes`,
        body: shown.join('\n'),
        url: `#/notifications?at=${encodeURIComponent(`${minute}:00.000Z`)}`,
        key: `group:${minute}`,
      },
    })
  }
  return out
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await run(items[next++])
  })
  await Promise.all(workers)
}

export async function dispatch(deps: DispatchDeps, limit = 200, concurrency = 8) {
  const due = await deps.claim(limit)
  if (!due.length) return { due: 0, sent: 0, removed: 0, failed: 0 }
  const subs = await deps.subscriptionsFor([...new Set(due.map((d) => d.user_id))])
  let sent = 0
  let removed = 0
  let failed = 0
  const gone = new Set<string>()
  const results: RowResult[] = []
  await pool(compose(due), concurrency, async (msg) => {
    const payload = JSON.stringify(msg.payload)
    let ok = 0
    let bad = 0
    let error: string | null = null
    for (const sub of subs.filter((s) => s.user_id === msg.user_id)) {
      if (gone.has(sub.id)) continue
      try {
        const res = await deps.send(sub, payload)
        if (res.gone) {
          gone.add(sub.id)
          await deps.removeSubscription(sub.id)
          removed++
        } else {
          ok++
          sent++
        }
      } catch (err) {
        // One failing device must not block the others; the row stays claimed (no retries → no duplicates).
        deps.onError?.(err)
        error = (err instanceof Error ? err.message : String(err)).slice(0, 200)
        bad++
        failed++
      }
    }
    const status: RowResult['status'] = ok > 0 ? 'sent' : bad > 0 ? 'failed' : 'nodevice'
    for (const row of msg.rows) results.push({ user_id: row.user_id, key: row.key, status, sent: ok, failed: bad, error, grouped: msg.rows.length > 1 })
  })
  if (deps.record) {
    try {
      await deps.record(results)
    } catch (err) {
      deps.onError?.(err)
    }
  }
  return { due: due.length, sent, removed, failed }
}
