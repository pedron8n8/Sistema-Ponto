import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const Overview = () => {
  const { profile } = useAuth()

  return (
    <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">Visao geral</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">Oi {profile?.name || 'time'}.</h2>
        <p className="mt-4 text-sm text-slate-600">
          Selecione a area que voce precisa hoje. Mantemos o foco no essencial para reduzir atrito no dia a dia.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[
            { title: 'Colaborador', desc: 'Clock in/out e historico de jornadas.', to: '/app/colaborador' },
            { title: 'Supervisor', desc: 'Aprovacoes pendentes e revisoes.', to: '/app/supervisor' },
            { title: 'Admin', desc: 'Usuarios, roles e supervisores.', to: '/app/admin' },
            { title: 'Relatorios', desc: 'Exportacoes semanais e timesheets.', to: '/app/relatorios' },
          ].map((item) => (
            <Link
              key={item.title}
              to={item.to}
              className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 transition hover:border-slate-200"
            >
              <h3 className="text-sm font-semibold text-slate-800">{item.title}</h3>
              <p className="mt-2 text-xs text-slate-600">{item.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      <aside className="space-y-5">
        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Seu perfil</h3>
          <p className="mt-2 text-sm text-slate-600">Role ativa: {profile?.role || '---'}</p>
          <div className="mt-5 grid gap-2 text-xs text-slate-500">
            <span>Email: {profile?.email || '-'}</span>
            <span>Supervisor: {profile?.supervisor?.name || 'Nao informado'}</span>
          </div>
        </div>
        <div className="rounded-3xl border border-slate-100 bg-slate-900 p-6 text-white shadow-sm">
          <p className="text-xs uppercase tracking-[0.3em] text-teal-200">Experiencia</p>
          <p className="mt-3 text-sm text-slate-100">
            Interfaces leves, com contraste suave e foco na acao principal.
          </p>
        </div>
      </aside>
    </section>
  )
}

export default Overview
