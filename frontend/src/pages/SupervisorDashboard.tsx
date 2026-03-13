import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTimeZone } from '../context/TimezoneContext'
import {
  TIME_ZONE_OPTIONS,
  formatDateTimeWithTimeZone,
  formatDateWithTimeZone,
  formatTimeWithTimeZone,
} from '../lib/timezone'

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

type TeamMember = {
  id: string
  name: string
  email: string
  contractDailyMinutes?: number
  workdayStartTime?: string | null
  workdayEndTime?: string | null
  timeZone?: string
}

type TeamWorkSettingsForm = {
  contractDailyHours: string
  workdayStartTime: string
  workdayEndTime: string
  timeZone: string
}

type TeamBankHoursOverviewItem = {
  member: {
    id: string
    name: string
    email: string
    role: string
  }
  bankHours: {
    balanceMinutes: number
    creditMinutes: number
    debtMinutes: number
    pendingMinutes: number
    paidMinutes: number
  }
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

type EntryDetailState = {
  entry: Entry | null
}

const formatMinutesLabel = (minutes: number) => {
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const mins = absolute % 60
  const sign = minutes < 0 ? '-' : ''
  return `${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

const SupervisorDashboard = () => {
  const { session } = useAuth()
  const { viewTimeZone } = useTimeZone()
  const token = session?.access_token
  const [entries, setEntries] = useState<Entry[]>([])
  const [subordinates, setSubordinates] = useState<Subordinate[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [stats, setStats] = useState<Stats>({ PENDING: 0, APPROVED: 0, REJECTED: 0 })
  const [notice, setNotice] = useState('')
  const [teamWorkSettingsByUser, setTeamWorkSettingsByUser] = useState<Record<string, TeamWorkSettingsForm>>({})
  const [teamWorkSettingsLoadingByUser, setTeamWorkSettingsLoadingByUser] = useState<Record<string, boolean>>({})
  const [teamBankOverview, setTeamBankOverview] = useState<TeamBankHoursOverviewItem[]>([])
  const [teamBankLoading, setTeamBankLoading] = useState(false)
  const [teamBankPayLoadingByUser, setTeamBankPayLoadingByUser] = useState<Record<string, boolean>>({})
  const [teamBankNotice, setTeamBankNotice] = useState('')
  const [teamErrorByUser, setTeamErrorByUser] = useState<Record<string, string>>({})
  const [teamNoticeByUser, setTeamNoticeByUser] = useState<Record<string, string>>({})
  const [filters, setFilters] = useState({
    status: 'PENDING',
    userId: '',
    startDate: '',
    endDate: '',
  })
  const [entryDetail, setEntryDetail] = useState<EntryDetailState>({ entry: null })
  const [review, setReview] = useState<ReviewState>({ entry: null, action: 'APPROVE', comment: '' })
  const [error, setError] = useState('')

  const defaultStats: Stats = { PENDING: 0, APPROVED: 0, REJECTED: 0 }

  const formatMinutesToHours = (minutes?: number) => {
    if (!minutes || minutes <= 0) return ''
    const hours = Math.floor(minutes / 60)
    const mins = Math.max(0, minutes % 60)
    return `${hours}:${String(mins).padStart(2, '0')}`
  }

  const parseHoursToMinutes = (value: string) => {
    const normalized = value.trim()
    if (!normalized) return null

    const match = normalized.match(/^(\d{1,2}):(\d{2})$/)
    if (!match) return null

    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
    if (minutes < 0 || minutes > 59) return null

    const total = hours * 60 + minutes
    if (total < 60 || total > 1440) return null
    return total
  }

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

  const loadTeamMembers = async () => {
    if (!token) return

    const response = await apiFetch<{ team: TeamMember[] }>('/supervisor/team', { token })
    setTeamMembers(response.team || [])
    setTeamWorkSettingsByUser((prev) => {
      const next: Record<string, TeamWorkSettingsForm> = { ...prev }
      for (const member of response.team || []) {
        next[member.id] = {
          contractDailyHours: formatMinutesToHours(member.contractDailyMinutes),
          workdayStartTime: member.workdayStartTime || '',
          workdayEndTime: member.workdayEndTime || '',
          timeZone: member.timeZone || 'America/New_York',
        }
      }
      return next
    })
  }

  const loadTeamBankOverview = async () => {
    if (!token) return
    setTeamBankLoading(true)
    try {
      const response = await apiFetch<{ overview: TeamBankHoursOverviewItem[] }>(
        '/supervisor/team/bank-hours/overview',
        { token }
      )
      setTeamBankOverview(response.overview || [])
    } finally {
      setTeamBankLoading(false)
    }
  }

  useEffect(() => {
    loadEntries().catch((err) => {
      setError(err instanceof Error ? err.message : 'Erro ao carregar pendencias')
      setEntries([])
      setSubordinates([])
      setStats(defaultStats)
    })
  }, [token, filters.status, filters.userId, filters.startDate, filters.endDate])

  useEffect(() => {
    loadTeamMembers().catch((err) => {
      setError(err instanceof Error ? err.message : 'Erro ao carregar equipe')
      setTeamMembers([])
    })
  }, [token])

  useEffect(() => {
    loadTeamBankOverview().catch(() => undefined)
  }, [token])

  const openReview = (entry: Entry, action: ReviewState['action']) => {
    setReview({ entry, action, comment: '' })
  }

  const openEntryDetail = (entry: Entry) => {
    setEntryDetail({ entry })
  }

  const closeEntryDetail = () => {
    setEntryDetail({ entry: null })
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

  const handleUpdateTeamWorkSettings = async (userId: string) => {
    if (!token) return

    const current = teamWorkSettingsByUser[userId]
    if (!current) return

    setError('')
    setNotice('')
    setTeamErrorByUser((prev) => ({ ...prev, [userId]: '' }))
    setTeamNoticeByUser((prev) => ({ ...prev, [userId]: '' }))
    setTeamWorkSettingsLoadingByUser((prev) => ({ ...prev, [userId]: true }))

    try {
      const body: Record<string, unknown> = {}

      if (current.contractDailyHours.trim() !== '') {
        const parsedMinutes = parseHoursToMinutes(current.contractDailyHours)
        if (parsedMinutes === null) {
          setTeamErrorByUser((prev) => ({
            ...prev,
            [userId]: 'Jornada inválida. Use o formato hh:mm (ex.: 8:20).',
          }))
          return
        }
        body.contractDailyMinutes = parsedMinutes
      }
      if (current.workdayStartTime.trim() !== '') {
        body.workdayStartTime = current.workdayStartTime.trim()
      }
      if (current.workdayEndTime.trim() !== '') {
        body.workdayEndTime = current.workdayEndTime.trim()
      }
      if (current.timeZone.trim() !== '') {
        body.timeZone = current.timeZone.trim()
      }

      if (Object.keys(body).length === 0) {
        setTeamErrorByUser((prev) => ({
          ...prev,
          [userId]: 'Preencha ao menos um campo de jornada para salvar.',
        }))
        return
      }

      await apiFetch(`/supervisor/team/${userId}/work-settings`, {
        token,
        method: 'PATCH',
        body,
      })

      setTeamNoticeByUser((prev) => ({
        ...prev,
        [userId]: 'Jornada do colaborador atualizada com sucesso.',
      }))
      await loadTeamMembers()
    } catch (err) {
      setTeamErrorByUser((prev) => ({
        ...prev,
        [userId]: err instanceof Error ? err.message : 'Erro ao atualizar jornada do colaborador',
      }))
    } finally {
      setTeamWorkSettingsLoadingByUser((prev) => ({ ...prev, [userId]: false }))
    }
  }

  const handlePayTeamMemberPendingBankHours = async (userId: string) => {
    if (!token) return

    setError('')
    setNotice('')
    setTeamBankNotice('')
    setTeamBankPayLoadingByUser((prev) => ({ ...prev, [userId]: true }))

    try {
      const response = await apiFetch<{ message: string }>(`/supervisor/team/${userId}/bank-hours/pay`, {
        token,
        method: 'PATCH',
        body: { payAllPending: true },
      })
      setTeamBankNotice(response.message || 'Baixa realizada com sucesso.')
      await loadTeamBankOverview()
      await loadTeamMembers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao dar baixa no banco de horas')
    } finally {
      setTeamBankPayLoadingByUser((prev) => ({ ...prev, [userId]: false }))
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
        {notice ? <p className="mt-4 text-xs text-emerald-600">{notice}</p> : null}

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
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                onClick={() => openEntryDetail(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openEntryDetail(entry)
                  }
                }}
                className="cursor-pointer rounded-2xl border border-slate-100 bg-slate-50/70 p-4 transition hover:border-teal-200"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{entry.user.name}</p>
                    <p className="text-xs text-slate-500">{entry.user.email}</p>
                  </div>
                  <div className="text-xs text-slate-600">
                    {formatDateWithTimeZone(entry.clockIn, viewTimeZone)} •{' '}
                    {formatTimeWithTimeZone(entry.clockIn, viewTimeZone)} -{' '}
                    {entry.clockOut ? formatTimeWithTimeZone(entry.clockOut, viewTimeZone) : 'Em aberto'}
                  </div>
                </div>
                {entry.notes ? <p className="mt-2 text-xs text-slate-600">Notas: {entry.notes}</p> : null}
                <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-teal-700">Clique para abrir em tela maior</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    onClick={(event) => {
                      event.stopPropagation()
                      openReview(entry, 'APPROVE')
                    }}
                    className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white"
                  >
                    Aprovar
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation()
                      openReview(entry, 'REQUEST_EDIT')
                    }}
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

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Jornada da equipe</h3>
        <p className="mt-2 text-xs text-slate-500">
          Defina a jornada contratual e horários esperados dos colaboradores.
        </p>
        <div className="mt-5 space-y-3">
          {teamMembers.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum colaborador disponível.</p>
          ) : (
            teamMembers.map((member) => (
              <div key={member.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{member.name}</p>
                  <p className="text-xs text-slate-500">{member.email}</p>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-5 md:items-center">
                  <input
                    type="text"
                    value={teamWorkSettingsByUser[member.id]?.contractDailyHours || ''}
                    onChange={(event) =>
                      setTeamWorkSettingsByUser((prev) => ({
                        ...prev,
                        [member.id]: {
                          ...(prev[member.id] || {
                            contractDailyHours: '',
                            workdayStartTime: '',
                            workdayEndTime: '',
                            timeZone: 'America/New_York',
                          }),
                          contractDailyHours: event.target.value,
                        },
                      }))
                    }
                    placeholder="Jornada (hh:mm) ex: 8:20"
                    className="w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                  />
                  <input
                    type="time"
                    value={teamWorkSettingsByUser[member.id]?.workdayStartTime || ''}
                    onChange={(event) =>
                      setTeamWorkSettingsByUser((prev) => ({
                        ...prev,
                        [member.id]: {
                          ...(prev[member.id] || {
                            contractDailyHours: '',
                            workdayStartTime: '',
                            workdayEndTime: '',
                            timeZone: 'America/New_York',
                          }),
                          workdayStartTime: event.target.value,
                        },
                      }))
                    }
                    className="w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                  />
                  <input
                    type="time"
                    value={teamWorkSettingsByUser[member.id]?.workdayEndTime || ''}
                    onChange={(event) =>
                      setTeamWorkSettingsByUser((prev) => ({
                        ...prev,
                        [member.id]: {
                          ...(prev[member.id] || {
                            contractDailyHours: '',
                            workdayStartTime: '',
                            workdayEndTime: '',
                            timeZone: 'America/New_York',
                          }),
                          workdayEndTime: event.target.value,
                        },
                      }))
                    }
                    className="w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                  />
                  <select
                    value={teamWorkSettingsByUser[member.id]?.timeZone || 'America/New_York'}
                    onChange={(event) =>
                      setTeamWorkSettingsByUser((prev) => ({
                        ...prev,
                        [member.id]: {
                          ...(prev[member.id] || {
                            contractDailyHours: '',
                            workdayStartTime: '',
                            workdayEndTime: '',
                            timeZone: 'America/New_York',
                          }),
                          timeZone: event.target.value,
                        },
                      }))
                    }
                    className="w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                  >
                    {TIME_ZONE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleUpdateTeamWorkSettings(member.id)}
                    disabled={Boolean(teamWorkSettingsLoadingByUser[member.id])}
                    className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Salvar jornada
                  </button>
                </div>
                {teamErrorByUser[member.id] ? (
                  <p className="mt-2 text-xs text-rose-600">{teamErrorByUser[member.id]}</p>
                ) : null}
                {teamNoticeByUser[member.id] ? (
                  <p className="mt-2 text-xs text-emerald-600">{teamNoticeByUser[member.id]}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">Banco de horas da equipe</h3>
          <button
            onClick={() => loadTeamBankOverview().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
          >
            Atualizar
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Consulte credito, saldo devedor, pendente e pago. Use baixa para liquidar pendencias.
        </p>
        {teamBankNotice ? <p className="mt-2 text-xs text-emerald-600">{teamBankNotice}</p> : null}

        <div className="mt-4 space-y-2">
          {teamBankLoading ? <p className="text-sm text-slate-500">Carregando banco de horas...</p> : null}
          {!teamBankLoading && teamBankOverview.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum colaborador com dados de banco de horas.</p>
          ) : null}
          {teamBankOverview.map((row) => (
            <div key={row.member.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{row.member.name}</p>
                  <p className="text-xs text-slate-500">{row.member.email}</p>
                </div>
                <button
                  onClick={() => handlePayTeamMemberPendingBankHours(row.member.id)}
                  disabled={Boolean(teamBankPayLoadingByUser[row.member.id]) || row.bankHours.pendingMinutes <= 0}
                  className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {teamBankPayLoadingByUser[row.member.id] ? 'Processando...' : 'Dar baixa pendente'}
                </button>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
                <span className="rounded-full bg-white px-3 py-1">
                  Credito: {formatMinutesLabel(row.bankHours.creditMinutes)}
                </span>
                <span className="rounded-full bg-white px-3 py-1">
                  Devedor: {formatMinutesLabel(row.bankHours.debtMinutes)}
                </span>
                <span className="rounded-full bg-white px-3 py-1">
                  Pendente: {formatMinutesLabel(row.bankHours.pendingMinutes)}
                </span>
                <span className="rounded-full bg-white px-3 py-1">
                  Pago: {formatMinutesLabel(row.bankHours.paidMinutes)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {entryDetail.entry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-6">
          <div className="w-full max-w-3xl rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-lg font-semibold text-slate-900">Detalhes do registro</h4>
              <button
                onClick={closeEntryDetail}
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600"
              >
                Fechar
              </button>
            </div>

            <div className="mt-4 grid gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-sm text-slate-700 md:grid-cols-2">
              <p>
                <span className="font-semibold text-slate-900">Colaborador:</span> {entryDetail.entry.user.name}
              </p>
              <p>
                <span className="font-semibold text-slate-900">E-mail:</span> {entryDetail.entry.user.email}
              </p>
              <p>
                <span className="font-semibold text-slate-900">Data:</span>{' '}
                {formatDateWithTimeZone(entryDetail.entry.clockIn, viewTimeZone)}
              </p>
              <p>
                <span className="font-semibold text-slate-900">Intervalo:</span>{' '}
                {formatTimeWithTimeZone(entryDetail.entry.clockIn, viewTimeZone)} -{' '}
                {entryDetail.entry.clockOut
                  ? formatTimeWithTimeZone(entryDetail.entry.clockOut, viewTimeZone)
                  : 'Em aberto'}
              </p>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Notas</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                {entryDetail.entry.notes?.trim() || 'Sem notas no registro.'}
              </p>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => {
                  closeEntryDetail()
                  openReview(entryDetail.entry as Entry, 'APPROVE')
                }}
                className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white"
              >
                Aprovar este registro
              </button>
              <button
                onClick={() => {
                  closeEntryDetail()
                  openReview(entryDetail.entry as Entry, 'REQUEST_EDIT')
                }}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Solicitar ajuste
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {review.entry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-6">
          <div className="w-full max-w-lg rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
            <h4 className="text-lg font-semibold text-slate-900">Revisar jornada</h4>
            <p className="mt-2 text-xs text-slate-500">
              {review.entry.user.name} • {formatDateTimeWithTimeZone(review.entry.clockIn, viewTimeZone)}
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
