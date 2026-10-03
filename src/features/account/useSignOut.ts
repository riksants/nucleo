import { useState } from 'react'
import { useStore } from '../../data/store'
import { deleteCache } from '../../data/sync'
import { useFeedback } from '../../ui/Feedback'
import { useVault } from '../accounts/vault'
import { forgetPushOnThisDevice } from '../reminders/push'
import { useSession } from './session'

/**
 * "Sair da conta" — same steps as always (sync first, confirm, lock the vault,
 * stop push on this device, end the session, remove this account's copy from
 * the device). Afterwards the sign-in screen opens, so another account can sign
 * in right away (or go back to use the app without an account).
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
      const uid = auth.userId!
      await auth.signOut()
      await deleteCache(uid).catch(() => {})
      auth.openAuth('signin')
    } finally {
      setBusy(false)
    }
  }

  return { signOut, busy }
}
