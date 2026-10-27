import { MotionConfig } from 'framer-motion'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppErrorScreen, BareErrorScreen, ErrorBoundary } from './app/ErrorBoundary'
import { playOpening } from './app/opening'
import { onAccountRemoval, rememberAccountOnDevice } from './data/deviceCleanup'
import { createIndexedDbRepository, type Repository } from './data/repository'
import { StoreProvider } from './data/store'
import { createSupabaseRemote, createSyncedRepository } from './data/sync'
import { AuthScreen } from './features/account/AuthScreen'
import { SessionProvider, useSession } from './features/account/session'
import { VaultProvider } from './features/accounts/vault'
import './index.css'
import { installErrorLog } from './lib/errorLog'
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
    // Every account that gets a cache here is remembered, so it is always found and removed when its session ends.
    if (userId && supabase) rememberAccountOnDevice(userId)
    repo = userId && supabase ? createSyncedRepository(userId, createSupabaseRemote(supabase, userId)) : createIndexedDbRepository()
    repositories.set(key, repo)
  }
  return repo
}

// An account being removed from the device stops syncing before its database goes away.
onAccountRemoval((uid) => {
  repositories.get(uid)?.dispose?.()
  repositories.delete(uid)
})

function Root() {
  const { checked, clearing, userId, screen } = useSession()
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

  // Nothing on screen while the session is checked or an ended account is being removed.
  if (!checked || clearing) return null
  if (screen && (screen !== 'newPassword' || userId)) return <AuthScreen />
  return (
    <StoreProvider key={userId ?? 'local'} repository={repository}>
      <VaultProvider>
        <ErrorBoundary fallback={(error, retry) => <AppErrorScreen error={error} retry={retry} />}>
          <App />
        </ErrorBoundary>
      </VaultProvider>
    </StoreProvider>
  )
}

installErrorLog()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* "Reduzir movimento" on the device: sheets, lists and indicators keep only fades, no movement. */}
    <MotionConfig reducedMotion="user">
      <SessionProvider>
        <FeedbackProvider>
          <ErrorBoundary fallback={() => <BareErrorScreen />}>
            <Root />
          </ErrorBoundary>
        </FeedbackProvider>
      </SessionProvider>
    </MotionConfig>
  </StrictMode>,
)

// Opening animation: reveals the first screen once it has rendered behind the splash.
void playOpening()
