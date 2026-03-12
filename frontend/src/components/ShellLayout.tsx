import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-2 text-sm font-medium transition ${
    isActive ? 'bg-teal-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
  }`

const ShellLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, profileError, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-transparent px-6 py-8 text-slate-900">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-2xl bg-teal-700/90" />
          <div className="leading-tight">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Sistema de ponto</p>
            <h1 className="text-xl font-semibold text-slate-900">SystemaPonto</h1>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <span>{profile?.name || profile?.email}</span>
          <button
            onClick={signOut}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 hover:border-slate-300"
          >
            Sair
          </button>
        </div>
      </header>

      {profileError ? (
        <div className="mx-auto mt-6 w-full max-w-6xl rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900">
          {profileError} Entre em contato com o administrador para habilitar o acesso.
        </div>
      ) : null}

      <nav className="mx-auto mt-8 flex w-full max-w-6xl flex-wrap items-center gap-3 rounded-3xl border border-white/80 bg-white/80 p-3 shadow-[0_12px_30px_-25px_rgba(15,23,42,0.5)] backdrop-blur">
        <NavLink to="/app" className={navLinkClass} end>
          Visao geral
        </NavLink>
        <NavLink to="/app/colaborador" className={navLinkClass}>
          Colaborador
        </NavLink>
        <NavLink to="/app/supervisor" className={navLinkClass}>
          Supervisor
        </NavLink>
        <NavLink to="/app/admin" className={navLinkClass}>
          Admin
        </NavLink>
        <NavLink to="/app/relatorios" className={navLinkClass}>
          Relatorios
        </NavLink>
      </nav>

      <main className="mx-auto mt-10 w-full max-w-6xl">{children}</main>
    </div>
  )
}

export default ShellLayout
