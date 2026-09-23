import { BrowserRouter, Route, Routes } from 'react-router'
import { AppShell } from './components/AppShell'
import { AuthGate } from './components/AuthGate'
import { AuthProvider } from './lib/auth'
import { ChangelogPage } from './pages/ChangelogPage'
import { SettingsPage } from './pages/SettingsPage'
import { ShuttlePage } from './pages/ShuttlePage'
import { SitePlanPage } from './pages/SitePlanPage'
import { TasksPage } from './pages/TasksPage'
import { TodayPage } from './pages/TodayPage'
import { VehicleDetailPage } from './pages/VehicleDetailPage'
import { VehiclesPage } from './pages/VehiclesPage'

export function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<TodayPage />} />
              <Route path="lageplan" element={<SitePlanPage />} />
              <Route path="fahrzeuge" element={<VehiclesPage />} />
              <Route path="fahrzeuge/:id" element={<VehicleDetailPage />} />
              <Route path="aufgaben" element={<TasksPage />} />
              <Route path="shuttle" element={<ShuttlePage />} />
              <Route path="einstellungen" element={<SettingsPage />} />
              <Route path="changelog" element={<ChangelogPage />} />
              <Route path="*" element={<TodayPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthGate>
    </AuthProvider>
  )
}
