import { describe, expect, it } from 'vitest'
import { authMessage, isEmailThrottle, loginPasswordProblem } from '../src/features/account/authRules'

/** The shape supabase-js gives: an Error with the server's `code`. */
const apiError = (message: string, code = '', status = 400) => Object.assign(new Error(message), { code, status })

describe('senha de login', () => {
  it('recusa vazia, curta, longa demais ou só um tipo de caractere', () => {
    expect(loginPasswordProblem('')).toMatch(/pelo menos 8/)
    expect(loginPasswordProblem('ab12')).toMatch(/pelo menos 8/)
    expect(loginPasswordProblem('a1'.repeat(37))).toMatch(/no máximo 72/)
    expect(loginPasswordProblem('abcdefghij')).toBe('Misture letras e números.')
    expect(loginPasswordProblem('1234567890')).toBe('Misture letras e números.')
  })

  it('conta bytes no limite de 72, como o servidor (acentos ocupam 2)', () => {
    expect(loginPasswordProblem('á1'.repeat(25))).toMatch(/no máximo 72/) // 50 caracteres, 75 bytes
    expect(loginPasswordProblem('a1'.repeat(36))).toBeNull() // 72 bytes
  })

  it('recusa as senhas mais comuns e o próprio e-mail', () => {
    expect(loginPasswordProblem('Senha123')).toBe('Essa senha é muito comum. Escolha outra.')
    expect(loginPasswordProblem('1q2w3e4r')).toBe('Essa senha é muito comum. Escolha outra.')
    expect(loginPasswordProblem('mariana2024', 'mariana@exemplo.com')).toBe('Não use o seu e-mail na senha.')
  })

  it('aceita senhas razoáveis sem exigir símbolos nem maiúsculas', () => {
    expect(loginPasswordProblem('cafe na praia 7')).toBeNull()
    expect(loginPasswordProblem('pão-de-queijo-42', 'ana@exemplo.com')).toBeNull()
    expect(loginPasswordProblem('Nucleo-teste-42', 'ana@exemplo.com')).toBeNull()
  })
})

describe('mensagens de erro do servidor', () => {
  it('login: mesma mensagem para e-mail inexistente e senha errada (o servidor também responde igual)', () => {
    expect(authMessage(apiError('Invalid login credentials', 'invalid_credentials'))).toBe('E-mail ou senha incorretos.')
  })

  it('limite de tentativas do servidor vira uma mensagem clara', () => {
    expect(authMessage(apiError('Request rate limit reached', 'over_request_rate_limit', 429))).toBe('Muitas tentativas. Espere alguns minutos e tente de novo.')
    expect(authMessage(apiError('For security purposes, you can only request this after 42 seconds.', 'over_email_send_rate_limit', 429))).toBe('Por segurança, espere um minuto antes de pedir outro e-mail.')
  })

  it('senha recusada pelo servidor (curta, vazada, longa)', () => {
    expect(authMessage(apiError('Password should be at least 8 characters.', 'weak_password', 422))).toMatch(/Senha fraca/)
    expect(authMessage(apiError('Password is known to be weak and easy to guess, please choose a different one.', 'weak_password', 422))).toMatch(/vazamentos/)
    expect(authMessage(apiError('Password cannot be longer than 72 characters', 'validation_failed'))).toMatch(/no máximo 72/)
    expect(authMessage(apiError('New password should be different from the old password.', 'same_password', 422))).toMatch(/diferente da atual/)
  })

  it('reconhece o "espere para pedir outro e-mail" (só uma conta existente recebe)', () => {
    expect(isEmailThrottle(apiError('For security purposes, you can only request this after 42 seconds.', 'over_email_send_rate_limit', 429))).toBe(true)
    expect(isEmailThrottle(apiError('email rate limit exceeded', 'over_email_send_rate_limit', 429))).toBe(true)
    expect(isEmailThrottle(apiError('Request rate limit reached', 'over_request_rate_limit', 429))).toBe(false)
    expect(isEmailThrottle(apiError('Invalid login credentials', 'invalid_credentials'))).toBe(false)
  })

  it('explica quando o servidor recusa o CAPTCHA (Turnstile)', () => {
    expect(authMessage(apiError('captcha protection: request disallowed (no captcha response)', 'captcha_failed'))).toBe('A verificação de segurança falhou. Tente de novo.')
    expect(authMessage(apiError('captcha protection: request disallowed (timeout-or-duplicate)', 'captcha_failed'))).toMatch(/verificação de segurança/)
  })
})
