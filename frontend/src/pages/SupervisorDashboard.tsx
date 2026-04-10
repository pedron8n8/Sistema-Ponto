import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTimeZone } from '../context/TimezoneContext'
import { useTranslation } from 'react-i18next'
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import {
  TIME_ZONE_OPTIONS,
  formatDateTimeWithTimeZone,
  formatDateWithTimeZone,
  formatTimeWithTimeZone,
} from '../lib/timezone'

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

type PresenceStatus = 'PRESENT' | 'ABSENT' | 'ON_BREAK' | 'OVERTIME_ACTIVE'

type PresenceMember = {
  member: {
    id: string
    name: string
    email: string
    role: string
  }
  status: PresenceStatus
  since: string | null
  metadata: {
    branch: string
    department: string
    team: string
  }
  lastLocation?: {
    lat: number
    lng: number
    source: 'CLOCK_IN' | 'CLOCK_OUT' | 'LEGACY'
    recordedAt: string
    updatedAt: string
    timeEntryId: string
  } | null
}

type PresenceSnapshot = {
  generatedAt: string
  summary: {
    total: number
    present: number
    absent: number
    onBreak: number
    overtimeActive: number
  }
  filters: {
    branch: string[]
    department: string[]
    team: string[]
  }
  overtimeAlerts?: Array<{
    type: string
    thresholdPercent: number
    thresholdMinutes: number
    overtimeMinutes: number
    overtimeLimitMinutes: number
    dateKey: string
    triggeredAt: string
    channels: string[]
    member: {
      id: string
      name: string
      email: string
    }
  }>
  members: PresenceMember[]
}

type OvertimeAlert = {
  id: string
  memberId: string
  memberName: string
  memberEmail: string
  triggeredAt: string
}

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

const formatShortDuration = (minutes: number) => {
  const safeMinutes = Math.max(0, minutes)
  const hours = Math.floor(safeMinutes / 60)
  const mins = safeMinutes % 60
  return `${hours}h ${String(mins).padStart(2, '0')}m`
}

const getElapsedMinutes = (sinceIso: string, nowMs: number) => {
  const since = new Date(sinceIso).getTime()
  if (!Number.isFinite(since)) return 0
  return Math.max(0, Math.floor((nowMs - since) / 60000))
}

