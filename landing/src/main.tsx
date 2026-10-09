import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { captureAttribution } from './lib/utm'
import { router } from './router'
import './index.css'

// UTM-Parameter der Anzeige sofort beim Laden sichern (vor jeder Navigation)
captureAttribution(window.location.search, document.referrer, window.location.origin)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
