import { ChevronRight, Download, RefreshCw, Scale, Upload } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { PageHeader } from '../../app/Shell'
import { useStore } from '../../data/store'
import type { Currency } from '../../data/types'
import { backupFileName, buildBackup, parseBackup, saveFile, type ParsedBackup } from '../../lib/backup'
import { formatDateTime } from '../../lib/dates'
import { amountToInput, CURRENCY_INFO, formatMoney, formatNumber, parseAmount } from '../../lib/money'
import { effectiveRates } from '../../lib/rates'
import { Button } from '../../ui/Button'
import { Badge, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft } from '../../ui/formHooks'
import { Sheet } from '../../ui/Sheet'

const COLLECTION_LABELS: Record<string, string> = {
  transactions: 'Movimentações',
  goals: 'Metas',
  clients: 'Clientes',
  projects: 'Projetos',
  tasks: 'Tarefas',
  tools: 'Ferramentas',
  accounts: 'Contas',
  notes: 'Anotações',
  portfolio: 'Portfólio',
}

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
  const [d, set] = useDraft(open, () => ({
    BRL: settings.manualRates.BRL ? String(settings.manualRates.BRL).replace('.', ',') : '',
    AED: settings.manualRates.AED ? String(settings.manualRates.AED).replace('.', ',') : '',
  }))
  const parseRate = (s: string) => {
    if (!s.trim()) return undefined
    const n = Number(s.replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const submit = async () => {
    const BRL = parseRate(d.BRL)
    const AED = parseRate(d.AED)
    if (BRL === null || AED === null) return 'Confira as taxas'
    const manualRates: Partial<Record<Currency, number>> = {}
    if (BRL) manualRates.BRL = BRL
    if (AED) manualRates.AED = AED
    await updateSettings({ manualRates })
    toast('Taxas salvas')
    onClose()
  }
  const auto = settings.rates?.values
  return (
    <FormSheet open={open} onClose={onClose} title="Taxa manual" onSubmit={submit}>
      <p className="pb-2 text-[15px] leading-relaxed text-soft">Deixe em branco para usar a cotação automática.</p>
      <FormGrid>
        {(['BRL', 'AED'] as const).map((c) => (
          <div key={c} className="half">
            <Field label={`1 EUR em ${c}`} hint={auto ? `auto: ${formatNumber(Math.round(auto[c] * 100))}` : undefined}>
              <TextInput className="num" inputMode="decimal" placeholder={auto ? String(auto[c].toFixed(4)).replace('.', ',') : '0,00'} value={d[c]} onChange={(e) => set(c, e.target.value)} />
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
    await importData(backup.data, backup.settings, mode)
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
              <Row key={k} label={COLLECTION_LABELS[k] ?? k} value={n} />
            ))}
          </div>
        </>
      )}
    </Sheet>
  )
}

export function SettingsPage() {
  const { settings, data, balance, refreshRates, ratesLoading, updateSettings } = useStore()
  const { toast } = useFeedback()
  const fileRef = useRef<HTMLInputElement>(null)
  const [sheet, setSheet] = useState<'adjust' | 'rates' | null>(null)
  const [backup, setBackup] = useState<ParsedBackup | null>(null)

  const rates = effectiveRates(settings)

  const exportData = async () => {
    const ok = await saveFile(buildBackup(data, settings), backupFileName())
    if (!ok) return
    await updateSettings({ lastBackupAt: new Date().toISOString() })
    toast('Dados exportados')
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
        <Group title="Saldo">
          <Row label="Moeda principal" value={`${settings.baseCurrency} ${CURRENCY_INFO[settings.baseCurrency].symbol}`} />
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
          {(['BRL', 'AED'] as const).map((c) => (
            <Row
              key={c}
              label={`1 EUR em ${c}`}
              value={
                <span className="inline-flex items-center gap-2">
                  {settings.manualRates[c] && <Badge tone="warn">manual</Badge>}
                  {rates ? formatNumber(Math.round(rates[c] * 100)) : '—'}
                </span>
              }
            />
          ))}
          <Row label={ratesLoading ? 'Atualizando…' : 'Atualizar cotação'} icon={<RefreshCw size={18} className={ratesLoading ? 'animate-spin' : ''} />} onClick={update} />
          <Row label="Definir taxa manual" icon={<span className="text-[15px] font-semibold">≈</span>} onClick={() => setSheet('rates')} />
        </Group>

        <Group
          title="Backup"
          note={`Seus dados ficam salvos neste aparelho. Exporte um backup de vez em quando. Último: ${settings.lastBackupAt ? formatDateTime(settings.lastBackupAt).toLowerCase() : 'nunca'}.`}
        >
          <Row label="Exportar dados" icon={<Download size={18} />} onClick={exportData} />
          <Row label="Importar dados" icon={<Upload size={18} />} onClick={() => fileRef.current?.click()} />
        </Group>
      </div>

      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
      <AdjustSheet open={sheet === 'adjust'} onClose={() => setSheet(null)} />
      <RatesSheet open={sheet === 'rates'} onClose={() => setSheet(null)} />
      <ImportSheet backup={backup} onClose={() => setBackup(null)} />
    </>
  )
}
