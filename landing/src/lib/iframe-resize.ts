/**
 * Sendet die aktuelle Dokumenthöhe per postMessage an den Eltern-Frame (z. B. Jimdo).
 * Wird nur aktiviert, wenn die Seite tatsächlich in einem iframe läuft.
 * Der Parent reagiert darauf und passt die iframe-Höhe an, sodass kein Scrollbalken entsteht.
 */
export function initIframeResize() {
  if (window.parent === window) return

  function send() {
    const h = document.documentElement.scrollHeight
    window.parent.postMessage({ type: 'parkfly-resize', height: h }, '*')
  }

  // Beim ersten Laden und bei jeder DOM-Veränderung senden
  send()
  const ro = new ResizeObserver(send)
  ro.observe(document.documentElement)

  // Beim Navigieren (React Router) ebenfalls senden
  window.addEventListener('popstate', send)
  window.addEventListener('hashchange', send)
}
