import { useMemo, useState } from 'react'
import { columnValues, mappingProblems, readLines, type CsvGuess, type CsvSheet } from '../../core/import/csv'
import type { CsvColumns, CsvMapping } from '../../data/types'
import { formatMoney, formatNumber } from '../../lib/money'
import { Button } from '../../ui/Button'
import { Field, Select, TextInput } from '../../ui/Field'
import { Segmented } from '../../ui/Segmented'
import { Switch } from '../settings/ModulePicker'

type Role = keyof CsvColumns

const ROLES: { role: Role; label: string; required?: boolean }[] = [
  { role: 'date', label: 'Data', required: true },
  { role: 'description', label: 'Descrição', required: true },
  { role: 'memo', label: 'Complemento (opcional)' },
  { role: 'currency', label: 'Moeda (opcional)' },
  { role: 'id', label: 'Identificador da transação (opcional)' },
  { role: 'balance', label: 'Saldo (opcional)' },
  { role: 'type', label: 'Tipo D/C (opcional)' },
]

/** "Coluna 3 · Importe (ex.: -45,30)" */
function columnLabel(sheet: CsvSheet, headerRow: number, i: number): string {
  const sample = columnValues(sheet, headerRow, i, 3)[0]
  const name = headerRow >= 0 ? sheet.rows[headerRow][i] || `Coluna ${i + 1}` : `Coluna ${i + 1}`
  return `${headerRow >= 0 ? `${i + 1}. ` : ''}${name}${sample ? ` (ex.: ${sample.length > 24 ? `${sample.slice(0, 24)}…` : sample})` : ''}`
}

export interface ColumnsResult {
  mapping: CsvMapping
  template: { name: string } | null
}

/**
 * "Quais colunas são o quê": shown when the Núcleo could not tell for sure (or the person asked to adjust).
 * The first lines are read live with the choice, so the person sees the result before going on.
 */
