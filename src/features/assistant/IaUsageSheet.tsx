import { useEffect, useState } from 'react'
import { Sheet } from '../../ui/Sheet'
import { usageView, type UsageRow } from '../../core/assistant/ia/usage'
import { iaUsage } from './iaApi'

function Bar({ label, value, detail, data }: { label: string; value: number; detail?: string; data: string }) {
  const pct = Math.round(value * 100)
  return (
    <div className="space-y-1.5" data-usage={data}>
      <div className="flex items-baseline justify-between gap-3 text-[15px]">
        <span className="text-ink">{label}</span>
        <span className="tabular-nums text-soft">{detail ?? `${pct}%`}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-tint/[0.08]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={`h-full rounded-full ${value >= 0.8 ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** "Uso da IA": how much of the person's limit is used (percentages; dollars only for the owner). */
export function IaUsageSheet({ open, onClose, row }: { open: boolean; onClose(): void; row?: UsageRow | null }) {
  const [u, setU] = useState<UsageRow | null | undefined>(row)
  useEffect(() => {
    if (!open) return
    let alive = true
    iaUsage().then((x) => alive && setU(x))
    return () => {
      alive = false
    }
  }, [open])
  const v = u ? usageView(u) : null
  return (
    <Sheet open={open} onClose={onClose} title="Uso da IA">
      <div className="space-y-5 pb-2" data-ia-usage>
        {u === undefined && <p className="text-[15px] text-soft">Carregando…</p>}
        {u === null && <p className="text-[15px] text-soft">Não deu para ver o uso agora. Tente de novo com internet.</p>}
        {v && (
          <>
            <p className="text-[15px] text-soft">
              <span className="font-medium text-ink">{v.label}</span>
              {v.daysLeft !== null && ` · ${v.daysLeft === 1 ? 'falta 1 dia' : `faltam ${v.daysLeft} dias`}`}
            </p>
            <div className="card space-y-4 p-4">
              <Bar data="day" label="Hoje" value={v.day} detail={v.dollars?.day} />
              <Bar data="period" label={u!.tier === 'trial' ? 'Período de teste' : 'Este mês'} value={v.period} detail={v.dollars?.period} />
              <Bar data="deep" label="Análises a fundo" value={v.deep} detail={v.dollars?.deep} />
            </div>
            <p className="text-[15px] leading-relaxed text-soft" data-usage-left>
              {v.blocked ? 'O limite de uso da IA acabou por agora. Os comandos do Assistente continuam funcionando.' : `Cabem cerca de ${v.questionsLeft} perguntas simples ${v.day >= v.period ? 'hoje' : 'neste período'}. Análises a fundo gastam mais.`}
            </p>
            <p className="text-[13px] leading-relaxed text-faint">O NÚCLEO registra só o custo de cada pergunta, nunca o texto.</p>
          </>
        )}
      </div>
    </Sheet>
  )
}
