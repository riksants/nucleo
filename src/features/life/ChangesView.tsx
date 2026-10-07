import { useMemo, useState } from 'react'
import { computeChanges, type ChangePeriod } from '../../core/changes'
import { useToday, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import { Segmented } from '../../ui/Segmented'

/** "O que mudou?": the person compared with themselves, only where there is enough data. */
export function ChangesView() {
  const { data, settings } = useStore()
  const today = useToday(zoneOf(settings))
  const [period, setPeriod] = useState<ChangePeriod>('week')
  const c = useMemo(() => computeChanges(data, settings, period), [data, settings, period, today]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Segmented<ChangePeriod> variant="underline" block label="Período" value={period} onChange={setPeriod} options={[{ value: 'week', label: 'Semana × anterior' }, { value: 'month', label: 'Mês × anterior' }]} />
      {c.partialNote && !c.notComparable && <p className="px-1 text-[13px] text-faint">{c.partialNote}</p>}
      {c.notComparable ? (
        <p className="card px-5 py-4 text-[15px] leading-relaxed text-soft">Dados insuficientes: você começou a usar o NÚCLEO depois do início do período anterior. A comparação aparece quando houver dois períodos completos para comparar.</p>
      ) : c.lines.length ? (
        <ul className="card divide-y divide-line">
          {c.lines.map((l, i) => (
            <li key={i} className="px-5 py-3.5 text-[15px] leading-relaxed">
              {l.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="card px-5 py-4 text-[15px] text-soft">Dados insuficientes para comparar. Quando houver registros nos dois períodos, as mudanças aparecem aqui.</p>
      )}
      <p className="px-1 text-[13px] leading-relaxed text-faint">Só aparecem áreas com dados nos dois períodos. Nenhuma comparação com outras pessoas.</p>
    </div>
  )
}
