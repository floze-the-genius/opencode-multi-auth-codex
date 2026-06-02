import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { NotificationProvider } from './hooks/useNotification'
import { NotificationCenter } from './components/NotificationCenter'
import { DashboardPage } from './components/DashboardPage'
import { ConfigurationPage } from './components/ConfigurationPage'
import { AntigravityPage } from './components/AntigravityPage'
import { useDashboardState } from './hooks/useDashboardState'

export function App(): JSX.Element {
  const { data: state } = useDashboardState()
  const featureFlags = state?.featureFlags ?? { antigravityEnabled: false }

  return (
    <NotificationProvider>
      <AppShell featureFlags={featureFlags}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/settings" element={<ConfigurationPage />} />
          {featureFlags.antigravityEnabled && (
            <Route path="/settings/antigravity" element={<AntigravityPage />} />
          )}

          {/* Legacy route redirects: collapse 4-area model into 2-section IA */}
          <Route path="/accounts" element={<Navigate to="/" replace />} />
          <Route path="/operations" element={<Navigate to="/" replace />} />
          <Route path="/configuration" element={<Navigate to="/settings" replace />} />
          <Route
            path="/antigravity"
            element={
              <Navigate
                to={featureFlags.antigravityEnabled ? '/settings/antigravity' : '/settings'}
                replace
              />
            }
          />
        </Routes>
      </AppShell>
      <NotificationCenter />
    </NotificationProvider>
  )
}
