import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import ShellLayout from './components/ShellLayout'
import Login from './pages/Login'
import Overview from './pages/Overview'
import ColaboradorDashboard from './pages/ColaboradorDashboard'
import ColaboradorHistoryPage from './pages/ColaboradorHistoryPage'
import SupervisorDashboard from './pages/SupervisorDashboard'
import AdminDashboard from './pages/AdminDashboard'
import AdminBillingResultPage from './pages/AdminBillingResultPage'
import AdminQrCodePage from './pages/AdminQrCodePage'
import SupervisorKpisPage from './pages/SupervisorKpisPage'
import SupervisorPendingItemsPage from './pages/SupervisorPendingItemsPage'
import SupervisorHoursPage from './pages/SupervisorHoursPage'
import Reports from './pages/Reports'
import VacationMemberPage from './pages/VacationMemberPage'
import VacationSupervisorPage from './pages/VacationSupervisorPage'
import ProfileComplete from './pages/ProfileComplete'
import NotFound from './pages/NotFound'
import { hasSupabaseEnv } from './lib/supabase'
import { TimezoneProvider } from './context/TimezoneContext'
import { LanguageProvider, useLanguage } from './context/LanguageContext'
import LanguageSwitcher from './components/LanguageSwitcher'

const MissingEnvScreen = () => {
  const { tr } = useLanguage()

  return (
    <div className="min-h-screen px-6 py-10">
      <LanguageSwitcher fixed />
      <div className="mx-auto w-full max-w-3xl rounded-3xl border border-amber-200 bg-amber-50 p-8 text-slate-800 shadow-sm">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-700">
          {tr('Configuration required', 'Configuracao necessaria')}
        </p>
        <h2 className="mt-4 text-2xl font-semibold">
          {tr('Frontend environment variables are missing', 'Frontend sem variaveis de ambiente')}
        </h2>
        <p className="mt-3 text-sm text-slate-700">
          {tr(
            'Create the .env file inside frontend with your Supabase keys.',
            'Crie o arquivo .env dentro de frontend com as chaves do Supabase.'
          )}
        </p>
        <pre className="mt-5 overflow-x-auto rounded-2xl bg-white p-4 text-xs text-slate-700">
{`VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SEU_ANON_KEY
VITE_API_URL=http://localhost:3000/api/v1`}
        </pre>
        <p className="mt-4 text-xs text-slate-600">
          {tr('After that, restart Vite with npm run dev.', 'Depois disso, reinicie o Vite com npm run dev.')}
        </p>
      </div>
    </div>
  )
}

const App = () => {
  return (
    <LanguageProvider>
      {hasSupabaseEnv ? (
        <AuthProvider>
          <TimezoneProvider>
            <BrowserRouter>
              <Routes>
              <Route path="/" element={<Navigate to="/app" replace />} />
              <Route path="/login" element={<Login />} />
              <Route
                path="/app"
                element={
                  <ProtectedRoute>
                    <ShellLayout>
                      <Overview />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/colaborador"
                element={
                  <ProtectedRoute>
                    <ShellLayout>
                      <ColaboradorDashboard />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/colaborador/historico"
                element={
                  <ProtectedRoute>
                    <ShellLayout>
                      <ColaboradorHistoryPage />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/supervisor"
                element={
                  <ProtectedRoute allowedRoles={['SUPERVISOR', 'HR', 'ADMIN', 'SUPERADMIN']}>
                    <Navigate to="/app/supervisor/overview" replace />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/supervisor/overview"
                element={
                  <ProtectedRoute allowedRoles={['SUPERVISOR', 'HR', 'ADMIN', 'SUPERADMIN']}>
                    <ShellLayout>
                      <SupervisorDashboard />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/supervisor/kpis"
                element={
                  <ProtectedRoute allowedRoles={['SUPERVISOR', 'HR', 'ADMIN', 'SUPERADMIN']}>
                    <ShellLayout>
                      <SupervisorKpisPage />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/supervisor/hours"
                element={
                  <ProtectedRoute allowedRoles={['SUPERVISOR', 'HR', 'ADMIN', 'SUPERADMIN']}>
                    <ShellLayout>
                      <SupervisorHoursPage />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/supervisor/pending-items"
                element={
                  <ProtectedRoute allowedRoles={['SUPERVISOR', 'HR', 'ADMIN', 'SUPERADMIN']}>
                    <ShellLayout>
                      <SupervisorPendingItemsPage />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/admin"
                element={
                  <ProtectedRoute allowedRoles={['ADMIN', 'HR', 'SUPERADMIN']}>
                    <Navigate to="/app/admin/qr-code" replace />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/admin/overview"
                element={
                  <ProtectedRoute allowedRoles={['ADMIN', 'HR', 'SUPERADMIN']}>
                    <ShellLayout>
                      <AdminDashboard />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/admin/qr-code"
                element={
                  <ProtectedRoute allowedRoles={['ADMIN', 'HR', 'SUPERADMIN']}>
                    <ShellLayout>
                      <AdminQrCodePage />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/admin/billing-result"
                element={
                  <ProtectedRoute allowedRoles={['ADMIN', 'HR', 'SUPERADMIN']}>
                    <ShellLayout>
                      <AdminBillingResultPage />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/relatorios"
                element={
                  <ProtectedRoute>
                    <ShellLayout>
                      <Reports />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/perfil-completo"
                element={
                  <ProtectedRoute>
                    <ShellLayout>
                      <ProfileComplete />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/ferias"
                element={
                  <ProtectedRoute>
                    <ShellLayout>
                      <VacationMemberPage />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/ferias-equipe"
                element={
                  <ProtectedRoute allowedRoles={['SUPERVISOR', 'HR', 'ADMIN', 'SUPERADMIN']}>
                    <ShellLayout>
                      <VacationSupervisorPage />
                    </ShellLayout>
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TimezoneProvider>
        </AuthProvider>
      ) : (
        <MissingEnvScreen />
      )}
    </LanguageProvider>
  )
}

export default App
