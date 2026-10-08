import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check } from 'lucide-react'
import { useState } from 'react'
import { usePrefersReducedMotion } from '../../lib/hooks'
import { Logo } from '../../app/Shell'
import { useStore } from '../../data/store'
import { STARTER_CURRENCIES, type Currency, type ModuleId } from '../../data/types'
import { currencyInfo, parseAmount } from '../../lib/money'
import { Button, IconButton } from '../../ui/Button'
import { CurrencySheet } from '../../ui/CurrencySheet'
import { useSession } from '../account/session'
import { ModulePicker, starterModules } from '../settings/ModulePicker'

/** Step transitions on the GPU: the old step leaves quickly (120 ms), the new one settles in (220 ms). Reduced motion: fades only. */
const STEP_EASE = [0.22, 1, 0.36, 1] as const
function stepVariants(reduce: boolean) {
  const shift = (px: number) => (reduce ? 'translateX(0px)' : `translateX(${px}px)`)
  return {
    enter: (d: number) => ({ opacity: 0, transform: shift(16 * d) }),
    center: { opacity: 1, transform: 'translateX(0px)', transition: { duration: 0.22, ease: STEP_EASE } },
    exit: (d: number) => ({ opacity: 0, transform: shift(-16 * d), transition: { duration: 0.12, ease: STEP_EASE } }),
  }
}

