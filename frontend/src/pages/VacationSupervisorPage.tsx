import { useEffect, useMemo, useState } from 'react'
import { apiFetch, resolveApiAssetUrl } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTimeZone } from '../context/TimezoneContext'
import { useTranslation } from 'react-i18next'
import { formatDateWithTimeZone } from '../lib/timezone'
import UserAvatar from '../components/UserAvatar'

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
  user: {
    id: string
    name: string
    email: string
    photoUrl?: string | null
  }
}

type VacationCalendarDay = {
  date: string
  absentCount: number
  availableCount: number
  teamSize: number
  presencePercent: number
  belowThreshold: boolean
  membersOnVacation: Array<{
    id: string
    name: string | null
    email: string
    photoUrl?: string | null
    requestType?: 'VACATION' | 'DAY_OFF'
    status: string
  }>
}

type VacationCalendar = {
  month: { year: number; month: number }
  minPresencePercent: number
  teamSize: number
  days: VacationCalendarDay[]
  annual: Array<{
    year: number
    month: number
    requestsCount: number
    membersScheduled: number
  }>
}

const VacationSupervisorPage = () => {
  const { session, profile } = useAuth()
  const { viewTimeZone } = useTimeZone()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token
  const isHrFlow = profile?.role === 'HR' || profile?.role === 'ADMIN'
  const getRequestTypeLabel = (requestType: 'VACATION' | 'DAY_OFF') =>
    requestType === 'DAY_OFF' ? t('Day off', 'Folga') : t('Vacation', 'Férias')

  const [requests, setRequests] = useState<VacationRequest[]>([])
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [reviewCommentById, setReviewCommentById] = useState<Record<string, string>>({})
  const [actionLoadingById, setActionLoadingById] = useState<Record<string, boolean>>({})
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const [calendar, setCalendar] = useState<VacationCalendar | null>(null)
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })
  const [minPresencePercent, setMinPresencePercent] = useState(70)
  const [selectedDate, setSelectedDate] = useState('')

  const calendarGrid = useMemo(() => {
    if (!calendar) return [] as Array<{ type: 'empty'; key: string } | { type: 'day'; key: string; day: VacationCalendarDay }>

    const firstDayOfMonth = new Date(calendar.month.year, calendar.month.month - 1, 1)
    const leadingEmpty = firstDayOfMonth.getDay()
    const grid: Array<{ type: 'empty'; key: string } | { type: 'day'; key: string; day: VacationCalendarDay }> = []

    for (let i = 0; i < leadingEmpty; i += 1) {
      grid.push({ type: 'empty', key: `empty-${i}` })
    }

    for (const day of calendar.days) {
      grid.push({ type: 'day', key: day.date, day })
    }

    return grid
  }, [calendar])

  const selectedDay = useMemo(() => {
    if (!calendar || !selectedDate) return null
    return calendar.days.find((day) => day.date === selectedDate) || null
  }, [calendar, selectedDate])

  const loadRequests = async () => {
    if (!token) return
    setRequestsLoading(true)
    try {
      const endpoint = isHrFlow
        ? '/vacations/hr/requests?status=SUPERVISOR_APPROVED'
        : '/vacations/team/requests?status=ALL'

      const response = await apiFetch<{ requests: VacationRequest[] }>(endpoint, { token })
      setRequests(
        (response.requests || []).map((request) => ({
          ...request,
          user: {
            ...request.user,
            photoUrl: resolveApiAssetUrl(request.user.photoUrl),
          },
        }))
      )
    } finally {
      setRequestsLoading(false)
    }
  }

  const loadCalendar = async () => {
    if (!token) return
    setCalendarLoading(true)
    try {
      const query = new URLSearchParams({
        year: String(calendarMonth.year),
        month: String(calendarMonth.month),
        minPresencePercent: String(minPresencePercent),
      })

      const response = await apiFetch<VacationCalendar>(`/vacations/team/calendar?${query.toString()}`, {
        token,
      })
      setCalendar({
        ...response,
        days: (response.days || []).map((day) => ({
          ...day,
          membersOnVacation: (day.membersOnVacation || []).map((member) => ({
            ...member,
            photoUrl: resolveApiAssetUrl(member.photoUrl),
          })),
        })),
      })
    } finally {
      setCalendarLoading(false)
    }
  }

  useEffect(() => {
    loadRequests().catch(() => undefined)
  }, [token, isHrFlow])

  useEffect(() => {
    loadCalendar().catch(() => undefined)
  }, [token, calendarMonth.year, calendarMonth.month, minPresencePercent])

  useEffect(() => {
    if (!calendar?.days?.length) {
      setSelectedDate('')
      return
    }

    const stillExists = calendar.days.some((day) => day.date === selectedDate)
    if (!stillExists) {
      setSelectedDate('')
    }
  }, [calendar, selectedDate])

  const handleReviewRequest = async (
    requestId: string,
    decision: 'APPROVE' | 'REJECT' | 'CONFIRM'
  ) => {
    if (!token) return

    const comment = reviewCommentById[requestId] || ''
    setError('')
    setNotice('')

    if (decision === 'REJECT' && comment.trim().length < 5) {
      setError(t('Comment is required for rejection (minimum 5 characters).', 'Comentário obrigatório para rejeição (mínimo 5 caracteres).'))
      return
    }

    setActionLoadingById((prev) => ({ ...prev, [requestId]: true }))
    try {
      const endpoint = isHrFlow
        ? `/vacations/${requestId}/hr-review`
        : `/vacations/${requestId}/supervisor-review`

      await apiFetch(endpoint, {
        token,
        method: 'PATCH',
        body: {
          decision,
          comment: comment || undefined,
        },
      })

      setNotice(
        decision === 'APPROVE'
          ? t('Request approved and forwarded to HR.', 'Solicitação aprovada e encaminhada ao RH.')
          : decision === 'CONFIRM'
            ? t('Request confirmed by HR.', 'Solicitação confirmada pelo RH.')
            : isHrFlow
              ? t('Request rejected by HR.', 'Solicitação rejeitada pelo RH.')
              : t('Request rejected by supervisor.', 'Solicitação rejeitada pelo supervisor.')
      )
      setReviewCommentById((prev) => ({ ...prev, [requestId]: '' }))
      await loadRequests()
      await loadCalendar()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to review request', 'Erro ao revisar solicitação'))
    } finally {
      setActionLoadingById((prev) => ({ ...prev, [requestId]: false }))
    }
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Supervisor', 'Supervisor')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{t('Team vacation', 'Férias da equipe')}</h2>
        <p className="mt-3 text-sm text-slate-600">
          {t('Approve/reject requests and track impact on team availability.', 'Aprove/rejeite solicitações e acompanhe impacto na presença da equipe.')}
        </p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">
            {isHrFlow ? t('Pending HR requests', 'Solicitações pendentes de RH') : t('Pending requests', 'Solicitações pendentes')}
          </h3>
          <button
            onClick={() => {
              loadRequests().catch(() => undefined)
              loadCalendar().catch(() => undefined)
            }}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
          >
            {t('Refresh', 'Atualizar')}
          </button>
        </div>

        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
        {notice ? <p className="mt-2 text-xs text-emerald-600">{notice}</p> : null}

        <div className="mt-4 space-y-3">
          {requestsLoading ? <p className="text-sm text-slate-500">{t('Loading requests...', 'Carregando solicitações...')}</p> : null}
          {!requestsLoading && requests.filter((item) => (isHrFlow ? item.status === 'SUPERVISOR_APPROVED' : item.status === 'REQUESTED')).length === 0 ? (
            <p className="text-sm text-slate-500">
              {isHrFlow
                ? t('No pending HR requests.', 'Nenhuma solicitação pendente de RH.')
                : t('No pending supervisor requests.', 'Nenhuma solicitação pendente de supervisor.')}
            </p>
          ) : null}

          {requests
            .filter((item) => (isHrFlow ? item.status === 'SUPERVISOR_APPROVED' : item.status === 'REQUESTED'))
            .map((request) => (
              <div key={request.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex items-center gap-3">
                  <UserAvatar name={request.user.name} photoUrl={request.user.photoUrl} size="md" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{request.user.name}</p>
                    <p className="text-xs text-slate-500">{request.user.email}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  {formatDateWithTimeZone(request.startDate, viewTimeZone)} {t('to', 'até')}{' '}
                  {formatDateWithTimeZone(request.endDate, viewTimeZone)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {t('Type:', 'Tipo:')} {getRequestTypeLabel(request.requestType || 'VACATION')}
                </p>
                {request.reason ? <p className="mt-1 text-xs text-slate-600">{t('Reason:', 'Motivo:')} {request.reason}</p> : null}

                <input
                  value={reviewCommentById[request.id] || ''}
                  onChange={(event) =>
                    setReviewCommentById((prev) => ({
                      ...prev,
                      [request.id]: event.target.value,
                    }))
                  }
                  placeholder={t('Comment (required for rejection)', 'Comentário (obrigatório para rejeição)')}
                  className="mt-3 w-full rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
                />

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    onClick={() => handleReviewRequest(request.id, isHrFlow ? 'CONFIRM' : 'APPROVE')}
                    disabled={Boolean(actionLoadingById[request.id])}
                    className="rounded-full bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {isHrFlow ? t('Confirm', 'Confirmar') : t('Approve', 'Aprovar')}
                  </button>
                  <button
                    onClick={() => handleReviewRequest(request.id, 'REJECT')}
                    disabled={Boolean(actionLoadingById[request.id])}
                    className="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                  >
                    {t('Reject', 'Rejeitar')}
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{t('Team calendar', 'Calendário da equipe')}</h3>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <input
            type="number"
            min={2000}
            value={calendarMonth.year}
            onChange={(event) =>
              setCalendarMonth((prev) => ({
                ...prev,
                year: Number(event.target.value) || prev.year,
              }))
            }
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
            placeholder={t('Year', 'Ano')}
          />
          <input
            type="number"
            min={1}
            max={12}
            value={calendarMonth.month}
            onChange={(event) =>
              setCalendarMonth((prev) => ({
                ...prev,
                month: Math.min(12, Math.max(1, Number(event.target.value) || prev.month)),
              }))
            }
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
            placeholder={t('Month', 'Mês')}
          />
          <input
            type="number"
            min={0}
            max={100}
            value={minPresencePercent}
            onChange={(event) => setMinPresencePercent(Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
            placeholder={t('Min. presence (%)', 'Min. presença (%)')}
          />
        </div>

        {calendarLoading ? <p className="mt-3 text-sm text-slate-500">{t('Loading calendar...', 'Carregando calendário...')}</p> : null}
        {!calendarLoading && calendar ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
              <div className="mb-2 grid grid-cols-7 gap-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <span>{t('Sun', 'Dom')}</span>
                <span>{t('Mon', 'Seg')}</span>
                <span>{t('Tue', 'Ter')}</span>
                <span>{t('Wed', 'Qua')}</span>
                <span>{t('Thu', 'Qui')}</span>
                <span>{t('Fri', 'Sex')}</span>
                <span>{t('Sat', 'Sab')}</span>
              </div>

              <div className="grid grid-cols-7 gap-2">
                {calendarGrid.map((cell) => {
                  if (cell.type === 'empty') {
                    return <div key={cell.key} className="h-24 rounded-xl border border-transparent" />
                  }

                  const day = cell.day
                  const isSelected = day.date === selectedDate

                  return (
                    <button
                      key={cell.key}
                      onClick={() => setSelectedDate(day.date)}
                      className={`h-24 rounded-xl border p-2 text-left text-[11px] transition ${
                        isSelected
                          ? 'border-teal-500 bg-teal-50 shadow-sm'
                          : day.belowThreshold
                            ? 'border-rose-200 bg-rose-50 hover:border-rose-300'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <p className="font-semibold text-slate-800">{new Date(`${day.date}T12:00:00`).getDate()}</p>
                      <p className="mt-1 text-slate-600">{t('Absent:', 'Ausentes:')} {day.absentCount}</p>
                      <p className="text-slate-600">{t('Presence:', 'Presença:')} {day.presencePercent}%</p>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4 text-xs text-slate-600">
              <p className="text-sm font-semibold text-slate-800">{t('Day details', 'Detalhes do dia')}</p>
              {!selectedDay ? (
                <p className="mt-2 text-slate-500">{t('Select a day to see details.', 'Selecione um dia para ver os detalhes.')}</p>
              ) : (
                <>
                  <p className="mt-2 font-semibold text-slate-800">{formatDateWithTimeZone(selectedDay.date, viewTimeZone)}</p>
                  <p className="mt-1">{t('Absent:', 'Ausentes:')} {selectedDay.absentCount}</p>
                  <p>{t('Available:', 'Disponíveis:')} {selectedDay.availableCount}</p>
                  <p>{t('Presence:', 'Presença:')} {selectedDay.presencePercent}%</p>
                  {selectedDay.belowThreshold ? (
                    <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1 text-rose-700">
                      {t('Alert: team is below the configured minimum threshold.', 'Alerta: equipe abaixo do limite mínimo configurado.')}
                    </p>
                  ) : null}

                  <div className="mt-3 space-y-2">
                    <p className="font-semibold text-slate-700">{t('On vacation this day', 'Em férias neste dia')}</p>
                    {selectedDay.membersOnVacation.length === 0 ? (
                      <p className="text-slate-500">{t('No team members on vacation.', 'Nenhum colaborador em férias.')}</p>
                    ) : (
                      selectedDay.membersOnVacation.map((member) => (
                        <div key={member.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <UserAvatar name={member.name || member.email} photoUrl={member.photoUrl} size="sm" />
                            <div>
                              <p className="font-semibold text-slate-800">{member.name || member.email}</p>
                              <p className="text-slate-500">{member.email}</p>
                            </div>
                          </div>
                          <p className="mt-1 text-slate-500">{t('Status:', 'Status:')} {member.status}</p>
                          <p className="text-slate-500">
                            {t('Type:', 'Tipo:')} {getRequestTypeLabel(member.requestType || 'VACATION')}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}

        {!calendarLoading && calendar?.annual?.length ? (
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {calendar.annual.map((item) => (
              <button
                key={`${item.year}-${item.month}`}
                onClick={() => {
                  setCalendarMonth({ year: item.year, month: item.month })
                  setSelectedDate('')
                }}
                className={`rounded-2xl border bg-white p-3 text-left text-xs text-slate-600 transition ${
                  item.year === calendarMonth.year && item.month === calendarMonth.month
                    ? 'border-teal-300 ring-2 ring-teal-100'
                    : 'border-slate-100 hover:border-slate-300'
                }`}
              >
                <p className="font-semibold text-slate-800">
                  {String(item.month).padStart(2, '0')}/{item.year}
                </p>
                <p>{t('Requests:', 'Solicitações:')} {item.requestsCount}</p>
                <p>{t('Team members on vacation:', 'Colaboradores em férias:')} {item.membersScheduled}</p>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export default VacationSupervisorPage
