import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'

type TimeEntry = {
  id: string
  clockIn: string
  clockOut: string | null
  notes?: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
}

type CurrentEntryResponse = {
  hasOpenEntry: boolean
  entry: {
    id: string
    clockIn: string
  } | null
}

const ColaboradorDashboard = () => {
  const { session } = useAuth()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [currentEntry, setCurrentEntry] = useState<CurrentEntryResponse['entry'] | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const token = session?.access_token

  const activeEntry = useMemo(() => entries.find((entry) => !entry.clockOut) ?? null, [entries])

  const loadEntries = async () => {
    if (!token) return
    const response = await apiFetch<{ entries: TimeEntry[] }>('/time/me', { token })
    setEntries(response.entries)
  }

  const loadCurrentEntry = async () => {
    if (!token) return
    const response = await apiFetch<CurrentEntryResponse>('/time/current', { token })
    setCurrentEntry(response.entry)
    if (response.entry?.clockIn) {
      const startedAt = new Date(response.entry.clockIn).getTime()
      setElapsedMs(Date.now() - startedAt)
    } else {
      setElapsedMs(null)
    }
  }

  useEffect(() => {
    loadEntries().catch(() => undefined)
    loadCurrentEntry().catch(() => undefined)
  }, [token])

  useEffect(() => {
    if (!token) return
    const interval = window.setInterval(() => {
      loadEntries().catch(() => undefined)
      loadCurrentEntry().catch(() => undefined)
    }, 15000)

    return () => window.clearInterval(interval)
  }, [token])

  useEffect(() => {
    if (!currentEntry?.clockIn) return
    const startedAt = new Date(currentEntry.clockIn).getTime()
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt)
    }, 1000)
    return () => window.clearInterval(interval)
  }, [currentEntry?.clockIn])

  const formatElapsed = (value: number | null) => {
    if (value === null) return '--:--:--'
    const totalSeconds = Math.max(0, Math.floor(value / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  const handleClockIn = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      await apiFetch('/time/clock-in', { token, method: 'POST', body: { notes } })
      setNotes('')
      await loadEntries()
      await loadCurrentEntry()
      setSuccess('Clock-in registrado com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar entrada')
    } finally {
      setLoading(false)
    }
  }

  const handleClockOut = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      await apiFetch('/time/clock-out', { token, method: 'POST', body: { notes } })
      setNotes('')
      await loadEntries()
      await loadCurrentEntry()
      setSuccess('Clock-out registrado com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar saida')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">Colaborador</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">Sua jornada em um toque.</h2>
        <p className="mt-4 text-sm text-slate-600">
          Registre a entrada e a saida com rapidez. O sistema salva automaticamente o contexto.
        </p>

        <div className="mt-8 rounded-2xl border border-slate-100 bg-slate-50/70 p-5">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Notas da jornada
          </label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Opcional: reuniao, foco, home office..."
            className="mt-3 h-24 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
          />

          {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
          {success ? <p className="mt-3 text-xs text-emerald-600">{success}</p> : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={handleClockIn}
              disabled={loading || Boolean(activeEntry)}
              className="rounded-full bg-teal-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50"
            >
              Clock in
            </button>
            <button
              onClick={handleClockOut}
              disabled={loading || !activeEntry}
              className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
            >
              Clock out
            </button>
          </div>
        </div>
      </div>

      <aside className="space-y-5">
        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Status atual</h3>
          <p className="mt-2 text-sm text-slate-600">
            {activeEntry ? 'Jornada em andamento' : 'Nenhuma jornada aberta'}
          </p>
          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Tempo ativo</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatElapsed(elapsedMs)}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {currentEntry?.clockIn
                ? `Inicio: ${new Date(currentEntry.clockIn).toLocaleTimeString('pt-BR')}`
                : 'Sem jornada em andamento'}
            </p>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Ultimo registro: {entries[0]?.clockIn ? new Date(entries[0].clockIn).toLocaleString('pt-BR') : '--'}
          </p>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Historico de pontos</h3>
            <button
              onClick={() => {
                loadEntries().catch(() => undefined)
                loadCurrentEntry().catch(() => undefined)
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600"
            >
              Atualizar
            </button>
          </div>
          <div className="mt-4 space-y-3 text-xs text-slate-600">
            {entries.length === 0 ? (
              <p>Sem registros ainda.</p>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between">
                    <span>{new Date(entry.clockIn).toLocaleDateString('pt-BR')}</span>
                    <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-600">
                      {entry.status}
                    </span>
                  </div>
                  <p className="mt-2">
                    {entry.clockIn ? new Date(entry.clockIn).toLocaleTimeString('pt-BR') : '--'} -{' '}
                    {entry.clockOut ? new Date(entry.clockOut).toLocaleTimeString('pt-BR') : 'Em aberto'}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </section>
  )
}

export default ColaboradorDashboard
