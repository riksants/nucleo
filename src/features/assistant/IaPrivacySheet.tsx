import { Check, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../data/store'
import { Sheet } from '../../ui/Sheet'
import { Switch } from '../settings/ModulePicker'
import { areaAvailable } from '../../core/assistant/ia/lookups'
import { AREA_HINT, AREA_LABEL, PRIVACY_AREAS } from '../../../supabase/functions/_shared/ia/tools.ts'
import { cleanMemory, MEMORY_CHARS, MEMORY_MAX, memoryRefusal } from '../../../supabase/functions/_shared/ia/memory.ts'
import { speechSupported } from '../../lib/speech'

type Memory = { id: string; text: string; at: string }

const rowCls = 'flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-tint/[0.03]'

function SwitchRow({ label, hint, on, onToggle, data }: { label: string; hint: string; on: boolean; onToggle(): void; data?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} data-setting={data} onClick={onToggle} className={rowCls}>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-ink">{label}</span>
        <span className="block text-[13px] text-faint">{hint}</span>
      </span>
      <Switch checked={on} />
    </button>
  )
}

/** One reminder: shown, edited in place (same checks as new ones) or deleted. */
function MemoryRow({ m, onSave, onDelete }: { m: Memory; onSave(text: string): string | null; onDelete(): void }) {
  const [edit, setEdit] = useState<string | null>(null)
  const [err, setErr] = useState('')
  if (edit === null)
    return (
      <li className="flex items-start gap-2 px-4 py-2.5" data-memory={m.id}>
        <p className="min-w-0 flex-1 py-1.5 text-[15px] leading-snug break-words">{m.text}</p>
        <button type="button" aria-label="Editar lembrete" onClick={() => setEdit(m.text)} className="press grid size-11 shrink-0 place-items-center rounded-full text-soft hover:text-ink">
          <Pencil size={18} />
        </button>
        <button type="button" aria-label="Apagar lembrete" onClick={onDelete} className="press grid size-11 shrink-0 place-items-center rounded-full text-soft hover:text-danger">
          <Trash2 size={18} />
        </button>
      </li>
    )
  return (
    <li className="space-y-1.5 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <input aria-label="Editar lembrete" value={edit} maxLength={MEMORY_CHARS} onChange={(e) => setEdit(e.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-raised px-3 text-[16px] text-ink focus:border-accent-hi/70 focus:outline-none" />
        <button
          type="button"
          aria-label="Salvar lembrete"
          onClick={() => {
            const why = onSave(edit)
            if (why) return setErr(why)
            setEdit(null)
            setErr('')
          }}
          className="press grid size-11 shrink-0 place-items-center rounded-full bg-accent text-on-accent"
        >
          <Check size={18} />
        </button>
        <button type="button" aria-label="Cancelar" onClick={() => (setEdit(null), setErr(''))} className="press grid size-11 shrink-0 place-items-center rounded-full text-soft hover:text-ink">
          <X size={18} />
        </button>
      </div>
      {err && <p className="text-[13px] text-danger" role="alert">{err}</p>}
    </li>
  )
}

/**
 * "Privacidade da IA" — everything the person controls about the AI, in one place: what it may read
 * (areas), the conversation kept on this device, long-term reminders, voice, and erasing it all.
 * Senhas and the vault never appear: never readable.
 */
