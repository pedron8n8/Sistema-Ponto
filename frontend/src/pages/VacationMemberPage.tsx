import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTimeZone } from '../context/TimezoneContext'
import { useTranslation } from 'react-i18next'
import { formatDateTimeWithTimeZone, formatDateWithTimeZone } from '../lib/timezone'

type VacationRequest = {
  id: string
  requestType?: 'VACATION' | 'DAY_OFF'
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

const getVacationStatusLabel = (
  status: VacationRequest['status'],
  t: (en: string, pt: string) => string
) => {
  if (status === 'REQUESTED') return t('Awaiting supervisor', 'Aguardando supervisor')
  if (status === 'SUPERVISOR_APPROVED') return t('Awaiting HR', 'Aguardando RH')
  if (status === 'SUPERVISOR_REJECTED') return t('Rejected by supervisor', 'Rejeitada pelo supervisor')
  if (status === 'HR_CONFIRMED') return t('Confirmed by HR', 'Confirmada pelo RH')
  if (status === 'HR_REJECTED') return t('Rejected by HR', 'Rejeitada pelo RH')
  if (status === 'CANCELED') return t('Canceled', 'Cancelada')
  return status
}

const VacationMemberPage = () => {
  const { session } = useAuth()
  const { viewTimeZone } = useTimeZone()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token

  const [requests, setRequests] = useState<VacationRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({
    requestType: 'VACATION' as 'VACATION' | 'DAY_OFF',
    startDate: '',
    endDate: '',
    reason: '',
  })

  const getRequestTypeLabel = (requestType: 'VACATION' | 'DAY_OFF') =>
    requestType === 'DAY_OFF' ? t('Day off', 'Folga') : t('Vacation', 'Férias')

  const loadRequests = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch<{ requests: VacationRequest[] }>('/vacations/me', { token })
      setRequests(response.requests || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to load vacation requests', 'Erro ao carregar férias'))
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
      setError(t('Provide both start and end dates to request vacation.', 'Informe data inicial e final para solicitar férias.'))
      return
    }

    if (form.requestType === 'DAY_OFF' && form.startDate !== form.endDate) {
      setError(t('Day-off request must be for a single day.', 'Solicitação de folga deve ser para um único dia.'))
      return
    }

    try {
      await apiFetch('/vacations/request', {
        token,
        method: 'POST',
        body: {
          requestType: form.requestType,
          startDate: form.startDate,
          endDate: form.endDate,
          reason: form.reason,
        },
      })

      setNotice(
        form.requestType === 'DAY_OFF'
          ? t('Day-off request sent successfully.', 'Solicitação de folga enviada com sucesso.')
          : t('Vacation request sent successfully.', 'Solicitação de férias enviada com sucesso.')
      )
      setForm((prev) => ({ ...prev, startDate: '', endDate: '', reason: '' }))
      await loadRequests()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Failed to submit vacation/day-off request', 'Erro ao solicitar férias/folga')
      )
    }
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Vacation and day off', 'Férias e folga')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">
          {t('Request and track your vacation/day off.', 'Solicite e acompanhe suas férias/folgas.')}
        </h2>
        <p className="mt-3 text-sm text-slate-600">
          {t('The flow goes through supervisor approval and final HR confirmation.', 'O fluxo segue para aprovação do supervisor e confirmação final do RH.')}
        </p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{t('New request', 'Nova solicitação')}</h3>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <select
            value={form.requestType}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                requestType: event.target.value as 'VACATION' | 'DAY_OFF',
              }))
            }
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="VACATION">{t('Vacation', 'Férias')}</option>
            <option value="DAY_OFF">{t('Day off', 'Folga')}</option>
          </select>
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
            placeholder={t('Reason (optional)', 'Motivo (opcional)')}
            className="h-24 w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-3"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={handleCreate}
            disabled={loading}
            className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {loading
              ? t('Sending...', 'Enviando...')
              : form.requestType === 'DAY_OFF'
                ? t('Request day off', 'Solicitar folga')
                : t('Request vacation', 'Solicitar férias')}
          </button>
          <button
            onClick={() => loadRequests().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs text-slate-700"
          >
            {t('Refresh', 'Atualizar')}
          </button>
        </div>

        {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
        {notice ? <p className="mt-3 text-xs text-emerald-600">{notice}</p> : null}
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{t('History', 'Histórico')}</h3>
        <div className="mt-4 space-y-2 text-xs text-slate-600">
          {loading ? <p className="text-sm text-slate-500">{t('Loading requests...', 'Carregando solicitações...')}</p> : null}
          {!loading && requests.length === 0 ? <p>{t('No requests found.', 'Nenhuma solicitação registrada.')}</p> : null}

          {requests.map((request) => (
            <div key={request.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
              <p className="font-semibold text-slate-800">
                {formatDateWithTimeZone(request.startDate, viewTimeZone)} -{' '}
                {formatDateWithTimeZone(request.endDate, viewTimeZone)}
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                {getVacationStatusLabel(request.status, t)}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {t('Type:', 'Tipo:')} {getRequestTypeLabel(request.requestType || 'VACATION')}
              </p>
              {request.reason ? <p className="mt-1 text-xs text-slate-600">{t('Reason:', 'Motivo:')} {request.reason}</p> : null}
              {request.logs[0] ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  {t('Last action:', 'Última ação:')} {request.logs[0].action} {t('at', 'em')}{' '}
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
