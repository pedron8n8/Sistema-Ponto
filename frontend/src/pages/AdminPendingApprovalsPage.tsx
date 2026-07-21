import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'
import JourneyModal from '../components/JourneyModal'

type EntryStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
type ReviewAction = 'APPROVE' | 'REJECT' | 'REQUEST_EDIT'

type TimeEntry = {
  id: string
  status: EntryStatus
  user: {
    id?: string
    name: string
    email: string
  }
  clockIn: string
  clockOut: string | null
  notes?: string | null
  overtimeMinutes?: number | null
  overtimeStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null
  breakMinutes?: number | null
  breaks?: { start: string; end: string }[] | null
}

type EntriesStats = {
  PENDING: number
  APPROVED: number
  REJECTED: number
}

type VacationRequest = {
  id: string
  requestType?: 'VACATION' | 'DAY_OFF'
  status: string
  startDate: string
  endDate: string
  reason?: string | null
  user: {
    id: string
    name: string
    email: string
  }
  supervisor?: {
    id: string
    name: string
    email: string
  } | null
}

const defaultStats: EntriesStats = { PENDING: 0, APPROVED: 0, REJECTED: 0 }

const AdminPendingApprovalsPage = () => {
  const { session } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const locale = isPt ? 'pt-BR' : 'en-US'
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const getRequestTypeLabel = (requestType: 'VACATION' | 'DAY_OFF') =>
    requestType === 'DAY_OFF' ? t('Day off', 'Folga') : t('Vacation', 'Férias')
  const token = session?.access_token

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [entryStats, setEntryStats] = useState<EntriesStats>(defaultStats)
  const [entryActionLoadingById, setEntryActionLoadingById] = useState<Record<string, boolean>>({})
  const [entryCommentById, setEntryCommentById] = useState<Record<string, string>>({})
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null)

  const [vacationRequests, setVacationRequests] = useState<VacationRequest[]>([])
  const [vacationActionLoadingById, setVacationActionLoadingById] = useState<Record<string, boolean>>({})
  const [vacationCommentById, setVacationCommentById] = useState<Record<string, string>>({})

  const loadData = async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const [entriesResponse, vacationResponse] = await Promise.all([
        apiFetch<{ entries: TimeEntry[]; stats: EntriesStats }>('/supervisor/entries?status=PENDING', {
          token,
        }),
        apiFetch<{ requests: VacationRequest[] }>('/vacations/hr/requests?status=SUPERVISOR_APPROVED', {
          token,
        }),
      ])

      setEntries(entriesResponse.entries || [])
      setEntryStats(entriesResponse.stats || defaultStats)
      setVacationRequests(vacationResponse.requests || [])
    } catch (err) {
      setEntries([])
      setEntryStats(defaultStats)
      setVacationRequests([])
      setError(
        err instanceof Error
          ? err.message
          : t('Could not load pending items.', 'Erro ao carregar pendencias')
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData().catch(() => undefined)
  }, [token])

  const openClockCount = useMemo(() => entries.filter((entry) => !entry.clockOut).length, [entries])

  const handleReviewEntry = async (entryId: string, action: ReviewAction) => {
    if (!token) return

    const comment = (entryCommentById[entryId] || '').trim()

    if ((action === 'REJECT' || action === 'REQUEST_EDIT') && comment.length < 3) {
      setError(
        t(
          'For reject or request-edit, provide a comment with at least 3 characters.',
          'Para rejeitar ou solicitar ajuste, informe comentario com pelo menos 3 caracteres.'
        )
      )
      return
    }

    setError('')
    setNotice('')
    setEntryActionLoadingById((prev) => ({ ...prev, [entryId]: true }))

    const endpointMap: Record<ReviewAction, string> = {
      APPROVE: `/supervisor/approve/${entryId}`,
      REJECT: `/supervisor/reject/${entryId}`,
      REQUEST_EDIT: `/supervisor/request-edit/${entryId}`,
    }

    try {
      await apiFetch(endpointMap[action], {
        token,
        method: 'PATCH',
        body: comment ? { comment } : {},
      })

      setNotice(
        action === 'APPROVE'
          ? t('Entry approved successfully.', 'Registro aprovado com sucesso.')
          : action === 'REJECT'
            ? t('Entry rejected successfully.', 'Registro rejeitado com sucesso.')
            : t('Edit request sent to employee.', 'Solicitacao de ajuste enviada ao colaborador.')
      )

      setEntryCommentById((prev) => ({ ...prev, [entryId]: '' }))
      await loadData()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not review time entry.', 'Erro ao revisar registro de ponto')
      )
    } finally {
      setEntryActionLoadingById((prev) => ({ ...prev, [entryId]: false }))
    }
  }

  const handleReviewOvertime = async (entryId: string, decision: 'APPROVE' | 'REJECT') => {
    if (!token) return

    const comment = (entryCommentById[entryId] || '').trim()

    if (decision === 'REJECT' && comment.length < 5) {
      setError(
        t(
          'To deny overtime, provide a comment with at least 5 characters.',
          'Para negar horas extras, informe comentario com pelo menos 5 caracteres.'
        )
      )
      return
    }

    setError('')
    setNotice('')
    setEntryActionLoadingById((prev) => ({ ...prev, [entryId]: true }))

    try {
      await apiFetch(`/supervisor/overtime/${entryId}/${decision === 'APPROVE' ? 'approve' : 'reject'}`, {
        token,
        method: 'PATCH',
        body: comment ? { comment } : {},
      })

      setNotice(
        decision === 'APPROVE'
          ? t('Overtime approved. You can now review the entry.', 'Horas extras aprovadas. Agora voce pode revisar o ponto.')
          : t('Overtime denied (not paid). You can now review the entry.', 'Horas extras negadas (nao pagas). Agora voce pode revisar o ponto.')
      )

      setEntryCommentById((prev) => ({ ...prev, [entryId]: '' }))
      await loadData()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not review overtime.', 'Erro ao revisar horas extras')
      )
    } finally {
      setEntryActionLoadingById((prev) => ({ ...prev, [entryId]: false }))
    }
  }

  const handleReviewVacationByHr = async (requestId: string, decision: 'CONFIRM' | 'REJECT') => {
    if (!token) return

    const comment = (vacationCommentById[requestId] || '').trim()

    if (decision === 'REJECT' && comment.length < 5) {
      setError(
        t(
          'For HR rejection, provide a comment with at least 5 characters.',
          'Para rejeitar no RH, informe comentario com pelo menos 5 caracteres.'
        )
      )
      return
    }

    setError('')
    setNotice('')
    setVacationActionLoadingById((prev) => ({ ...prev, [requestId]: true }))

    try {
      await apiFetch(`/vacations/${requestId}/hr-review`, {
        token,
        method: 'PATCH',
        body: {
          decision,
          ...(comment ? { comment } : {}),
        },
      })

      setNotice(
        decision === 'CONFIRM'
          ? t('Vacation request confirmed by HR.', 'Solicitacao de ferias confirmada pelo RH.')
          : t('Vacation request rejected by HR.', 'Solicitacao de ferias rejeitada pelo RH.')
      )

      setVacationCommentById((prev) => ({ ...prev, [requestId]: '' }))
      await loadData()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not review vacation request.', 'Erro ao revisar solicitacao de ferias')
      )
    } finally {
      setVacationActionLoadingById((prev) => ({ ...prev, [requestId]: false }))
    }
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Admin', 'Admin')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">
          {t('Pending approvals', 'Pendencias de aprovacao')}
        </h2>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'Single inbox for time-entry approvals (supervision) and vacation confirmations (HR).',
            'Central unica para aprovacoes de ponto (supervisao) e confirmacoes de ferias (RH).'
          )}
        </p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {t('Pending entries', 'Ponto pendente')} {entryStats.PENDING}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {t('Approved entries', 'Ponto aprovado')} {entryStats.APPROVED}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {t('Rejected entries', 'Ponto rejeitado')} {entryStats.REJECTED}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {t('Open clocks', 'Em aberto')} {openClockCount}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {t('HR vacations', 'Ferias RH')} {vacationRequests.length}
          </span>
        </div>

        <div className="mt-4">
          <button
            onClick={() => loadData().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          >
            {t('Refresh pending items', 'Atualizar pendencias')}
          </button>
        </div>

        {loading ? <p className="mt-3 text-sm text-slate-500">{t('Loading pending items...', 'Carregando pendencias...')}</p> : null}
        {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
        {notice ? <p className="mt-3 text-xs text-emerald-600">{notice}</p> : null}
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">
          {t('Time entries pending approval', 'Registros de ponto para aprovacao')}
        </h3>

        <div className="mt-4 space-y-4">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-500">{t('No pending time entry.', 'Nenhum registro de ponto pendente.')}</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-sm font-semibold text-slate-900">{entry.user.name}</p>
                <p className="text-xs text-slate-500">{entry.user.email}</p>
                <button
                  type="button"
                  onClick={() => setDetailEntryId(entry.id)}
                  title={t('View journey details', 'Ver detalhes da jornada')}
                  className="mt-2 text-left text-xs text-slate-600 underline decoration-dotted underline-offset-2 hover:text-slate-900"
                >
                  {t('Clock-in:', 'Entrada:')} {new Date(entry.clockIn).toLocaleString(locale)}
                  {entry.clockOut
                    ? ` | ${t('Clock-out:', 'Saida:')} ${new Date(entry.clockOut).toLocaleString(locale)}`
                    : ` | ${t('Open', 'Em aberto')}`}
                </button>
                {entry.notes ? <p className="mt-1 text-xs text-slate-600">{t('Notes:', 'Notas:')} {entry.notes}</p> : null}

                {(entry.overtimeMinutes ?? 0) > 0 || entry.overtimeStatus ? (
                  <p className="mt-2 text-xs">
                    <span
                      className={
                        entry.overtimeStatus === 'APPROVED'
                          ? 'rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-700'
                          : entry.overtimeStatus === 'REJECTED'
                            ? 'rounded-full bg-rose-100 px-3 py-1 font-semibold text-rose-700'
                            : 'rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-700'
                      }
                    >
                      {t('Overtime:', 'Horas extras:')} {Math.floor((entry.overtimeMinutes || 0) / 60)}h{' '}
                      {String((entry.overtimeMinutes || 0) % 60).padStart(2, '0')}m
                      {' — '}
                      {entry.overtimeStatus === 'APPROVED'
                        ? t('approved', 'aprovadas')
                        : entry.overtimeStatus === 'REJECTED'
                          ? t('denied (not paid)', 'negadas (nao pagas)')
                          : t('awaiting decision', 'aguardando decisao')}
                    </span>
                  </p>
                ) : null}

                <textarea
                  value={entryCommentById[entry.id] || ''}
                  onChange={(event) =>
                    setEntryCommentById((prev) => ({
                      ...prev,
                      [entry.id]: event.target.value,
                    }))
                  }
                  placeholder={t(
                    'Comment (required to reject/request edit)',
                    'Comentario (obrigatorio para rejeitar/solicitar ajuste)'
                  )}
                  className="mt-3 h-20 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs"
                />

                {entry.overtimeStatus === 'PENDING' ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleReviewOvertime(entry.id, 'APPROVE')}
                      disabled={Boolean(entryActionLoadingById[entry.id])}
                      className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {t('Approve overtime', 'Aprovar horas extras')}
                    </button>

                    <button
                      onClick={() => handleReviewOvertime(entry.id, 'REJECT')}
                      disabled={Boolean(entryActionLoadingById[entry.id])}
                      className="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                    >
                      {t('Deny overtime', 'Negar horas extras')}
                    </button>

                    <span className="text-xs text-amber-700">
                      {t('Decide the overtime before reviewing the entry.', 'Decida as horas extras antes de revisar o ponto.')}
                    </span>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => handleReviewEntry(entry.id, 'APPROVE')}
                    disabled={Boolean(entryActionLoadingById[entry.id]) || entry.overtimeStatus === 'PENDING'}
                    className="rounded-full bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {t('Approve', 'Aprovar')}
                  </button>

                  <button
                    onClick={() => handleReviewEntry(entry.id, 'REQUEST_EDIT')}
                    disabled={Boolean(entryActionLoadingById[entry.id])}
                    className="rounded-full border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-700 disabled:opacity-50"
                  >
                    {t('Request edit', 'Solicitar ajuste')}
                  </button>

                  <button
                    onClick={() => handleReviewEntry(entry.id, 'REJECT')}
                    disabled={Boolean(entryActionLoadingById[entry.id]) || entry.overtimeStatus === 'PENDING'}
                    className="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                  >
                    {t('Reject', 'Rejeitar')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">
          {t('Vacation requests pending in HR', 'Solicitacoes de ferias pendentes no RH')}
        </h3>

        <div className="mt-4 space-y-4">
          {vacationRequests.length === 0 ? (
            <p className="text-sm text-slate-500">
              {t('No request pending HR decision.', 'Nenhuma solicitacao pendente para decisao do RH.')}
            </p>
          ) : (
            vacationRequests.map((request) => (
              <div key={request.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-sm font-semibold text-slate-900">{request.user.name}</p>
                <p className="text-xs text-slate-500">{request.user.email}</p>
                <p className="mt-2 text-xs text-slate-600">
                  {t('Period:', 'Periodo:')} {new Date(request.startDate).toLocaleDateString(locale)}{' '}
                  {t('to', 'ate')} {new Date(request.endDate).toLocaleDateString(locale)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {t('Type:', 'Tipo:')} {getRequestTypeLabel(request.requestType || 'VACATION')}
                </p>
                {request.reason ? <p className="mt-1 text-xs text-slate-600">{t('Reason:', 'Motivo:')} {request.reason}</p> : null}

                <textarea
                  value={vacationCommentById[request.id] || ''}
                  onChange={(event) =>
                    setVacationCommentById((prev) => ({
                      ...prev,
                      [request.id]: event.target.value,
                    }))
                  }
                  placeholder={t(
                    'Comment (required for HR rejection)',
                    'Comentario (obrigatorio para rejeitar no RH)'
                  )}
                  className="mt-3 h-20 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs"
                />

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => handleReviewVacationByHr(request.id, 'CONFIRM')}
                    disabled={Boolean(vacationActionLoadingById[request.id])}
                    className="rounded-full bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {t('Confirm', 'Confirmar')}
                  </button>

                  <button
                    onClick={() => handleReviewVacationByHr(request.id, 'REJECT')}
                    disabled={Boolean(vacationActionLoadingById[request.id])}
                    className="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                  >
                    {t('Reject', 'Rejeitar')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {detailEntryId
        ? (() => {
            const de = entries.find((e) => e.id === detailEntryId)
            if (!de) return null
            return <JourneyModal entry={de} onClose={() => setDetailEntryId(null)} t={t} locale={locale} />
          })()
        : null}
    </section>
  )
}

export default AdminPendingApprovalsPage
