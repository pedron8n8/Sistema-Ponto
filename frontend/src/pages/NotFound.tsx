import { Link } from 'react-router-dom'

const NotFound = () => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-3xl font-semibold text-slate-900">Pagina nao encontrada</h2>
      <p className="text-sm text-slate-600">Volte para o painel principal.</p>
      <Link
        to="/app"
        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600"
      >
        Ir para dashboard
      </Link>
    </div>
  )
}

export default NotFound
