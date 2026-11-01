import { useStore } from '../../data/store'
import { Sheet } from '../../ui/Sheet'
import { Switch } from '../settings/ModulePicker'
import { areaAvailable } from '../../core/assistant/ia/lookups'
import { AREA_HINT, AREA_LABEL, PRIVACY_AREAS } from '../../../supabase/functions/_shared/ia/tools.ts'

/**
 * "Privacidade da IA": what the AI may read, area by area. Only areas with a visible section are
 * listed (a section off is already out of reach). Senhas and the vault never appear: never readable.
 */
export function IaPrivacySheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { settings, updateSettings } = useStore()
  const ai = settings.assistantAi
  const off = new Set(ai?.areasOff ?? [])
  const areas = PRIVACY_AREAS.filter((a) => areaAvailable(a, settings))
  const toggle = (area: string) => {
    if (!ai) return
    const next = new Set(off)
    if (next.has(area)) next.delete(area)
    else next.add(area)
    updateSettings({ assistantAi: { ...ai, areasOff: [...next] } })
  }
  return (
    <Sheet open={open} onClose={onClose} title="Privacidade da IA">
      <div className="space-y-4 pb-2" data-ia-privacy>
        <p className="text-[15px] leading-relaxed text-soft">
          Escolha o que a IA pode consultar para responder. Uma área desligada nunca é lida nem enviada. Senhas e cofre nunca são acessíveis.
        </p>
        <div className="card divide-y divide-line">
          {areas.map((a) => {
            const on = !off.has(a)
            return (
              <button key={a} type="button" role="switch" aria-checked={on} data-area={a} onClick={() => toggle(a)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-tint/[0.03]">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-ink">{AREA_LABEL[a]}</span>
                  <span className="block text-[13px] text-faint">{AREA_HINT[a]}</span>
                </span>
                <Switch checked={on} />
              </button>
            )
          })}
        </div>
        <p className="text-[13px] leading-relaxed text-faint">Vale para este e para os outros aparelhos da sua conta. A busca da IA segue as mesmas escolhas.</p>
      </div>
    </Sheet>
  )
}
