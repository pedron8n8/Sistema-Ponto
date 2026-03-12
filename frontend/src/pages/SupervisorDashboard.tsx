import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'

type Entry = {
  id: string
  user: { name: string; email: string }
  clockIn: string
  clockOut: string | null
  notes?: string | null
}

type Subordinate = {
  id: string
  name: string
  email: string
}

type Stats = {
  PENDING: number
  APPROVED: number
  REJECTED: number
}

type ReviewState = {
  entry: Entry | null
  action: 'APPROVE' | 'REQUEST_EDIT'
  comment: string
}

const SupervisorDashboard = () => {
  const { session } = useAuth()
  const token = session?.access_token
  const [entries, setEntries] = useState<Entry[]>([])
  const [subordinates, setSubordinates] = useState<Subordinate[]>([])
  const [stats, setStats] = useState<Stats>({ PENDING: 0, APPROVED: 0, REJECTED: 0 })
  const [filters, setFilters] = useState({
    status: 'PENDING',
    userId: '',
    startDate: '',
    endDate: '',
  })
  const [review, setReview] = useState<ReviewState>({ entry: null, action: 'APPROVE', comment: '' })
  const [error, setError] = useState('')

  const defaultStats: Stats = { PENDING: 0, APPROVED: 0, REJECTED: 0 }

  const loadEntries = async () => {
    if (!token) return
    const query = new URLSearchParams({
      status: filters.status,
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.startDate ? { startDate: filters.startDate } : {}),
      ...(filters.endDate ? { endDate: filters.endDate } : {}),
    })
    const response = await apiFetch<{
      entries?: Entry[]
      subordinates?: Subordinate[]
      stats?: Partial<Stats>
    }>(
      `/supervisor/entries?${query.toString()}`,
      { token }
    )
    setEntries(response.entries ?? [])
    setSubordinates(response.subordinates ?? [])
    setStats({
      PENDING: response.stats?.PENDING ?? defaultStats.PENDING,
      APPROVED: response.stats?.APPROVED ?? defaultStats.APPROVED,
      REJECTED: response.stats?.REJECTED ?? defaultStats.REJECTED,
    })
  }

  useEffect(() => {
    loadEntries().catch((err) => {
      setError(err instanceof Error ? err.message : 'Erro ao carregar pendencias')
      setEntries([])
      setSubordinates([])
      setStats(defaultStats)
    })
  }, [token, filters.status, filters.userId, filters.startDate, filters.endDate])

  const openReview = (entry: Entry, action: ReviewState['action']) => {
    setReview({ entry, action, comment: '' })
  }

  const closeReview = () => setReview({ entry: null, action: 'APPROVE', comment: '' })

  const submitReview = async () => {
    if (!token || !review.entry) return
    setError('')
    try {
      if (review.action === 'APPROVE') {
        await apiFetch(`/supervisor/approve/${review.entry.id}`, { token, method: 'PATCH' })
      } else {
        await apiFetch(`/supervisor/request-edit/${review.entry.id}`, {
          token,
          method: 'PATCH',
          body: { comment: review.comment },
        })
      }
      closeReview()
      await loadEntries()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao registrar revisao')
    }
  }

  const canSubmit = review.action === 'APPROVE' || review.comment.trim().length >= 3

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">Supervisor</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">Aprovacoes pendentes em um painel.</h2>
        <p className="mt-4 text-sm text-slate-600">
          Revise as jornadas da equipe e registre comentarios sem sair do fluxo.
        </p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">Pendencias</h3>
          <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1">Pendentes {stats.PENDING}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1">Aprovados {stats.APPROVED}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1">Rejeitados {stats.REJECTED}</span>
          </div>
        </div>

        {error ? <p className="mt-4 text-xs text-rose-600">{error}</p> : null}

        <div className="mt-5 grid gap-3 text-xs text-slate-600 md:grid-cols-4">
          <select
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            className="rounded-full border border-slate-200 bg-white px-3 py-2"
          >
            <option value="PENDING">Pendentes</option>
            <option value="APPROVED">Aprovados</option>
            <option value="REJECTED">Rejeitados</option>
            <option value="ALL">Todos</option>
          </select>
          <select
            value={filters.userId}
            onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value }))}
            className="rounded-full border border-slate-200 bg-white px-3 py-2"
          >
            <option value="">Todos os colaboradores</option>
            {subordinates.map((subordinate) => (
              <option key={subordinate.id} value={subordinate.id}>
                {subordinate.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filters.startDate}
            onChange={(event) => setFilters((prev) => ({ ...prev, startDate: event.target.value }))}
            className="rounded-full border border-slate-200 bg-white px-3 py-2"
          />
          <input
            type="date"
            value={filters.endDate}
            onChange={(event) => setFilters((prev) => ({ ...prev, endDate: event.target.value }))}
            className="rounded-full border border-slate-200 bg-white px-3 py-2"
          />
        </div>

        <div className="mt-5 space-y-4">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma pendencia no momento.</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{entry.user.name}</p>
                    <p className="text-xs text-slate-500">{entry.user.email}</p>
                  </div>
                  <div className="text-xs text-slate-600">
                    {new Date(entry.clockIn).toLocaleDateString('pt-BR')} •{' '}
                    {new Date(entry.clockIn).toLocaleTimeString('pt-BR')} -{' '}
                    {entry.clockOut ? new Date(entry.clockOut).toLocaleTimeString('pt-BR') : 'Em aberto'}
                  </div>
                </div>
                {entry.notes ? <p className="mt-2 text-xs text-slate-600">Notas: {entry.notes}</p> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => openReview(entry, 'APPROVE')}
                    className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white"
                  >
                    Aprovar
                  </button>
                  <button
                    onClick={() => openReview(entry, 'REQUEST_EDIT')}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    Solicitar ajuste
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {review.entry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-6">
          <div className="w-full max-w-lg rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
            <h4 className="text-lg font-semibold text-slate-900">Revisar jornada</h4>
            <p className="mt-2 text-xs text-slate-500">
              {review.entry.user.name} • {new Date(review.entry.clockIn).toLocaleString('pt-BR')}
            </p>

            <label className="mt-5 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Comentario
            </label>
            <textarea
              value={review.comment}
              onChange={(event) => setReview((prev) => ({ ...prev, comment: event.target.value }))}
              className="mt-2 h-28 w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            />
            {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                onClick={closeReview}
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600"
              >
                Cancelar
              </button>
              <button
                onClick={submitReview}
                disabled={!canSubmit}
                className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white"
              >
                {review.action === 'APPROVE' ? 'Confirmar aprovacao' : 'Enviar pedido'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default SupervisorDashboard
