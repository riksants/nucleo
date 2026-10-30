/* Imported by the generated service worker (vite-plugin-pwa → workbox.importScripts). */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || 'Núcleo'
  // Every push must show a notification (iOS revokes the subscription otherwise). When the app is
  // on screen, it is told too: if it already showed this reminder itself, it closes this copy.
  event.waitUntil(
    self.registration
      .showNotification(title, {
        body: data.body || 'Você tem um lembrete',
        // Same key = same notification: the OS replaces instead of duplicating.
        tag: data.key || undefined,
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        data: { url: data.url || '#/today' },
      })
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((list) => {
        for (const client of list) if (client.visibilityState === 'visible') client.postMessage({ type: 'nucleo-push', key: data.key || '' })
      }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '#/today'
  const hash = url.startsWith('#') ? url : '#/' + url.replace(/^[/#]+/, '')
  const target = new URL(hash, self.registration.scope).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const client = list.find((c) => 'focus' in c)
      if (client) {
        // The app changes its own route (WindowClient.navigate is missing or unreliable on iOS).
        client.postMessage({ type: 'nucleo-open', url: hash })
        try {
          return await client.focus()
        } catch {
          // Focus refused (no user activation on some platforms): open a window instead.
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
