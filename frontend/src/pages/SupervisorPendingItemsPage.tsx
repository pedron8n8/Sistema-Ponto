import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'
import JourneyModal from '../components/JourneyModal'

type Entry = {
  id: string
  user: { id?: string; name: string; email: string }
  clockIn: string
  clockOut: string | null
  notes?: string | null
  status?: string
  workedMinutes?: number | null
  overtimeMinutes?: number | null
  overtimeStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null
  breakMinutes?: number | null
  breaks?: { start: string; end: string }[] | null
  lastAction?: { action: string; comment?: string | null; reviewer?: { name: string } } | null
}

type Subordinate = {
  id: string
  name: string
  email: string
  role: string
  supervisorId?: string | null
}

type Stats = {
  PENDING: number
  APPROVED: number
  REJECTED: number
}

type ReviewAction = 'APPROVE' | 'REJECT' | 'REQUEST_EDIT'

type PeriodType = 'day' | 'week' | 'fortnight' | 'month'

const defaultStats: Stats = { PENDING: 0, APPROVED: 0, REJECTED: 0 }

const toYmd = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const parseYmd = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

const getPeriodRange = (periodType: PeriodType, anchorDate: string) => {
  const anchor = parseYmd(anchorDate)
  const year = anchor.getFullYear()
  const month = anchor.getMonth()

  if (periodType === 'day') {
    return { startDate: anchorDate, endDate: anchorDate }
  }
  if (periodType === 'week') {
    const weekday = (anchor.getDay() + 6) % 7 // 0 = segunda
    const start = new Date(year, month, anchor.getDate() - weekday)
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
    return { startDate: toYmd(start), endDate: toYmd(end) }
  }
  if (periodType === 'fortnight') {
    if (anchor.getDate() <= 15) {
      return { startDate: toYmd(new Date(year, month, 1)), endDate: toYmd(new Date(year, month, 15)) }
    }
    return { startDate: toYmd(new Date(year, month, 16)), endDate: toYmd(new Date(year, month + 1, 0)) }
  }
  return { startDate: toYmd(new Date(year, month, 1)), endDate: toYmd(new Date(year, month + 1, 0)) }
}

