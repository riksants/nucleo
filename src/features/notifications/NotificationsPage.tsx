import { AlarmClock, Bell, BellOff, CalendarClock, CheckCheck, ChevronRight, CircleDollarSign, HandCoins, Hourglass, ListChecks, Repeat, Settings2, Sparkles, Target, Timer, Utensils, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../app/Shell'
import { clearParams, useRoute } from '../../app/router'
import { useStore } from '../../data/store'
import type { ReminderKind, ReminderPrefs } from '../../data/types'
import { formatDateTime } from '../../lib/dates'
import { Button } from '../../ui/Button'
import { EmptyState, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Sheet } from '../../ui/Sheet'
import { useSession } from '../account/session'
import { DEFAULT_REMINDERS, effectivePrefs } from '../reminders/engine'
import { dismiss, feedEntries, isUnread, markSeen, ORIGIN_LABEL, refreshHistory, restore, STATE_HINT, STATE_LABEL, useFeedVersion, type FeedEntry } from './feed'

export const KIND_LABEL: Record<ReminderKind, string> = {
  events: 'Agenda',
  tasks: 'Tarefas',
  habits: 'Hábitos',
  routine: 'Rotina',
  recurring: 'Recorrentes e contas',
  payments: 'A pagar',
  receivables: 'A receber',
  deadlines: 'Prazos',
  meals: 'Alimentação',
  focus: 'Modo foco',
  app: 'Avisos do app',
}

const KIND_ICON: Record<ReminderKind, LucideIcon> = {
  events: CalendarClock,
  tasks: ListChecks,
  habits: Target,
  routine: AlarmClock,
  recurring: Repeat,
  payments: CircleDollarSign,
  receivables: HandCoins,
  deadlines: Hourglass,
  meals: Utensils,
  focus: Timer,
  app: Sparkles,
}

const PAGE = 25

function StateChip({ e }: { e: FeedEntry }) {
  const tone = e.state === 'failed' || e.state === 'expired' || e.state === 'nodevice' ? 'text-warn' : e.state === 'scheduled' ? 'text-soft' : 'text-faint'
  return <span className={`text-[12px] ${tone}`}>{e.dismissed ? 'Dispensado' : STATE_LABEL[e.state]}</span>
}

function Row({ e, onOpen, highlight }: { e: FeedEntry; onOpen(e: FeedEntry): void; highlight?: boolean }) {
  const Icon = e.kind ? KIND_ICON[e.kind] : Bell
  const unread = isUnread(e)
  return (
    <button type="button" onClick={() => onOpen(e)} className={`press flex w-full items-start gap-3 px-4 py-3 text-left ${highlight ? 'bg-accent/[0.06]' : ''}`}>
      <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${unread ? 'bg-accent text-on-accent' : 'bg-tint/[0.06] text-soft'}`}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`min-w-0 truncate text-[15px] ${unread ? 'font-semibold' : 'font-medium'}`}>{e.title}</span>
          <span className="num shrink-0 text-[12px] text-faint">{formatDateTime(e.at.toISOString()).toLowerCase()}</span>
        </span>
        {e.text && e.text !== e.title && <span className="mt-0.5 line-clamp-2 block text-[14px] leading-snug text-soft">{e.text}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-faint">
          <span>{ORIGIN_LABEL[e.origin]}</span>
          <span aria-hidden>·</span>
          <StateChip e={e} />
          {e.grouped && (
            <>
              <span aria-hidden>·</span>
              <span>junto com outros do mesmo minuto</span>
            </>
          )}
        </span>
      </span>
      {unread && <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" aria-label="Não lida" />}
    </button>
  )
}

/**
 * Central de notificações: o que está agendado, o que foi enviado (com o resultado real do envio)
 * e o que apareceu no app. Cada aviso abre o registro dele.
 */
export function NotificationsPage() {
  useFeedVersion()
  const { userId } = useSession()
  const { settings, updateSettings } = useStore()
  const { toast } = useFeedback()
  const { params } = useRoute()
  const [focusAt] = useState(() => params.get('at'))
  const [open, setOpen] = useState<FeedEntry | null>(null)
  const [more, setMore] = useState({ past: PAGE, next: 8 })
  const [showDismissed, setShowDismissed] = useState(false)

  useEffect(() => {
    void refreshHistory(Boolean(userId))
    if (params.get('at')) clearParams()
  }, [userId])

  const { past, upcoming } = feedEntries()
  const group = useMemo(() => {
    if (!focusAt) return []
    const t = Date.parse(focusAt)
    return past.filter((e) => Math.abs(e.at.getTime() - t) < 60_000)
  }, [focusAt, past])
  const active = past.filter((e) => !e.dismissed)
  const unread = active.filter(isUnread)
  const earlier = active.filter((e) => !isUnread(e))
  const dismissed = past.filter((e) => e.dismissed)
  const prefs = effectivePrefs(settings)

  const go = (e: FeedEntry, url: string) => {
    if (isUnread(e)) void markSeen([e.key])
    setOpen(null)
    window.location.hash = url.replace(/^#/, '')
  }

  const silence = (kind: ReminderKind) => {
    const stored: ReminderPrefs = settings.reminders ?? { showDetails: false, rules: {} }
    const patch: ReminderPrefs = prefs.legacy
      ? { ...stored, rules: { ...stored.rules, [kind]: { ...DEFAULT_REMINDERS.rules[kind], ...stored.rules?.[kind], enabled: false } } }
      : { ...stored, kinds: { ...stored.kinds, [kind]: { ...stored.kinds?.[kind], enabled: false } } }
    void updateSettings({ reminders: patch })
    setOpen(null)
    toast(`${KIND_LABEL[kind]}: notificações silenciadas`, undefined, { label: 'Desfazer', run: () => void updateSettings({ reminders: stored }) })
  }

  const empty = !past.length && !upcoming.length

  return (
    <>
      <PageHeader
        title="Central de notificações"
        subtitle={unread.length ? `${unread.length} não ${unread.length === 1 ? 'lida' : 'lidas'}` : 'Tudo lido'}
        actions={
          unread.length ? (
            <Button variant="secondary" icon={<CheckCheck size={16} />} onClick={() => void markSeen(null)}>
              Marcar todas como lidas
            </Button>
          ) : undefined
        }
      />
      <div className="mx-auto max-w-xl space-y-6">
        {!prefs.on && (
          <a href="#/reminders" className="card press flex items-center gap-3 p-4">
            <BellOff size={20} className="shrink-0 text-soft" />
            <span className="min-w-0 flex-1 text-[15px]">As notificações estão desligadas. Ative para receber os lembretes.</span>
            <ChevronRight size={18} className="text-faint" />
          </a>
        )}

        {empty && <EmptyState icon={<Bell size={22} />} title="Nenhuma notificação ainda" text="Quando algo com data ou horário se aproximar, ele aparece aqui — e também chega no aparelho, se as notificações estiverem ligadas." />}

        {group.length > 0 && (
          <section>
            <SectionTitle>Deste aviso</SectionTitle>
            <div className="card divide-y divide-line overflow-hidden">
              {group.map((e) => (
                <Row key={`g${e.key}`} e={e} onOpen={setOpen} highlight />
              ))}
            </div>
          </section>
        )}

        {unread.length > 0 && (
          <section>
            <SectionTitle>Não lidas</SectionTitle>
            <div className="card divide-y divide-line overflow-hidden">
              {unread.map((e) => (
                <Row key={e.key} e={e} onOpen={setOpen} />
              ))}
            </div>
          </section>
        )}

        {upcoming.length > 0 && (
          <section>
            <SectionTitle action={upcoming.length > more.next ? 'Ver mais' : undefined} onAction={() => setMore((m) => ({ ...m, next: m.next + 20 }))}>
              Próximos
            </SectionTitle>
            <div className="card divide-y divide-line overflow-hidden">
              {upcoming.slice(0, more.next).map((e) => (
                <Row key={e.key} e={e} onOpen={setOpen} />
              ))}
            </div>
          </section>
        )}

        {earlier.length > 0 && (
          <section>
            <SectionTitle>Anteriores</SectionTitle>
            <div className="card divide-y divide-line overflow-hidden">
              {earlier.slice(0, more.past).map((e) => (
                <Row key={e.key} e={e} onOpen={setOpen} />
              ))}
            </div>
            {earlier.length > more.past && (
              <div className="mt-2 text-center">
                <Button variant="ghost" onClick={() => setMore((m) => ({ ...m, past: m.past + PAGE }))}>
                  Mostrar mais
                </Button>
              </div>
            )}
          </section>
        )}

        {dismissed.length > 0 && (
          <section>
            <button type="button" onClick={() => setShowDismissed((v) => !v)} className="press flex w-full items-center justify-between rounded-2xl px-4 py-3 text-[15px] text-soft hover:text-ink">
              Dispensadas ({dismissed.length})
              <ChevronRight size={18} className={`text-faint transition-transform ${showDismissed ? 'rotate-90' : ''}`} />
            </button>
            {showDismissed && (
              <div className="card divide-y divide-line overflow-hidden">
                {dismissed.map((e) => (
                  <Row key={e.key} e={e} onOpen={setOpen} />
                ))}
              </div>
            )}
          </section>
        )}

        <a href="#/reminders" className="press flex items-center justify-between rounded-2xl px-4 py-3 text-[15px] text-soft hover:text-ink">
          <span className="inline-flex items-center gap-2">
            <Settings2 size={16} /> Ajustes de notificações
          </span>
          <ChevronRight size={18} className="text-faint" />
        </a>
        <p className="px-1 pb-4 text-[12px] leading-relaxed text-faint">
          “Enviado” quer dizer que o serviço de notificações do aparelho aceitou o envio. O Núcleo não tem como confirmar se a notificação apareceu ou se foi vista. O histórico guarda os últimos 30 dias.
        </p>
      </div>

      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open?.title ?? ''}>
        {open && (
          <div className="space-y-4">
            {open.text && open.text !== open.title && <p className="text-[16px] leading-relaxed">{open.text}</p>}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
              <dt className="text-faint">Quando</dt>
              <dd>{formatDateTime(open.at.toISOString())}</dd>
              <dt className="text-faint">Origem</dt>
              <dd>
                {ORIGIN_LABEL[open.origin]}
                {open.kind ? ` · ${KIND_LABEL[open.kind]}` : ''}
              </dd>
              <dt className="text-faint">Situação</dt>
              <dd>
                {open.dismissed ? 'Dispensado · ' : ''}
                {STATE_LABEL[open.state]}
              </dd>
            </dl>
            <p className="text-[13px] leading-relaxed text-faint">
              {STATE_HINT[open.state]}
              {open.error ? ` Motivo: ${open.error}` : ''}
            </p>
            <div className="grid gap-2">
              {open.url && (
                <Button block onClick={() => go(open, open.url)}>
                  Abrir
                </Button>
              )}
              {open.url && open.origin !== 'app' && open.origin !== 'test' && (
                <Button block variant="secondary" onClick={() => go(open, open.origin === 'mine' || /\?open=/.test(open.url) ? open.url : '#/reminders')}>
                  Ajustar lembrete
                </Button>
              )}
              {isUnread(open) && (
                <Button block variant="secondary" onClick={() => (void markSeen([open.key]), setOpen(null))}>
                  Marcar como lida
                </Button>
              )}
              {open.state !== 'scheduled' &&
                (open.dismissed ? (
                  <Button block variant="ghost" onClick={() => (void restore([open.key]), setOpen(null))}>
                    Restaurar
                  </Button>
                ) : (
                  <Button block variant="ghost" onClick={() => (void dismiss([open.key]), setOpen(null))}>
                    Dispensar
                  </Button>
                ))}
              {open.kind && open.kind !== 'app' && prefs.kinds[open.kind]?.enabled !== false && (
                <Button block variant="ghost" onClick={() => silence(open.kind as ReminderKind)}>
                  Silenciar “{KIND_LABEL[open.kind]}”
                </Button>
              )}
            </div>
          </div>
        )}
      </Sheet>
    </>
  )
}
