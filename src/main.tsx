import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { playOpening } from './app/opening'
import { createIndexedDbRepository, type Repository } from './data/repository'
import { StoreProvider } from './data/store'
import { createSupabaseRemote, createSyncedRepository } from './data/sync'
import { AuthScreen } from './features/account/AuthScreen'
import { SessionProvider, useSession } from './features/account/session'
import { VaultProvider } from './features/accounts/vault'
import './index.css'
import { supabase } from './lib/supabase'
import { FeedbackProvider } from './ui/Feedback'

/**
 * Without an account the app keeps using the device database exactly as before.
 * Signed in, each account gets its own synced cache: data from the device or
 * from another account is never mixed in silently.
 */
const repositories = new Map<string, Repository>()

function repositoryFor(userId: string | null): Repository {
  const key = userId ?? 'local'
  let repo = repositories.get(key)
  if (!repo) {
    repo = userId && supabase ? createSyncedRepository(userId, createSupabaseRemote(supabase, userId)) : createIndexedDbRepository()
    repositories.set(key, repo)
  }
  return repo
}

function Root() {
  const { checked, userId, screen } = useSession()
  const repository = repositoryFor(userId)
  // Switching account (or signing out) stops the previous account's sync.
  useEffect(() => {
    const key = userId ?? 'local'
    for (const [k, repo] of repositories) {
      if (k === key) continue
      repo.dispose?.()
      repositories.delete(k)
    }
  }, [userId])

  if (!checked) return null
  if (screen && (screen !== 'newPassword' || userId)) return <AuthScreen />
  return (
    <StoreProvider key={userId ?? 'local'} repository={repository}>
      <VaultProvider>
        <App />
      </VaultProvider>
    </StoreProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <FeedbackProvider>
        <Root />
      </FeedbackProvider>
    </SessionProvider>
  </StrictMode>,
)

// Opening animation: reveals the first screen once it has rendered behind the splash.
void playOpening()
