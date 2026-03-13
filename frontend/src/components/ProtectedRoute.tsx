import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

type Props = {
  children: React.ReactNode
  allowedRoles?: Array<'ADMIN' | 'SUPERVISOR' | 'MEMBER'>
}

const ProtectedRoute = ({ children, allowedRoles }: Props) => {
  const { session, loading, profile } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Carregando...
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (allowedRoles && (!profile || !allowedRoles.includes(profile.role))) {
    return <Navigate to="/app" replace />
  }

  return <>{children}</>
}

export default ProtectedRoute
