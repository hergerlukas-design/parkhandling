import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { startErrorReporting } from './lib/errorReporting'
import { startMediaUploads } from './lib/media/mediaService'
import { startProtocolSync } from './lib/protocols'
import { startUpdateChecks } from './lib/update/updateController'
import './index.css'

startErrorReporting()
startUpdateChecks()
startMediaUploads()
startProtocolSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