export function ColumnsStep({ sheet, guess, initial, templateName, onDone, onCancel }: { sheet: CsvSheet; guess: CsvGuess; initial: CsvMapping; templateName?: string; onDone(r: ColumnsResult): void; onCancel(): void }) {
  const [m, setM] = useState<CsvMapping>(initial)
  const [split, setSplit] = useState(initial.columns.amount === undefined && initial.columns.debit !== undefined)
  const [save, setSave] = useState(Boolean(templateName))
  const [name, setName] = useState(templateName ?? '')
  const width = guess.headers.length
  const set = (role: Role, v: string) => setM((x) => ({ ...x, columns: { ...x.columns, [role]: v === '' ? undefined : Number(v) } }))
  const columns: CsvColumns = useMemo(() => {
    const c = { ...m.columns }
    if (split) delete c.amount
    else {
      delete c.debit
      delete c.credit
    }
    return c
  }, [m.columns, split])
  const mapping = useMemo(() => ({ ...m, columns }), [m, columns])
  const problems = mappingProblems(mapping)
  const sample = useMemo(() => (problems.length ? [] : readLines({ ...sheet, rows: sheet.rows.slice(0, mapping.headerRow + 1 + 6) }, mapping).lines.slice(0, 5)), [sheet, mapping, problems.length])

  const picker = (role: Role, label: string, required = false) => (
    <Field key={role} label={label}>
      <Select aria-label={label} value={columns[role] === undefined ? '' : String(columns[role])} onChange={(e) => set(role, e.target.value)}>
        <option value="">{required ? 'Escolha a coluna' : 'Nenhuma'}</option>
        {Array.from({ length: width }, (_, i) => (
          <option key={i} value={i}>
            {columnLabel(sheet, m.headerRow, i)}
          </option>
        ))}
      </Select>
    </Field>
  )

  return (
    <div className="space-y-5">
      <p className="text-[15px] leading-relaxed text-soft">Diga o que cada coluna é. O Núcleo já preencheu o que reconheceu — confira as primeiras linhas abaixo antes de continuar.</p>
      {(m.headerRow === 0 || m.headerRow === -1) && (
        <button type="button" role="switch" aria-checked={m.headerRow === 0} onClick={() => setM((x) => ({ ...x, headerRow: x.headerRow === 0 ? -1 : 0 }))} className="card flex w-full items-center gap-3 px-4 py-3 text-left">
          <span className="min-w-0 flex-1 text-[15px]">A primeira linha tem os nomes das colunas</span>
          <Switch checked={m.headerRow === 0} />
        </button>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {picker('date', 'Data', true)}
        {picker('description', 'Descrição', true)}
      </div>
      <button type="button" role="switch" aria-checked={split} onClick={() => setSplit((s) => !s)} className="card flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px]">Débito e crédito em colunas separadas</span>
          <span className="block text-[13px] text-faint">Em vez de uma coluna de valor com sinal</span>
        </span>
        <Switch checked={split} />
      </button>
      <div className="grid gap-4 sm:grid-cols-2">
        {split ? (
          <>
            {picker('debit', 'Débito (saídas)', true)}
            {picker('credit', 'Crédito (entradas)', true)}
          </>
        ) : (
          picker('amount', 'Valor', true)
        )}
        {ROLES.filter((r) => !r.required).map((r) => picker(r.role, r.label))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Separador decimal">
          <Segmented
            block
            label="Separador decimal"
            value={m.decimal}
            onChange={(decimal) => setM((x) => ({ ...x, decimal }))}
            options={[
              { value: ',', label: '1.234,56' },
              { value: '.', label: '1,234.56' },
            ]}
          />
        </Field>
        <Field label="Datas" hint={guess.dateAmbiguous ? 'confira: todas as datas servem nas duas ordens' : undefined}>
          <Select aria-label="Ordem das datas" value={m.dateOrder} onChange={(e) => setM((x) => ({ ...x, dateOrder: e.target.value as CsvMapping['dateOrder'] }))}>
            <option value="dmy">dia/mês/ano (31/12/2026)</option>
            <option value="mdy">mês/dia/ano (12/31/2026)</option>
            <option value="ymd">ano-mês-dia (2026-12-31)</option>
          </Select>
        </Field>
      </div>
      <button type="button" role="switch" aria-checked={Boolean(m.invert)} onClick={() => setM((x) => ({ ...x, invert: !x.invert }))} className="card flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px]">Valores positivos são saídas</span>
          <span className="block text-[13px] text-faint">Comum em faturas de cartão de crédito</span>
        </span>
        <Switch checked={Boolean(m.invert)} />
      </button>

      <section aria-label="Primeiras linhas">
        <p className="mb-2 text-[13px] font-semibold text-soft">Primeiras linhas, como o Núcleo leu</p>
        {problems.length ? (
          <p className="card px-4 py-3 text-[14px] text-warn">{problems.join(' ')}</p>
        ) : (
          <div className="card divide-y divide-line">
            {sample.map((l) => (
              <div key={l.row} className="flex items-start gap-3 px-4 py-2.5 text-[14px]">
                <span className="num w-[5.5rem] shrink-0 text-soft">{l.day ? l.day.split('-').reverse().join('/') : '—'}</span>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{l.error ? <span className="text-warn">Linha {l.row}: {l.error}</span> : l.description}</span>
                <span className={`num shrink-0 ${l.amount !== null && l.amount < 0 ? 'text-expense' : 'text-income'}`}>{l.amount === null ? '—' : `${l.amount < 0 ? '−' : '+'}${l.currency ? formatMoney(Math.abs(l.amount), l.currency) : formatNumber(Math.abs(l.amount))}`}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="card space-y-3 px-4 py-3">
        <button type="button" role="switch" aria-checked={save} onClick={() => setSave((s) => !s)} className="flex w-full items-center gap-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">Salvar como modelo</span>
            <span className="block text-[13px] text-faint">Na próxima vez que vier um arquivo igual, o Núcleo usa estas colunas sozinho</span>
          </span>
          <Switch checked={save} />
        </button>
        {save && (
          <Field label="Nome do modelo">
            <TextInput value={name} placeholder="Meu Sabadell" onChange={(e) => setName(e.target.value)} maxLength={40} />
          </Field>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button size="lg" disabled={problems.length > 0 || (save && !name.trim())} onClick={() => onDone({ mapping, template: save && name.trim() ? { name: name.trim() } : null })}>
          Continuar
        </Button>
        <Button size="lg" variant="ghost" onClick={onCancel}>
          Escolher outro arquivo
        </Button>
      </div>
    </div>
  )
}
