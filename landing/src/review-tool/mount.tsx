import { createRoot } from 'react-dom/client'
import type { router as appRouter } from '../router'
import { TOOL_ATTR } from './context'
import { ReviewTool } from './ReviewTool'

/** Hängt das Markier-Werkzeug in einer eigenen React-Wurzel an die Seite (nur Entwicklung). */
export function mountReviewTool(router: typeof appRouter) {
  const host = document.createElement('div')
  host.setAttribute(TOOL_ATTR, '')
  document.body.appendChild(host)
  createRoot(host).render(<ReviewTool router={router} />)
}
