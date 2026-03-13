import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import ShellLayout from './components/ShellLayout'
import Login from './pages/Login'
import Overview from './pages/Overview'
import ColaboradorDashboard from './pages/ColaboradorDashboard'
import SupervisorDashboard from './pages/SupervisorDashboard'
import AdminDashboard from './pages/AdminDashboard'
import Reports from './pages/Reports'
import NotFound from './pages/NotFound'
import { hasSupabaseEnv } from './lib/supabase'
import { TimezoneProvider } from './context/TimezoneContext'

const MissingEnvScreen = () => {
  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto w-full max-w-3xl rounded-3xl border border-amber-200 bg-amber-50 p-8 text-slate-800 shadow-sm">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-700">Configuracao necessaria</p>
        <h2 className="mt-4 text-2xl font-semibold">Frontend sem variaveis de ambiente</h2>
        <p className="mt-3 text-sm text-slate-700">
          Crie o arquivo <strong>.env</strong> dentro de <strong>frontend</strong> com as chaves do Supabase.
        </p>
        <pre className="mt-5 overflow-x-auto rounded-2xl bg-white p-4 text-xs text-slate-700">
{`VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SEU_ANON_KEY
VITE_API_URL=http://localhost:3000/api/v1`}
        </pre>
        <p className="mt-4 text-xs text-slate-600">Depois disso, reinicie o Vite com npm run dev.</p>
      </div>
    </div>
  )
}

const App = () => {
  if (!hasSupabaseEnv) {
    return <MissingEnvScreen />
  }

  return (
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
            path="/app/supervisor"
            element={
              <ProtectedRoute allowedRoles={['SUPERVISOR', 'ADMIN']}>
                <ShellLayout>
                  <SupervisorDashboard />
                </ShellLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/admin"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <ShellLayout>
                  <AdminDashboard />
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
          <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TimezoneProvider>
    </AuthProvider>
  )
}

export default App