const getTodayBucket = (nowMs: number) => {
  const now = new Date(nowMs)
  const day = String(now.getDate()).padStart(2, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}`
}

const presenceStatusLabel: Record<PresenceStatus, string> = {
  PRESENT: 'Presente',
  ABSENT: 'Ausente',
  ON_BREAK: 'Em intervalo',
  OVERTIME_ACTIVE: 'HE ativa',
}

const presenceStatusClass: Record<PresenceStatus, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-800',
  ABSENT: 'bg-slate-200 text-slate-700',
  ON_BREAK: 'bg-amber-100 text-amber-800',
  OVERTIME_ACTIVE: 'bg-rose-100 text-rose-700',
}

const SupervisorDashboard = () => {
  const { session } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
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
  const [presenceSnapshot, setPresenceSnapshot] = useState<PresenceSnapshot | null>(null)
  const [presenceConnected, setPresenceConnected] = useState(false)
  const [presenceError, setPresenceError] = useState('')
  const [overtimeAlerts, setOvertimeAlerts] = useState<OvertimeAlert[]>([])
  const [presenceFilters, setPresenceFilters] = useState({
    branch: '',
    department: '',
    team: '',
  })
  const [hoursKpi, setHoursKpi] = useState<HoursKpiResponse | null>(null)
  const [hoursKpiPeriod, setHoursKpiPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [hoursKpiLoading, setHoursKpiLoading] = useState(false)
  const [hoursKpiError, setHoursKpiError] = useState('')
  const [nowMs, setNowMs] = useState(Date.now())
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
  const previousPresenceByUserRef = useRef<Record<string, PresenceStatus>>({})
  const presenceBaselineReadyRef = useRef(false)

  const openMinutesByUser = useMemo(() => {
    const minutesByUser: Record<string, number> = {}

    for (const member of presenceSnapshot?.members || []) {
      if (!member.since) continue
      if (member.status !== 'PRESENT' && member.status !== 'OVERTIME_ACTIVE') continue
      minutesByUser[member.member.id] = getElapsedMinutes(member.since, nowMs)
    }

    return minutesByUser
  }, [presenceSnapshot, nowMs])

  const openMinutesTotal = useMemo(
    () => Object.values(openMinutesByUser).reduce((acc, value) => acc + value, 0),
    [openMinutesByUser]
  )

  const membersWithLocation = useMemo(
    () =>
      (presenceSnapshot?.members || []).filter(
        (row) =>
          row.lastLocation &&
          Number.isFinite(Number(row.lastLocation.lat)) &&
          Number.isFinite(Number(row.lastLocation.lng))
      ),
    [presenceSnapshot]
  )

  const mapCenter: [number, number] = useMemo(() => {
    if (membersWithLocation.length === 0) return [-23.55052, -46.63331]

    const { latSum, lngSum } = membersWithLocation.reduce(
      (acc, row) => ({
        latSum: acc.latSum + Number(row.lastLocation?.lat || 0),
        lngSum: acc.lngSum + Number(row.lastLocation?.lng || 0),
      }),
      { latSum: 0, lngSum: 0 }
    )

    return [latSum / membersWithLocation.length, lngSum / membersWithLocation.length]
  }, [membersWithLocation])

  const hoursKpiWithOpen = useMemo(() => {
    if (!hoursKpi) return null

    const byCollaborator = hoursKpi.byCollaborator.map((item) => {
      const openMinutes = openMinutesByUser[item.member.id] || 0
      return {
        ...item,
        workedMinutes: item.workedMinutes + openMinutes,
        openMinutes,
      }
    })

    const timeline = hoursKpi.timeline.map((item) => ({ ...item }))
    const todayBucket = getTodayBucket(nowMs)
    const currentDayIndex = timeline.findIndex((item) => item.date === todayBucket)
    if (currentDayIndex >= 0 && openMinutesTotal > 0) {
      timeline[currentDayIndex] = {
        ...timeline[currentDayIndex],
        workedMinutes: timeline[currentDayIndex].workedMinutes + openMinutesTotal,
      }
    }

    return {
      ...hoursKpi,
      summary: {
        ...hoursKpi.summary,
        workedMinutes: hoursKpi.summary.workedMinutes + openMinutesTotal,
      },
      byCollaborator,
      timeline,
    }
  }, [hoursKpi, openMinutesByUser, openMinutesTotal, nowMs])

  const kpiChartMax = useMemo(() => {
    if (!hoursKpiWithOpen?.timeline?.length) return 1
    return Math.max(
      ...hoursKpiWithOpen.timeline.map((item) =>
        Math.max(item.expectedMinutes, item.workedMinutes, item.overtimeMinutes)
      ),
      1
    )
  }, [hoursKpiWithOpen])

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

  const loadHoursKpi = async () => {
    if (!token) return
    setHoursKpiLoading(true)
    setHoursKpiError('')

    try {
      const query = new URLSearchParams({
        period: hoursKpiPeriod,
        ...(presenceFilters.branch ? { branch: presenceFilters.branch } : {}),
        ...(presenceFilters.department ? { department: presenceFilters.department } : {}),
        ...(presenceFilters.team ? { team: presenceFilters.team } : {}),
      })

      const response = await apiFetch<HoursKpiResponse>(`/supervisor/kpis/hours?${query.toString()}`, {
        token,
      })
      setHoursKpi(response)
    } catch (err) {
      setHoursKpiError(err instanceof Error ? err.message : 'Erro ao carregar KPIs de horas')
      setHoursKpi(null)
    } finally {
      setHoursKpiLoading(false)
    }
  }

  const loadPresenceSnapshot = async () => {
    if (!token) return

    const query = new URLSearchParams({
      ...(presenceFilters.branch ? { branch: presenceFilters.branch } : {}),
      ...(presenceFilters.department ? { department: presenceFilters.department } : {}),
      ...(presenceFilters.team ? { team: presenceFilters.team } : {}),
    })

    const payload = await apiFetch<PresenceSnapshot>(`/supervisor/presence?${query.toString()}`, {
      token,
    })
    setPresenceSnapshot(payload)
  }

  const connectPresenceStream = async (abortSignal: AbortSignal) => {
    if (!token) return

    while (!abortSignal.aborted) {
      try {
        const query = new URLSearchParams({
          ...(presenceFilters.branch ? { branch: presenceFilters.branch } : {}),
          ...(presenceFilters.department ? { department: presenceFilters.department } : {}),
          ...(presenceFilters.team ? { team: presenceFilters.team } : {}),
        })

        const response = await fetch(`${API_BASE}/supervisor/presence/stream?${query.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
          signal: abortSignal,
        })

        if (!response.ok || !response.body) {
          throw new Error('Falha ao conectar stream de presença')
        }

        setPresenceConnected(true)
        setPresenceError('')

        const reader = response.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let pendingChunk = ''

        while (!abortSignal.aborted) {
          const { value, done } = await reader.read()
          if (done) {
            setPresenceConnected(false)
            break
          }

          pendingChunk += decoder.decode(value, { stream: true })
          const events = pendingChunk.split(/\r?\n\r?\n/)
          pendingChunk = events.pop() || ''

          for (const rawEvent of events) {
            const lines = rawEvent.split(/\r?\n/)
            let eventName = 'message'
            const dataLines: string[] = []

            for (const line of lines) {
              if (line.startsWith('event:')) {
                eventName = line.slice(6).trim()
              }
              if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim())
              }
            }

            if (eventName === 'presence' && dataLines.length > 0) {
              const payload = JSON.parse(dataLines.join('\n')) as PresenceSnapshot
              setPresenceSnapshot(payload)
              setPresenceError('')
            }

            if (eventName === 'error' && dataLines.length > 0) {
              const payload = JSON.parse(dataLines.join('\n')) as { message?: string }
              setPresenceError(payload.message || 'Erro no stream de presença')
            }
          }
        }
      } catch (err) {
        if (abortSignal.aborted) return
        setPresenceConnected(false)
        setPresenceError(err instanceof Error ? err.message : 'Erro ao conectar presença em tempo real')
      }

      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }

  useEffect(() => {
    loadEntries().catch((err) => {
      setError(err instanceof Error ? err.message : t('Failed to load pending items', 'Erro ao carregar pendencias'))
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

  useEffect(() => {
    loadHoursKpi().catch(() => undefined)
  }, [token, hoursKpiPeriod, presenceFilters.branch, presenceFilters.department, presenceFilters.team])

  useEffect(() => {
    if (!token) return

    const abortController = new AbortController()

    loadPresenceSnapshot().catch(() => undefined)

    const fallbackInterval = setInterval(() => {
      loadPresenceSnapshot().catch(() => undefined)
    }, 12000)

    connectPresenceStream(abortController.signal).catch(() => undefined)

    return () => {
      abortController.abort()
      clearInterval(fallbackInterval)
      setPresenceConnected(false)
    }
  }, [token, presenceFilters.branch, presenceFilters.department, presenceFilters.team])

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowMs(Date.now())
    }, 30000)

    return () => clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!presenceSnapshot) return

    const currentStatuses = (presenceSnapshot.members || []).reduce<Record<string, PresenceStatus>>(
      (acc, row) => {
        acc[row.member.id] = row.status
        return acc
      },
      {}
    )

    if (!presenceBaselineReadyRef.current) {
      previousPresenceByUserRef.current = currentStatuses
      presenceBaselineReadyRef.current = true
      return
    }

    const previousStatuses = previousPresenceByUserRef.current
    const enteredOvertime = (presenceSnapshot.members || []).filter((row) => {
      const previousStatus = previousStatuses[row.member.id]
      return previousStatus && previousStatus !== 'OVERTIME_ACTIVE' && row.status === 'OVERTIME_ACTIVE'
    })

    if (enteredOvertime.length > 0) {
      setOvertimeAlerts((prev) => {
        const next = [...prev]

        for (const row of enteredOvertime) {
          next.unshift({
            id: `${row.member.id}-${presenceSnapshot.generatedAt}`,
            memberId: row.member.id,
            memberName: row.member.name,
            memberEmail: row.member.email,
            triggeredAt: presenceSnapshot.generatedAt,
          })
        }

        const deduplicated = next.filter(
          (item, index, arr) => arr.findIndex((x) => x.id === item.id) === index
        )

        return deduplicated.slice(0, 6)
      })
    }

    previousPresenceByUserRef.current = currentStatuses
  }, [presenceSnapshot])

  useEffect(() => {
    previousPresenceByUserRef.current = {}
    presenceBaselineReadyRef.current = false
    setOvertimeAlerts([])
  }, [presenceFilters.branch, presenceFilters.department, presenceFilters.team])

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
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{t('Pending approvals in one panel.', 'Aprovacoes pendentes em um painel.')}</h2>
        <p className="mt-4 text-sm text-slate-600">
          {t('Review team work logs and register comments without leaving the flow.', 'Revise as jornadas da equipe e registre comentarios sem sair do fluxo.')}
        </p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">Presença em tempo real</h3>
          <span
            className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${
              presenceConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            {presenceConnected ? 'Online' : 'Reconectando'}
          </span>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Atualizacao continua via SSE sem recarregar a pagina.
        </p>
        {presenceError ? <p className="mt-2 text-xs text-rose-600">{presenceError}</p> : null}

        {(presenceSnapshot?.overtimeAlerts || []).length > 0 ? (
          <div className="mt-3 space-y-2">
            {(presenceSnapshot?.overtimeAlerts || []).map((alert) => (
              <div
                key={`${alert.member.id}-${alert.triggeredAt}`}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                <p>
                  <span className="font-semibold">Alerta proativo HE:</span> {alert.member.name} atingiu {alert.overtimeMinutes}min de HE no dia ({alert.thresholdPercent}% do limite de {alert.overtimeLimitMinutes}min).
                </p>
                <p className="mt-1 text-[11px] text-amber-800">
                  Disparado às {formatDateTimeWithTimeZone(alert.triggeredAt, viewTimeZone)} via {alert.channels.join(', ')}.
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {overtimeAlerts.length > 0 ? (
          <div className="mt-3 space-y-2">
            {overtimeAlerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
              >
                <p>
                  <span className="font-semibold">Hora extra ativa:</span> {alert.memberName} ({alert.memberEmail}) desde{' '}
                  {formatTimeWithTimeZone(alert.triggeredAt, viewTimeZone)}.
                </p>
                <button
                  onClick={() =>
                    setOvertimeAlerts((prev) => prev.filter((currentAlert) => currentAlert.id !== alert.id))
                  }
                  className="rounded-full border border-rose-300 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-rose-700"
                >
                  Fechar
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-4 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
          <select
            value={presenceFilters.branch}
            onChange={(event) =>
              setPresenceFilters((prev) => ({
                ...prev,
                branch: event.target.value,
              }))
            }
            className="rounded-full border border-slate-200 bg-white px-3 py-2"
          >
            <option value="">Todas as filiais</option>
            {(presenceSnapshot?.filters.branch || []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={presenceFilters.department}
            onChange={(event) =>
              setPresenceFilters((prev) => ({
                ...prev,
                department: event.target.value,
              }))
            }
            className="rounded-full border border-slate-200 bg-white px-3 py-2"
          >
            <option value="">Todos os departamentos</option>
            {(presenceSnapshot?.filters.department || []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={presenceFilters.team}
            onChange={(event) =>
              setPresenceFilters((prev) => ({
                ...prev,
                team: event.target.value,
              }))
            }
            className="rounded-full border border-slate-200 bg-white px-3 py-2"
          >
            <option value="">Todas as equipes</option>
            {(presenceSnapshot?.filters.team || []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 grid gap-2 text-xs text-slate-600 md:grid-cols-4">
          <span className="rounded-full bg-slate-100 px-3 py-1">Total {presenceSnapshot?.summary.total || 0}</span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
            Presentes {presenceSnapshot?.summary.present || 0}
          </span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
            Em intervalo {presenceSnapshot?.summary.onBreak || 0}
          </span>
          <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-700">
            HE ativa {presenceSnapshot?.summary.overtimeActive || 0}
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(presenceSnapshot?.members || []).map((row) => (
            <div key={row.member.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{row.member.name}</p>
                  <p className="text-xs text-slate-500">{row.member.email}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-[11px] ${presenceStatusClass[row.status]}`}>
                  {presenceStatusLabel[row.status]}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                <span className="rounded-full bg-white px-2 py-1">Filial: {row.metadata.branch}</span>
                <span className="rounded-full bg-white px-2 py-1">Equipe: {row.metadata.team}</span>
              </div>
              {row.since ? (
                <p className="mt-2 text-[11px] text-slate-500">
                  Desde {formatDateTimeWithTimeZone(row.since, viewTimeZone)}
                </p>
              ) : null}
              {row.lastLocation ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  Última posição: {row.lastLocation.lat.toFixed(5)}, {row.lastLocation.lng.toFixed(5)} ({row.lastLocation.source})
                </p>
              ) : null}
            </div>
          ))}
          {presenceSnapshot && presenceSnapshot.members.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum colaborador para os filtros atuais.</p>
          ) : null}
        </div>

        <div className="mt-5 rounded-2xl border border-slate-100 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-800">Mapa de colaboradores (última localização)</h4>
            <span className="text-[11px] text-slate-500">{membersWithLocation.length} com posição</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-100">
            <MapContainer center={mapCenter} zoom={11} style={{ height: '280px', width: '100%' }}>
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {membersWithLocation.map((row) => (
                <CircleMarker
                  key={`map-${row.member.id}`}
                  center={[Number(row.lastLocation?.lat), Number(row.lastLocation?.lng)]}
                  radius={7}
                  pathOptions={{ color: '#0f766e', fillColor: '#14b8a6', fillOpacity: 0.9 }}
                >
                  <Popup>
                    <div className="text-xs">
                      <p className="font-semibold">{row.member.name}</p>
                      <p>{row.member.email}</p>
                      <p>Status: {presenceStatusLabel[row.status]}</p>
                      <p>
                        Atualizado:{' '}
                        {formatDateTimeWithTimeZone(
                          row.lastLocation?.updatedAt || row.lastLocation?.recordedAt || new Date(),
                          viewTimeZone
                        )}
                      </p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          {membersWithLocation.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Nenhuma posição disponível para os filtros atuais.</p>
          ) : null}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">KPIs de horas</h3>
          <select
            value={hoursKpiPeriod}
            onChange={(event) =>
              setHoursKpiPeriod(event.target.value as 'daily' | 'weekly' | 'monthly')
            }
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
          >
            <option value="daily">Diario</option>
            <option value="weekly">Semanal</option>
            <option value="monthly">Mensal</option>
          </select>
        </div>

        <div className="mt-4 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
          <span className="rounded-full bg-slate-100 px-3 py-1">
            Previsto {formatShortDuration(hoursKpiWithOpen?.summary.expectedMinutes || 0)}
          </span>
          <span className="rounded-full bg-teal-100 px-3 py-1 text-teal-800">
            Realizado {formatShortDuration(hoursKpiWithOpen?.summary.workedMinutes || 0)}
          </span>
          <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-700">
            Extras {formatShortDuration(hoursKpiWithOpen?.summary.overtimeMinutes || 0)}
          </span>
        </div>

        {hoursKpiError ? <p className="mt-2 text-xs text-rose-600">{hoursKpiError}</p> : null}
        {hoursKpiLoading ? <p className="mt-3 text-sm text-slate-500">Carregando KPIs...</p> : null}

        {!hoursKpiLoading && hoursKpiWithOpen?.timeline?.length ? (
          <div className="mt-4 grid gap-3">
            {hoursKpiWithOpen.timeline.map((bucket) => {
              const expectedWidth = `${Math.max((bucket.expectedMinutes / kpiChartMax) * 100, 6)}%`
              const workedWidth = `${Math.max((bucket.workedMinutes / kpiChartMax) * 100, 6)}%`
              const overtimeWidth = `${Math.max((bucket.overtimeMinutes / kpiChartMax) * 100, 6)}%`

              return (
                <div key={bucket.date} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
                    <span>{bucket.date}</span>
                    <span>
                      {formatShortDuration(bucket.workedMinutes)} / {formatShortDuration(bucket.expectedMinutes)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-slate-400" style={{ width: expectedWidth }} />
                    </div>
                    <div className="h-2 rounded-full bg-teal-100">
                      <div className="h-2 rounded-full bg-teal-600" style={{ width: workedWidth }} />
                    </div>
                    <div className="h-2 rounded-full bg-rose-100">
                      <div className="h-2 rounded-full bg-rose-500" style={{ width: overtimeWidth }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}

        {!hoursKpiLoading && hoursKpiWithOpen?.byCollaborator?.length ? (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {hoursKpiWithOpen.byCollaborator.map((item) => (
              <div key={item.member.id} className="rounded-2xl border border-slate-100 bg-white p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">{item.member.name}</p>
                <p className="mt-1 text-slate-500">{item.member.email}</p>
                <p className="mt-2">Previsto: {formatShortDuration(item.expectedMinutes)}</p>
                <p>Realizado: {formatShortDuration(item.workedMinutes)}</p>
                <p>Extras: {formatShortDuration(item.overtimeMinutes)}</p>
                {'openMinutes' in item && Number(item.openMinutes || 0) > 0 ? (
                  <p className="text-teal-700">Em aberto agora: {formatShortDuration(Number(item.openMinutes || 0))}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">Férias da equipe</h3>
          <button
            onClick={() => {
              loadVacationRequests().catch(() => undefined)
              loadVacationCalendar().catch(() => undefined)
            }}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
          >
            Atualizar
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <input
            type="number"
            min={2000}
            value={vacationCalendarMonth.year}
            onChange={(event) =>
              setVacationCalendarMonth((prev) => ({
                ...prev,
                year: Number(event.target.value) || prev.year,
              }))
            }
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
            placeholder="Ano"
          />
          <input
            type="number"
            min={1}
            max={12}
            value={vacationCalendarMonth.month}
            onChange={(event) =>
              setVacationCalendarMonth((prev) => ({
                ...prev,
                month: Math.min(12, Math.max(1, Number(event.target.value) || prev.month)),
              }))
            }
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
            placeholder="Mês"
          />
          <input
            type="number"
            min={0}
            max={100}
            value={vacationMinPresencePercent}
            onChange={(event) => setVacationMinPresencePercent(Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
            placeholder="Min. presença (%)"
          />
        </div>

        {vacationError ? <p className="mt-2 text-xs text-rose-600">{vacationError}</p> : null}
        {vacationNotice ? <p className="mt-2 text-xs text-emerald-600">{vacationNotice}</p> : null}

        <div className="mt-4 space-y-3">
          {vacationRequestsLoading ? <p className="text-sm text-slate-500">Carregando solicitações...</p> : null}
          {!vacationRequestsLoading && vacationRequests.filter((item) => item.status === 'REQUESTED').length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma solicitação pendente de supervisor.</p>
          ) : null}

          {vacationRequests
            .filter((item) => item.status === 'REQUESTED')
            .map((request) => (
              <div key={request.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-sm font-semibold text-slate-800">{request.user.name}</p>
                <p className="text-xs text-slate-500">{request.user.email}</p>
                <p className="mt-2 text-xs text-slate-600">
                  {formatDateWithTimeZone(request.startDate, viewTimeZone)} até{' '}
                  {formatDateWithTimeZone(request.endDate, viewTimeZone)}
                </p>
                {request.reason ? <p className="mt-1 text-xs text-slate-600">Motivo: {request.reason}</p> : null}

                <input
                  value={vacationReviewCommentById[request.id] || ''}
                  onChange={(event) =>
                    setVacationReviewCommentById((prev) => ({
                      ...prev,
                      [request.id]: event.target.value,
                    }))
                  }
                  placeholder="Comentário (obrigatório para rejeição)"
                  className="mt-3 w-full rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
                />

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    onClick={() => handleReviewVacationBySupervisor(request.id, 'APPROVE')}
                    disabled={Boolean(vacationActionLoadingById[request.id])}
                    className="rounded-full bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Aprovar
                  </button>
                  <button
                    onClick={() => handleReviewVacationBySupervisor(request.id, 'REJECT')}
                    disabled={Boolean(vacationActionLoadingById[request.id])}
                    className="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                  >
                    Rejeitar
                  </button>
                </div>
              </div>
            ))}
        </div>

        <div className="mt-6">
          <h4 className="text-sm font-semibold text-slate-800">Calendário da equipe (mensal)</h4>
          {vacationCalendarLoading ? <p className="mt-2 text-sm text-slate-500">Carregando calendário...</p> : null}
          {!vacationCalendarLoading && vacationCalendar ? (
            <div className="mt-3 space-y-2">
              {vacationCalendar.days.map((day) => (
                <div
                  key={day.date}
                  className={`rounded-2xl border p-3 text-xs ${
                    day.belowThreshold
                      ? 'border-rose-200 bg-rose-50 text-rose-700'
                      : 'border-slate-100 bg-slate-50/70 text-slate-600'
                  }`}
                >
                  <p className="font-semibold">{day.date}</p>
                  <p>
                    Ausentes: {day.absentCount} • Disponíveis: {day.availableCount} • Presença: {day.presencePercent}%
                  </p>
                  {day.belowThreshold ? <p>Alerta: equipe abaixo do limite mínimo configurado.</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          {!vacationCalendarLoading && vacationCalendar?.annual?.length ? (
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              {vacationCalendar.annual.map((item) => (
                <div key={`${item.year}-${item.month}`} className="rounded-2xl border border-slate-100 bg-white p-3 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">{String(item.month).padStart(2, '0')}/{item.year}</p>
                  <p>Solicitações: {item.requestsCount}</p>
                  <p>Colaboradores em férias: {item.membersScheduled}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div> */}

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">{t('Pending items', 'Pendencias')}</h3>
          <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1">{t('Pending', 'Pendentes')} {stats.PENDING}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1">{t('Approved', 'Aprovados')} {stats.APPROVED}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1">{t('Rejected', 'Rejeitados')} {stats.REJECTED}</span>
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
            <option value="PENDING">{t('Pending', 'Pendentes')}</option>
            <option value="APPROVED">{t('Approved', 'Aprovados')}</option>
            <option value="REJECTED">{t('Rejected', 'Rejeitados')}</option>
            <option value="ALL">{t('All', 'Todos')}</option>
          </select>
          <select
            value={filters.userId}
            onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value }))}
            className="rounded-full border border-slate-200 bg-white px-3 py-2"
          >
            <option value="">{t('All members', 'Todos os colaboradores')}</option>
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
            <p className="text-sm text-slate-500">{t('No pending items at the moment.', 'Nenhuma pendencia no momento.')}</p>
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
                {!entry.clockOut ? (
                  <p className="mt-2 text-xs text-teal-700">
                    Aberta ha {formatShortDuration(getElapsedMinutes(entry.clockIn, nowMs))}
                  </p>
                ) : null}
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
