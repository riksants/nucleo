import { useState } from 'react'
import { useStore } from '../../data/store'
import { useFeedback } from '../../ui/Feedback'
import { useVault } from '../accounts/vault'
import { forgetPushOnThisDevice } from '../reminders/push'
import { useSession } from './session'

/**
 * "Sair da conta": sync first, confirm, lock the vault, stop push on this device (while the
 * session can still remove it from the server), then end the session. Removing the account's
 * data from the device is the same for every way a session ends (session.tsx → deviceCleanup);
 * afterwards the page starts fresh on the sign-in screen.
 * "Sair de todos os aparelhos" ends the other sessions on the server first, then this one.
 */
export function useSignOut() {
  const auth = useSession()
  const { repository } = useStore()
  const vault = useVault()
  const { confirm, toast } = useFeedback()
  const [busy, setBusy] = useState(false)

  const leave = async (everywhere: boolean) => {
    setBusy(true)
    try {
      await repository.syncNow?.()
      const pending = repository.status?.().pending ?? 0
      const lostText = pending ? `${pending} alteração(ões) ainda não chegaram ao servidor e serão perdidas neste aparelho. Conecte-se à internet e sincronize antes, se puder.` : ''
      const ok = await confirm(
        everywhere
          ? {
              title: 'Sair de todos os aparelhos?',
              message: `${lostText ? lostText + ' ' : ''}A sessão termina em todos os aparelhos onde esta conta está aberta, inclusive este. Use se perdeu um aparelho ou acha que alguém entrou na sua conta — e troque também a senha. Seus dados continuam na conta.`,
              confirmLabel: 'Sair de todos',
              danger: true,
            }
          : {
              title: 'Sair da conta?',
              message: lostText || 'Seus dados continuam na conta. A cópia desta conta é removida deste aparelho e o cofre é fechado.',
              confirmLabel: 'Sair',
              danger: pending > 0,
            },
      )
      if (!ok) return
      if (everywhere) {
        // Other devices first: if that fails (offline), this one stays as it was and says so.
        try {
          await auth.signOutEverywhere({
            beforeThisDevice: async () => {
              vault.lock()
              await forgetPushOnThisDevice().catch(() => {})
            },
          })
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), 'error')
        }
        return
      }
      vault.lock()
      await forgetPushOnThisDevice().catch(() => {})
      await auth.signOut()
    } finally {
      setBusy(false)
    }
  }

  return { signOut: () => leave(false), signOutEverywhere: () => leave(true), busy }
}
