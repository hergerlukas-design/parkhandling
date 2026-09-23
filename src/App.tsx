import { BrowserRouter, Route, Routes } from 'react-router'
import { AppShell } from './components/AppShell'
import { ChangelogPage } from './pages/ChangelogPage'
import { SettingsPage } from './pages/SettingsPage'
import { ShuttlePage } from './pages/ShuttlePage'
import { SitePlanPage } from './pages/SitePlanPage'
import { TasksPage } from './pages/TasksPage'
import { TodayPage } from './pages/TodayPage'
import { VehiclesPage } from './pages/VehiclesPage'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<TodayPage />} />
          <Route path="lageplan" element={<SitePlanPage />} />
          <Route path="fahrzeuge" element={<VehiclesPage />} />
          <Route path="aufgaben" element={<TasksPage />} />
          <Route path="shuttle" element={<ShuttlePage />} />
          <Route path="einstellungen" element={<SettingsPage />} />
          <Route path="changelog" element={<ChangelogPage />} />
          <Route path="*" element={<TodayPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
