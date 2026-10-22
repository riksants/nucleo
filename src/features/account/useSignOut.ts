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
 */
export function useSignOut() {
  const auth = useSession()
  const { repository } = useStore()
  const vault = useVault()
  const { confirm } = useFeedback()
  const [busy, setBusy] = useState(false)

  const signOut = async () => {
    setBusy(true)
    try {
      await repository.syncNow?.()
      const pending = repository.status?.().pending ?? 0
      const ok = await confirm({
        title: 'Sair da conta?',
        message: pending
          ? `${pending} alteração(ões) ainda não chegaram ao servidor e serão perdidas neste aparelho. Conecte-se à internet e sincronize antes, se puder.`
          : 'Seus dados continuam na conta. A cópia desta conta é removida deste aparelho e o cofre é fechado.',
        confirmLabel: 'Sair',
        danger: pending > 0,
      })
      if (!ok) return
      vault.lock()
      await forgetPushOnThisDevice().catch(() => {})
      await auth.signOut()
    } finally {
      setBusy(false)
    }
  }

  return { signOut, busy }
}
