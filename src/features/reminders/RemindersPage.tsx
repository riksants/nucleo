import { BellOff, BellRing, ChevronRight, Moon, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isEnabled } from '../../app/modules'
import { PageHeader } from '../../app/Shell'
import { useStore } from '../../data/store'
import type { ModuleId, ReminderKind, ReminderKindPref, ReminderPrefs, ReminderWhen } from '../../data/types'
import { formatDateTime } from '../../lib/dates'
import { deviceTimeZone, isValidTimeZone } from '../../lib/zoned'
import { Button } from '../../ui/Button'
import { SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, Select, TextInput } from '../../ui/Field'
import { Segmented } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { useSession } from '../account/session'
import { Switch } from '../settings/ModulePicker'
import { NumberInput, ToggleRow } from '../planner/controls'
import { buildOccurrences, effectivePrefs } from './engine'
import { currentSubscription, enablePush, forgetPushOnThisDevice, isIOS, pushSupport } from './push'

/** Advanced list. `lead`: has times (minutes before) · `days`: has only dates (days before, time of day). */
const KINDS: {
  kind: ReminderKind
  label: string
  hint: string
  lead?: boolean
  days?: boolean
  modules: ModuleId[]
}[] = [
  {
    kind: 'events',
    label: 'Agenda',
    hint: 'Compromissos e reuniões',
    lead: true,
    modules: ['agenda'],
  },
  {
    kind: 'tasks',
    label: 'Tarefas',
    hint: 'Com horário ou só com data; atrasadas avisam uma vez',
    lead: true,
    days: true,
    modules: ['tasks'],
  },
  {
    kind: 'habits',
    label: 'Hábitos',
    hint: 'No horário de cada hábito; não avisa o que você já marcou',
    lead: true,
    modules: ['habits'],
  },
  {
    kind: 'routine',
    label: 'Rotina',
    hint: 'Início de cada atividade e, ao terminar, “concluiu?”',
    lead: true,
    modules: ['routine'],
  },
  {
    kind: 'recurring',
    label: 'Recorrentes e contas',
    hint: 'Contas avisam dias antes; cada item pode ter o seu',
    lead: true,
    days: true,
    modules: ['recurring'],
  },
  {
    kind: 'payments',
    label: 'A pagar',
    hint: 'Assinaturas e serviços que você paga. Já pago não avisa.',
    days: true,
    modules: ['tools'],
  },
  {
    kind: 'receivables',
    label: 'A receber',
    hint: 'Parcelas de vendas e cobranças de assinantes',
    days: true,
    modules: ['sales', 'subscribers'],
  },
  {
    kind: 'deadlines',
    label: 'Prazos',
    hint: 'Projetos, etapas, objetivos e metas financeiras',
    days: true,
    modules: ['projects', 'life', 'finance'],
  },
  {
    kind: 'meals',
    label: 'Refeições',
    hint: 'Mostra só o nome da refeição, nunca o cardápio',
    lead: true,
    modules: ['meals'],
  },
  {
    kind: 'focus',
    label: 'Modo foco',
    hint: 'Quando a sessão de um hábito chega à meta',
    modules: ['habits'],
  },
]

const WHEN: { value: ReminderWhen; label: string }[] = [
  { value: 'before', label: 'Antes' },
  { value: 'at', label: 'Na hora' },
  { value: 'both', label: 'Antes e na hora' },
]

const WHEN_HINT: Record<ReminderWhen, string> = {
  before: 'Compromissos 30 min antes, tarefas 15 min antes, contas 2 dias antes.',
  at: 'No horário de cada item. O que tem só data avisa às 9h do dia.',
  both: 'Um aviso com antecedência e outro na hora.',
}

