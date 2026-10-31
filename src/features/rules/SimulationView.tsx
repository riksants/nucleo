import { Check, CircleHelp, X } from 'lucide-react'
import { useMemo } from 'react'
import { todayIn, zoneOf } from '../../core/period'
import { describeCondition, describeRule } from '../../core/rules/sentence'
import { NO_HISTORY, simulateRule } from '../../core/rules/simulate'
import type { RuleDraft } from '../../core/rules/templates'
import { useStore } from '../../data/store'
import { useRuleNames } from './useRules'

const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
/** "reservou €24" → "teria reservado €24": the simulation never says something happened. */
const would = (text: string) =>
  `teria ${text
    .replace(/^reservou /, 'reservado ')
    .replace(/^criou /, 'criado ')
    .replace(/^adicionou /, 'adicionado ')
    .replace(/^mudou /, 'mudado ')
    .replace(/^aplicou /, 'aplicado ')
    .replace(/^pediu /, 'pedido ')
    .replace(/^avisou /, 'avisado ')}`

/** When the data has nothing to replay: one example in words, clearly marked as not real. */
function Example({ draft }: { draft: RuleDraft & { name: string } }) {
  const names = useRuleNames()
  const s = describeRule(draft, names)
  return (
    <div className="rounded-[var(--radius-field)] border border-dashed border-line px-3.5 py-2.5">
      <p className="label-mono text-faint">Exemplo — não aconteceu</p>
      <p className="mt-1 text-[14px] leading-relaxed text-soft">
        Se {s.when.replace(/^eu /, 'você ')}
        {s.ifs.length ? `, e ${s.ifs.join(' e ')}` : ''}, o Núcleo vai {s.dos.join(', depois ')}{draft.confirm ? ' — mas só depois que você confirmar em Pendências' : ''}.
      </p>
    </div>
  )
}

/** "Testar esta regra": read only — computed on a copy, nothing is saved. */
export function SimulationView({ draft }: { draft: RuleDraft & { name: string } }) {
  const { data, settings, convert } = useStore()
  const names = useRuleNames()
  const today = todayIn(zoneOf(settings))
  const sim = useMemo(() => simulateRule(draft, data, settings, convert, today), [draft, data, settings, convert, today])

  if (!sim.possible)
    return (
      <div className="space-y-3">
        <p className="text-[14px] leading-relaxed text-soft">{NO_HISTORY} O app não guarda o histórico de mudanças de status, então não dá para dizer o que teria acontecido.</p>
        <Example draft={draft} />
      </div>
    )

  const ran = sim.items.filter((x) => x.ran)
  const head = !sim.items.length
    ? `Nos últimos ${sim.days} dias não houve nenhum acontecimento deste tipo nos seus dados.`
    : ran.length
      ? `Nos últimos ${sim.days} dias esta regra teria rodado ${ran.length === 1 ? '1 vez' : `${ran.length} vezes`}${sim.items.length > ran.length ? ` (de ${sim.items.length} acontecimentos; nos outros, as condições não passaram)` : ''}.`
      : `Nos últimos ${sim.days} dias houve ${sim.items.length === 1 ? '1 acontecimento' : `${sim.items.length} acontecimentos`}, mas as condições não passaram em nenhum.`
  return (
    <div className="space-y-3">
      <p className="text-[15px] leading-relaxed">{head}</p>
      {!sim.items.length && <Example draft={draft} />}
      {sim.items.length > 0 && (
        <ul className="space-y-2.5">
          {sim.items.slice(-10).reverse().map((it, i) => (
            <li key={i} className="rounded-[var(--radius-field)] border border-line px-3.5 py-2.5">
              <p className="text-[14px] font-medium leading-snug">
                {ddmm(it.date)} · {it.label}
              </p>
              {it.conditions.map((c, k) => (
                <p key={k} className="mt-1 flex items-start gap-1.5 text-[13px] leading-snug text-soft">
                  {c.ok === true ? <Check size={14} className="mt-0.5 shrink-0 text-income" /> : c.ok === false ? <X size={14} className="mt-0.5 shrink-0 text-faint" /> : <CircleHelp size={14} className="mt-0.5 shrink-0 text-warn" />}
                  <span>
                    se {describeCondition(draft.conditions[k], names)}
                    {c.ok === null && ` — não dá para conferir (${c.reason})`}
                    {c.conversion && ` — ${names.money(c.conversion.amount, c.conversion.from)} ≈ ${names.money(c.conversion.converted, c.conversion.to)} pela cotação de hoje`}
                  </span>
                </p>
              ))}
              {it.actions.map((a, k) => (
                <p key={`a${k}`} className={`mt-1 text-[13px] leading-snug ${a.ok ? 'text-ink' : 'text-faint'}`}>
                  {a.ok ? `→ ${would(a.text)}` : `→ não teria feito: ${a.text}`}
                  {a.estimated && a.ok && <span className="ml-1.5 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn">estimativa</span>}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
      {sim.items.length > 10 && <p className="text-[13px] text-faint">Mostrando os 10 mais recentes.</p>}
      {sim.notes.map((n) => (
        <p key={n} className="text-[13px] leading-relaxed text-faint">
          {n}
        </p>
      ))}
      <p className="text-[13px] font-medium text-soft">Só uma simulação: nada foi criado, reservado ou alterado.</p>
    </div>
  )
}
