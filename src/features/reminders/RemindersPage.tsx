import { BellOff, BellRing, ChevronRight, Moon, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isEnabled } from '../../app/modules'
import { PageHeader } from '../../app/Shell'
import { useStore } from '../../data/store'
import type { ModuleId, ReminderKind, ReminderKindPref, ReminderPrefs, ReminderPrivacy, ReminderWhen } from '../../data/types'
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
import { buildOccurrences, effectivePrefs, lockText } from './engine'
import { currentSubscription, enablePush, forgetPushOnThisDevice, isIOS, pushSupport, sendTestPush } from './push'

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
    kind: 'app',
    label: 'Avisos do app',
    hint: 'Regra aguardando sua confirmação, “Me avisar” de uma regra, automação que falhou',
    modules: [],
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

const PRIVACY: { value: ReminderPrivacy; label: string }[] = [
  { value: 'noAmounts', label: 'Sem valores' },
  { value: 'complete', label: 'Completo' },
  { value: 'discreet', label: 'Discreto' },
]

const PRIVACY_HINT: Record<ReminderPrivacy, string> = {
  noAmounts: 'Diz o que é e quando, sem valores em dinheiro nem o cardápio. Recomendado.',
  complete: 'Mostra tudo, inclusive valores. Qualquer pessoa que veja a tela bloqueada lê.',
  discreet: 'Só “Núcleo” e o tipo de aviso. Os detalhes ficam dentro do app.',
}

/** What to do on each platform to get notifications with the app closed. */
const STEPS: Partial<Record<string, string[]>> = {
  'ios-needs-install': [
    'Abra hellonucleo.app no Safari.',
    'Toque em Compartilhar (o quadrado com a seta) e em “Adicionar à Tela de Início”.',
    'Abra o Núcleo pelo ícone novo na Tela de Início.',
    'Volte aqui e toque em “Ativar notificações”. O iPhone vai pedir permissão: toque em Permitir.',
  ],
  denied: [
    'iPhone: Ajustes → Notificações → Núcleo → Permitir Notificações.',
    'Android: toque e segure o ícone do Núcleo → Informações do app → Notificações.',
    'Computador: clique no cadeado ao lado do endereço → Notificações → Permitir.',
    'Depois, volte aqui e toque em “Receber neste aparelho”.',
  ],
}

const REASONS: Record<string, string> = {
  'no-api': 'Este navegador não mostra notificações. Os lembretes aparecem dentro do app.',
  'ios-needs-install': 'No iPhone, as notificações chegam com o Núcleo instalado: Safari → Compartilhar → “Adicionar à Tela de Início”, e abra pelo ícone.',
  'ios-too-old': 'Notificações exigem iOS 16.4 ou mais novo. Os lembretes aparecem dentro do app.',
  'not-configured': 'O envio com o app fechado não está disponível nesta versão. Os lembretes aparecem dentro do app.',
  'no-account': 'Sem conta, os lembretes só aparecem com o Núcleo aberto: avisos com o app fechado precisam de um servidor que envie na hora certa. Entre ou crie uma conta (grátis) para receber com o app fechado.',
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
  const [testing, setTesting] = useState(false)
  const device = deviceTimeZone()
  // Example of the lock screen with the chosen privacy, from a real upcoming reminder (never invented).
  const sample = upcoming.find((o) => o.detail !== o.plain) ?? upcoming[0]
  const preview = (p: ReminderPrivacy) => (sample ? lockText(p, sample.kind, sample.title === 'Núcleo' ? sample.plain : sample.title, sample.detail, sample.plain) : null)
  const test = async () => {
    setTesting(true)
    try {
      await sendTestPush()
      toast('Teste enviado. Deve chegar em até 1 minuto, também com o app fechado.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível enviar o teste', 'error')
    } finally {
      setTesting(false)
    }
  }

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
          {on && support.ok && subscribed && userId && (
            <Button block variant="secondary" onClick={() => void test()} disabled={testing}>
              Enviar teste para este aparelho
            </Button>
          )}
          {!support.ok && support.reason !== 'not-configured' && (
            <div className="space-y-2 rounded-2xl bg-tint/[0.04] p-3 text-[14px] leading-relaxed text-soft">
              <p className="flex items-start gap-2">
                <Smartphone size={18} className="mt-0.5 shrink-0" />
                {REASONS[support.reason]}
              </p>
              {STEPS[support.reason] && (
                <ol className="list-decimal space-y-1 pl-9">
                  {STEPS[support.reason]!.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
              {support.reason === 'no-account' && (
                <a href="#/account" className="inline-block pl-7 font-medium text-accent">
                  Entrar ou criar conta
                </a>
              )}
            </div>
          )}
        </section>

        {on && (
          <>
            {tz !== device && (
              <div className="card space-y-2 p-4 text-[14px] leading-relaxed">
                <p>
                  Seus lembretes seguem o horário de <strong>{tz}</strong>. Este aparelho está em <strong>{device}</strong>.
                </p>
                <p className="text-faint">Uma tarefa às 9h continua às 9h de {tz} até você mudar. Se você mudou de cidade, use o fuso do aparelho.</p>
                <Button variant="secondary" onClick={() => updateSettings({ timeZone: device })}>
                  Usar {device}
                </Button>
              </div>
            )}

            <section>
              <SectionTitle>Na tela bloqueada</SectionTitle>
              <div className="card space-y-3 p-4">
                <Segmented block label="Na tela bloqueada" value={prefs.privacy} onChange={(v) => write({ privacy: v })} options={PRIVACY} />
                <p className="text-[13px] leading-relaxed text-faint">{PRIVACY_HINT[prefs.privacy]} Senhas e dados do cofre nunca aparecem.</p>
                {preview(prefs.privacy) && (
                  <div className="rounded-2xl bg-tint/[0.05] px-3.5 py-2.5 text-[14px] leading-snug" aria-label="Exemplo com um aviso seu">
                    <span className="block font-semibold">{preview(prefs.privacy)!.title}</span>
                    <span className="block text-soft">{preview(prefs.privacy)!.body}</span>
                  </div>
                )}
              </div>
            </section>

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
              {KINDS.filter((k) => !k.modules.length || k.modules.some((m) => isEnabled(settings, m))).map(({ kind, label, hint, lead, days }) => {
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
            <p className="px-1 text-[13px] leading-relaxed text-faint">
              Com conta, o servidor continua enviando os lembretes que se repetem (contas, hábitos, rotina, assinaturas) e as datas mais distantes, mesmo se você ficar semanas sem abrir o
              app. Concluir, pagar, remarcar ou excluir um item muda ou apaga o aviso assim que este aparelho sincroniza. Nada é marcado como feito ou pago porque o horário passou.
            </p>
          </section>
        </div>
      </Sheet>
    </>
  )
}
