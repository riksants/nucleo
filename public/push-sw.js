/* Imported by the generated service worker (vite-plugin-pwa → workbox.importScripts). */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || 'Núcleo'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || 'Você tem um lembrete',
      // Same key = same notification: the OS replaces instead of duplicating.
      tag: data.key || undefined,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: data.url || '#/today' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(self.registration.scope + (event.notification.data?.url || '#/today').replace(/^\//, ''), self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate?.(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