export function Onboarding() {
  const { completeOnboarding } = useStore()
  const auth = useSession()
  const [step, setStep] = useState(0)
  // Direction of the last step change: forward slides in from the right, back from the left.
  const [shown, setShown] = useState(0)
  const [dir, setDir] = useState(1)
  if (shown !== step) {
    setDir(step > shown ? 1 : -1)
    setShown(step)
  }
  const reduce = usePrefersReducedMotion()
  const [currency, setCurrency] = useState<Currency>('BRL')
  const [searching, setSearching] = useState(false)
  const [modules, setModules] = useState<Partial<Record<ModuleId, boolean>>>(starterModules)
  const [amount, setAmount] = useState('')
  const cents = amount.trim() ? parseAmount(amount) : 0
  const choices = STARTER_CURRENCIES.includes(currency) ? STARTER_CURRENCIES : [...STARTER_CURRENCIES, currency]
  const points = ['Saldo em qualquer moeda', 'Projetos, clientes, tarefas e mais', auth.userId ? 'Sincronizado na sua conta' : auth.configured ? 'No aparelho ou sincronizado na sua conta' : 'Tudo salvo no seu aparelho']
  const steps = modules.finance ? 4 : 3

  const finish = () => {
    if (cents === null) return
    completeOnboarding(currency, modules.finance ? cents : 0, modules)
  }

  return (
    <div className="flex min-h-dvh flex-col px-6 pt-[calc(env(safe-area-inset-top)+20px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex h-11 items-center justify-between">
          {step > 0 ? (
            <IconButton label="Voltar" onClick={() => setStep(step - 1)} className="-ml-2">
              <ArrowLeft size={20} />
            </IconButton>
          ) : (
            <span />
          )}
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: steps }, (_, i) => i).map((i) => (
              <span key={i} className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ease-(--ease-out-soft) ${i === step ? 'w-6 bg-accent' : 'w-1.5 bg-tint/15'}`} />
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={step}
            className="flex flex-1 flex-col"
            custom={dir}
            variants={stepVariants(reduce)}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {step === 0 && (
              <>
                <div className="flex flex-1 flex-col justify-center">
                  <div className="scale-150 self-start origin-left">
                    <Logo />
                  </div>
                  <h1 className="mt-8 text-[38px] leading-[1.05] font-semibold tracking-[-0.04em]">Seu centro de organização.</h1>
                  <p className="mt-4 text-[17px] leading-relaxed text-soft">Dinheiro, trabalho e anotações num lugar só — rápido de abrir, simples de usar.</p>
                  <ul className="mt-8 space-y-3">
                    {points.map((p) => (
                      <li key={p} className="flex items-center gap-3 text-[16px]">
                        <span className="grid size-6 place-items-center rounded-full bg-accent/15 text-accent-hi">
                          <Check size={14} strokeWidth={2.6} />
                        </span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-2.5">
                  <Button size="lg" block onClick={() => setStep(1)}>
                    {auth.userId ? 'Configurar minha conta' : auth.configured ? 'Começar sem conta' : 'Começar'}
                  </Button>
                  {auth.configured && !auth.userId && (
                    <Button size="lg" variant="secondary" block onClick={() => auth.openAuth('signin')}>
                      Entrar ou criar conta
                    </Button>
                  )}
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div className="flex-1 pt-10">
                  <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.03em]">Qual sua moeda principal?</h1>
                  <p className="mt-2 text-[16px] text-soft">Seu saldo é guardado nela. Você pode ver em outras moedas depois.</p>
                  <div className="mt-8 space-y-3" role="radiogroup">
                    {choices.map((c) => {
                      const active = c === currency
                      return (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setCurrency(c)}
                          className={`press flex h-18 w-full items-center gap-4 rounded-[1.25rem] border px-5 text-left transition-colors ${
                            active ? 'border-accent-hi bg-accent/10' : 'border-line bg-surface hover:border-line-strong'
                          }`}
                        >
                          <span className="grid h-11 min-w-11 place-items-center rounded-2xl bg-elevated px-1.5 text-[15px] font-semibold">{currencyInfo(c).symbol}</span>
                          <span className="flex-1">
                            <span className="block text-[17px] font-semibold">{currencyInfo(c).label}</span>
                            <span className="text-sm text-faint">{c}</span>
                          </span>
                          <span className={`grid size-6 place-items-center rounded-full border-2 ${active ? 'border-accent-hi bg-accent text-on-accent' : 'border-tint/20'}`}>
                            {active && <Check size={14} strokeWidth={2.6} />}
                          </span>
                        </button>
                      )
                    })}
                    <button type="button" onClick={() => setSearching(true)} className="w-full py-2 text-left text-[15px] font-medium text-accent-hi hover:text-ink">
                      Outra moeda…
                    </button>
                  </div>
                  <CurrencySheet open={searching} onClose={() => setSearching(false)} value={currency} onPick={setCurrency} />
                </div>
                <Button size="lg" block onClick={() => setStep(2)}>
                  Continuar
                </Button>
              </>
            )}

            {step === 2 && (
              <>
                <div className="flex-1 pt-10">
                  <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.03em]">O que você quer usar?</h1>
                  <p className="mt-2 text-[16px] text-soft">Só aparece o que você escolher. Dá para mudar em Configurações, sem perder nada.</p>
                  <div className="mt-6">
                    <ModulePicker value={modules} onChange={setModules} />
                  </div>
                </div>
                <Button size="lg" block onClick={() => (modules.finance ? setStep(3) : finish())}>
                  {modules.finance ? 'Continuar' : 'Entrar'}
                </Button>
              </>
            )}

            {step === 3 && (
              <>
                <div className="flex-1 pt-10">
                  <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.03em]">Quanto você tem hoje?</h1>
                  <p className="mt-2 text-[16px] text-soft">Esse é o seu saldo inicial. Não conta como entrada.</p>
                  <label className="mt-8 flex items-center gap-3 rounded-[1.25rem] border border-line bg-raised px-5 focus-within:border-accent-hi/70">
                    <span className="text-2xl font-medium text-soft">{currencyInfo(currency).symbol}</span>
                    <input
                      inputMode="decimal"
                      autoFocus
                      placeholder="0"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && finish()}
                      aria-label="Saldo inicial"
                      className="num h-20 min-w-0 flex-1 bg-transparent text-[40px]! font-semibold tracking-tight placeholder:text-faint/60 focus:outline-none"
                    />
                  </label>
                  {cents === null && <p className="mt-2 text-sm text-expense">Digite um valor válido</p>}
                  <p className="mt-4 text-sm text-faint">Dá para corrigir depois em Configurações.</p>
                </div>
                <Button size="lg" block onClick={finish} disabled={cents === null}>
                  Entrar
                </Button>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
