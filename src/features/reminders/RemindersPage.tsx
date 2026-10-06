import { BellRing, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isEnabled } from '../../app/modules'
import { PageHeader } from '../../app/Shell'
import { useStore } from '../../data/store'
import type { ModuleId, ReminderKind, ReminderRule } from '../../data/types'
import { formatDateTime } from '../../lib/dates'
import { deviceTimeZone, isValidTimeZone } from '../../lib/zoned'
import { Button } from '../../ui/Button'
import { SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, Select, TextInput } from '../../ui/Field'
import { useSession } from '../account/session'
import { NumberInput, ToggleRow } from '../planner/controls'
import { buildOccurrences, reminderPrefs } from './engine'
import { currentSubscription, enablePush, forgetPushOnThisDevice, isIOS, pushSupport } from './push'

const KINDS: { kind: ReminderKind; label: string; hint: string; timed: boolean; modules: ModuleId[] }[] = [
  { kind: 'tasks', label: 'Tarefas e compromissos', hint: 'Com horário: minutos antes. Só com data: no dia escolhido.', timed: true, modules: ['tasks'] },
  { kind: 'routine', label: 'Rotina e treinos', hint: 'Antes de cada horário da rotina salva', timed: true, modules: ['routine'] },
  { kind: 'meals', label: 'Refeições', hint: 'Mostra só o nome da refeição, nunca o cardápio', timed: true, modules: ['meals'] },
  { kind: 'deadlines', label: 'Prazos de projetos', hint: 'Dias antes do prazo', timed: false, modules: ['projects'] },
  { kind: 'payments', label: 'Pagamentos e cobranças', hint: 'Assinaturas, vendas a receber e assinantes — sem valores', timed: false, modules: ['tools', 'sales', 'subscribers'] },
]

const REASONS: Record<string, string> = {
  'no-api': 'Este navegador não oferece notificações push.',
  'ios-needs-install': 'No iPhone, as notificações só funcionam com o Núcleo instalado: Safari → Compartilhar → “Adicionar à Tela de Início”, e abra pelo ícone.',
  'ios-too-old': 'Notificações de app web exigem iOS 16.4 ou mais novo.',
  'not-configured': 'O envio de notificações ainda não foi configurado no servidor.',
  'no-account': 'Para receber com o app fechado, entre na sua conta (o servidor envia os lembretes).',
  denied: 'As notificações estão bloqueadas para o Núcleo. Libere nas configurações do aparelho/navegador.',
}

