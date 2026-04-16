import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'

type Entry = {
  id: string
  user: { id?: string; name: string; email: string }
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

type ReviewAction = 'APPROVE' | 'REJECT' | 'REQUEST_EDIT'

const defaultStats: Stats = { PENDING: 0, APPROVED: 0, REJECTED: 0 }

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

  const [filters, setFilters] = useState({
    status: 'PENDING',
    userId: '',
    startDate: '',
    endDate: '',
  })

  const loadData = async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const query = new URLSearchParams()
      if (filters.status) query.set('status', filters.status)
      if (filters.userId) query.set('userId', filters.userId)
      if (filters.startDate) query.set('startDate', filters.startDate)
      if (filters.endDate) query.set('endDate', filters.endDate)

      const [entriesResponse, teamResponse] = await Promise.all([
        apiFetch<{ entries: Entry[]; stats: Stats }>(`/supervisor/entries?${query.toString()}`, { token }),
        apiFetch<{ subordinates: Subordinate[] }>('/supervisor/team', { token }),
      ])

      setEntries(entriesResponse.entries || [])
      setStats(entriesResponse.stats || defaultStats)
      setSubordinates(teamResponse.subordinates || [])
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
  }, [token, filters.status, filters.userId, filters.startDate, filters.endDate])

  const pendingCount = useMemo(() => entries.filter((entry) => !entry.clockOut).length, [entries])

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

        <div className="mt-4 grid gap-2 md:grid-cols-4">
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

          <select
            value={filters.userId}
            onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value }))}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="">{t('All employees', 'Todos os colaboradores')}</option>
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
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
          />

          <input
            type="date"
            value={filters.endDate}
            onChange={(event) => setFilters((prev) => ({ ...prev, endDate: event.target.value }))}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
          />
        </div>

        <div className="mt-4 flex gap-2">
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

        <div className="mt-4 space-y-4">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-500">{t('No pending item for current filters.', 'Nenhuma pendencia no filtro atual.')}</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-sm font-semibold text-slate-900">{entry.user.name}</p>
                <p className="text-xs text-slate-500">{entry.user.email}</p>
                <p className="mt-2 text-xs text-slate-600">
                  {t('Clock-in:', 'Entrada:')} {new Date(entry.clockIn).toLocaleString(locale)}
                  {entry.clockOut
                    ? ` | ${t('Clock-out:', 'Saida:')} ${new Date(entry.clockOut).toLocaleString(locale)}`
                    : ` | ${t('Open', 'Em aberto')}`}
                </p>
                {entry.notes ? <p className="mt-1 text-xs text-slate-600">{t('Notes:', 'Notas:')} {entry.notes}</p> : null}

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

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => handleReview(entry.id, 'APPROVE')}
                    disabled={Boolean(actionLoadingByEntry[entry.id])}
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
                    disabled={Boolean(actionLoadingByEntry[entry.id])}
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
    </section>
  )
}

export default SupervisorPendingItemsPage
