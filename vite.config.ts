import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Content-Security-Policy in the built page (M9): the browser runs only the app's own scripts (plus
 * the theme script, by hash, and Cloudflare Turnstile) and talks only to the servers the app uses.
 * If an injection bug ever appears, it cannot load code or send the session anywhere else.
 * GitHub Pages can't send headers, so it goes in a <meta> (frame-ancestors doesn't work there).
 */
function contentSecurityPolicy(mode: string): Plugin {
  return {
    name: 'nucleo-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
      const supabase = env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL) : null
      const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`)
      const turnstile = 'https://challenges.cloudflare.com'
      const connect = ["'self'", 'https://open.er-api.com', 'https://cdn.jsdelivr.net', turnstile]
      if (supabase) connect.push(supabase.origin, `${supabase.protocol === 'https:' ? 'wss' : 'ws'}://${supabase.host}`)
      const policy = [
        "default-src 'self'",
        `script-src 'self' ${inline.join(' ')} ${turnstile}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        `connect-src ${connect.join(' ')}`,
        `frame-src ${turnstile}`,
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
    },
  }
}

// Published at the root of https://hellonucleo.app. The e2e builds (modes e2e*, .env.e2e*) use /nucleo/.
const baseFor = (mode: string) => process.env.NUCLEO_BASE || (mode.startsWith('e2e') ? '/nucleo/' : '/')

export default defineConfig(({ mode }) => {
  const BASE = baseFor(mode)
  return {
    base: BASE,
    // Vitest: generous timeout, the first time-zone formatting can be slow on a busy machine.
    test: { testTimeout: 30_000 },
    plugins: [
      react(),
      tailwindcss(),
      contentSecurityPolicy(mode),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'],
        // ?v=4: the "N" mark (Oct 2026, v4) — new icon URLs so browsers and installed apps don't keep the old one.
        manifest: {
          name: 'Núcleo',
          short_name: 'Núcleo',
          description: 'Painel pessoal: dinheiro, projetos, clientes, tarefas e anotações.',
          lang: 'pt-BR',
          id: BASE,
          start_url: BASE,
          scope: BASE,
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#0a0a0b',
          theme_color: '#ff5b2e',
          icons: [
            { src: 'icon-192.png?v=4', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png?v=4', sizes: '512x512', type: 'image/png' },
            { src: 'icon-maskable-512.png?v=4', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // Etapa 4: the PDF reader (PDF.js, ~1 MB) is downloaded only by who imports a PDF, never by every update.
          globIgnores: ['**/pdf-*.js', '**/pdf.worker*'],
          navigateFallback: `${BASE}index.html`,
          // Push notifications (works with the app closed where the platform allows it).
          importScripts: ['push-sw.js'],
        },
      }),
    ],
  }
})
