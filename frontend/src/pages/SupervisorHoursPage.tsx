import { useEffect, useState } from 'react'
import { apiFetch, translateApiMessage } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { TIME_ZONE_OPTIONS } from '../lib/timezone'
import { useTranslation } from 'react-i18next'

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

const formatMinutesLabel = (minutes: number) => {
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const mins = absolute % 60
  const sign = minutes < 0 ? '-' : ''
  return `${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

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

const SupervisorHoursPage = () => {
  const { session, profile } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token
  const canPostBankPayments = profile?.role === 'ADMIN'

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teamWorkSettingsByUser, setTeamWorkSettingsByUser] = useState<Record<string, TeamWorkSettingsForm>>({})
  const [teamWorkSettingsLoadingByUser, setTeamWorkSettingsLoadingByUser] = useState<Record<string, boolean>>({})
  const [teamErrorByUser, setTeamErrorByUser] = useState<Record<string, string>>({})
  const [teamNoticeByUser, setTeamNoticeByUser] = useState<Record<string, string>>({})

  const [teamBankOverview, setTeamBankOverview] = useState<TeamBankHoursOverviewItem[]>([])
  const [teamBankLoading, setTeamBankLoading] = useState(false)
  const [teamBankPayLoadingByUser, setTeamBankPayLoadingByUser] = useState<Record<string, boolean>>({})
  const [teamBankNotice, setTeamBankNotice] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const hydrateTeamForm = (members: TeamMember[]) => {
    setTeamWorkSettingsByUser((prev) => {
      const next: Record<string, TeamWorkSettingsForm> = { ...prev }
      for (const member of members) {
        next[member.id] = {
          contractDailyHours: formatMinutesToHours(member.contractDailyMinutes),
          workdayStartTime: member.workdayStartTime || '',
          workdayEndTime: member.workdayEndTime || '',
          timeZone: member.timeZone || 'America/Chicago',
        }
      }
      return next
    })
  }

  const loadTeamMembers = async () => {
    if (!token) return

    const response = await apiFetch<{ team: TeamMember[] }>('/supervisor/team', { token })
    const team = response.team || []
    setTeamMembers(team)
    hydrateTeamForm(team)
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

  const loadData = async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      await Promise.all([loadTeamMembers(), loadTeamBankOverview()])
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Failed to load team-hours data.', 'Erro ao carregar dados de horas da equipe')
      )
      setTeamMembers([])
      setTeamBankOverview([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData().catch(() => undefined)
  }, [token])

  const handleUpdateTeamWorkSettings = async (userId: string) => {
    if (!token) return

    const current = teamWorkSettingsByUser[userId]
    if (!current) return

    setError('')
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
            [userId]: t(
              'Invalid workday. Use hh:mm format (e.g. 8:20).',
              'Jornada inválida. Use o formato hh:mm (ex.: 8:20).'
            ),
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
          [userId]: t(
            'Fill at least one workday field before saving.',
            'Preencha ao menos um campo de jornada para salvar.'
          ),
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
        [userId]: t(
          'Member workday updated successfully.',
          'Jornada do colaborador atualizada com sucesso.'
        ),
      }))

      await loadTeamMembers()
    } catch (err) {
      setTeamErrorByUser((prev) => ({
        ...prev,
        [userId]:
          err instanceof Error
            ? err.message
            : t('Failed to update member workday.', 'Erro ao atualizar jornada do colaborador'),
      }))
    } finally {
      setTeamWorkSettingsLoadingByUser((prev) => ({ ...prev, [userId]: false }))
    }
  }

  const handlePayTeamMemberPendingBankHours = async (userId: string) => {
    if (!token) return

    if (!canPostBankPayments) {
      setError(t('Only admins can post banked-hours payments.', 'Apenas admins podem dar baixa no banco de horas.'))
      return
    }

    setError('')
    setTeamBankNotice('')
    setTeamBankPayLoadingByUser((prev) => ({ ...prev, [userId]: true }))

    try {
      const response = await apiFetch<{ message: string }>(`/supervisor/team/${userId}/bank-hours/pay`, {
        token,
        method: 'PATCH',
        body: { payAllPending: true },
      })

      setTeamBankNotice(
        response.message
          ? translateApiMessage(response.message)
          : t('Payment posted successfully.', 'Baixa realizada com sucesso.')
      )
      await loadTeamBankOverview()
      await loadTeamMembers()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Failed to post banked-hours payment.', 'Erro ao dar baixa no banco de horas')
      )
    } finally {
      setTeamBankPayLoadingByUser((prev) => ({ ...prev, [userId]: false }))
    }
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Supervisor', 'Supervisor')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{t('Team hours', 'Horas da equipe')}</h2>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'Manage team workday and banked hours in a single panel.',
            'Gerencie jornada e banco de horas dos colaboradores em um único painel.'
          )}
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div>
      ) : null}

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">{t('Team workday', 'Jornada da equipe')}</h3>
          <button
            onClick={() => loadData().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
          >
            {t('Refresh', 'Atualizar')}
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          {t(
            'Define contracted workday, start/end time and team timezone.',
            'Defina jornada contratual, horário de início/fim e fuso da equipe.'
          )}
        </p>

        {loading && teamMembers.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t('Loading team...', 'Carregando equipe...')}</p>
        ) : null}

        <div className="mt-5 space-y-3">
          {teamMembers.length === 0 ? (
            <p className="text-sm text-slate-500">{t('No team members available.', 'Nenhum colaborador disponível.')}</p>
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
                            timeZone: 'America/Chicago',
                          }),
                          contractDailyHours: event.target.value,
                        },
                      }))
                    }
                    placeholder={t('Workday (hh:mm), e.g. 8:20', 'Jornada (hh:mm) ex: 8:20')}
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
                            timeZone: 'America/Chicago',
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
                            timeZone: 'America/Chicago',
                          }),
                          workdayEndTime: event.target.value,
                        },
                      }))
                    }
                    className="w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                  />

                  <select
                    value={teamWorkSettingsByUser[member.id]?.timeZone || 'America/Chicago'}
                    onChange={(event) =>
                      setTeamWorkSettingsByUser((prev) => ({
                        ...prev,
                        [member.id]: {
                          ...(prev[member.id] || {
                            contractDailyHours: '',
                            workdayStartTime: '',
                            workdayEndTime: '',
                            timeZone: 'America/Chicago',
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
                    {t('Save workday', 'Salvar jornada')}
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
          <h3 className="text-lg font-semibold text-slate-900">{t('Team banked hours', 'Banco de horas da equipe')}</h3>
          <button
            onClick={() => loadTeamBankOverview().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
          >
            {t('Refresh', 'Atualizar')}
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          {t(
            'Review credit, debt, pending balance and paid value per collaborator.',
            'Consulte crédito, devedor, saldo pendente e valor pago por colaborador.'
          )}
        </p>
        {teamBankNotice ? <p className="mt-2 text-xs text-emerald-600">{teamBankNotice}</p> : null}

        <div className="mt-4 space-y-2">
          {teamBankLoading ? (
            <p className="text-sm text-slate-500">{t('Loading banked hours...', 'Carregando banco de horas...')}</p>
          ) : null}
          {!teamBankLoading && teamBankOverview.length === 0 ? (
            <p className="text-sm text-slate-500">
              {t('No collaborators with banked-hours data.', 'Nenhum colaborador com dados de banco de horas.')}
            </p>
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
                  disabled={
                    !canPostBankPayments ||
                    Boolean(teamBankPayLoadingByUser[row.member.id]) ||
                    row.bankHours.pendingMinutes <= 0
                  }
                  className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {!canPostBankPayments
                    ? t('Admins only', 'Apenas admin')
                    : teamBankPayLoadingByUser[row.member.id]
                      ? t('Processing...', 'Processando...')
                      : t('Post pending amount', 'Dar baixa pendente')}
                </button>
              </div>

              <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-5">
                <span className="rounded-full bg-white px-3 py-1">
                  {t('Balance:', 'Saldo:')} {formatMinutesLabel(row.bankHours.balanceMinutes)}
                </span>
                <span className="rounded-full bg-white px-3 py-1">
                  {t('Credit:', 'Crédito:')} {formatMinutesLabel(row.bankHours.creditMinutes)}
                </span>
                <span className="rounded-full bg-white px-3 py-1">
                  {t('Debt:', 'Devedor:')} {formatMinutesLabel(row.bankHours.debtMinutes)}
                </span>
                <span className="rounded-full bg-white px-3 py-1">
                  {t('Pending:', 'Pendente:')} {formatMinutesLabel(row.bankHours.pendingMinutes)}
                </span>
                <span className="rounded-full bg-white px-3 py-1">
                  {t('Paid:', 'Pago:')} {formatMinutesLabel(row.bankHours.paidMinutes)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default SupervisorHoursPage
