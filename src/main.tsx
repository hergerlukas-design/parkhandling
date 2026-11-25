import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyAppearance } from './lib/appearance'
import { startMediaUploads } from './lib/media/mediaService'
import { startProtocolSync } from './lib/protocols'
import { startUpdateChecks } from './lib/update/updateController'
import './index.css'

// Darstellung vor dem ersten Rendern setzen, damit nichts aufblitzt
applyAppearance()
startUpdateChecks()
startMediaUploads()
startProtocolSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
