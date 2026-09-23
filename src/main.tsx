import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startMediaUploads } from './lib/media/mediaService'
import { startUpdateChecks } from './lib/update/updateController'
import './index.css'

startUpdateChecks()
startMediaUploads()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
