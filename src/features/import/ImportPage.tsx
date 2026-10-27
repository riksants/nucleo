import { FileUp, History, ShieldCheck } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { navigate } from '../../app/router'
import { usePrimaryAction } from '../../app/primaryAction'
import { PageHeader } from '../../app/Shell'
import { analyze } from '../../core/import/analyze'
import { csvLines, readFile, templateOf, type FileRead } from '../../core/import/read'
import { MAX_IMPORT_LINES } from '../../core/import/csv'
import { actionOf, type Decision } from '../../core/import/plan'
import { newId, useStore } from '../../data/store'
import type { AutomationRun, CsvMapping, Currency } from '../../data/types'
import { Button } from '../../ui/Button'
import { quickCurrencies } from '../../ui/CurrencySheet'
import { useFeedback } from '../../ui/Feedback'
import { CurrencyPicker, Field, TextInput } from '../../ui/Field'
import { ColumnsStep, type ColumnsResult } from './ColumnsStep'
import { PreviewStep } from './PreviewStep'
import { useImportActions } from './useImport'

const MAX_BYTES = 15 * 1024 * 1024

type Step = 'pick' | 'reading' | 'error' | 'columns' | 'preview' | 'done'

/** "Importar extrato": choose a file → the Núcleo reads it here → columns (CSV, if needed) → preview → confirm. */
export function ImportPage() {
  const { data, settings, convert } = useStore()
  const { importNow, saveTemplate } = useImportActions()
  // The screen's own buttons are the actions here: no floating "+".
  usePrimaryAction(null)
  const { toast, confirm } = useFeedback()
  const input = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('pick')
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [read, setRead] = useState<Exclude<FileRead, { kind: 'error' }> | null>(null)
  const [mapping, setMapping] = useState<CsvMapping | null>(null)
  const [template, setTemplate] = useState<{ id: string; name: string; applied: boolean } | null>(null)
  const [account, setAccount] = useState('')
  const [accountKey, setAccountKey] = useState('')
  const [currency, setCurrency] = useState<Currency | null>(null)
  const [decisions, setDecisions] = useState<Map<number, Decision>>(new Map())
  const [saving, setSaving] = useState(false)
  const [run, setRun] = useState<AutomationRun | null>(null)

  const knownAccounts = useMemo(() => {
    const names = new Set<string>()
    for (const r of data.automationRuns) if (r.bankImport?.account) names.add(r.bankImport.account)
    for (const t of settings.importTemplates ?? []) if (t.account) names.add(t.account)
    return [...names]
  }, [data.automationRuns, settings.importTemplates])

  const reset = () => {
    setStep('pick')
    setRead(null)
    setMapping(null)
    setTemplate(null)
    setDecisions(new Map())
    setRun(null)
    setError('')
    if (input.current) input.current.value = ''
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    reset()
    setFileName(file.name)
    if (file.size > MAX_BYTES) {
      setError('Este arquivo é grande demais para um extrato (mais de 15 MB). Exporte um período menor.')
      setStep('error')
      return
    }
    setStep('reading')
    // Let the "Lendo…" screen paint before the work.
    await new Promise((r) => setTimeout(r, 30))
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const r = readFile(bytes, file.name, settings.importTemplates)
      if (r.kind === 'error') {
        setError(r.message)
        setStep('error')
        return
      }
      setRead(r)
      if (r.kind === 'ofx') {
        setAccount(r.account ?? '')
        setAccountKey(r.account ?? '')
        setCurrency(r.currency ?? null)
        setStep('preview')
        return
      }
      setMapping(r.mapping)
      const acct = r.template?.account ?? ''
      setAccount(acct)
      setAccountKey(acct)
      setCurrency(r.template?.currency ?? null)
      if (r.template) setTemplate({ id: r.template.id, name: r.template.name, applied: true })
      const ok = !csvLines(r.sheet, r.mapping).problems.length
      setStep(ok && (r.template || (!r.guess.missing.length && !r.guess.dateAmbiguous)) ? 'preview' : 'columns')
    } catch (err) {
      console.error('Importação: falha ao ler o arquivo', err)
      setError('Não consegui ler este arquivo. Ele parece usar um formato diferente.')
      setStep('error')
    }
  }

  const lines = useMemo(() => {
    if (!read) return null
    if (read.kind === 'ofx') return { lines: read.lines, ignored: 0, problems: [] as string[] }
    return mapping ? csvLines(read.sheet, mapping) : null
  }, [read, mapping])

  const fileCurrency = useMemo(() => (lines ? [...new Set(lines.lines.map((l) => l.currency).filter(Boolean))] : []), [lines])
  const needsCurrency = Boolean(lines?.lines.some((l) => !l.currency && !l.error)) && !currency

  const analysis = useMemo(() => {
    if (step !== 'preview' || !lines || lines.problems.length) return null
    return analyze(lines.lines, { account: accountKey, currency }, data, { settings, convert })
  }, [step, lines, accountKey, currency, data, settings, convert])

  const onColumns = (r: ColumnsResult) => {
    setMapping(r.mapping)
    setDecisions(new Map())
    if (r.template && read?.kind === 'csv') {
      const id = template?.id ?? newId()
      void saveTemplate(templateOf(r.template.name, read.guess, r.mapping, { currency, account }, id, new Date()))
      setTemplate({ id, name: r.template.name, applied: false })
      toast(`Modelo “${r.template.name}” salvo`)
    }
    setStep('preview')
  }

  const decide = useCallback((i: number, d: Decision) => setDecisions((m) => new Map(m).set(i, d)), [])
  const decideMany = useCallback(
    (changes: Map<number, Decision>) =>
      setDecisions((m) => {
        const n = new Map(m)
        for (const [i, d] of changes) n.set(i, d)
        return n
      }),
    [],
  )

  const onConfirm = async () => {
    if (!analysis || !read) return
    const toImport = analysis.lines.filter((l) => actionOf(l, decisions.get(l.i)) === 'import').length
    const toReconcile = analysis.lines.filter((l) => actionOf(l, decisions.get(l.i)) === 'reconcile').length
    const parts = [toImport ? `${toImport === 1 ? '1 movimentação nova' : `${toImport} movimentações novas`}` : '', toReconcile ? `${toReconcile === 1 ? '1 conciliação' : `${toReconcile} conciliações`}` : ''].filter(Boolean)
    const ok = await confirm({ title: 'Importar agora?', message: `${parts.join(' e ')}. Tudo é gravado de uma vez e dá para desfazer depois em Importações.`, confirmLabel: 'Importar' })
    if (!ok) return
    setSaving(true)
    try {
      const r = await importNow(analysis, decisions, { file: fileName, format: read.kind, account: accountKey.trim(), ...(template ? { template: template.name } : {}) })
      if (typeof r === 'string') {
        toast(r, 'error')
        return
      }
      // The model remembers the account and currency used with it.
      if (template && read.kind === 'csv' && mapping) {
        const saved = settings.importTemplates?.find((t) => t.id === template.id)
        if (saved && (saved.account !== (accountKey.trim() || undefined) || saved.currency !== (currency ?? undefined))) void saveTemplate({ ...saved, ...(accountKey.trim() ? { account: accountKey.trim() } : {}), ...(currency ? { currency } : {}) })
      }
      setRun(r)
      setStep('done')
    } finally {
      setSaving(false)
    }
  }

  const header = <PageHeader title="Importar extrato" subtitle={step === 'pick' ? 'CSV ou OFX do seu banco' : fileName} />

  if (step === 'done' && run?.bankImport) {
    const b = run.bankImport
    const row = (label: string, n: number) => (
      <div className="flex items-center justify-between px-4 py-3 text-[15px]">
        <span className="text-soft">{label}</span>
        <span className="num font-semibold">{n}</span>
      </div>
    )
    return (
      <>
        {header}
        <div className="max-w-xl space-y-5">
          <div className="card px-4 py-4">
            <p className="text-[17px] font-semibold">{run.summary}</p>
            {run.detail && <p className="mt-1 text-[14px] leading-relaxed text-soft">{run.detail}</p>}
          </div>
          <div className="card divide-y divide-line">
            {row('Importadas', b.created)}
            {row('Conciliadas com o que já existia', b.reconciled)}
            {row('Duplicadas ignoradas', b.duplicates)}
            {row('Categorias aplicadas', b.categorized)}
            {row('Deixadas de fora (revisão)', b.possible + b.review + b.errors)}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => navigate('/finance')}>Ver no Financeiro</Button>
            <Button variant="secondary" onClick={() => navigate('/imports', { open: run.id })}>
              Ver em Importações
            </Button>
            <Button variant="ghost" onClick={reset}>
              Importar outro arquivo
            </Button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {header}
      <input ref={input} type="file" accept=".csv,.ofx,.qfx,.txt,text/csv,application/x-ofx" className="sr-only" aria-label="Arquivo do extrato" onChange={(e) => void onFile(e.target.files?.[0])} />
      {step === 'pick' && (
        <div className="max-w-xl space-y-5">
          <button type="button" onClick={() => input.current?.click()} className="card flex w-full flex-col items-center gap-3 border-dashed px-6 py-10 text-center transition-colors hover:bg-tint/[0.03]">
            <span className="grid size-12 place-items-center rounded-full bg-accent/12 text-accent-hi">
              <FileUp size={24} />
            </span>
            <span className="text-[17px] font-semibold">Escolher arquivo</span>
            <span className="text-[14px] text-soft">Extrato em CSV ou OFX, baixado do site ou app do banco</span>
          </button>
          <p className="flex items-start gap-2 px-1 text-[13px] leading-relaxed text-faint">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            O arquivo é lido só neste aparelho e não é enviado nem guardado. Só entram no Núcleo as movimentações que você confirmar na prévia.
          </p>
          <button type="button" onClick={() => navigate('/imports')} className="card flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-tint/[0.03]">
            <History size={18} className="text-soft" />
            <span className="min-w-0 flex-1 text-[15px] font-medium">Importações anteriores</span>
          </button>
        </div>
      )}
      {step === 'reading' && <p className="text-[15px] text-soft">Lendo o arquivo…</p>}
      {step === 'error' && (
        <div className="max-w-xl space-y-4">
          <p className="card px-4 py-4 text-[15px] leading-relaxed">{error}</p>
          <Button onClick={() => input.current?.click()}>Escolher outro arquivo</Button>
        </div>
      )}
      {step === 'columns' && read?.kind === 'csv' && mapping && (
        <div className="max-w-2xl">
          <ColumnsStep sheet={read.sheet} guess={read.guess} initial={mapping} templateName={template?.name} onDone={onColumns} onCancel={() => input.current?.click()} />
        </div>
      )}
      {step === 'preview' && read && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Conta" hint="opcional">
              <TextInput
                list="import-accounts"
                value={account}
                placeholder="Ex.: Sabadell, Wise, Dinheiro"
                maxLength={40}
                onChange={(e) => setAccount(e.target.value)}
                onBlur={() => setAccountKey(account)}
                onKeyDown={(e) => e.key === 'Enter' && setAccountKey(account)}
              />
              <datalist id="import-accounts">
                {knownAccounts.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </Field>
            {(needsCurrency || (currency && !fileCurrency.length)) && (
              <Field label="Moeda do extrato" hint={needsCurrency ? 'o arquivo não diz' : undefined}>
                {currency ? (
                  <CurrencyPicker value={currency} onChange={(c: Currency) => setCurrency(c)} />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {quickCurrencies(settings).slice(0, 4).map((c) => (
                      <Button key={c} variant="secondary" onClick={() => setCurrency(c)}>
                        {c}
                      </Button>
                    ))}
                  </div>
                )}
              </Field>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-soft">
            <span>{read.kind === 'ofx' ? 'Arquivo OFX' : template?.applied ? `Modelo “${template.name}” aplicado` : 'Arquivo CSV'}</span>
            {read.kind === 'csv' && (
              <button type="button" className="font-medium text-accent-hi hover:text-ink" onClick={() => setStep('columns')}>
                Ajustar colunas
              </button>
            )}
            {lines && lines.ignored > 0 && <span>{lines.ignored === 1 ? '1 linha de saldo/total ignorada' : `${lines.ignored} linhas de saldo/total ignoradas`}</span>}
            {lines?.tooMany ? <span>{`Só as primeiras ${MAX_IMPORT_LINES.toLocaleString('pt-BR')} linhas foram lidas; ${lines.tooMany.toLocaleString('pt-BR')} ficaram de fora. Importe um período menor.`}</span> : null}
          </div>
          {needsCurrency ? (
            <p className="card px-4 py-4 text-[15px] leading-relaxed">Este arquivo não diz em que moeda estão os valores. Escolha a moeda acima para ver a prévia.</p>
          ) : lines?.problems.length ? (
            <div className="card space-y-3 px-4 py-4">
              <p className="text-[15px]">{lines.problems.join(' ')}</p>
              {read.kind === 'csv' && <Button onClick={() => setStep('columns')}>Escolher as colunas</Button>}
            </div>
          ) : analysis ? (
            <PreviewStep analysis={analysis} decisions={decisions} onDecide={decide} onDecideMany={decideMany} saving={saving} onConfirm={onConfirm} />
          ) : null}
        </div>
      )}
    </>
  )
}
