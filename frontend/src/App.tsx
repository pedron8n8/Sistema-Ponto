import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import ShellLayout from './components/ShellLayout'
import LoadingScreen from './components/LoadingScreen'
import Login from './pages/Login'
import Signup from './pages/Signup'
import LandingPage from './pages/LandingPage'
import PricingPage from './pages/PricingPage'
import PrivacyPage from './pages/PrivacyPage'
import TermsPage from './pages/TermsPage'
import PlanSelectionPage from './pages/PlanSelectionPage'
import Overview from './pages/Overview'
import ColaboradorDashboard from './pages/ColaboradorDashboard'
import ColaboradorHistoryPage from './pages/ColaboradorHistoryPage'
import SupervisorDashboard from './pages/SupervisorDashboard'
import AdminUsersPage from './pages/AdminUsersPage'
import AdminBankHoursPage from './pages/AdminBankHoursPage'
import AdminPendingApprovalsPage from './pages/AdminPendingApprovalsPage'
import AdminFinancePage from './pages/AdminFinancePage'
import AdminBillingResultPage from './pages/AdminBillingResultPage'
import AdminCheckoutThankYouPage from './pages/AdminCheckoutThankYouPage.tsx'
import AdminSeatPurchasePage from './pages/AdminSeatPurchasePage'
import AdminQrCodePage from './pages/AdminQrCodePage'
import AdminProSettingsPage from './pages/AdminProSettingsPage'
import SupervisorKpisPage from './pages/SupervisorKpisPage'
import SupervisorPendingItemsPage from './pages/SupervisorPendingItemsPage'
import SupervisorHoursPage from './pages/SupervisorHoursPage'
import SuperAdminAccountsPage from './pages/SuperAdminAccountsPage'
import Reports from './pages/Reports'
import VacationMemberPage from './pages/VacationMemberPage'
import VacationSupervisorPage from './pages/VacationSupervisorPage'
import ProfileComplete from './pages/ProfileComplete'
import NotFound from './pages/NotFound'
import { hasSupabaseEnv } from './lib/supabase'
import { TimezoneProvider } from './context/TimezoneContext'
import { LanguageProvider } from './context/LanguageContext'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from './components/LanguageSwitcher'
import { Toaster } from 'sonner'

const MissingEnvScreen = () => {
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)

  return (
    <div className="min-h-screen px-6 py-10">
      <LanguageSwitcher fixed />
      <div className="mx-auto w-full max-w-3xl rounded-3xl border border-amber-200 bg-amber-50 p-8 text-slate-800 shadow-sm">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-700">
          {t('Configuration required', 'Configuracao necessaria')}
        </p>
        <h2 className="mt-4 text-2xl font-semibold">
          {t('Frontend environment variables are missing', 'Frontend sem variaveis de ambiente')}
        </h2>
        <p className="mt-3 text-sm text-slate-700">
          {t(
            'Create the .env file inside frontend with your Supabase keys.',
            'Crie o arquivo .env dentro de frontend com as chaves do Supabase.'
          )}
        </p>
        <pre className="mt-5 overflow-x-auto rounded-2xl bg-white p-4 text-xs text-slate-700">
          {`VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
          VITE_SUPABASE_ANON_KEY=SEU_ANON_KEY
          VITE_API_URL=https://api.omnipunt.com/api/v1`}
        </pre>
        <p className="mt-4 text-xs text-slate-600">
          {t('After that, restart Vite with npm run dev.', 'Depois disso, reinicie o Vite com npm run dev.')}
        </p>
      </div>
    </div>
  )
}

const App = () => {
  const [showInitialLoading, setShowInitialLoading] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setShowInitialLoading(false), 350)
    return () => window.clearTimeout(timer)
  }, [])

  if (showInitialLoading) {
    return <LoadingScreen />
  }

  return (
    <LanguageProvider>
      {hasSupabaseEnv ? (
        <AuthProvider>
          <TimezoneProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route
                  path="/app/escolher-plano"
                  element={
                    <ProtectedRoute allowInactivePlan>
                      <PlanSelectionPage />
                    </ProtectedRoute>
                  }
                />
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
                  path="/app/superadmin"
                  element={
                    <ProtectedRoute allowedRoles={['SUPERADMIN']}>
                      <Navigate to="/app/superadmin/accounts" replace />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/app/superadmin/accounts"
                  element={
                    <ProtectedRoute allowedRoles={['SUPERADMIN']}>
                      <ShellLayout>
                        <SuperAdminAccountsPage />
                      </ShellLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/app/admin"
                  element={
                    <ProtectedRoute allowedRoles={['ADMIN']}>
                      <Navigate to="/app/admin/users" replace />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/app/admin/overview"
                  element={
                    <ProtectedRoute allowedRoles={['ADMIN']}>
                      <Navigate to="/app/admin/users" replace />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/app/admin/users"
                  element={
                    <ProtectedRoute allowedRoles={['ADMIN']}>
                      <ShellLayout>
                        <AdminUsersPage />
                      </ShellLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/app/admin/bank-hours"
                  element={
                    <ProtectedRoute allowedRoles={['ADMIN']}>
                      <ShellLayout>
                        <AdminBankHoursPage />
                      </ShellLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/app/admin/pending-approvals"
                  element={
                    <ProtectedRoute allowedRoles={['ADMIN']}>
                      <ShellLayout>
                        <AdminPendingApprovalsPage />
                      </ShellLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/app/admin/financeiro"
                  element={
                    <ProtectedRoute allowedRoles={['ADMIN']}>
                      <ShellLayout>
                        <AdminFinancePage />
                      </ShellLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/app/admin/comprar-assentos"
                  element={
                    <ProtectedRoute allowedRoles={['ADMIN']}>
                      <ShellLayout>
                        <AdminSeatPurchasePage />
                      </ShellLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/app/admin/qr-code"
                  element={
                    <ProtectedRoute allowedRoles={['ADMIN', 'HR', 'SUPERADMIN']} allowedPlans={['GROWTH', 'PRO']}>
                      <ShellLayout>
                        <AdminQrCodePage />
                      </ShellLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/app/admin/pro-settings"
                  element={
                    <ProtectedRoute allowedRoles={['ADMIN']} allowedPlans={['PRO']}>
                      <ShellLayout>
                        <AdminProSettingsPage />
                      </ShellLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/app/admin/obrigado"
                  element={
                    <ProtectedRoute allowedRoles={['ADMIN', 'HR', 'SUPERADMIN']}>
                      <ShellLayout>
                        <AdminCheckoutThankYouPage />
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
                  path="/app/colaborador/ferias"
                  element={
                    <ProtectedRoute allowedPlans={['GROWTH', 'PRO']}>
                      <ShellLayout>
                        <VacationMemberPage />
                      </ShellLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/app/ferias-equipe"
                  element={
                    <ProtectedRoute allowedRoles={['SUPERVISOR', 'HR', 'ADMIN', 'SUPERADMIN']} allowedPlans={['GROWTH', 'PRO']}>
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
      <Toaster position="top-right" richColors />
    </LanguageProvider>
  )
}

export default App
