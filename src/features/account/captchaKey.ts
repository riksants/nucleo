/** Cloudflare Turnstile site key (public). Empty: no security check on the sign-in screens. */
export const TURNSTILE_SITE_KEY = ((import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '').trim()
export const captchaOn = TURNSTILE_SITE_KEY !== ''
