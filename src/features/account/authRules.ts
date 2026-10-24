/**
 * Login password rules and the wording of auth errors. The real limits live on the server
 * (Supabase Auth: minimum length, required characters, rate limits); these only give the same
 * answer earlier, in plain Portuguese.
 */

export const MIN_LOGIN_PASSWORD = 8
/** bcrypt only uses 72 bytes; Supabase Auth refuses anything longer. */
export const MAX_LOGIN_PASSWORD = 72

/** The obvious ones that still mix letters and numbers. */
const COMMON = new Set([
  'senha123', 'senha1234', 'senha12345', 'senha123456', 'mudar123', 'mudar1234', 'teste123', 'teste1234',
  'password1', 'password12', 'password123', 'passw0rd', 'abc12345', 'abcd1234', 'abc123456', 'a1234567',
  'a12345678', '12345678a', '123456789a', 'qwerty123', 'qwerty12', '1q2w3e4r', '1q2w3e4r5t', 'q1w2e3r4',
  'admin123', 'admin1234', 'brasil123', 'iloveyou1', 'nucleo123', 'nucleo1234',
])

/** Problem with a new login password (sign-up, new password); null when it's fine. */
export function loginPasswordProblem(password: string, email = ''): string | null {
  if (password.length < MIN_LOGIN_PASSWORD) return `Use pelo menos ${MIN_LOGIN_PASSWORD} caracteres.`
  if (new TextEncoder().encode(password).length > MAX_LOGIN_PASSWORD) return `Use no máximo ${MAX_LOGIN_PASSWORD} caracteres.`
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return 'Misture letras e números.'
  const lower = password.toLowerCase()
  if (COMMON.has(lower)) return 'Essa senha é muito comum. Escolha outra.'
  const name = email.trim().toLowerCase().split('@')[0] ?? ''
  if (name.length >= 4 && lower.includes(name)) return 'Não use o seu e-mail na senha.'
  return null
}

function errorCode(err: unknown): string {
  return typeof err === 'object' && err && 'code' in err && typeof err.code === 'string' ? err.code : ''
}

/**
 * The server refused to send another e-mail to this address yet (one per minute per address,
 * or the project's hourly limit). Only an existing account can get this answer.
 */
export function isEmailThrottle(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return errorCode(err) === 'over_email_send_rate_limit' || m.includes('for security purposes') || m.includes('email rate limit')
}

/** Turns Supabase auth errors into short Portuguese messages. */
export function authMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const m = raw.toLowerCase()
  const code = errorCode(err)
  if (code === 'invalid_credentials' || m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (code === 'email_not_confirmed' || m.includes('email not confirmed')) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.'
  if (code === 'user_already_exists' || m.includes('user already registered')) return 'Já existe uma conta com este e-mail.'
  if (code === 'same_password' || m.includes('same as the old') || m.includes('different from the old')) return 'A nova senha precisa ser diferente da atual.'
  if (m.includes('known to be weak') || m.includes('pwned')) return 'Essa senha aparece em vazamentos conhecidos. Escolha outra.'
  if (m.includes('cannot be longer than')) return `Use no máximo ${MAX_LOGIN_PASSWORD} caracteres.`
  if (code === 'weak_password' || m.includes('password should be') || m.includes('weak password')) return 'Senha fraca: use pelo menos 8 caracteres, com letras e números.'
  if (isEmailThrottle(err)) return 'Por segurança, espere um minuto antes de pedir outro e-mail.'
  if (code === 'over_request_rate_limit' || m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas. Espere alguns minutos e tente de novo.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sem conexão com o servidor.'
  return raw
}
