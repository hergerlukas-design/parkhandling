/* Push-Empfang im Service Worker (per importScripts in den von vite-plugin-pwa erzeugten sw.js eingebunden).
 * Der Aktualisierungs-Flow (registerType 'prompt', SKIP_WAITING) bleibt unverändert im erzeugten Teil.
 *
 * Nachricht vom Server: { title, body, url, tag, event }
 *  - App im Vordergrund (sichtbar + fokussiert): Hinweis in der App (postMessage → Toast).
 *    Auf Apple-Geräten wird trotzdem eine Systembenachrichtigung gezeigt, weil Safari
 *    stille Pushes mit dem Entzug der Berechtigung bestraft.
 *  - sonst: Systembenachrichtigung; Tippen fokussiert die App und öffnet die Ansicht.
 */
/* eslint-disable no-restricted-globals */
;(function () {
  var APPLE = /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent) && !/Chrome|Android/.test(self.navigator.userAgent)

  function parse(event) {
    if (!event.data) return {}
    try {
      return event.data.json() || {}
    } catch (e) {
      return { body: event.data.text() }
    }
  }

  self.addEventListener('push', function (event) {
    var data = parse(event)
    var title = data.title || 'Park & Fly'
    var url = typeof data.url === 'string' && data.url.charAt(0) === '/' ? data.url : '/'
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
        var active = list.find(function (c) {
          return c.visibilityState === 'visible' && c.focused
        })
        if (active) active.postMessage({ type: 'pf-push', payload: { title: title, body: data.body || '', url: url, event: data.event } })
        if (active && !APPLE) return undefined
        return self.registration.showNotification(title, {
          body: data.body || '',
          tag: data.tag || undefined,
          renotify: Boolean(data.tag),
          icon: '/pwa-192.png',
          badge: '/pwa-192.png',
          lang: 'de',
          data: { url: url },
        })
      }),
    )
  })

  self.addEventListener('notificationclick', function (event) {
    event.notification.close()
    var url = (event.notification.data && event.notification.data.url) || '/'
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
        var client = list[0]
        if (client) {
          client.postMessage({ type: 'pf-navigate', url: url })
          return client.focus()
        }
        return self.clients.openWindow(url)
      }),
    )
  })
})()
