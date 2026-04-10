import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePlan } from '../hooks/usePlan'
import type { PlanCode } from '../hooks/usePlan'
import { useTranslation } from 'react-i18next'

type Props = {
  children: React.ReactNode
  allowedRoles?: Array<'SUPERADMIN' | 'ADMIN' | 'HR' | 'SUPERVISOR' | 'MEMBER'>
  allowedPlans?: PlanCode | PlanCode[]
}

const ProtectedRoute = ({ children, allowedRoles, allowedPlans }: Props) => {
  const { session, loading, profile } = useAuth()
  const { hasPlan } = usePlan()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        {t('Loading...', 'Carregando...')}
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (allowedRoles && (!profile || !allowedRoles.includes(profile.role))) {
    return <Navigate to="/app" replace />
  }

  if (allowedPlans && !hasPlan(allowedPlans)) {
    return <Navigate to="/app" replace />
  }

  return <>{children}</>
}

export default ProtectedRoute