const REASONS: Record<string, string> = {
  'no-api': 'Este navegador não mostra notificações. Os lembretes aparecem dentro do app.',
  'ios-needs-install': 'No iPhone, as notificações chegam com o Núcleo instalado: Safari → Compartilhar → “Adicionar à Tela de Início”, e abra pelo ícone.',
  'ios-too-old': 'Notificações exigem iOS 16.4 ou mais novo. Os lembretes aparecem dentro do app.',
  'not-configured': 'O envio com o app fechado não está disponível nesta versão. Os lembretes aparecem dentro do app.',
  'no-account': 'Para receber com o app fechado, entre na sua conta.',
  denied: 'As notificações estão bloqueadas para o Núcleo. Libere em Ajustes do aparelho → Notificações → Núcleo.',
}

export function RemindersPage() {
  const { settings, updateSettings, data } = useStore()
  const { userId } = useSession()
  const { toast } = useFeedback()
  const prefs = effectivePrefs(settings)
  const stored: ReminderPrefs = settings.reminders ?? {
    showDetails: false,
    rules: {},
  }
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const support = pushSupport(Boolean(userId))
  const tz = settings.timeZone || deviceTimeZone()
  const on = prefs.on && !prefs.legacy
  const upcoming = on ? buildOccurrences(data, settings, { days: 7 }).slice(0, 3) : []

  useEffect(() => {
    currentSubscription().then(
      (s) => setSubscribed(Boolean(s)),
      () => {},
    )
  }, [])

  const write = (patch: Partial<ReminderPrefs>) => updateSettings({ reminders: { ...stored, ...patch } })
  const setKind = (kind: ReminderKind, patch: ReminderKindPref) =>
    write({
      kinds: { ...stored.kinds, [kind]: { ...stored.kinds?.[kind], ...patch } },
    })

  // One tap: reminders on for everything relevant, and this device asks for permission (it must be the
  // first thing after the tap on iPhone, before anything else is awaited).
  const turnOn = async () => {
    setBusy(true)
    let problem: string | null = null
    if (support.ok && !subscribed) {
      try {
        await enablePush()
        setSubscribed(true)
      } catch (err) {
        problem = err instanceof Error ? err.message : 'Não foi possível ativar neste aparelho'
      }
    }
    write({ on: true })
    setBusy(false)
    toast(problem ?? 'Notificações ativadas', problem ? 'error' : undefined)
  }

  const turnOff = async () => {
    write({ on: false })
    await forgetPushOnThisDevice().catch(() => {})
    setSubscribed(false)
    toast('Notificações desativadas')
  }

  const status = !on
    ? 'Ative uma vez e o Núcleo lembra sozinho de compromissos, tarefas, contas, cobranças, hábitos e rotina.'
    : support.ok
      ? subscribed
        ? 'Ligadas. Este aparelho recebe os lembretes, mesmo com o app fechado.'
        : 'Ligadas na sua conta, mas este aparelho ainda não recebe.'
      : 'Ligadas. Os lembretes aparecem dentro do app.'

  return (
    <>
      <PageHeader title="Notificações" subtitle="O Núcleo avisa do que tem data e hora, sem você configurar nada" />
      <div className="mx-auto max-w-xl space-y-6">
        <section className="card space-y-4 p-4">
          {/* Off: the big button is the only action. On: one row with the switch, to turn it off. */}
          <div
            role={on ? 'switch' : undefined}
            aria-checked={on ? true : undefined}
            aria-label={on ? 'Notificações' : undefined}
            tabIndex={on ? 0 : undefined}
            onClick={on ? () => void turnOff() : undefined}
            onKeyDown={on ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), void turnOff()) : undefined}
            className={`flex items-center gap-3 ${on ? 'cursor-pointer' : ''}`}
          >
            <span className={`grid size-11 shrink-0 place-items-center rounded-full ${on ? 'bg-accent text-on-accent' : 'bg-tint/[0.06] text-soft'}`}>
              {on ? <BellRing size={20} /> : <BellOff size={20} />}
            </span>
            <span className="min-w-0 flex-1 text-[17px] font-semibold">Notificações</span>
            {on && <Switch checked />}
          </div>
          <p className="text-[14px] leading-relaxed text-soft">{status}</p>
          {!on && (
            <Button block onClick={() => void turnOn()} disabled={busy}>
              Ativar notificações
            </Button>
          )}
          {on && support.ok && !subscribed && (
            <Button block onClick={() => void turnOn()} disabled={busy}>
              Receber neste aparelho
            </Button>
          )}
          {!support.ok && support.reason !== 'not-configured' && (
            <p className="flex items-start gap-2 rounded-2xl bg-tint/[0.04] p-3 text-[14px] leading-relaxed text-soft">
              <Smartphone size={18} className="mt-0.5 shrink-0" />
              {REASONS[support.reason]}
            </p>
          )}
        </section>

        {on && (
          <>
            <section>
              <SectionTitle>Quando avisar</SectionTitle>
              <div className="card space-y-3 p-4">
                <Segmented block label="Quando avisar" value={prefs.when} onChange={(v) => write({ when: v })} options={WHEN} />
                <p className="text-[13px] leading-relaxed text-faint">{WHEN_HINT[prefs.when]}</p>
              </div>
            </section>

            <section>
              <SectionTitle>Horário silencioso</SectionTitle>
              <div className="card space-y-3 p-3">
                <ToggleRow checked={!!prefs.quiet} onChange={(v) => write({ quiet: v ? { from: '22:00', to: '07:00' } : null })} hint="O que cair nesse horário chega quando ele terminar. Uma vez só.">
                  <span className="inline-flex items-center gap-2">
                    <Moon size={16} className="text-soft" />
                    Não avisar à noite
                  </span>
                </ToggleRow>
                {prefs.quiet && (
                  <div className="grid grid-cols-2 gap-3 px-1 pb-1">
                    <Field label="Das">
                      <TextInput
                        type="time"
                        value={prefs.quiet.from}
                        onChange={(e) =>
                          e.target.value &&
                          write({
                            quiet: { ...prefs.quiet!, from: e.target.value },
                          })
                        }
                      />
                    </Field>
                    <Field label="Até">
                      <TextInput
                        type="time"
                        value={prefs.quiet.to}
                        onChange={(e) =>
                          e.target.value &&
                          write({
                            quiet: { ...prefs.quiet!, to: e.target.value },
                          })
                        }
                      />
                    </Field>
                  </div>
                )}
              </div>
            </section>

            {upcoming.length > 0 && (
              <section>
                <SectionTitle>Próximos avisos</SectionTitle>
                <div className="card divide-y divide-line">
                  {upcoming.map((o) => (
                    <div key={o.key} className="flex items-center justify-between gap-3 px-4 py-3 text-[15px]">
                      <span className="min-w-0 truncate">{o.detail}</span>
                      <span className="shrink-0 text-[13px] text-faint">{formatDateTime(o.fireAt.toISOString()).toLowerCase()}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <button type="button" onClick={() => setAdvanced(true)} className="press flex w-full items-center justify-between rounded-2xl px-4 py-3 text-[15px] text-soft hover:text-ink">
              Ajustes avançados
              <ChevronRight size={18} className="text-faint" />
            </button>
          </>
        )}
        {!on && isIOS() && <p className="px-1 text-[13px] leading-relaxed text-faint">No iPhone, a entrega também depende do sistema: modo foco e economia de bateria podem segurar os avisos.</p>}
      </div>

      <Sheet open={advanced} onClose={() => setAdvanced(false)} title="Ajustes avançados" size="lg">
        <div className="space-y-6 pb-4">
          <section>
            <SectionTitle>O que lembrar</SectionTitle>
            <p className="mb-3 px-1 text-[13px] leading-relaxed text-faint">Tudo vem ligado. Mude só o que quiser: o que você ajustar aqui vale mais que a escolha geral.</p>
            <div className="space-y-3">
              {KINDS.filter((k) => k.modules.some((m) => isEnabled(settings, m))).map(({ kind, label, hint, lead, days }) => {
                const k = prefs.kinds[kind]
                const own = stored.kinds?.[kind]?.when
                return (
                  <div key={kind} className="card space-y-3 p-3">
                    <ToggleRow checked={k.enabled} onChange={(v) => setKind(kind, { enabled: v })} hint={hint}>
                      {label}
                    </ToggleRow>
                    {k.enabled &&
                      (lead || days) &&
                      (() => {
                        const before = (own ?? prefs.when) !== 'at'
                        return (
                          <div className="grid grid-cols-2 gap-3 px-1 pb-1">
                            <div className="col-span-2">
                              <Field label="Quando">
                                <Select
                                  value={own ?? ''}
                                  onChange={(e) =>
                                    setKind(kind, {
                                      when: (e.target.value || undefined) as ReminderWhen | undefined,
                                    })
                                  }
                                >
                                  <option value="">Como o geral ({WHEN.find((w) => w.value === prefs.when)!.label.toLowerCase()})</option>
                                  {WHEN.map((w) => (
                                    <option key={w.value} value={w.value}>
                                      {w.label}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                            </div>
                            {lead && before && (
                              <Field label="Minutos antes">
                                <NumberInput label="Minutos antes" value={k.leadMin} max={720} suffix="min" onChange={(v) => setKind(kind, { leadMin: v })} />
                              </Field>
                            )}
                            {days && before && (
                              <Field label={kind === 'recurring' ? 'Contas: dias antes' : 'Dias antes'}>
                                <NumberInput label="Dias antes" value={k.daysBefore} max={30} suffix="dias" onChange={(v) => setKind(kind, { daysBefore: v })} />
                              </Field>
                            )}
                            {days && (
                              <Field label={lead ? 'Sem horário: avisar às' : 'Horário do aviso'}>
                                <TextInput type="time" value={k.at} onChange={(e) => e.target.value && setKind(kind, { at: e.target.value })} />
                              </Field>
                            )}
                          </div>
                        )
                      })()}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle>Mais</SectionTitle>
            <ToggleRow checked={prefs.followUp} onChange={(v) => write({ followUp: v })} hint="Tarefa atrasada, conta ou cobrança pendente: um aviso no dia seguinte. Uma vez só.">
              Avisar de novo se ficar pendente
            </ToggleRow>
            <ToggleRow
              checked={prefs.showDetails}
              onChange={(v) => write({ showDetails: v })}
              hint="Desligado, a tela bloqueada mostra só “Núcleo — Você tem uma conta a pagar”. Valores e o que você come nunca aparecem."
            >
              Mostrar o nome do item na tela bloqueada
            </ToggleRow>
            <Field label="Horários em">
              <Select value={tz} onChange={(e) => isValidTimeZone(e.target.value) && updateSettings({ timeZone: e.target.value })}>
                {[
                  ...new Set([
                    tz,
                    deviceTimeZone(),
                    'America/Sao_Paulo',
                    'Europe/Lisbon',
                    'Europe/Madrid',
                    'Asia/Dubai',
                    'America/New_York',
                    'UTC',
                    ...(() => {
                      try {
                        return Intl.supportedValuesOf('timeZone')
                      } catch {
                        return []
                      }
                    })(),
                  ]),
                ].map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </Field>
            {tz !== deviceTimeZone() && (
              <p className="px-1 text-[13px] leading-relaxed text-warn">
                Este aparelho está em {deviceTimeZone()}.{' '}
                <button type="button" className="font-medium underline" onClick={() => updateSettings({ timeZone: deviceTimeZone() })}>
                  Usar o fuso do aparelho
                </button>
              </p>
            )}
            <p className="px-1 text-[13px] leading-relaxed text-faint">
              Os avisos dos próximos 14 dias são preparados sempre que você abre o app. Concluir, pagar, remarcar ou excluir um item muda ou apaga o aviso na hora. Nada é marcado como feito ou pago
              porque o horário passou.
            </p>
          </section>
        </div>
      </Sheet>
    </>
  )
}
