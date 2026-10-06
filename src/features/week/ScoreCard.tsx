import { Gauge, Info } from 'lucide-react'
import { useState } from 'react'
import { describeChange, MIN_VALID_AREAS, SCORE_AREAS } from '../../core/score'
import { Badge, Progress } from '../../ui/Display'
import { Sheet } from '../../ui/Sheet'

/** Personal score: compared only with the person's own previous week. */
export function ScoreCard({ overall, areas, previous, version, details }: { overall: number | null; areas: Record<string, number | null>; previous: number | null; version: number; details?: Record<string, string> }) {
  const [explain, setExplain] = useState(false)
  const change = describeChange(overall, previous)
  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent-hi">
          <Gauge size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-soft">NÚCLEO Score</p>
          {overall === null ? <p className="mt-1 text-[17px] font-semibold">Dados insuficientes</p> : <p className="num mt-0.5 text-[34px] leading-none font-semibold tracking-tight">{overall}</p>}
          <p className="mt-1 text-[13px] text-faint">{overall === null ? `Aparece quando pelo menos ${MIN_VALID_AREAS} áreas tiverem dados.` : (change ?? 'Sua pontuação pessoal da semana.')}</p>
        </div>
        <button type="button" aria-label="Como é calculado" onClick={() => setExplain(true)} className="grid size-9 place-items-center rounded-xl text-faint hover:bg-tint/[0.04] tap hover:text-ink">
          <Info size={18} />
        </button>
      </div>
      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {SCORE_AREAS.map((a) => {
          const s = areas[a.id]
          return (
            <div key={a.id}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                <span className="text-soft">{a.label}</span>
                {s === null || s === undefined ? <span className="text-faint">dados insuficientes</span> : <span className="num font-medium">{s}{details?.[a.id] ? <span className="font-normal text-faint"> · {details[a.id]}</span> : null}</span>}
              </div>
              {s !== null && s !== undefined && <Progress value={s} tone="accent" />}
            </div>
          )
        })}
      </div>

      <Sheet open={explain} onClose={() => setExplain(false)} title="Como o Score é calculado">
        <div className="space-y-4 text-[15px] leading-relaxed text-soft">
          <p>O Score compara você só com você mesmo. Não existe ranking nem comparação com outras pessoas.</p>
          <div className="card divide-y divide-line">
            {SCORE_AREAS.map((a) => (
              <div key={a.id} className="flex items-start gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{a.label}</span>
                  <span className="block text-[13px] text-faint">
                    {a.explain} · mínimo {a.min} {a.id === 'goals' ? 'meta' : a.id === 'training' ? 'dia planejado' : 'itens'}
                  </span>
                </span>
                <Badge>peso {a.weight}</Badge>
              </div>
            ))}
          </div>
          <p>Cada área vai de 0 a 100. O Score é a média ponderada só das áreas com dados suficientes — área sem dados fica de fora, nunca vale zero. Com menos de {MIN_VALID_AREAS} áreas, aparece “dados insuficientes”.</p>
          <p>Contam os dias que já passaram e, de hoje, só o que você já marcou. Itens pulados ficam fora da conta. Um treino conta só na área Treino, uma vez por dia.</p>
          <p className="text-[13px] text-faint">Fórmula versão {version}. Semanas fechadas guardam o Score com a versão usada.</p>
        </div>
      </Sheet>
    </section>
  )
}
