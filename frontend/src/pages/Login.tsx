import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const Login = () => {
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      await signIn(email, password)
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao entrar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-2xl bg-teal-700/90" />
          <div className="leading-tight">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Sistema de ponto</p>
            <h1 className="text-xl font-semibold text-slate-900">SystemaPonto</h1>
          </div>
        </div>
        <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Login</span>
      </div>

      <div className="mx-auto mt-14 grid w-full max-w-5xl gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
          <h2 className="text-3xl font-semibold text-slate-900">Bem-vindo de volta.</h2>
          <p className="mt-3 text-sm text-slate-600">
            Acesse sua conta para registrar a jornada, aprovar solicitacoes e acompanhar os relatarios.
          </p>
          <div className="mt-10 rounded-2xl border border-slate-100 bg-slate-50/70 p-5 text-xs text-slate-500">
            Dica: use o mesmo email cadastrado no Supabase para autenticar.
          </div>
        </section>

        <form onSubmit={handleSubmit} className="rounded-3xl border border-slate-100 bg-white/90 p-8 shadow-sm">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Email</label>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
            placeholder="email@empresa.com"
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
          />

          <label className="mt-6 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Senha</label>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
            placeholder="********"
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
          />

          {error ? <p className="mt-4 text-xs text-rose-600">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="mt-8 w-full rounded-full bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