export function RemindersPage() {
  const { settings, updateSettings, data } = useStore()
  const { userId } = useSession()
  const { toast } = useFeedback()
  const prefs = reminderPrefs(settings)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const support = pushSupport(Boolean(userId))
  const tz = settings.timeZone || deviceTimeZone()
  const upcoming = buildOccurrences(data, settings, { days: 7 }).slice(0, 5)

  useEffect(() => {
    currentSubscription().then((s) => setSubscribed(Boolean(s)), () => {})
  }, [])

  const setRule = (kind: ReminderKind, patch: Partial<ReminderRule>) =>
    updateSettings({ reminders: { ...prefs, rules: { ...prefs.rules, [kind]: { ...prefs.rules[kind], ...patch } } } })

  const turnOnPush = async () => {
    setBusy(true)
    try {
      await enablePush()
      setSubscribed(true)
      toast('Notificações ativadas neste aparelho')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível ativar', 'error')
    } finally {
      setBusy(false)
    }
  }

  const turnOffPush = async () => {
    await forgetPushOnThisDevice()
    setSubscribed(false)
    toast('Notificações desativadas neste aparelho')
  }

  return (
    <>
      <PageHeader title="Lembretes" subtitle="Escolha o que lembrar, quando e com quanta antecedência" />
      <div className="grid gap-7 lg:grid-cols-2 lg:items-start">
        <div className="space-y-7">
          <section>
            <SectionTitle>O que lembrar</SectionTitle>
            <div className="space-y-3">
              {KINDS.map(({ kind, label, hint, timed, modules }) => {
                const rule = prefs.rules[kind]
                const available = modules.some((m) => isEnabled(settings, m))
                if (!available) return null
                return (
                  <div key={kind} className="card space-y-3 p-3">
                    <ToggleRow checked={rule.enabled} onChange={(v) => setRule(kind, { enabled: v })} hint={hint}>
                      {label}
                    </ToggleRow>
                    {rule.enabled && (
                      <div className="grid grid-cols-2 gap-3 px-1 pb-1">
                        {timed && (
                          <Field label="Minutos antes">
                            <NumberInput label="Minutos antes" value={rule.leadMin} max={720} suffix="min" onChange={(v) => setRule(kind, { leadMin: v })} />
                          </Field>
                        )}
                        {(kind === 'tasks' || !timed) && (
                          <>
                            <Field label={kind === 'tasks' ? 'Sem horário: dias antes' : 'Dias antes'}>
                              <NumberInput label="Dias antes" value={rule.daysBefore} max={30} suffix="dias" onChange={(v) => setRule(kind, { daysBefore: v })} />
                            </Field>
                            <Field label="Horário do aviso">
                              <TextInput type="time" value={rule.at} onChange={(e) => setRule(kind, { at: e.target.value })} />
                            </Field>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          <section>
            <SectionTitle>Privacidade</SectionTitle>
            <ToggleRow checked={prefs.showDetails} onChange={(v) => updateSettings({ reminders: { ...prefs, showDetails: v } })} hint="Desligado: a tela bloqueada mostra só “Núcleo — Você tem uma tarefa”. Valores e o que você come nunca aparecem.">
              Mostrar o nome do item na tela bloqueada
            </ToggleRow>
          </section>
        </div>

        <div className="space-y-7">
          <section>
            <SectionTitle>Com o app fechado</SectionTitle>
            <div className="card space-y-3 p-4">
              <p className="flex items-start gap-2 text-[15px] leading-relaxed">
                <BellRing size={18} className="mt-0.5 shrink-0 text-accent-hi" />
                {subscribed ? 'Este aparelho recebe notificações do Núcleo.' : 'Receba os lembretes como notificação, mesmo com o app fechado.'}
              </p>
              {support.ok ? (
                subscribed ? (
                  <Button variant="secondary" onClick={turnOffPush}>
                    Desativar neste aparelho
                  </Button>
                ) : (
                  <Button onClick={turnOnPush} disabled={busy}>
                    Ativar notificações
                  </Button>
                )
              ) : (
                <p className="flex items-start gap-2 rounded-2xl bg-tint/[0.04] p-3 text-[14px] leading-relaxed text-soft">
                  <Smartphone size={17} className="mt-0.5 shrink-0" />
                  {REASONS[support.reason]}
                </p>
              )}
              <p className="text-[13px] leading-relaxed text-faint">
                Sem notificações, os lembretes aparecem dentro do app quando ele está aberto.{isIOS() ? ' No iPhone, a entrega depende do sistema (modo foco, economia de bateria).' : ''} Lembretes dos próximos 14 dias são preparados sempre que você abre o app.
              </p>
            </div>
          </section>

          <section>
            <SectionTitle>Fuso horário</SectionTitle>
            <div className="card space-y-2 p-4">
              <Field label="Horários da rotina e lembretes em">
                <Select value={tz} onChange={(e) => isValidTimeZone(e.target.value) && updateSettings({ timeZone: e.target.value })}>
                  {[...new Set([tz, deviceTimeZone(), 'America/Sao_Paulo', 'Europe/Lisbon', 'Europe/Madrid', 'Asia/Dubai', 'America/New_York', 'UTC', ...(() => { try { return Intl.supportedValuesOf('timeZone') } catch { return [] } })()])].map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              </Field>
              {tz !== deviceTimeZone() && (
                <p className="text-[13px] leading-relaxed text-warn">
                  Este aparelho está em {deviceTimeZone()}.{' '}
                  <button type="button" className="font-medium underline" onClick={() => updateSettings({ timeZone: deviceTimeZone() })}>
                    Usar o fuso do aparelho
                  </button>
                </p>
              )}
            </div>
          </section>

          {upcoming.length > 0 && (
            <section>
              <SectionTitle>Próximos lembretes</SectionTitle>
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
        </div>
      </div>
    </>
  )
}
