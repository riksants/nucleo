/**
 * NÚCLEO IA — long-term reminders (Etapa 5). The person controls them: the model can only PROPOSE
 * one (`propor_lembrete`), the app shows "Lembrar disso?" and saves only on a tap; the person sees,
 * edits and deletes them. Never values or sensitive data. Sent with each question as data
 * (preferences/context said by the person), never as instructions that change the rules.
 */
import { hasGuardedValue } from './facts.ts'

export const MEMORY_TOOL = 'propor_lembrete'
export const MEMORY_MAX = 20
export const MEMORY_CHARS = 200

const SENSITIVE = /senha|password|\bpin\b|token|cart[aã]o|cvv|\bcpf\b|\bcnpj\b|\brg\b|passaporte|iban|\bpix\b|ag[eê]ncia|conta (corrente|banc)|c[oó]digo de (acesso|seguran)|@|https?:\/\/|www\./i
const PHONE_OR_ID = /\d[\d\s().-]{5,}\d/
/** Text that tries to command the AI (e.g. copied from an injected note) is never a reminder. */
const COMMAND = /ignor|instru[cç]|regras?|prompt|sistema|a partir de agora|sempre (diga|responda|afirme)|nunca (diga|mencione)|finja|voc[eê] (é|agora)/i

/** Why a reminder is refused (null = allowed). Same rule for the model's proposals and for typed ones. */
export function memoryRefusal(raw: unknown): string | null {
  const t = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  if (t.length < 3) return 'Lembrete vazio.'
  if (t.length > MEMORY_CHARS) return `Lembrete longo demais (até ${MEMORY_CHARS} caracteres).`
  if (hasGuardedValue(t) || PHONE_OR_ID.test(t)) return 'Lembretes não guardam valores, datas, horários nem números (eles mudam e ficam nos seus registros).'
  if (COMMAND.test(t)) return 'Lembretes guardam preferências e contexto, não instruções para a IA.'
  if (SENSITIVE.test(t)) return 'Lembretes não guardam dados sensíveis (senhas, documentos, contas, e-mails, telefones ou links).'
  return null
}

export const cleanMemory = (raw: unknown): string => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '')

/** What goes to the model: only valid reminders, at most MEMORY_MAX (also protects against bad synced data). */
export function memoryForModel(list: readonly { text: string }[] | undefined): string[] {
  return (list ?? []).map((m) => cleanMemory(m.text)).filter((t) => memoryRefusal(t) === null).slice(0, MEMORY_MAX)
}

export const MEMORY_TOOL_DEF = {
  name: MEMORY_TOOL,
  description:
    'Propõe guardar um lembrete de longo prazo sobre a pessoa (preferência estável ou contexto que ajuda em conversas futuras, ex.: "prefere respostas curtas", "a Vânia é a cliente principal"). Use SOMENTE quando a pessoa pedir para lembrar algo ou disser uma preferência duradoura. Nunca valores, datas, números, senhas, documentos, contatos. O app mostra o lembrete e só salva se a pessoa tocar em "Lembrar".',
  strict: true,
  input_schema: {
    type: 'object',
    properties: { texto: { type: 'string', description: 'O lembrete, em uma frase curta na 3ª pessoa, sem números.' } },
    required: ['texto'],
    additionalProperties: false,
  },
}
