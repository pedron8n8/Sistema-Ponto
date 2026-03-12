import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

type Props = {
  children: React.ReactNode
}

const ProtectedRoute = ({ children }: Props) => {
  const { session, loading } = useAuth()

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

  return <>{children}</>
}

export default ProtectedRoute
