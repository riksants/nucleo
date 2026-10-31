import { useCallback } from 'react'
import { startHistory } from '../../core/financeGoals'
import { dayOf } from '../../core/indexes'
import { todayIn, zoneOf } from '../../core/period'
import { foldSame } from '../../core/smart/amount'
import { missingOf, sameMovement, type PaymentLink, type SmartDraft } from '../../core/smart/understand'
import { instantFor } from '../../data/receipts'
import { newId, useStore, withExtras } from '../../data/store'
import { useReceipts } from '../../data/useReceipts'
import { useAutomationActions } from '../../data/useAutomations'
import type { Sale } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { useFeedback } from '../../ui/Feedback'

/**
 * Saves a confirmed smart preview through the app's usual paths (the same as the forms): rules answer the write
 * as always, a payment of a sale goes into the sale (its income follows), a waiting charge is confirmed instead of
 * creating a second movement. Returns the message to show, or null when nothing was saved.
 */
export function useSmartSave() {
  const { data, settings, save, convert } = useStore()
  const { saveSales } = useReceipts()
  const { confirm: confirmCharge } = useAutomationActions()
  const { confirm, toast } = useFeedback()

  return useCallback(
    async (d: SmartDraft, links: PaymentLink[]): Promise<string | null> => {
      if (missingOf(d, links).length) return null
      const now = new Date()
      const tz = zoneOf(settings)
      const today = todayIn(tz, now)
      switch (d.kind) {
        case 'money': {
          const amount = d.amount!
          const currency = d.currency!
          const date = d.date!
          const link = links.find((l) => l.key === d.link)
          if (link?.kind === 'sale') {
            const sale = data.sales.find((s) => s.id === link.saleId) as Sale | undefined
            if (!sale) return toast('A venda não existe mais.', 'error'), null
            if (amount > (link.open ?? 0)) return toast(`O valor é maior do que falta nesta venda (${formatMoney(link.open ?? 0, sale.currency)}).`, 'error'), null
            await saveSales([{ ...sale, payments: [...sale.payments, { id: newId(), date, amount, note: '', finance: true }] }])
            return `Pagamento registrado na venda “${sale.product || 'venda'}”`
          }
          if (link?.kind === 'charge' && link.run) {
            const error = await confirmCharge(link.run, { amount, date })
            if (error) return toast(error, 'error'), null
            return link.run.automation === 'subscriberCharge' ? 'Recebimento confirmado' : 'Pagamento confirmado'
          }
          if (sameMovement({ ...d, amount, currency, date }, data, (iso) => dayOf(iso, tz))) {
            const ok = await confirm({ title: 'Já existe uma igual', message: `Você já registrou “${d.reason}” de ${formatMoney(amount, currency)} neste dia. Registrar outra?`, confirmLabel: 'Registrar outra' })
            if (!ok) return null
          }
          const base = convert(amount, currency, settings.baseCurrency)
          if (base === null) return toast(`Sem cotação para ${currency} agora. Atualize as cotações e tente de novo.`, 'error'), null
          await save('transactions', withExtras({ type: d.type, amount, currency, reason: d.reason.trim(), baseAmount: d.type === 'in' ? base : -base, createdAt: instantFor(date, tz, now) }, d.type, d.category ? { category: d.category } : {}))
          return d.type === 'in' ? 'Entrada registrada' : 'Saída registrada'
        }
        case 'goal': {
          const g = {
            name: d.name.trim(),
            target: d.target!,
            saved: 0,
            deadline: d.deadline!,
            currency: d.currency!,
            note: '',
            status: 'active' as const,
            history: startHistory(0, today),
            ...(d.monthly && d.autoSave ? { inBalance: true, autoSave: { day: Math.min(Number(today.slice(8, 10)), 28), mode: 'fixed' as const, amount: d.monthly, since: today } } : {}),
          }
          await save('financeGoals', g)
          return `Meta “${g.name}” criada`
        }
        case 'subscription': {
          const same = data.tools.find((t) => foldSame(t.name).trim() === foldSame(d.name).trim() && t.status === 'active')
          if (same) {
            const ok = await confirm({ title: 'Já existe', message: `Você já tem a assinatura “${same.name}”. Criar outra?`, confirmLabel: 'Criar outra' })
            if (!ok) return null
          }
          await save('tools', { name: d.name.trim(), link: '', plan: '', price: d.price!, currency: d.currency!, billing: d.billing!, nextCharge: d.nextCharge!, notes: '', status: 'active' })
          return `Assinatura “${d.name.trim()}” criada`
        }
        case 'client': {
          const same = data.clients.find((c) => foldSame(c.name).trim() === foldSame(d.name).trim())
          if (same) return toast(`O cliente “${same.name}” já existe.`, 'error'), null
          await save('clients', { name: d.name.trim(), company: '', phone: '', whatsapp: '', email: '', location: '', notes: '', status: 'active' })
          return `Cliente “${d.name.trim()}” cadastrado`
        }
        default:
          return null
      }
    },
    [data, settings, save, convert, saveSales, confirmCharge, confirm, toast],
  )
}
