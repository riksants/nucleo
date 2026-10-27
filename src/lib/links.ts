/** Links typed by the person (or brought by a backup) open only as web, e-mail or phone links (B1). */
const SAFE_SCHEME = /^(https?:\/\/|mailto:|tel:)/i

export function normalizeUrl(link: string): string {
  const trimmed = (link ?? '').trim()
  if (!trimmed) return ''
  if (SAFE_SCHEME.test(trimmed)) return trimmed
  // "site.com" → https://site.com ("site.com:8080" keeps its port). Any other scheme (javascript:,
  // data:…) becomes a harmless web address.
  return `https://${trimmed.replace(/^[a-z][a-z0-9+.-]*:(?!\d)\/*/i, '')}`
}

/** Portfolio images are photos compressed on the device: anything else (a tracking pixel from a backup) is not loaded (B2). */
export function safeImage(src: string | null | undefined): string | undefined {
  return typeof src === 'string' && /^(data:image\/(jpeg|png|webp|gif);base64,|blob:)/i.test(src) ? src : undefined
}

/** "https://www.site.com/path" → "site.com/path" */
export function displayUrl(link: string): string {
  return link.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
}

export function whatsappUrl(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}
