import { Bell, ChevronRight, Gauge, Sunrise, Coins, Download, KeyRound, LayoutGrid, RefreshCw, Scale, Upload, UserRound } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { isEnabled } from '../../app/modules'
import { navigate } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { useStore } from '../../data/store'
import { COLLECTION_NAMES, type Account, type Currency, type DataState, type ModuleId } from '../../data/types'
import { backupFileName, buildBackup, parseBackup, saveFile, type ParsedBackup } from '../../lib/backup'
import { formatDateTime } from '../../lib/dates'
import { amountToInput, currencyInfo, formatMoney, formatNumber, parseAmount } from '../../lib/money'
import { vaultPasswordProblem } from '../../lib/vault'
import { effectiveRates } from '../../lib/rates'
import { Button } from '../../ui/Button'
import { Badge, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft } from '../../ui/formHooks'
import { CurrencySheet, quickCurrencies } from '../../ui/CurrencySheet'
import { Segmented } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { COLLECTION_LABELS } from '../account/MigrationOffer'
import { useSession } from '../account/session'
import { AUTO_LOCK_OPTIONS, useVault } from '../accounts/vault'
import { ModulePicker, Switch } from './ModulePicker'


function Group({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="card divide-y divide-line overflow-hidden">{children}</div>
      {note && <p className="mt-2 px-1 text-[13px] leading-relaxed text-faint">{note}</p>}
    </section>
  )
}

