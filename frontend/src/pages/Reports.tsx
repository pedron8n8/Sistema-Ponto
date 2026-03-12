import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'

type TimeEntry = {
  id: string
  clockIn: string
  clockOut: string | null
  duration?: {
    totalMinutes: number
    formatted: string
  } | null
}

const Reports = () => {
  const { session } = useAuth()
  const token = session?.access_token
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [teamId, setTeamId] = useState('')
  const [message, setMessage] = useState('')
  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date()
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1)
    const start = new Date(now)
    start.setDate(diff)
    start.setHours(0, 0, 0, 0)
    return start
  })

  const weekEnd = useMemo(() => {
    const end = new Date(weekStart)
    end.setDate(end.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    return end
  }, [weekStart])

  const formatDateInput = (date: Date) => date.toISOString().split('T')[0]

  const loadWeek = async () => {
    if (!token) return
    const query = new URLSearchParams({
      startDate: formatDateInput(weekStart),
      endDate: formatDateInput(weekEnd),
      limit: '200',
    })
    const response = await apiFetch<{ entries: TimeEntry[] }>(`/time/me?${query.toString()}`, { token })
    setEntries(response.entries)
  }

  useEffect(() => {
    loadWeek().catch(() => undefined)
  }, [token, weekStart, weekEnd])

  const handleExport = async () => {
    if (!token) return
    setMessage('')
    try {
      await apiFetch('/reports/export', {
        token,
        method: 'POST',
        body: {
          startDate,
          endDate,
          teamId: teamId || undefined,
        },
      })
      setMessage('Solicitacao enviada. Voce sera notificado quando o CSV estiver pronto.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erro ao solicitar exportacao')
    }
  }

  const dayRows = useMemo(() => {
    const rows = Array.from({ length: 7 }).map((_, index) => {
      const date = new Date(weekStart)
      date.setDate(date.getDate() + index)
      return date
    })

    return rows.map((date) => {
      const key = date.toDateString()
      const dayEntries = entries.filter((entry) => new Date(entry.clockIn).toDateString() === key)
      const totalMinutes = dayEntries.reduce((acc, entry) => {
        if (entry.duration?.totalMinutes) return acc + entry.duration.totalMinutes
        if (entry.clockIn && entry.clockOut) {
          const diff = new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()
          return acc + Math.max(0, Math.floor(diff / 60000))
        }
        return acc
      }, 0)
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      return {
        date,
        entries: dayEntries,
        totalLabel: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      }
    })
  }, [entries, weekStart])

  return (
    <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">Relatorios</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">Timesheet semanal, pronto para exportar.</h2>
        <p className="mt-4 text-sm text-slate-600">
          Selecione o periodo e solicite a exportacao. O sistema gera o CSV em background.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            Semana de {weekStart.toLocaleDateString('pt-BR')} a {weekEnd.toLocaleDateString('pt-BR')}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const prev = new Date(weekStart)
                prev.setDate(prev.getDate() - 7)
                setWeekStart(prev)
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
            >
              Semana anterior
            </button>
            <button
              onClick={() => {
                const next = new Date(weekStart)
                next.setDate(next.getDate() + 7)
                setWeekStart(next)
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
            >
              Proxima semana
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3">
          {dayRows.map((day) => (
            <div key={day.date.toISOString()} className="rounded-2xl border border-slate-100 bg-white/80 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {day.date.toLocaleDateString('pt-BR', { weekday: 'long' })}
                  </p>
                  <p className="text-xs text-slate-500">{day.date.toLocaleDateString('pt-BR')}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                  {day.totalLabel}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-slate-600">
                {day.entries.length === 0 ? (
                  <p>Sem registros.</p>
                ) : (
                  day.entries.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between">
                      <span>
                        {new Date(entry.clockIn).toLocaleTimeString('pt-BR')} -{' '}
                        {entry.clockOut ? new Date(entry.clockOut).toLocaleTimeString('pt-BR') : 'Em aberto'}
                      </span>
                      <span>{entry.duration?.formatted || ''}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Solicitar exportacao</h3>
        <div className="mt-5 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Data inicio</label>
            <input
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              type="date"
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Data fim</label>
            <input
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              type="date"
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Equipe (ID opcional)</label>
            <input
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
              placeholder="ID da equipe"
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm"
            />
          </div>
          <button
            onClick={handleExport}
            className="w-full rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Solicitar exportacao CSV
          </button>
          {message ? <p className="text-xs text-slate-600">{message}</p> : null}
        </div>
      </div>
    </section>
  )
}

export default Reports
