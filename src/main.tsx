import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startMediaUploads } from './lib/media/mediaService'
import { startProtocolSync } from './lib/protocols'
import { startUpdateChecks } from './lib/update/updateController'
import './index.css'

startUpdateChecks()
startMediaUploads()
startProtocolSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
