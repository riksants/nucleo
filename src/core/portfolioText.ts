/**
 * Portfólio: one sentence → the fields it really contains, for the person to check in the form.
 * "Adicionar meu projeto de site para uma lavanderia em Barcelona, com link lavanderia.es, categoria
 * desenvolvimento web e status concluído" → name, kind site, link, category, status. Never invents a link,
 * image, client or result: what isn't written stays empty.
 */
import type { PortfolioItem, ProjectKind } from '../data/types'

export interface PortfolioDraft {
  name: string
  kind: ProjectKind
  link: string
  category: string
  status: PortfolioItem['status'] | ''
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const URL_RE = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s,;]*)?)/i
const STATUS: [PortfolioDraft['status'], RegExp][] = [
  ['inProgress', /\b(em andamento|andamento|fazendo|em progresso)\b/],
  ['paused', /\b(pausad[oa]|parad[oa])\b/],
  ['done', /\b(concluid[oa]|finalizad[oa]|entregue|pronto|terminad[oa])\b/],
]

export function parsePortfolio(text: string): PortfolioDraft {
  let rest = ` ${text.trim().replace(/\s+/g, ' ')} `
  const cut = (re: RegExp) => {
    rest = rest.replace(re, ' ')
  }

  let link = ''
  const url = rest.match(URL_RE)
  // Only something that looks like an address (has a dot and no spaces); "categoria web" is never a link.
  if (url && /\./.test(url[1])) {
    link = url[1].replace(/[.)]+$/, '')
    cut(new RegExp(`(?:,?\\s*(?:com\\s+)?(?:o\\s+)?(?:link|site|endereco|endereço|url)?\\s*:?\\s*)?${url[1].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`, 'i'))
  }

  let category = ''
  const cat = rest.match(/(?:,\s*|\s+)(?:e\s+)?(?:na\s+|da\s+)?categoria\s*:?\s*([^,;]+?)(?=\s*(?:,|;|\s+e\s+status\b|\s+status\b|$))/i)
  if (cat) {
    category = cat[1].trim().replace(/[.!]+$/, '')
    cut(new RegExp(cat[0].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'i'))
  }

  let status: PortfolioDraft['status'] = ''
  const f = fold(rest)
  for (const [value, re] of STATUS) {
    if (re.test(f)) {
      status = value
      break
    }
  }
  cut(/,?\s*(?:e\s+)?(?:com\s+)?status\s*:?\s*(?:conclu[ií]d[oa]|finalizad[oa]|entregue|pronto|em andamento|pausad[oa]|parad[oa])\b/i)
  cut(/,?\s*\b(?:j[aá]\s+)?(?:conclu[ií]d[oa]|finalizad[oa]|entregue)\b/i)
  cut(/,?\s*\b(?:em andamento|em progresso|pausad[oa])\b/i)

  const lower = fold(rest)
  const kind: ProjectKind = /\b(app|aplicativo)\b/.test(lower) ? 'app' : /\b(site|landing|pagina|loja virtual|e-?commerce|blog)\b/.test(lower) ? 'site' : 'other'

  const name = rest
    .replace(/^\s*(?:adicionar|adicione|adiciona|incluir|inclua|novo|nova|criar|cadastrar)\s+/i, ' ')
    .replace(/^\s*(?:o\s+|um\s+|uma\s+)?(?:meu|minha)?\s*(?:projeto|trabalho)\s+(?:de\s+|do\s+|da\s+)?/i, ' ')
    .replace(/\s+(?:com|e)\s*$/i, '')
    .replace(/\s*,\s*(?:,\s*)*/g, ', ')
    .replace(/^[\s,;:-]+|[\s,;:.-]+$/g, '')
    .replace(/\s+(?:com|e)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { name: name ? name[0].toUpperCase() + name.slice(1) : '', kind, link, category: category ? category[0].toUpperCase() + category.slice(1) : '', status }
}
