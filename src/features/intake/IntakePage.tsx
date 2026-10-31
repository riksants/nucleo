/**
 * Importação inteligente (Etapa 4): a document or pasted text → what it probably is → a preview that can be
 * corrected → the records, only after "Importar". Read on this device only; the document is never stored.
 */
import { emptyMealAnswers } from '../../../supabase/functions/_shared/planner/foodSafety.ts'
import { ClipboardPaste, FileUp, ShieldCheck } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { navigate, useRoute } from '../../app/router'
import { usePrimaryAction } from '../../app/primaryAction'
import { PageHeader } from '../../app/Shell'
import { planIntake, previousImport, undoIntake } from '../../core/intake/commit'
import { detect, TARGET_LABEL, type IntakeItem, type Proposal, type TargetId } from '../../core/intake/detect'
import { extractFile, extractText, MAX_INTAKE_CHARS, type Extracted } from '../../core/intake/extract'
import { handOff } from '../../core/intake/handoff'
import { foodSafetyProblem, mealTypes, typeLabel } from '../../core/meals'
import { describeRule } from '../../core/recurrence'
import { todayIn, useToday, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import { syncAllowsAutomations } from '../../data/useAutomations'
import type { AutomationRun } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { Button } from '../../ui/Button'
import { Badge } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { TextArea, TextInput } from '../../ui/Field'
import { Sheet } from '../../ui/Sheet'
import { ToggleRow } from '../planner/controls'
import { PROFILE_ID } from '../planner/plans'

type Step = 'pick' | 'reading' | 'error' | 'preview' | 'done'

const ACCEPT = '.txt,.md,.csv,.tsv,.pdf,.docx,.xlsx,text/plain,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ddmm = (d: string) => (d ? d.split('-').reverse().join('/') : '')

/** One line of the preview, in words: what will be created, with every detail kept. */
function describeItem(it: IntakeItem, types: Parameters<typeof typeLabel>[0]): { kind: string; title: string; details: string[] } {
  switch (it.kind) {
    case 'meal':
      return { kind: 'Refeição', title: it.name || typeLabel(types, it.type) || 'Refeição', details: [ddmm(it.date), it.time, it.type && it.name ? typeLabel(types, it.type) : '', it.ingredients.join(', ')].filter(Boolean) }
    case 'recurring':
      return { kind: 'Recorrente', title: it.title, details: [describeRule(it.rule), it.time, it.notes ? `${it.notes.split('\n').length} ${it.notes.split('\n').length === 1 ? 'linha de detalhes' : 'linhas de detalhes'}` : ''].filter(Boolean) }
    case 'event':
      return { kind: 'Compromisso', title: it.title, details: [ddmm(it.date), it.end ? `${it.start}–${it.end}` : it.start].filter(Boolean) }
    case 'task':
      return { kind: 'Tarefa', title: it.title, details: [it.dueDate ? `até ${ddmm(it.dueDate)}` : 'sem data', it.dueTime].filter(Boolean) }
    case 'note':
      return { kind: 'Anotação', title: it.title, details: [`${it.body.split('\n').filter(Boolean).length} linhas, como no documento`] }
    case 'shopping':
      return { kind: 'Compra', title: it.name, details: [[it.qty, it.unit].filter(Boolean).join(' ')].filter(Boolean) }
    case 'project':
      return { kind: 'Projeto', title: it.name, details: [it.dueDate ? `prazo ${ddmm(it.dueDate)}` : 'sem prazo'] }
  }
}

function ItemRow({ it, onChange }: { it: IntakeItem; onChange(it: IntakeItem): void }) {
  const { settings } = useStore()
  const d = describeItem(it, settings)
  const [editing, setEditing] = useState(false)
  const titleKey = it.kind === 'shopping' || it.kind === 'project' ? 'name' : it.kind === 'meal' ? 'name' : 'title'
  const title = (it as Record<string, unknown>)[titleKey] as string
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <input type="checkbox" aria-label={`Importar ${d.title}`} checked={it.include} onChange={() => onChange({ ...it, include: !it.include })} className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{d.kind}</Badge>
            {editing ? (
              <TextInput aria-label="Título" value={title} autoFocus onBlur={() => setEditing(false)} onChange={(e) => onChange({ ...it, [titleKey]: e.target.value } as IntakeItem)} className="h-9!" />
            ) : (
              <button type="button" onClick={() => setEditing(true)} className="text-left text-[15px] leading-snug font-medium [overflow-wrap:anywhere]">
                {d.title || '(sem título)'}
              </button>
            )}
          </span>
          {d.details.length > 0 && <span className="mt-0.5 block text-[13px] leading-snug text-soft [overflow-wrap:anywhere]">{d.details.join(' · ')}</span>}
          {'problem' in it && it.problem && <span className="mt-0.5 block text-[13px] leading-snug text-warn">{it.problem}</span>}
          {it.kind === 'note' || it.kind === 'recurring' ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-[13px] font-medium text-accent-hi">Ver tudo o que vai junto</summary>
              <pre className="mt-1 text-[13px] leading-snug whitespace-pre-wrap text-soft [overflow-wrap:anywhere]">{it.kind === 'note' ? it.body : it.notes}</pre>
            </details>
          ) : (
            <span className="mt-0.5 block text-[12px] leading-snug text-faint [overflow-wrap:anywhere]">Linha: {it.source}</span>
          )}
        </span>
      </div>
    </div>
  )
}

