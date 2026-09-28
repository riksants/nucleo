export function normalizeUrl(link: string): string {
  const trimmed = link.trim()
  if (!trimmed) return ''
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
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