function Row({ label, value, icon, onClick }: { label: string; value?: ReactNode; icon?: ReactNode; onClick?(): void }) {
  const content = (
    <>
      {icon && <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent-hi">{icon}</span>}
      <span className="min-w-0 flex-1 text-[15px]">{label}</span>
      {value !== undefined && <span className="num shrink-0 text-right text-[15px] text-soft">{value}</span>}
      {onClick && <ChevronRight size={18} className="shrink-0 text-faint" />}
    </>
  )
  const cls = 'flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left'
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} transition-colors hover:bg-white/[0.03] active:bg-white/[0.05]`}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  )
}

function AdjustSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { balance, settings, adjustBalance } = useStore()
  const { toast } = useFeedback()
  const [d, set] = useDraft(open, () => ({ value: amountToInput(balance) }))
  const submit = async () => {
    const target = parseAmount(d.value.replace(/^-/, ''))
    if (target === null) return 'Digite um valor válido'
    const signed = d.value.trim().startsWith('-') ? -target : target
    const tx = await adjustBalance(signed)
    toast(tx ? 'Saldo ajustado' : 'O saldo já está correto')
    onClose()
  }
  return (
    <FormSheet open={open} onClose={onClose} title="Corrigir saldo" submitLabel="Salvar ajuste" onSubmit={submit}>
      <p className="pb-5 text-[15px] leading-relaxed text-soft">
        Informe quanto você tem de verdade agora. A diferença entra no histórico como <span className="text-ink">“Ajuste de saldo”</span>.
      </p>
      <Field label={`Saldo real (${settings.baseCurrency})`} hint={`atual: ${formatMoney(balance, settings.baseCurrency)}`}>
        <TextInput className="num text-[20px]!" inputMode="decimal" value={d.value} onChange={(e) => set('value', e.target.value)} autoFocus />
      </Field>
    </FormSheet>
  )
}

function RatesSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { settings, updateSettings } = useStore()
  const { toast } = useFeedback()
  const codes = quickCurrencies(settings, [settings.baseCurrency, settings.displayCurrency ?? settings.baseCurrency]).filter((c) => c !== 'EUR')
  const [d, , setAll] = useDraft(open, () => Object.fromEntries(codes.map((c) => [c, settings.manualRates[c] ? String(settings.manualRates[c]).replace('.', ',') : ''])) as Record<string, string>)
  const parseRate = (s: string) => {
    if (!s.trim()) return undefined
    const n = Number(s.replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const submit = async () => {
    const manualRates: Partial<Record<Currency, number>> = {}
    for (const c of codes) {
      const v = parseRate(d[c] ?? '')
      if (v === null) return `Confira a taxa de ${c}`
      if (v) manualRates[c] = v
    }
    await updateSettings({ manualRates })
    toast('Taxas salvas')
    onClose()
  }
  const auto = settings.rates?.values
  return (
    <FormSheet open={open} onClose={onClose} title="Taxa manual" onSubmit={submit}>
      <p className="pb-2 text-[15px] leading-relaxed text-soft">Deixe em branco para usar a cotação automática.</p>
      <FormGrid>
        {codes.map((c) => (
          <div key={c} className="half">
            <Field label={`1 EUR em ${c}`} hint={auto?.[c] ? `auto: ${formatNumber(Math.round(auto[c] * 100))}` : 'sem cotação'}>
              <TextInput className="num" inputMode="decimal" placeholder={auto?.[c] ? String(auto[c].toFixed(4)).replace('.', ',') : '0,00'} value={d[c] ?? ''} onChange={(e) => setAll((x) => ({ ...x, [c]: e.target.value }))} />
            </Field>
          </div>
        ))}
      </FormGrid>
    </FormSheet>
  )
}

function ImportSheet({ backup, onClose }: { backup: ParsedBackup | null; onClose(): void }) {
  const { importData } = useStore()
  const { toast, confirm } = useFeedback()
  const vault = useVault()
  const { userId } = useSession()
  const run = async (mode: 'merge' | 'replace') => {
    if (!backup) return
    if (mode === 'replace') {
      const ok = await confirm({
        title: 'Substituir todos os dados?',
        message: 'Tudo o que está no app agora será trocado pelo conteúdo do arquivo. Se estiver em dúvida, exporte um backup antes.',
        confirmLabel: 'Substituir',
        danger: true,
      })
      if (!ok) return
    }
    let data: Partial<DataState> = backup.data
    const plain = (backup.data.accounts ?? []).filter((a) => a.password)
    if (plain.length) {
      // Old backups may carry plain-text passwords: they are sealed before being stored.
      if (vault.unlocked) data = { ...data, accounts: await Promise.all((backup.data.accounts ?? []).map((a: Account) => vault.sealAccount(a))) }
      else if (userId) {
        toast('Este backup tem senhas sem criptografia. Abra o cofre (em Contas) antes de importar.', 'error')
        return
      }
    }
    data = Object.fromEntries(Object.entries(data).filter(([k]) => (COLLECTION_NAMES as string[]).includes(k)))
    await importData(data, backup.settings, mode)
    toast('Dados importados')
    onClose()
  }
  return (
    <Sheet
      open={backup !== null}
      onClose={onClose}
      title="Importar backup"
      footer={
        <div className="space-y-2.5">
          <Button size="lg" block onClick={() => run('merge')}>
            Juntar com meus dados
          </Button>
          <Button size="lg" block variant="ghost" className="text-expense!" onClick={() => run('replace')}>
            Substituir tudo
          </Button>
        </div>
      }
    >
      {backup && (
        <>
          <p className="pb-4 text-[15px] leading-relaxed text-soft">
            Arquivo {backup.exportedAt ? `de ${formatDateTime(backup.exportedAt).toLowerCase()}` : 'válido'} com {backup.total} registros. “Juntar” mantém tudo o que você já tem e adiciona o que falta.
          </p>
          <div className="card divide-y divide-line">
            {Object.entries(backup.counts).map(([k, n]) => (
              <Row key={k} label={COLLECTION_LABELS[k as keyof typeof COLLECTION_LABELS] ?? k} value={n} />
            ))}
          </div>
        </>
      )}
    </Sheet>
  )
}

export function SettingsPage() {
  const { settings, data, balance, refreshRates, ratesLoading, updateSettings, setDisplayCurrency } = useStore()
  const { toast } = useFeedback()
  const fileRef = useRef<HTMLInputElement>(null)
  const [sheet, setSheet] = useState<'adjust' | 'rates' | 'currency' | 'modules' | 'vaultPassword' | null>(null)
  const { configured, email } = useSession()
  const vault = useVault()
  const display = settings.displayCurrency ?? settings.baseCurrency
  const rateCodes = quickCurrencies(settings, [settings.baseCurrency, display]).filter((c) => c !== 'EUR')
  const pickMain = async (c: Currency) => {
    setDisplayCurrency(c)
    await updateSettings({ displayCurrency: c, currencies: [c, ...quickCurrencies(settings).filter((x) => x !== c)].slice(0, 6) })
    toast(`Moeda principal: ${c}`)
  }
  const [backup, setBackup] = useState<ParsedBackup | null>(null)

  const rates = effectiveRates(settings)

  const exportData = async () => {
    const { blob, omittedPasswords } = buildBackup(data, settings)
    const ok = await saveFile(blob, backupFileName())
    if (!ok) return
    await updateSettings({ lastBackupAt: new Date().toISOString() })
    toast(omittedPasswords ? `Exportado sem ${omittedPasswords} senha(s) fora do cofre` : 'Dados exportados')
  }

  const pickFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    try {
      setBackup(parseBackup(await file.text()))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Arquivo inválido', 'error')
    }
  }

  const update = async () => {
    const ok = await refreshRates()
    toast(ok ? 'Cotação atualizada' : 'Sem conexão — mantendo a última taxa', ok ? 'success' : 'error')
  }

  return (
    <>
      <PageHeader title="Configurações" />
      <div className="grid gap-7 lg:grid-cols-2 lg:items-start">
        <Group title="Conta e seções">
          {configured && <Row label="Conta" icon={<UserRound size={18} />} value={email ?? 'Só neste aparelho'} onClick={() => navigate('/account')} />}
          <Row label="Seções visíveis" icon={<LayoutGrid size={18} />} onClick={() => setSheet('modules')} />
          <Row label="Lembretes e notificações" icon={<Bell size={18} />} onClick={() => navigate('/reminders')} />
          {isEnabled(settings, 'week') && (
            <button
              type="button"
              role="switch"
              aria-checked={!settings.hideScore}
              onClick={() => updateSettings({ hideScore: !settings.hideScore })}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent-hi">
                <Gauge size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">Mostrar o NÚCLEO Score</span>
                <span className="block text-[13px] text-faint">Pontuação pessoal da semana, só sua</span>
              </span>
              <Switch checked={!settings.hideScore} />
            </button>
          )}
          {isEnabled(settings, 'today') && (
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(settings.morningAutoOpen)}
              onClick={() => updateSettings({ morningAutoOpen: !settings.morningAutoOpen })}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent-hi">
                <Sunrise size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">Abrir o Modo Manhã sozinho</span>
                <span className="block text-[13px] text-faint">Uma vez por dia, antes do meio-dia</span>
              </span>
              <Switch checked={Boolean(settings.morningAutoOpen)} />
            </button>
          )}
        </Group>

        <Group title="Saldo" note={display !== settings.baseCurrency ? `Os valores continuam guardados na moeda em que foram registrados. O saldo é registrado em ${settings.baseCurrency} e mostrado em ${display} pela cotação atual.` : undefined}>
          <Row label="Moeda principal" icon={<Coins size={18} />} value={`${display} ${currencyInfo(display).symbol}`} onClick={() => setSheet('currency')} />
          {display !== settings.baseCurrency && <Row label="Moeda de registro do saldo" value={settings.baseCurrency} />}
          <Row label="Saldo inicial" value={formatMoney(settings.initialBalance, settings.baseCurrency)} />
          <Row label="Saldo atual" value={formatMoney(balance, settings.baseCurrency)} />
          <Row label="Corrigir saldo" icon={<Scale size={18} />} onClick={() => setSheet('adjust')} />
        </Group>

        <Group
          title="Câmbio"
          note={
            settings.rates
              ? `Fonte: ${settings.rates.source} · atualizado ${formatDateTime(settings.rates.fetchedAt).toLowerCase()}. Sem internet, a última taxa salva é usada.`
              : 'Ainda sem cotação. Conecte-se à internet ou defina uma taxa manual.'
          }
        >
          {rateCodes.map((c) => (
            <Row
              key={c}
              label={`1 EUR em ${c}`}
              value={
                <span className="inline-flex items-center gap-2">
                  {settings.manualRates[c] && <Badge tone="warn">manual</Badge>}
                  {rates?.[c] ? formatNumber(Math.round(rates[c] * 100)) : 'sem cotação'}
                </span>
              }
            />
          ))}
          <Row label={ratesLoading ? 'Atualizando…' : 'Atualizar cotação'} icon={<RefreshCw size={18} className={ratesLoading ? 'animate-spin' : ''} />} onClick={update} />
          <Row label="Definir taxa manual" icon={<span className="text-[15px] font-semibold">≈</span>} onClick={() => setSheet('rates')} />
        </Group>

        {isEnabled(settings, 'accounts') && vault.exists && (
          <Group title="Cofre de senhas" note="A senha do cofre é diferente da senha de login. Sem ela (ou sem o código de recuperação) as senhas guardadas não podem ser recuperadas.">
            <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent-hi">
                <KeyRound size={18} />
              </span>
              <span className="min-w-0 flex-1 text-[15px]">Fechar após</span>
              <Segmented size="sm" value={String(vault.meta?.autoLockMin ?? 5)} onChange={(v) => vault.setAutoLock(Number(v))} options={AUTO_LOCK_OPTIONS.map((m) => ({ value: String(m), label: `${m} min` }))} />
            </div>
            <Row label="Trocar senha do cofre" onClick={() => setSheet('vaultPassword')} />
          </Group>
        )}

        <Group
          title="Backup"
          note={`${email ? 'Seus dados estão na sua conta e neste aparelho.' : 'Seus dados ficam salvos neste aparelho.'} Senhas só saem criptografadas pelo cofre. Último backup: ${settings.lastBackupAt ? formatDateTime(settings.lastBackupAt).toLowerCase() : 'nunca'}.`}
        >
          <Row label="Exportar dados" icon={<Download size={18} />} onClick={exportData} />
          <Row label="Importar dados" icon={<Upload size={18} />} onClick={() => fileRef.current?.click()} />
        </Group>
      </div>

      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
      <AdjustSheet open={sheet === 'adjust'} onClose={() => setSheet(null)} />
      <RatesSheet open={sheet === 'rates'} onClose={() => setSheet(null)} />
      <ImportSheet backup={backup} onClose={() => setBackup(null)} />
      <CurrencySheet open={sheet === 'currency'} onClose={() => setSheet(null)} value={display} onPick={pickMain} title="Moeda principal" />
      <ModulesSheet open={sheet === 'modules'} onClose={() => setSheet(null)} />
      <VaultPasswordSheet open={sheet === 'vaultPassword'} onClose={() => setSheet(null)} />
    </>
  )
}

function ModulesSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { settings, updateSettings } = useStore()
  const set = (next: Partial<Record<ModuleId, boolean>>) => updateSettings({ modules: next, modulesReviewed: true })
  return (
    <Sheet open={open} onClose={onClose} title="Seções visíveis">
      <p className="pb-4 text-[15px] leading-relaxed text-soft">Esconder uma seção não apaga nada: os dados voltam quando você liga de novo.</p>
      <ModulePicker value={settings.modules ?? {}} onChange={set} isOn={(id) => isEnabled(settings, id)} />
    </Sheet>
  )
}

function VaultPasswordSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const vault = useVault()
  const { toast } = useFeedback()
  const [d, set] = useDraft(open, () => ({ current: '', next: '', confirm: '' }))
  const submit = async () => {
    const problem = vaultPasswordProblem(d.next)
    if (problem) return problem
    if (d.next !== d.confirm) return 'As senhas não são iguais'
    try {
      await vault.changePassword(d.current, d.next)
    } catch {
      return 'Senha atual do cofre incorreta'
    }
    toast('Senha do cofre trocada')
    onClose()
  }
  return (
    <FormSheet open={open} onClose={onClose} title="Trocar senha do cofre" onSubmit={submit}>
      <FormGrid>
        <Field label="Senha atual do cofre">
          <TextInput type="password" autoComplete="current-password" value={d.current} onChange={(e) => set('current', e.target.value)} />
        </Field>
        <Field label="Nova senha do cofre" hint="mín. 10 caracteres">
          <TextInput type="password" autoComplete="new-password" value={d.next} onChange={(e) => set('next', e.target.value)} />
        </Field>
        <Field label="Repita a nova senha">
          <TextInput type="password" autoComplete="new-password" value={d.confirm} onChange={(e) => set('confirm', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}
