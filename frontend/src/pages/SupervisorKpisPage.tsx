import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'

type KpiPeriod = 'daily' | 'weekly' | 'monthly'

type HoursKpiItem = {
  member: {
    id: string
    name: string
    email: string
  }
  expectedMinutes: number
  workedMinutes: number
  overtimeMinutes: number
}

type HoursKpiTimelineItem = {
  date: string
  expectedMinutes: number
  workedMinutes: number
  overtimeMinutes: number
}

type HoursKpiResponse = {
  summary: {
    expectedMinutes: number
    workedMinutes: number
    overtimeMinutes: number
  }
  byCollaborator: HoursKpiItem[]
  timeline: HoursKpiTimelineItem[]
}

const formatMinutesLabel = (minutes: number) => {
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const mins = absolute % 60
  const sign = minutes < 0 ? '-' : ''
  return `${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

const SupervisorKpisPage = () => {
  const { session } = useAuth()
  const token = session?.access_token

  const [period, setPeriod] = useState<KpiPeriod>('weekly')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [payload, setPayload] = useState<HoursKpiResponse | null>(null)

  const loadKpis = async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const response = await apiFetch<HoursKpiResponse>(`/supervisor/kpis/hours?period=${period}`, {
        token,
      })
      setPayload(response)
    } catch (err) {
      setPayload(null)
      setError(err instanceof Error ? err.message : 'Erro ao carregar KPIs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadKpis().catch(() => undefined)
  }, [token, period])

  const topOvertime = useMemo(() => {
    const list = payload?.byCollaborator || []
    return [...list].sort((a, b) => b.overtimeMinutes - a.overtimeMinutes).slice(0, 5)
  }, [payload])

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">Supervisor</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">KPIs de horas</h2>
        <p className="mt-3 text-sm text-slate-600">Acompanhe previsto, realizado e horas extras por período.</p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as KpiPeriod)}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="daily">Diário</option>
            <option value="weekly">Semanal</option>
            <option value="monthly">Mensal</option>
          </select>

          <button
            onClick={() => loadKpis().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          >
            Atualizar
          </button>
        </div>

        {loading ? <p className="mt-3 text-sm text-slate-500">Carregando KPIs...</p> : null}
        {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
      </div>

      {payload ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Previsto</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{formatMinutesLabel(payload.summary.expectedMinutes)}</p>
            </div>
            <div className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Realizado</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{formatMinutesLabel(payload.summary.workedMinutes)}</p>
            </div>
            <div className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Horas Extras</p>
              <p className="mt-2 text-2xl font-semibold text-rose-700">{formatMinutesLabel(payload.summary.overtimeMinutes)}</p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Top horas extras</h3>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              {topOvertime.length === 0 ? (
                <p className="text-slate-500">Sem dados no período selecionado.</p>
              ) : (
                topOvertime.map((item) => (
                  <div key={item.member.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2">
                    <div>
                      <p className="font-semibold text-slate-800">{item.member.name}</p>
                      <p className="text-xs text-slate-500">{item.member.email}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">HE</p>
                      <p className="font-semibold text-rose-700">{formatMinutesLabel(item.overtimeMinutes)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}

export default SupervisorKpisPage