const fmtHM = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`

const entryMinutes = (entry: Entry) => {
  if (typeof entry.workedMinutes === 'number' && entry.workedMinutes > 0) return entry.workedMinutes
  if (!entry.clockOut) return 0
  return Math.max(0, Math.floor((new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()) / 60000))
}

type DayGroup = { entries: Entry[]; totalMinutes: number }
type WorkerGroup = {
  user: Entry['user']
  days: Map<string, DayGroup>
  approvableIds: string[]
  totalMinutes: number
}

const SupervisorPendingItemsPage = () => {
  const { session } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const locale = isPt ? 'pt-BR' : 'en-US'
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token

  const [entries, setEntries] = useState<Entry[]>([])
  const [stats, setStats] = useState<Stats>(defaultStats)
  const [subordinates, setSubordinates] = useState<Subordinate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [actionLoadingByEntry, setActionLoadingByEntry] = useState<Record<string, boolean>>({})
  const [commentByEntry, setCommentByEntry] = useState<Record<string, string>>({})
  const [bulkLoadingByUser, setBulkLoadingByUser] = useState<Record<string, boolean>>({})
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null)

  const [filters, setFilters] = useState({
    status: 'PENDING',
    userId: '',
    groupId: '',
  })
  const [periodType, setPeriodType] = useState<PeriodType>('day')
  const [anchorDate, setAnchorDate] = useState(() => toYmd(new Date()))

  const { startDate, endDate } = useMemo(() => getPeriodRange(periodType, anchorDate), [periodType, anchorDate])

  const shiftPeriod = (direction: 1 | -1) => {
    const boundary = parseYmd(direction === 1 ? endDate : startDate)
    boundary.setDate(boundary.getDate() + direction)
    setAnchorDate(toYmd(boundary))
  }

  const loadData = async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const query = new URLSearchParams()
      if (filters.status) query.set('status', filters.status)
      if (filters.userId) query.set('userId', filters.userId)
      if (filters.groupId) query.set('groupId', filters.groupId)
      query.set('startDate', startDate)
      query.set('endDate', endDate)
      query.set('limit', '500')

      const entriesResponse = await apiFetch<{ entries: Entry[]; stats: Stats; subordinates: Subordinate[] }>(
        `/supervisor/entries?${query.toString()}`,
        { token }
      )

      setEntries(entriesResponse.entries || [])
      setStats(entriesResponse.stats || defaultStats)
      setSubordinates(entriesResponse.subordinates || [])
    } catch (err) {
      setEntries([])
      setStats(defaultStats)
      setError(err instanceof Error ? err.message : t('Could not load pending items.', 'Erro ao carregar pendencias'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData().catch(() => undefined)
  }, [token, filters.status, filters.userId, filters.groupId, startDate, endDate])

  const groups = useMemo(() => subordinates.filter((s) => s.role === 'SUPERVISOR'), [subordinates])

  const visibleSubordinates = useMemo(
    () => (filters.groupId ? subordinates.filter((s) => s.supervisorId === filters.groupId) : subordinates),
    [subordinates, filters.groupId]
  )

  const pendingCount = useMemo(() => entries.filter((entry) => !entry.clockOut).length, [entries])

  const workerGroups = useMemo(() => {
    const groups = new Map<string, WorkerGroup>()

    for (const entry of entries) {
      const userKey = entry.user.id || entry.user.email
      let group = groups.get(userKey)
      if (!group) {
        group = { user: entry.user, days: new Map(), approvableIds: [], totalMinutes: 0 }
        groups.set(userKey, group)
      }

      const dayKey = toYmd(new Date(entry.clockIn))
      let day = group.days.get(dayKey)
      if (!day) {
        day = { entries: [], totalMinutes: 0 }
        group.days.set(dayKey, day)
      }

      const minutes = entryMinutes(entry)
      day.entries.push(entry)
      day.totalMinutes += minutes
      group.totalMinutes += minutes
      if (entry.status === 'PENDING' && entry.clockOut && entry.overtimeStatus !== 'PENDING') {
        group.approvableIds.push(entry.id)
      }
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        sortedDays: Array.from(group.days.entries()).sort(([a], [b]) => a.localeCompare(b)),
      }))
      .sort((a, b) => (a.user.name || '').localeCompare(b.user.name || '', locale))
  }, [entries, locale])

  const handleReview = async (entryId: string, action: ReviewAction) => {
    if (!token) return

    setNotice('')
    setError('')
    setActionLoadingByEntry((prev) => ({ ...prev, [entryId]: true }))

    const comment = (commentByEntry[entryId] || '').trim()
    if ((action === 'REJECT' || action === 'REQUEST_EDIT') && comment.length < 3) {
      setActionLoadingByEntry((prev) => ({ ...prev, [entryId]: false }))
      setError(
        t(
          'For reject or request-edit, provide a comment with at least 3 characters.',
          'Para rejeitar ou solicitar ajuste, informe comentario com pelo menos 3 caracteres.'
        )
      )
      return
    }

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
            : t('Edit request sent to employee.', 'Solicitacao de ajuste enviada para o colaborador.')
      )

      setCommentByEntry((prev) => ({ ...prev, [entryId]: '' }))
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not review pending item.', 'Erro ao revisar item pendente'))
    } finally {
      setActionLoadingByEntry((prev) => ({ ...prev, [entryId]: false }))
    }
  }

  const handleOvertimeReview = async (entryId: string, decision: 'APPROVE' | 'REJECT') => {
    if (!token) return

    setNotice('')
    setError('')
    setActionLoadingByEntry((prev) => ({ ...prev, [entryId]: true }))

    const comment = (commentByEntry[entryId] || '').trim()
    if (decision === 'REJECT' && comment.length < 5) {
      setActionLoadingByEntry((prev) => ({ ...prev, [entryId]: false }))
      setError(
        t(
          'To deny overtime, provide a comment with at least 5 characters.',
          'Para negar horas extras, informe comentario com pelo menos 5 caracteres.'
        )
      )
      return
    }

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

      setCommentByEntry((prev) => ({ ...prev, [entryId]: '' }))
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not review overtime.', 'Erro ao revisar horas extras'))
    } finally {
      setActionLoadingByEntry((prev) => ({ ...prev, [entryId]: false }))
    }
  }

  const handleBulkApprove = async (group: WorkerGroup) => {
    if (!token || group.approvableIds.length === 0) return

    const userKey = group.user.id || group.user.email
    const confirmed = window.confirm(
      t(
        `Approve all ${group.approvableIds.length} pending entries of ${group.user.name} in this period?`,
        `Aprovar todos os ${group.approvableIds.length} registros pendentes de ${group.user.name} neste periodo?`
      )
    )
    if (!confirmed) return

    setNotice('')
    setError('')
    setBulkLoadingByUser((prev) => ({ ...prev, [userKey]: true }))

    try {
      const result = await apiFetch<{ approvedCount: number; skipped: { id: string; reason: string }[] }>(
        '/supervisor/approve-bulk',
        { token, method: 'POST', body: { entryIds: group.approvableIds } }
      )

      const skippedCount = result.skipped?.length || 0
      setNotice(
        skippedCount > 0
          ? t(
              `${result.approvedCount} entries approved, ${skippedCount} skipped.`,
              `${result.approvedCount} registros aprovados, ${skippedCount} ignorados.`
            )
          : t(`${result.approvedCount} entries approved.`, `${result.approvedCount} registros aprovados.`)
      )
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not bulk approve.', 'Erro ao aprovar em lote'))
    } finally {
      setBulkLoadingByUser((prev) => ({ ...prev, [userKey]: false }))
    }
  }

  const entryRowClass = (entry: Entry) => {
    if (entry.status === 'APPROVED') return 'rounded-2xl border border-emerald-200 bg-emerald-50 p-4'
    if (entry.status === 'REJECTED') return 'rounded-2xl border border-rose-200 bg-rose-50 p-4'
    if (entry.status === 'PENDING' && entry.lastAction?.action === 'EDIT_REQUESTED') {
      return 'rounded-2xl border border-amber-200 bg-amber-50 p-4'
    }
    return 'rounded-2xl border border-slate-100 bg-slate-50/70 p-4'
  }

  const formatDayLabel = (dayKey: string) =>
    parseYmd(dayKey).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Supervisor', 'Supervisor')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{t('Pending items', 'Pendencias')}</h2>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'Manage team approvals, rejections and edit requests.',
            'Gerencie aprovacoes, rejeicoes e solicitacoes de ajuste da equipe.'
          )}
        </p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">{t('Pending', 'Pendentes')} {stats.PENDING}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">{t('Approved', 'Aprovados')} {stats.APPROVED}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">{t('Rejected', 'Rejeitados')} {stats.REJECTED}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">{t('Open', 'Em aberto')} {pendingCount}</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="PENDING">{t('Pending', 'Pendentes')}</option>
            <option value="APPROVED">{t('Approved', 'Aprovados')}</option>
            <option value="REJECTED">{t('Rejected', 'Rejeitados')}</option>
            <option value="ALL">{t('All', 'Todos')}</option>
          </select>

          {groups.length > 0 ? (
            <select
              value={filters.groupId}
              onChange={(event) => {
                const groupId = event.target.value
                setFilters((prev) => {
                  const stillVisible =
                    !groupId || subordinates.some((s) => s.id === prev.userId && s.supervisorId === groupId)
                  return { ...prev, groupId, userId: stillVisible ? prev.userId : '' }
                })
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <option value="">{t('All groups', 'Todos os grupos')}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          ) : null}

          <select
            value={filters.userId}
            onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value }))}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="">{t('All employees', 'Todos os colaboradores')}</option>
            {visibleSubordinates.map((subordinate) => (
              <option key={subordinate.id} value={subordinate.id}>
                {subordinate.name}
              </option>
            ))}
          </select>

          <select
            value={periodType}
            onChange={(event) => setPeriodType(event.target.value as PeriodType)}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="day">{t('Daily', 'Diaria')}</option>
            <option value="week">{t('Weekly', 'Semanal')}</option>
            <option value="fortnight">{t('Pay period (15 days)', 'Quinzenal')}</option>
            <option value="month">{t('Monthly', 'Mensal')}</option>
          </select>

          <input
            type="date"
            value={anchorDate}
            onChange={(event) => event.target.value && setAnchorDate(event.target.value)}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
          />

          <button
            onClick={() => shiftPeriod(-1)}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          >
            {t('Previous', 'Anterior')}
          </button>
          <span className="rounded-full bg-slate-100 px-3 py-2 text-xs text-slate-700">
            {parseYmd(startDate).toLocaleDateString(locale)} — {parseYmd(endDate).toLocaleDateString(locale)}
          </span>
          <button
            onClick={() => shiftPeriod(1)}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          >
            {t('Next', 'Próximo')}
          </button>
          <button
            onClick={() => loadData().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          >
            {t('Refresh', 'Atualizar')}
          </button>
        </div>

        {loading ? <p className="mt-3 text-sm text-slate-500">{t('Loading pending items...', 'Carregando pendencias...')}</p> : null}
        {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
        {notice ? <p className="mt-3 text-xs text-emerald-600">{notice}</p> : null}
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{t('Items', 'Itens')}</h3>

        <div className="mt-4 space-y-6">
          {workerGroups.length === 0 ? (
            <p className="text-sm text-slate-500">{t('No pending item for current filters.', 'Nenhuma pendencia no filtro atual.')}</p>
          ) : (
            workerGroups.map((group) => {
              const userKey = group.user.id || group.user.email
              return (
                <div key={userKey} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{group.user.name}</p>
                      <p className="text-xs text-slate-500">{group.user.email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                        {t('Period total:', 'Total no periodo:')} {fmtHM(group.totalMinutes)}
                      </span>
                      <button
                        onClick={() => handleBulkApprove(group)}
                        disabled={group.approvableIds.length === 0 || Boolean(bulkLoadingByUser[userKey])}
                        className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {t(`Approve all (${group.approvableIds.length})`, `Aprovar tudo (${group.approvableIds.length})`)}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    {group.sortedDays.map(([dayKey, day]) => (
                      <div key={dayKey}>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                          {formatDayLabel(dayKey)} — {t('Worked:', 'Trabalhado:')} {fmtHM(day.totalMinutes)}
                        </p>

                        <div className="mt-2 space-y-3">
                          {day.entries.map((entry) => (
                            <div key={entry.id} className={entryRowClass(entry)}>
                              <button
                                type="button"
                                onClick={() => setDetailEntryId(entry.id)}
                                title={t('View journey details', 'Ver detalhes da jornada')}
                                className="text-left text-xs text-slate-600 underline decoration-dotted underline-offset-2 hover:text-slate-900"
                              >
                                {t('Clock-in:', 'Entrada:')} {new Date(entry.clockIn).toLocaleString(locale)}
                                {entry.clockOut
                                  ? ` | ${t('Clock-out:', 'Saida:')} ${new Date(entry.clockOut).toLocaleString(locale)}`
                                  : ` | ${t('Open', 'Em aberto')}`}
                                {` | ${t('Worked:', 'Trabalhado:')} ${fmtHM(entryMinutes(entry))}`}
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
                                    {t('Overtime:', 'Horas extras:')} {fmtHM(entry.overtimeMinutes || 0)}
                                    {' — '}
                                    {entry.overtimeStatus === 'APPROVED'
                                      ? t('approved', 'aprovadas')
                                      : entry.overtimeStatus === 'REJECTED'
                                        ? t('denied (not paid)', 'negadas (nao pagas)')
                                        : t('awaiting decision', 'aguardando decisao')}
                                  </span>
                                </p>
                              ) : null}

                              {entry.status === 'PENDING' ? (
                                <>
                                  {entry.lastAction?.action === 'EDIT_REQUESTED' ? (
                                    <p className="mt-2 text-xs font-semibold text-amber-700">
                                      {t('Sent for edit', 'Enviado para ajuste')}
                                      {entry.lastAction?.comment ? ` — ${entry.lastAction.comment}` : ''}
                                    </p>
                                  ) : null}

                                  <textarea
                                    value={commentByEntry[entry.id] || ''}
                                    onChange={(event) =>
                                      setCommentByEntry((prev) => ({
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
                                        onClick={() => handleOvertimeReview(entry.id, 'APPROVE')}
                                        disabled={Boolean(actionLoadingByEntry[entry.id])}
                                        className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                                      >
                                        {t('Approve OT', 'Aprovar HE')}
                                      </button>

                                      <button
                                        onClick={() => handleOvertimeReview(entry.id, 'REJECT')}
                                        disabled={Boolean(actionLoadingByEntry[entry.id])}
                                        className="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                                      >
                                        {t('Deny OT', 'Negar HE')}
                                      </button>

                                      <span className="text-xs text-amber-700">
                                        {t('Decide the overtime before reviewing the entry.', 'Decida as horas extras antes de revisar o ponto.')}
                                      </span>
                                    </div>
                                  ) : null}

                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                      onClick={() => handleReview(entry.id, 'APPROVE')}
                                      disabled={Boolean(actionLoadingByEntry[entry.id]) || entry.overtimeStatus === 'PENDING'}
                                      className="rounded-full bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                                    >
                                      {t('Approve', 'Aprovar')}
                                    </button>

                                    <button
                                      onClick={() => handleReview(entry.id, 'REQUEST_EDIT')}
                                      disabled={Boolean(actionLoadingByEntry[entry.id])}
                                      className="rounded-full border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-700 disabled:opacity-50"
                                    >
                                      {t('Request edit', 'Solicitar ajuste')}
                                    </button>

                                    <button
                                      onClick={() => handleReview(entry.id, 'REJECT')}
                                      disabled={Boolean(actionLoadingByEntry[entry.id]) || entry.overtimeStatus === 'PENDING'}
                                      className="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                                    >
                                      {t('Reject', 'Rejeitar')}
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <p className="mt-3 text-xs font-semibold text-slate-700">
                                  {entry.status === 'APPROVED' ? t('Approved', 'Aprovado') : t('Rejected', 'Rejeitado')}
                                  {entry.status === 'REJECTED' && entry.lastAction?.action === 'REJECTED' && entry.lastAction.comment
                                    ? ` — ${entry.lastAction.comment}`
                                    : ''}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
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

export default SupervisorPendingItemsPage
