import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Public project URL and anon (publishable) key. Both are meant to be public:
 * every table is protected by RLS on the server. The service_role key must
 * never appear here — it only exists as a secret of the Edge Functions.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const cloudConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = cloudConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        // PKCE puts `?code=` in the query string, which does not clash with the hash router.
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'nucleo:auth',
      },
    })
  : null

/** Where confirmation and password-reset e-mails send people back to. */
export function appUrl(): string {
  return `${location.origin}${import.meta.env.BASE_URL}`
}

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Sincronização não configurada neste aparelho.')
  return supabase
}
