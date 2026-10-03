import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// Published at the root of https://hellonucleo.app. The e2e builds still use NUCLEO_BASE=/nucleo/.
const BASE = process.env.NUCLEO_BASE || '/'

export default defineConfig({
  base: BASE,
  // Vitest: generous timeout, the first time-zone formatting can be slow on a busy machine.
  test: { testTimeout: 30_000 },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'],
      // ?v=3: new logo (Oct 2026, v3) — new icon URLs so browsers and installed apps don't keep the old one.
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
        background_color: '#09090b',
        theme_color: '#09090b',
        icons: [
          { src: 'icon-192.png?v=3', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png?v=3', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png?v=3', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${BASE}index.html`,
        // Push notifications (works with the app closed where the platform allows it).
        importScripts: ['push-sw.js'],
      },
    }),
  ],
})
