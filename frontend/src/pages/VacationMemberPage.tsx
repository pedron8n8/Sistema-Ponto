import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTimeZone } from '../context/TimezoneContext'
import { useLanguage } from '../context/LanguageContext'
import { formatDateTimeWithTimeZone, formatDateWithTimeZone } from '../lib/timezone'

type VacationRequest = {
  id: string
  startDate: string
  endDate: string
  status:
    | 'REQUESTED'
    | 'SUPERVISOR_APPROVED'
    | 'SUPERVISOR_REJECTED'
    | 'HR_CONFIRMED'
    | 'HR_REJECTED'
    | 'CANCELED'
  reason?: string | null
  logs: Array<{
    id: string
    action: string
    comment?: string | null
    timestamp: string
    actor?: {
      id: string
      name?: string | null
      email: string
      role: string
    } | null
  }>
}

const vacationStatusLabel: Record<string, string> = {
  REQUESTED: 'Aguardando supervisor',
  SUPERVISOR_APPROVED: 'Aguardando RH',
  SUPERVISOR_REJECTED: 'Rejeitada pelo supervisor',
  HR_CONFIRMED: 'Confirmada pelo RH',
  HR_REJECTED: 'Rejeitada pelo RH',
  CANCELED: 'Cancelada',
}

const VacationMemberPage = () => {
  const { session } = useAuth()
  const { viewTimeZone } = useTimeZone()
  const { tr } = useLanguage()
  const token = session?.access_token

  const [requests, setRequests] = useState<VacationRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({
    startDate: '',
    endDate: '',
    reason: '',
  })

  const loadRequests = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch<{ requests: VacationRequest[] }>('/vacations/me', { token })
      setRequests(response.requests || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('Failed to load vacation requests', 'Erro ao carregar férias'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRequests().catch(() => undefined)
  }, [token])

  const handleCreate = async () => {
    if (!token) return
    setError('')
    setNotice('')

    if (!form.startDate || !form.endDate) {
      setError(tr('Provide both start and end dates to request vacation.', 'Informe data inicial e final para solicitar férias.'))
      return
    }

    try {
      await apiFetch('/vacations/request', {
        token,
        method: 'POST',
        body: {
          startDate: form.startDate,
          endDate: form.endDate,
          reason: form.reason,
        },
      })

      setNotice(tr('Vacation request sent successfully.', 'Solicitação de férias enviada com sucesso.'))
      setForm({ startDate: '', endDate: '', reason: '' })
      await loadRequests()
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('Failed to submit vacation request', 'Erro ao solicitar férias'))
    }
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{tr('Vacation', 'Férias')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{tr('Request and track your vacation.', 'Solicite e acompanhe suas férias.')}</h2>
        <p className="mt-3 text-sm text-slate-600">
          {tr('The flow goes through supervisor approval and final HR confirmation.', 'O fluxo segue para aprovação do supervisor e confirmação final do RH.')}
        </p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{tr('New request', 'Nova solicitação')}</h3>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <input
            type="date"
            value={form.startDate}
            onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={form.endDate}
            onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
          />
          <textarea
            value={form.reason}
            onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
            placeholder={tr('Reason (optional)', 'Motivo (opcional)')}
            className="h-24 w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-2"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={handleCreate}
            disabled={loading}
            className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {loading ? tr('Sending...', 'Enviando...') : tr('Request vacation', 'Solicitar férias')}
          </button>
          <button
            onClick={() => loadRequests().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs text-slate-700"
          >
            {tr('Refresh', 'Atualizar')}
          </button>
        </div>

        {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
        {notice ? <p className="mt-3 text-xs text-emerald-600">{notice}</p> : null}
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{tr('History', 'Histórico')}</h3>
        <div className="mt-4 space-y-2 text-xs text-slate-600">
          {loading ? <p className="text-sm text-slate-500">{tr('Loading requests...', 'Carregando solicitações...')}</p> : null}
          {!loading && requests.length === 0 ? <p>{tr('No requests found.', 'Nenhuma solicitação registrada.')}</p> : null}

          {requests.map((request) => (
            <div key={request.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
              <p className="font-semibold text-slate-800">
                {formatDateWithTimeZone(request.startDate, viewTimeZone)} -{' '}
                {formatDateWithTimeZone(request.endDate, viewTimeZone)}
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                {tr(
                  {
                    REQUESTED: 'Awaiting supervisor',
                    SUPERVISOR_APPROVED: 'Awaiting HR',
                    SUPERVISOR_REJECTED: 'Rejected by supervisor',
                    HR_CONFIRMED: 'Confirmed by HR',
                    HR_REJECTED: 'Rejected by HR',
                    CANCELED: 'Canceled',
                  }[request.status] || request.status,
                  vacationStatusLabel[request.status] || request.status
                )}
              </p>
              {request.reason ? <p className="mt-1 text-xs text-slate-600">{tr('Reason:', 'Motivo:')} {request.reason}</p> : null}
              {request.logs[0] ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  {tr('Last action:', 'Última ação:')} {request.logs[0].action} {tr('at', 'em')}{' '}
                  {formatDateTimeWithTimeZone(request.logs[0].timestamp, viewTimeZone)}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default VacationMemberPage
