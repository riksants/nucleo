import { BellPlus, BellRing, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReminderAlert } from '../../data/types'
import { Field, TextInput } from '../../ui/Field'
import { ToggleRow } from '../planner/controls'

const uid = () => Math.random().toString(36).slice(2, 10)

/** "15 min antes", "1 dia antes às 09:00", "Na hora"… */
export function describeAlert(a: ReminderAlert, timed: boolean): string {
  if (a.type === 'at') return timed ? 'Na hora' : 'No dia'
  if (a.type === 'min') {
    if (a.minutes === 0) return 'Na hora'
    if (a.minutes % 1440 === 0) return a.minutes === 1440 ? '1 dia antes' : `${a.minutes / 1440} dias antes`
    if (a.minutes % 60 === 0) return a.minutes === 60 ? '1 h antes' : `${a.minutes / 60} h antes`
    return `${a.minutes} min antes`
  }
  if (a.days === 0) return `No dia às ${a.at}`
  return `${a.days === 1 ? '1 dia' : `${a.days} dias`} antes às ${a.at}`
}

type Preset = { label: string; make(): ReminderAlert }
const TIMED: Preset[] = [
  { label: 'Na hora', make: () => ({ id: uid(), type: 'at' }) },
  { label: '10 min antes', make: () => ({ id: uid(), type: 'min', minutes: 10 }) },
  { label: '30 min antes', make: () => ({ id: uid(), type: 'min', minutes: 30 }) },
  { label: '1 h antes', make: () => ({ id: uid(), type: 'min', minutes: 60 }) },
  { label: '1 dia antes às 09:00', make: () => ({ id: uid(), type: 'day', days: 1, at: '09:00' }) },
]
const DATED: Preset[] = [
  { label: 'No dia às 09:00', make: () => ({ id: uid(), type: 'day', days: 0, at: '09:00' }) },
  { label: '1 dia antes às 09:00', make: () => ({ id: uid(), type: 'day', days: 1, at: '09:00' }) },
  { label: '2 dias antes às 09:00', make: () => ({ id: uid(), type: 'day', days: 2, at: '09:00' }) },
  { label: '1 semana antes às 09:00', make: () => ({ id: uid(), type: 'day', days: 7, at: '09:00' }) },
]

const same = (a: ReminderAlert, b: ReminderAlert) => describeAlert(a, true) === describeAlert(b, true)

/**
 * The record's own reminders. Empty = the general setting (Notificações). Several are allowed
 * ("2 dias antes e no dia"); "Pausar" keeps them but sends none until turned back on.
 */
export function AlertsField({
  value,
  off,
  timed,
  onChange,
  hint,
}: {
  value: ReminderAlert[] | undefined
  off: boolean | undefined
  /** The item has a time (minutes before make sense). */
  timed: boolean
  onChange(alerts: ReminderAlert[], off: boolean): void
  hint?: string
}) {
  const alerts = value ?? []
  const [adding, setAdding] = useState(false)
  const [custom, setCustom] = useState<{ days: string; at: string; minutes: string }>({ days: '1', at: '09:00', minutes: '15' })
  const add = (a: ReminderAlert) => {
    if (!alerts.some((x) => same(x, a))) onChange([...alerts, a].slice(0, 8), !!off)
    setAdding(false)
  }
  const presets = timed ? TIMED : DATED
  return (
    <Field label="Lembretes" hint={hint ?? (alerts.length ? 'deste item' : 'padrão das Notificações')}>
      <div className="space-y-2">
        {alerts.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {alerts.map((a) => (
              <li key={a.id} className={`inline-flex items-center gap-1 rounded-full border border-line-strong py-1 pr-1 pl-3 text-[14px] ${off ? 'text-faint line-through' : ''}`}>
                <BellRing size={14} className="text-soft" />
                {describeAlert(a, timed)}
                <button
                  type="button"
                  aria-label={`Remover lembrete ${describeAlert(a, timed)}`}
                  onClick={() => onChange(alerts.filter((x) => x.id !== a.id), !!off)}
                  className="press grid size-7 place-items-center rounded-full text-faint hover:text-ink"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} className="press inline-flex min-h-10 items-center gap-2 rounded-full px-1 text-[15px] font-medium text-accent">
            <BellPlus size={17} />
            {alerts.length ? 'Adicionar outro aviso' : 'Escolher quando avisar'}
          </button>
        ) : (
          <div className="space-y-3 rounded-2xl bg-tint/[0.04] p-3">
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button key={p.label} type="button" onClick={() => add(p.make())} className="press min-h-9 rounded-full border border-line-strong px-3 text-[14px]">
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <Field label="Dias antes">
                <TextInput inputMode="numeric" value={custom.days} onChange={(e) => setCustom((c) => ({ ...c, days: e.target.value.replace(/\D/g, '').slice(0, 2) }))} />
              </Field>
              <Field label="Às">
                <TextInput type="time" value={custom.at} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, at: e.target.value }))} />
              </Field>
              <button type="button" onClick={() => add({ id: uid(), type: 'day', days: Math.min(60, Number(custom.days) || 0), at: custom.at })} className="press mb-0.5 min-h-11 rounded-full bg-accent px-4 text-[14px] font-medium text-on-accent">
                Adicionar
              </button>
            </div>
            {timed && (
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <Field label="Minutos antes">
                  <TextInput inputMode="numeric" value={custom.minutes} onChange={(e) => setCustom((c) => ({ ...c, minutes: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
                </Field>
                <button type="button" onClick={() => add({ id: uid(), type: 'min', minutes: Math.min(10080, Number(custom.minutes) || 0) })} className="press mb-0.5 min-h-11 rounded-full border border-line-strong px-4 text-[14px] font-medium">
                  Adicionar
                </button>
              </div>
            )}
            <button type="button" onClick={() => setAdding(false)} className="press text-[14px] text-soft">
              Cancelar
            </button>
          </div>
        )}
        <ToggleRow checked={!!off} onChange={(v) => onChange(alerts, v)} hint={off ? 'Nenhum aviso deste item é enviado até você ligar de novo.' : undefined}>
          Pausar lembretes deste item
        </ToggleRow>
        {alerts.length > 0 && (
          <button type="button" onClick={() => onChange([], false)} className="press text-[13px] text-faint hover:text-ink">
            Voltar ao padrão das Notificações
          </button>
        )}
      </div>
    </Field>
  )
}

/** Fields to save on the record: nothing stored when it uses the general setting. */
export function alertFields(alerts: ReminderAlert[] | undefined, off: boolean | undefined): { alerts?: ReminderAlert[]; alertsOff?: boolean } {
  return { alerts: alerts?.length ? alerts : undefined, alertsOff: off ? true : undefined }
}

/** The record's alerts as a separate piece of the form (reset when the form opens). */
export function useAlertsDraft(open: boolean, rec: { alerts?: ReminderAlert[]; alertsOff?: boolean } | null | undefined) {
  const [v, setV] = useState({ alerts: rec?.alerts ?? [], off: !!rec?.alertsOff })
  useEffect(() => {
    if (open) setV({ alerts: rec?.alerts ?? [], off: !!rec?.alertsOff })
  }, [open])
  return {
    fields: alertFields(v.alerts, v.off),
    render: (timed: boolean, hint?: string) => <AlertsField value={v.alerts} off={v.off} timed={timed} hint={hint} onChange={(alerts, off) => setV({ alerts, off })} />,
  }
}