export function IaPrivacySheet({ open, onClose, onClearDevice }: { open: boolean; onClose(): void; onClearDevice(): void }) {
  const { settings, updateSettings } = useStore()
  const ai = settings.assistantAi
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')
  const [cleared, setCleared] = useState(false)
  const voice = speechSupported()
  if (!ai) return null
  const off = new Set(ai.areasOff ?? [])
  const areas = PRIVACY_AREAS.filter((a) => areaAvailable(a, settings))
  const memory = ai.memory ?? []
  const set = (patch: Partial<NonNullable<typeof ai>>) => updateSettings({ assistantAi: { ...ai, ...patch } })
  const toggleArea = (area: string) => {
    const next = new Set(off)
    if (next.has(area)) next.delete(area)
    else next.add(area)
    set({ areasOff: [...next] })
  }
  const add = () => {
    const why = memoryRefusal(draft) ?? (memory.length >= MEMORY_MAX ? `Até ${MEMORY_MAX} lembretes. Apague um para guardar outro.` : null)
    if (why) return setErr(why)
    set({ memory: [...memory, { id: crypto.randomUUID(), text: cleanMemory(draft), at: new Date().toISOString() }] })
    setDraft('')
    setErr('')
  }
  const continuityOn = ai.continuity !== false
  return (
    <Sheet open={open} onClose={onClose} title="Privacidade da IA">
      <div className="space-y-5 pb-2" data-ia-privacy>
        <section className="space-y-2">
          <h3 className="label-mono text-faint">O que a IA pode consultar</h3>
          <p className="text-[15px] leading-relaxed text-soft">Uma área desligada nunca é lida nem enviada. Senhas e cofre nunca são acessíveis.</p>
          <div className="card divide-y divide-line">
            {areas.map((a) => {
              const on = !off.has(a)
              return (
                <button key={a} type="button" role="switch" aria-checked={on} data-area={a} onClick={() => toggleArea(a)} className={rowCls}>
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
        </section>

        <section className="space-y-2">
          <h3 className="label-mono text-faint">Conversa</h3>
          <div className="card divide-y divide-line">
            <SwitchRow
              data="continuity"
              label="Continuar a conversa neste aparelho"
              hint="Guarda a conversa só aqui, por 12 horas, sem valores no contexto. Nunca vai para a nuvem e some ao sair da conta."
              on={continuityOn}
              onToggle={() => {
                if (continuityOn) onClearDevice()
                set({ continuity: !continuityOn })
              }}
            />
            <button
              type="button"
              data-clear-ia
              onClick={() => {
                onClearDevice()
                setCleared(true)
              }}
              className={`${rowCls} text-[15px] text-danger`}
            >
              {cleared ? 'Conversa apagada deste aparelho' : 'Apagar a conversa deste aparelho'}
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="label-mono text-faint">Lembretes de longo prazo</h3>
          <div className="card divide-y divide-line">
            <SwitchRow
              data="memory"
              label="Usar lembretes"
              hint="Preferências que você confirma (ex.: “prefiro respostas curtas”). A IA só sugere; nada é guardado sem o seu toque. Sem valores nem dados sensíveis."
              on={Boolean(ai.memoryOn)}
              onToggle={() => set({ memoryOn: !ai.memoryOn })}
            />
            {ai.memoryOn && (
              <>
                {memory.length > 0 && (
                  <ul className="divide-y divide-line" data-memory-list>
                    {memory.map((m) => (
                      <MemoryRow
                        key={m.id}
                        m={m}
                        onDelete={() => set({ memory: memory.filter((x) => x.id !== m.id) })}
                        onSave={(text) => {
                          const why = memoryRefusal(text)
                          if (!why) set({ memory: memory.map((x) => (x.id === m.id ? { ...x, text: cleanMemory(text), at: new Date().toISOString() } : x)) })
                          return why
                        }}
                      />
                    ))}
                  </ul>
                )}
                <form
                  className="space-y-1.5 px-4 py-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    add()
                  }}
                >
                  <div className="flex items-center gap-2">
                    <input aria-label="Novo lembrete" placeholder="Ex.: prefiro respostas curtas" value={draft} maxLength={MEMORY_CHARS} onChange={(e) => setDraft(e.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-raised px-3 text-[16px] text-ink placeholder:text-faint focus:border-accent-hi/70 focus:outline-none" />
                    <button type="submit" disabled={!draft.trim()} className="press h-11 shrink-0 rounded-full bg-accent px-4 text-[15px] font-medium text-on-accent disabled:opacity-40">
                      Guardar
                    </button>
                  </div>
                  {err && <p className="text-[13px] text-danger" role="alert">{err}</p>}
                  <p className="text-[13px] text-faint">
                    {memory.length} de {MEMORY_MAX}. Vale nos seus aparelhos.
                  </p>
                </form>
              </>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="label-mono text-faint">Voz</h3>
          <p className="text-[15px] leading-relaxed text-soft">
            {voice
              ? 'O microfone usa o reconhecimento de voz do próprio aparelho. No iPhone e no Chrome ele pode passar pelos servidores da Apple ou do Google. “Ouvir” usa a voz do aparelho. Digitar sempre funciona.'
              : 'Este navegador não tem reconhecimento de voz: use o teclado (inclusive o ditado do próprio teclado). “Ouvir” funciona onde o aparelho tiver voz.'}
          </p>
        </section>

        <section className="space-y-2 pb-1">
          <button
            type="button"
            data-erase-ia
            onClick={() => {
              onClearDevice()
              set({ memory: [], memoryOn: false })
              setCleared(true)
            }}
            className="press h-12 w-full rounded-full border border-danger/50 text-[15px] font-medium text-danger"
          >
            Apagar tudo da IA (conversa e lembretes)
          </button>
          <p className="text-[13px] leading-relaxed text-faint">Os seus registros não são apagados. O NÚCLEO guarda só o custo de cada pergunta, nunca o texto.</p>
        </section>
      </div>
    </Sheet>
  )
}
