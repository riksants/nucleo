import { Gauge, Info } from 'lucide-react'
import { useState } from 'react'
import { describeChange, MIN_VALID_AREAS, SCORE_AREAS, scoreBand } from '../../core/score'
import { Badge, Progress } from '../../ui/Display'
import { Sheet } from '../../ui/Sheet'

/** Personal score: compared only with the person's own previous week. */
export function ScoreCard({ overall, areas, previous, version, details }: { overall: number | null; areas: Record<string, number | null>; previous: number | null; version: number; details?: Record<string, string> }) {
  const [explain, setExplain] = useState(false)
  const change = describeChange(overall, previous)
  const band = scoreBand(overall)
  // Only the areas with enough data are listed; the others are named in one quiet line (they don't count).
  const counted = SCORE_AREAS.filter((a) => areas[a.id] !== null && areas[a.id] !== undefined)
  const left = SCORE_AREAS.filter((a) => areas[a.id] === null || areas[a.id] === undefined)
  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl icon-tile">
          <Gauge size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-soft">NÚCLEO Score</p>
          {!band ? (
            <p className="mt-1 text-[17px] font-semibold">Dados insuficientes</p>
          ) : (
            <p className="mt-0.5 flex items-baseline gap-2">
              <span className="num text-[30px] leading-none font-semibold tracking-tight">≈ {band.approx}</span>
              <span className="text-[15px] font-medium text-soft">{band.label}</span>
            </p>
          )}
          <p className="mt-1 text-[13px] text-faint">{!band ? `Aparece quando pelo menos ${MIN_VALID_AREAS} áreas tiverem dados.` : (change ?? 'Você comparado só com você.')}</p>
        </div>
        <button type="button" aria-label="Como é calculado" onClick={() => setExplain(true)} className="grid size-9 place-items-center rounded-xl text-faint hover:bg-tint/[0.04] tap hover:text-ink">
          <Info size={18} />
        </button>
      </div>
      {counted.length > 0 && (
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {counted.map((a) => {
            const s = areas[a.id] as number
            return (
              <div key={a.id}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="text-soft">{a.label}</span>
                  <span className="num font-medium">{details?.[a.id] ?? `${s}%`}</span>
                </div>
                <Progress value={s} tone="accent" />
              </div>
            )
          })}
        </div>
      )}
      {left.length > 0 && <p className="mt-3 text-[12px] text-faint">Sem dados suficientes, não contam: {left.map((a) => a.label.toLowerCase()).join(', ')}.</p>}

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
          <p>O valor aparece arredondado de 5 em 5 (≈ 75), com uma palavra: 80 ou mais “muito consistente”, 60 a 79 “consistente”, 40 a 59 “parcial”, abaixo de 40 “começando”. É um retrato aproximado, não uma nota.</p>
          <p>Contam os dias que já passaram e, de hoje, só o que você já marcou. Itens pulados ficam fora da conta. Um treino conta só na área Treino, uma vez por dia.</p>
          <p className="text-[13px] text-faint">Fórmula versão {version}. Semanas fechadas guardam o Score com a versão usada.</p>
        </div>
      </Sheet>
    </section>
  )
}
