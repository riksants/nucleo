import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check } from 'lucide-react'
import { useState } from 'react'
import { Logo } from '../../app/Shell'
import { useStore } from '../../data/store'
import { CURRENCIES, type Currency } from '../../data/types'
import { CURRENCY_INFO, parseAmount } from '../../lib/money'
import { Button, IconButton } from '../../ui/Button'

const POINTS = ['Saldo em EUR, BRL e AED', 'Projetos, clientes e tarefas', 'Tudo salvo no seu aparelho']

export function Onboarding() {
  const { completeOnboarding } = useStore()
  const [step, setStep] = useState(0)
  const [currency, setCurrency] = useState<Currency>('EUR')
  const [amount, setAmount] = useState('')
  const cents = amount.trim() ? parseAmount(amount) : 0

  const finish = () => {
    if (cents === null) return
    completeOnboarding(currency, cents)
  }

  return (
    <div className="flex min-h-dvh flex-col px-6 pt-[calc(env(safe-area-inset-top)+20px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex h-11 items-center justify-between">
          {step > 0 ? (
            <IconButton label="Voltar" onClick={() => setStep(step - 1)} className="-ml-2">
              <ArrowLeft size={22} />
            </IconButton>
          ) : (
            <span />
          )}
          <div className="flex gap-1.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-accent' : 'w-1.5 bg-white/15'}`} />
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            className="flex flex-1 flex-col"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
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
                    {POINTS.map((p) => (
                      <li key={p} className="flex items-center gap-3 text-[16px]">
                        <span className="grid size-6 place-items-center rounded-full bg-accent/15 text-accent-hi">
                          <Check size={14} strokeWidth={3} />
                        </span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
                <Button size="lg" block onClick={() => setStep(1)}>
                  Começar
                </Button>
              </>
            )}

            {step === 1 && (
              <>
                <div className="flex-1 pt-10">
                  <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.03em]">Qual sua moeda principal?</h1>
                  <p className="mt-2 text-[16px] text-soft">Seu saldo é guardado nela. Você pode ver em qualquer moeda depois.</p>
                  <div className="mt-8 space-y-3" role="radiogroup">
                    {CURRENCIES.map((c) => {
                      const active = c === currency
                      return (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setCurrency(c)}
                          className={`press flex h-18 w-full items-center gap-4 rounded-[1.25rem] border px-5 text-left transition-colors ${
                            active ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-line-strong'
                          }`}
                        >
                          <span className="grid size-11 place-items-center rounded-2xl bg-elevated text-[17px] font-semibold">{CURRENCY_INFO[c].symbol}</span>
                          <span className="flex-1">
                            <span className="block text-[17px] font-semibold">{CURRENCY_INFO[c].label}</span>
                            <span className="text-sm text-faint">{c}</span>
                          </span>
                          <span className={`grid size-6 place-items-center rounded-full border-2 ${active ? 'border-accent bg-accent text-white' : 'border-white/20'}`}>
                            {active && <Check size={14} strokeWidth={3} />}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <Button size="lg" block onClick={() => setStep(2)}>
                  Continuar
                </Button>
              </>
            )}

            {step === 2 && (
              <>
                <div className="flex-1 pt-10">
                  <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.03em]">Quanto você tem hoje?</h1>
                  <p className="mt-2 text-[16px] text-soft">Esse é o seu saldo inicial. Não conta como entrada.</p>
                  <label className="mt-8 flex items-center gap-3 rounded-[1.25rem] border border-line bg-raised px-5 focus-within:border-accent/70">
                    <span className="text-2xl font-medium text-soft">{CURRENCY_INFO[currency].symbol}</span>
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
