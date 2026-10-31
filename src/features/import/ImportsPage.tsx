import { FileUp, History } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { clearParams, navigate, useRoute } from '../../app/router'
import { usePrimaryAction } from '../../app/primaryAction'
import { PageHeader } from '../../app/Shell'
import { canUndoImport } from '../../core/import/undo'
import { useStore } from '../../data/store'
import type { AutomationRun } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { Button } from '../../ui/Button'
import { Badge, EmptyState, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { useImportActions } from './useImport'

const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`

function ImportRow({ run, highlight }: { run: AutomationRun; highlight: boolean }) {
  const { undo } = useImportActions()
  const { toast, confirm } = useFeedback()
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'center' })
  }, [highlight])
  const b = run.bankImport!
  const left = b.possible + b.review + b.errors
  const facts = [
    n(b.lines, 'linha lida', 'linhas lidas'),
    n(b.created, 'importada', 'importadas'),
    b.duplicates ? n(b.duplicates, 'duplicada ignorada', 'duplicadas ignoradas') : '',
    b.reconciled ? n(b.reconciled, 'conciliada', 'conciliadas') : '',
    b.categorized ? n(b.categorized, 'categoria aplicada', 'categorias aplicadas') : '',
    b.transfers ? n(b.transfers, 'transferência entre contas', 'transferências entre contas') : '',
    left ? `${n(left, 'deixada', 'deixadas')} de fora para revisão` : '',
  ].filter(Boolean)

  const doUndo = async () => {
    const rules = run.status === 'done'
    const ok = await confirm({
      title: 'Desfazer esta importação?',
      message: `As movimentações criadas por ela saem do Financeiro (as que você editou depois ficam). As conciliadas continuam — só deixam de estar ligadas ao extrato.${rules ? ' O que suas regras fizeram por causa delas também é desfeito.' : ''}`,
      confirmLabel: 'Desfazer importação',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await undo(run)
      if (typeof r === 'string') return toast(r, 'error')
      toast(r.kept.length ? `Desfeito. ${n(r.kept.length, 'movimentação editada depois foi mantida', 'movimentações editadas depois foram mantidas')}.` : 'Importação desfeita')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className={`px-4 py-3.5 ${highlight ? 'bg-accent/[0.06]' : ''}`}>
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-snug font-medium [overflow-wrap:anywhere]">{b.file}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-faint">
            Importado em {formatDateValue(run.date)}
            {b.account ? ` · ${b.account}` : ''}
            {b.template ? ` · modelo “${b.template}”` : ''}
            {b.from && b.to ? ` · movimentações de ${b.from.split('-').reverse().join('/')} a ${b.to.split('-').reverse().join('/')}` : ''}
          </span>
        </span>
        {run.status === 'undone' && <Badge>desfeita</Badge>}
      </div>
      <p className="mt-1.5 text-[14px] leading-relaxed text-soft">{facts.join(' · ')}</p>
      {b.undone && (
        <div className="mt-1.5 text-[13px] leading-relaxed text-faint">
          <p>
            Desfeita em {new Date(b.undone.at).toLocaleDateString('pt-BR')}: {n(b.undone.removed, 'movimentação removida', 'movimentações removidas')}
            {b.undone.unlinked ? `, ${n(b.undone.unlinked, 'conciliada mantida', 'conciliadas mantidas')}` : ''}
            {b.undone.rules ? `, ${n(b.undone.rules, 'ação de regra desfeita', 'ações de regras desfeitas')}` : ''}.
          </p>
          {b.undone.kept.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {b.undone.kept.map((k) => (
                <li key={k.id}>
                  Mantida: {k.label} ({k.why})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {canUndoImport(run) && (
        <button type="button" disabled={busy} className="mt-2 text-[14px] font-medium text-soft hover:text-ink disabled:opacity-50" onClick={doUndo}>
          Desfazer importação
        </button>
      )}
    </div>
  )
}

export function ImportsPage() {
  const { data, settings } = useStore()
  const { removeTemplate } = useImportActions()
  // The screen's own buttons are the actions here: no floating "+".
  usePrimaryAction(null)
  const { toast, confirm } = useFeedback()
  const { params } = useRoute()
  const [open] = useState(() => params.get('open'))
  useEffect(() => {
    if (params.get('open')) clearParams()
  }, [params])
  const runs = data.automationRuns.filter((r) => r.automation === 'bankImport' && r.bankImport).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const templates = settings.importTemplates ?? []

  return (
    <>
      <PageHeader
        title="Importações"
        subtitle="Extratos importados, e como desfazer"
        actions={
          <Button icon={<FileUp size={18} />} onClick={() => navigate('/import')}>
            Importar extrato
          </Button>
        }
      />
      <div className="grid gap-7 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <section>
          <SectionTitle>Histórico</SectionTitle>
          {runs.length ? (
            <div className="card divide-y divide-line">
              {runs.map((r) => (
                <ImportRow key={r.id} run={r} highlight={r.id === open} />
              ))}
            </div>
          ) : (
            <EmptyState compact icon={<History size={20} />} title="Nenhuma importação ainda" text="Importe o extrato do seu banco (CSV ou OFX) e o Núcleo traz as movimentações, sem duplicar o que já existe." action="Importar extrato" onAction={() => navigate('/import')} />
          )}
        </section>
        <section>
          <SectionTitle>Modelos salvos</SectionTitle>
          {templates.length ? (
            <div className="card divide-y divide-line">
              {templates.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium">{t.name}</span>
                    <span className="block text-[13px] text-faint">{[t.account, t.currency].filter(Boolean).join(' · ') || 'CSV'}</span>
                  </span>
                  <button
                    type="button"
                    className="text-[14px] font-medium text-soft hover:text-expense"
                    onClick={async () => {
                      if (!(await confirm({ title: `Excluir o modelo “${t.name}”?`, message: 'As importações já feitas com ele não mudam.', confirmLabel: 'Excluir', danger: true }))) return
                      await removeTemplate(t.id)
                      toast('Modelo excluído')
                    }}
                  >
                    Excluir
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-1 text-[14px] leading-relaxed text-faint">Quando você escolhe as colunas de um CSV, pode salvar como modelo (“Meu Sabadell”). Na próxima vez, o Núcleo usa sozinho.</p>
          )}
        </section>
      </div>
    </>
  )
}