export function IntakePage() {
  const { data, settings, commit, syncStatus } = useStore()
  const { toast, confirm } = useFeedback()
  usePrimaryAction(null)
  const route = useRoute()
  const today = useToday(zoneOf(settings))
  const input = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('pick')
  const [error, setError] = useState('')
  const [read, setRead] = useState<Exclude<Extracted, { kind: 'error' }> | null>(null)
  const [bytes, setBytes] = useState<{ bytes: Uint8Array; name: string } | null>(null)
  const [target, setTarget] = useState<TargetId | null>(null)
  const [items, setItems] = useState<IntakeItem[]>([])
  const [keepLeft, setKeepLeft] = useState(true)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState<AutomationRun | null>(null)
  const prefer = route.params.get('target') as TargetId | null

  const answers = data.plannerProfiles.find((p) => p.id === PROFILE_ID)?.meals ?? emptyMealAnswers()
  const proposals = useMemo<Proposal[]>(() => {
    if (!read) return []
    const lines = read.kind === 'text' ? read.lines : read.rows.map((r) => r.filter(Boolean).join('\t'))
    return detect({ lines, table: read.kind === 'table' ? read.rows : null }, { today, mealTypes: mealTypes(settings), mealProblem: (foods) => foodSafetyProblem(foods, answers), title: read.source })
  }, [read, today, settings, answers])
  const proposal = proposals.find((p) => p.target === target) ?? null
  const previous = read && proposal ? previousImport(data, read.hash, proposal.target) : null

  const choose = (p: Proposal) => {
    setTarget(p.target)
    setItems(p.items.map((x) => ({ ...x })))
    setKeepLeft(true)
  }
  const show = (r: Extracted) => {
    if (r.kind === 'error') {
      setError(r.message)
      setStep('error')
      return
    }
    setRead(r)
    setStep('preview')
    const lines = r.kind === 'text' ? r.lines : r.rows.map((x) => x.filter(Boolean).join('\t'))
    const list = detect({ lines, table: r.kind === 'table' ? r.rows : null }, { today, mealTypes: mealTypes(settings), mealProblem: (foods) => foodSafetyProblem(foods, answers), title: r.source })
    const first = (prefer && list.find((p) => p.target === prefer)) || list[0]
    if (first) choose(first)
  }
  const onFile = async (file: File | undefined) => {
    if (!file) return
    setRun(null)
    setStep('reading')
    await new Promise((res) => setTimeout(res, 30))
    try {
      const b = new Uint8Array(await file.arrayBuffer())
      setBytes({ bytes: b, name: file.name })
      show(await extractFile(b, file.name))
    } catch (err) {
      console.error('Importação inteligente: falha ao ler', err)
      setError('Não consegui ler este arquivo.')
      setStep('error')
    } finally {
      if (input.current) input.current.value = ''
    }
  }
  const onPaste = () => {
    setPasteOpen(false)
    setBytes(null)
    setRun(null)
    show(extractText(pasted))
  }

  const toFinance = () => {
    if (!read) return
    if (bytes && read.kind === 'table') handOff({ kind: 'file', bytes: bytes.bytes, name: bytes.name })
    else handOff({ kind: 'text', text: read.kind === 'text' ? read.lines.join('\n') : read.rows.map((r) => r.join('\t')).join('\n'), source: read.source })
    navigate('/import')
  }

  const doImport = async () => {
    if (!read || !proposal || busy) return
    const chosen = items.filter((x) => x.include).length
    const ok = await confirm({ title: 'Importar agora?', message: `${chosen === 1 ? '1 item' : `${chosen} itens`} para ${TARGET_LABEL[proposal.target].split(' → ')[1] ?? ''}${keepLeft && proposal.unrecognised.length ? ', e uma anotação com o que não foi reconhecido' : ''}. Dá para desfazer depois.`, confirmLabel: 'Importar' })
    if (!ok) return
    setBusy(true)
    try {
      const now = new Date()
      const plan = planIntake(proposal, items, { unrecognised: keepLeft }, data, { source: read.source, hash: read.hash, today: todayIn(zoneOf(settings), now), now, baseCurrency: settings.baseCurrency })
      if (typeof plan === 'string') return toast(plan, 'error')
      await commit(plan.ops, { by: 'person', rules: { maxRuns: Math.max(20, plan.created * 2) } })
      setRun(plan.run)
      setStep('done')
    } finally {
      setBusy(false)
    }
  }

  const doUndo = async () => {
    if (!run) return
    const current = data.automationRuns.find((r) => r.id === run.id) ?? run
    if (!syncAllowsAutomations(syncStatus)) return toast('Espere a sincronização terminar para desfazer.', 'error')
    const ok = await confirm({ title: 'Desfazer esta importação?', message: 'O que foi criado sai. O que você já alterou depois fica.', confirmLabel: 'Desfazer' })
    if (!ok) return
    const r = undoIntake(current, data, todayIn(zoneOf(settings)))
    if (!r) return toast('Esta importação já foi desfeita.', 'error')
    await commit(r.ops, { by: 'undo' })
    toast(r.partial ? 'Desfeito. O que você alterou depois foi mantido.' : 'Importação desfeita')
    setRun({ ...current, status: 'undone' })
  }

  const header = <PageHeader title="Importação inteligente" subtitle={step === 'pick' ? 'Um documento ou texto vira registros no Núcleo' : (read?.source ?? '')} />

  if (step === 'done' && run?.smartImport) {
    const s = run.smartImport
    return (
      <>
        {header}
        <div className="max-w-xl space-y-5">
          <div className="card px-4 py-4">
            <p className="text-[17px] font-semibold">{run.status === 'undone' ? 'Importação desfeita' : run.summary}</p>
            {run.detail && <p className="mt-1 text-[14px] leading-relaxed text-soft">{run.detail}</p>}
          </div>
          <div className="card divide-y divide-line text-[15px]">
            {[
              ['Criados', s.created],
              ['Já existiam (não repetidos)', s.duplicates],
              ['Deixados de fora por você', s.skipped],
              ['Linhas não reconhecidas', s.unrecognised],
            ].map(([l, n]) => (
              <div key={l as string} className="flex items-center justify-between px-4 py-3">
                <span className="text-soft">{l}</span>
                <span className="num font-semibold">{n}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {run.status !== 'undone' && (
              <Button variant="secondary" onClick={doUndo}>
                Desfazer importação
              </Button>
            )}
            <Button variant="ghost" onClick={() => (setStep('pick'), setRead(null), setRun(null))}>
              Importar outro
            </Button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {header}
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" aria-label="Documento" onChange={(e) => void onFile(e.target.files?.[0])} />
      {step === 'pick' && (
        <div className="max-w-xl space-y-4">
          <button type="button" onClick={() => input.current?.click()} className="card flex w-full flex-col items-center gap-3 border-dashed px-6 py-9 text-center transition-colors hover:bg-tint/[0.03]">
            <span className="grid size-12 place-items-center rounded-full icon-tile">
              <FileUp size={24} />
            </span>
            <span className="text-[17px] font-semibold">Escolher documento</span>
            <span className="text-[14px] text-soft">PDF com texto, Word (.docx), Excel (.xlsx), CSV ou texto</span>
          </button>
          <button type="button" onClick={() => setPasteOpen(true)} className="card flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-tint/[0.03]">
            <ClipboardPaste size={18} className="text-soft" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">Colar texto</span>
              <span className="block text-[13px] text-faint">Dieta, treino, cronograma, lista de compras, planejamento…</span>
            </span>
          </button>
          <p className="flex items-start gap-2 px-1 text-[13px] leading-relaxed text-faint">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            Lido só neste aparelho: o documento não é enviado nem guardado. Fotos e PDFs digitalizados ainda não são lidos (no iPhone, copie o texto com o Texto ao Vivo e cole aqui).
          </p>
        </div>
      )}
      {step === 'reading' && <p className="text-[15px] text-soft">Lendo o documento…</p>}
      {step === 'error' && (
        <div className="max-w-xl space-y-4">
          <p className="card px-4 py-4 text-[15px] leading-relaxed">{error}</p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => input.current?.click()}>Escolher outro</Button>
            <Button variant="secondary" onClick={() => setPasteOpen(true)}>
              Colar texto
            </Button>
          </div>
        </div>
      )}
      {step === 'preview' && read && (
        <div className="max-w-2xl space-y-5">
          {read.notes.map((n) => (
            <p key={n} className="text-[14px] leading-relaxed text-soft">
              {n}
            </p>
          ))}
          <div>
            <p className="mb-2 px-1 text-[13px] font-semibold text-soft">O que parece ser</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Destino">
              {proposals.map((p) => (
                <button key={p.target} type="button" role="radio" aria-checked={target === p.target} onClick={() => choose(p)} className={`min-h-8 rounded-full px-3 py-1 text-left text-[13px] font-medium transition-colors ${target === p.target ? 'bg-paper text-coal' : 'bg-tint/[0.06] text-soft hover:text-ink'}`}>
                  {TARGET_LABEL[p.target]}
                </button>
              ))}
            </div>
          </div>
          {proposal && previous && <p className="card px-4 py-3 text-[14px] leading-relaxed text-warn">Este conteúdo já foi importado para cá em {formatDateValue(previous.date).toLowerCase()}. O que já existe não é criado de novo.</p>}
          {proposal?.notes.map((n) => (
            <p key={n} className="text-[14px] leading-relaxed text-soft">
              {n}
            </p>
          ))}
          {proposal?.target === 'finance' ? (
            <Button size="lg" onClick={toFinance}>
              Continuar em Importar extrato
            </Button>
          ) : proposal ? (
            <>
              <div className="card divide-y divide-line">
                {items.map((it, k) => (
                  <ItemRow key={it.key} it={it} onChange={(x) => setItems((list) => list.map((y, j) => (j === k ? x : y)))} />
                ))}
              </div>
              {proposal.unrecognised.length > 0 && (
                <div className="space-y-2">
                  <p className="px-1 text-[13px] font-semibold text-soft">
                    Não reconhecido ({proposal.unrecognised.length}) — nada é apagado do documento
                  </p>
                  <div className="card divide-y divide-line">
                    {proposal.unrecognised.slice(0, 40).map((u, k) => (
                      <div key={k} className="px-4 py-2.5">
                        <span className="block text-[14px] leading-snug [overflow-wrap:anywhere]">{u.line}</span>
                        <span className="block text-[12px] text-faint">{u.why}</span>
                      </div>
                    ))}
                    {proposal.unrecognised.length > 40 && <p className="px-4 py-2.5 text-[13px] text-faint">E mais {proposal.unrecognised.length - 40} linhas.</p>}
                  </div>
                  <ToggleRow checked={keepLeft} onChange={setKeepLeft} hint="As linhas acima viram uma anotação, exatamente como estão.">
                    Guardar o que não foi reconhecido numa anotação
                  </ToggleRow>
                </div>
              )}
              <Button size="lg" block disabled={busy || (!items.some((x) => x.include) && !(keepLeft && proposal.unrecognised.length))} onClick={doImport}>
                {busy ? 'Importando…' : `Importar ${items.filter((x) => x.include).length === 1 ? '1 item' : `${items.filter((x) => x.include).length} itens`}`}
              </Button>
            </>
          ) : null}
        </div>
      )}
      <Sheet
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="Colar texto"
        footer={
          <Button size="lg" block disabled={!pasted.trim()} onClick={onPaste}>
            Ler o texto
          </Button>
        }
      >
        <div className="space-y-3 pt-1">
          <TextArea aria-label="Conteúdo para importar" rows={10} maxLength={MAX_INTAKE_CHARS} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'Treino A — segunda e quinta 7h\nSupino reto 4x10 60kg\nRemada 3x12\nObs: descanso 60s'} />
          <p className="text-[13px] leading-relaxed text-faint">Nada é salvo antes da prévia.</p>
        </div>
      </Sheet>
    </>
  )
}
