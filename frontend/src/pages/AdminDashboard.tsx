import { useEffect, useState } from 'react'
import { API_BASE, apiFetch, resolveApiAssetUrl } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { usePlan } from '../hooks/usePlan'
import { TIME_ZONE_OPTIONS } from '../lib/timezone'
import UserAvatar from '../components/UserAvatar'

type Role = 'SUPERADMIN' | 'ADMIN' | 'HR' | 'SUPERVISOR' | 'MEMBER'
type AdminPlanStatus = 'ACTIVE' | 'INACTIVE'

type User = {
  id: string
  email: string
  name: string
  role: Role
  organizationAdminId?: string | null
  organizationAdmin?: {
    id: string
    name: string
    email: string
    role: Role
  } | null
  adminPlanStatus?: AdminPlanStatus
  adminPlanLinkedAt?: string | null
  adminPlan?: {
    id: string
    code: string
    name: string
    monthlyPrice: number
    isActive: boolean
  } | null
  photoUrl?: string | null
  photoUpdatedAt?: string | null
  contractDailyMinutes?: number
  workdayStartTime?: string | null
  workdayEndTime?: string | null
  hourlyRate?: number | null
  timeZone?: string
  supervisor?: {
    id: string
    name: string
    email: string
  } | null
}

type WorkSettingsForm = {
  contractDailyHours: string
  workdayStartTime: string
  workdayEndTime: string
  hourlyRate: string
  timeZone: string
}

type BankHoursOverviewItem = {
  user: {
    id: string
    name: string
    email: string
    role: Role
  }
  bankHours: {
    balanceMinutes: number
    creditMinutes: number
    debtMinutes: number
    pendingMinutes: number
    paidMinutes: number
  }
}

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

type LocationValidationSource = 'MOBILE' | 'TERMINAL_QR'

type AdminLocationSettings = {
  locationValidationSource: LocationValidationSource
  geofence: {
    enabled: boolean
    mode: 'ALERT' | 'REJECT'
    requireLocation: boolean
    center: { lat: number; lng: number } | null
    radiusMeters: number
  }
  allowedSources: LocationValidationSource[]
}

type AdminSeatPayload = {
  admin: {
    id: string
    name: string
    email: string
  }
  plan: {
    id: string | null
    code: string | null
    name: string | null
    status: AdminPlanStatus
    linkedAt: string | null
    monthlyPriceUsd: number | null
    isCatalogActive: boolean
  }
  billing: {
    seatLimit: number | null
    occupiedSeats: number
    availableSeats: number | null
    overageSeats: number
    extraSeatPriceUsd: number
  }
  team: {
    totalMembers: number
    byRole: {
      HR: number
      SUPERVISOR: number
      MEMBER: number
    }
  }
  seats: Array<{
    seatNumber: number
    occupied: boolean
    occupant: {
      id: string
      name: string
      email: string
      role: Role
      organizationAdminId: string
    } | null
  }>
}

type UserUpdatePayload = Partial<User> & {
  supervisorId?: string | null
  organizationAdminId?: string | null
}

const TEAM_ROLE_OPTIONS: Role[] = ['HR', 'SUPERVISOR', 'MEMBER']
const SUPERADMIN_ROLE_OPTIONS: Role[] = ['SUPERADMIN', 'ADMIN', 'HR', 'SUPERVISOR', 'MEMBER']

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

const normalizeCurrencyInput = (value: string) => {
  const cleaned = value.replace(/\$/g, '').replace(/,/g, '.').replace(/[^\d.]/g, '')
  if (!cleaned) return ''

  const numeric = Number(cleaned)
  if (!Number.isFinite(numeric)) return ''
  return `$${numeric}`
}

const parseCurrencyValue = (value: string) => {
  const cleaned = value.replace(/\$/g, '').replace(/,/g, '.').trim()
  if (!cleaned) return null
  const numeric = Number(cleaned)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  return numeric
}

const formatMinutesLabel = (minutes: number) => {
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const mins = absolute % 60
  const sign = minutes < 0 ? '-' : ''
  return `${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

const AdminDashboard = () => {
  const { session, profile } = useAuth()
  const { isGrowthOrBetter } = usePlan()
  const token = session?.access_token
  const isSuperAdmin = profile?.role === 'SUPERADMIN'
  const [users, setUsers] = useState<User[]>([])
  const [adminSeatAssignments, setAdminSeatAssignments] = useState<AdminSeatPayload[]>([])
  const [selectedAdminId, setSelectedAdminId] = useState('ALL')
  const [editNames, setEditNames] = useState<Record<string, string>>({})
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({})
  const [pinLoadingByUser, setPinLoadingByUser] = useState<Record<string, boolean>>({})
  const [workSettingsByUser, setWorkSettingsByUser] = useState<Record<string, WorkSettingsForm>>({})
  const [workSettingsLoadingByUser, setWorkSettingsLoadingByUser] = useState<Record<string, boolean>>({})
  const [bankOverview, setBankOverview] = useState<BankHoursOverviewItem[]>([])
  const [bankLoading, setBankLoading] = useState(false)
  const [bankPayLoadingByUser, setBankPayLoadingByUser] = useState<Record<string, boolean>>({})
  const [bankNotice, setBankNotice] = useState('')
  const [vacationRequests, setVacationRequests] = useState<VacationRequest[]>([])
  const [vacationLoading, setVacationLoading] = useState(false)
  const [vacationReviewCommentById, setVacationReviewCommentById] = useState<Record<string, string>>({})
  const [vacationActionLoadingById, setVacationActionLoadingById] = useState<Record<string, boolean>>({})
  const [vacationNotice, setVacationNotice] = useState('')
  const [vacationError, setVacationError] = useState('')
  const [locationSettings, setLocationSettings] = useState<AdminLocationSettings | null>(null)
  const [locationSettingsLoading, setLocationSettingsLoading] = useState(false)
  const [locationSettingsSaving, setLocationSettingsSaving] = useState(false)
  const [locationSettingsForm, setLocationSettingsForm] = useState({
    locationValidationSource: 'MOBILE' as LocationValidationSource,
    enabled: true,
    mode: 'ALERT' as 'ALERT' | 'REJECT',
    requireLocation: false,
    centerLat: '',
    centerLng: '',
    radiusMeters: '200',
  })
  const [errorByUser, setErrorByUser] = useState<Record<string, string>>({})
  const [noticeByUser, setNoticeByUser] = useState<Record<string, string>>({})
  const [form, setForm] = useState({
    email: '',
    name: '',
    role: 'MEMBER' as Role,
    password: '',
    supervisorId: '',
    organizationAdminId: '',
    adminPlanStatus: 'ACTIVE' as AdminPlanStatus,
  })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const roleOptions = isSuperAdmin ? SUPERADMIN_ROLE_OPTIONS : TEAM_ROLE_OPTIONS
  const selectedAdminSnapshot =
    selectedAdminId === 'ALL'
      ? null
      : adminSeatAssignments.find((entry) => entry.admin.id === selectedAdminId) || null
  const visibleBankOverview =
    isSuperAdmin && selectedAdminSnapshot
      ? bankOverview.filter((row) =>
          selectedAdminSnapshot.seats.some((seat) => seat.occupant?.id === row.user.id)
        )
      : bankOverview
  const visibleVacationRequests =
    isSuperAdmin && selectedAdminSnapshot
      ? vacationRequests.filter((request) =>
          selectedAdminSnapshot.seats.some((seat) => seat.occupant?.id === request.user.id)
        )
      : vacationRequests

  const resolveUserAdminOwnerId = (user: User) => {
    if (user.role === 'ADMIN') return user.id
    return user.organizationAdminId || ''
  }

  const getRoleOptionsForUser = (user: User): Role[] => {
    if (isSuperAdmin) return SUPERADMIN_ROLE_OPTIONS
    if (user.role === 'ADMIN') return ['ADMIN', ...TEAM_ROLE_OPTIONS]
    return TEAM_ROLE_OPTIONS
  }

  const loadUsers = async () => {
    if (!token) return
    const params = new URLSearchParams()

    if (isSuperAdmin) {
      params.set('activeOnly', 'true')
      if (selectedAdminId !== 'ALL') {
        params.set('organizationAdminId', selectedAdminId)
      }
    }

    const query = params.toString() ? `?${params.toString()}` : ''
    const response = await apiFetch<{ users: User[] }>(`/users${query}`, { token })

    const usersWithPhoto = response.users.map((user) => ({
      ...user,
      photoUrl: resolveApiAssetUrl(user.photoUrl),
    }))

    setUsers(usersWithPhoto)
    setEditNames(
      usersWithPhoto.reduce<Record<string, string>>((acc, user) => {
        acc[user.id] = user.name
        return acc
      }, {})
    )
    setWorkSettingsByUser(
      usersWithPhoto.reduce<Record<string, WorkSettingsForm>>((acc, user) => {
        acc[user.id] = {
          contractDailyHours: formatMinutesToHours(user.contractDailyMinutes),
          workdayStartTime: user.workdayStartTime || '',
          workdayEndTime: user.workdayEndTime || '',
          hourlyRate:
            user.hourlyRate !== null && user.hourlyRate !== undefined ? `$${user.hourlyRate}` : '',
          timeZone: user.timeZone || 'America/New_York',
        }
        return acc
      }, {})
    )
  }

  const loadAdminSeatAssignments = async () => {
    if (!token || !isSuperAdmin) return

    const response = await apiFetch<{ admins: AdminSeatPayload[] }>('/users/admin-seats', { token })
    const admins = response.admins || []
    setAdminSeatAssignments(admins)

    setSelectedAdminId((prev) => {
      if (prev === 'ALL') return prev
      return admins.some((entry) => entry.admin.id === prev) ? prev : 'ALL'
    })
  }

  const loadBankOverview = async () => {
    if (!token) return
    setBankLoading(true)
    try {
      const response = await apiFetch<{ overview: BankHoursOverviewItem[] }>('/admin/bank-hours/overview', {
        token,
      })
      setBankOverview(response.overview || [])
    } finally {
      setBankLoading(false)
    }
  }

  const loadVacationRequests = async () => {
    if (!token) return
    setVacationLoading(true)
    try {
      const response = await apiFetch<{ requests: VacationRequest[] }>(
        '/vacations/hr/requests?status=SUPERVISOR_APPROVED',
        { token }
      )
      setVacationRequests(response.requests || [])
    } finally {
      setVacationLoading(false)
    }
  }

  const loadLocationSettings = async () => {
    if (!token || !isGrowthOrBetter) return
    setLocationSettingsLoading(true)
    try {
      const response = await apiFetch<{ locationSettings: AdminLocationSettings }>(
        '/admin/location-settings',
        { token }
      )
      setLocationSettings(response.locationSettings)
      setLocationSettingsForm({
        locationValidationSource: response.locationSettings.locationValidationSource,
        enabled: response.locationSettings.geofence.enabled,
        mode: response.locationSettings.geofence.mode,
        requireLocation: response.locationSettings.geofence.requireLocation,
        centerLat:
          response.locationSettings.geofence.center?.lat !== undefined
            ? String(response.locationSettings.geofence.center.lat)
            : '',
        centerLng:
          response.locationSettings.geofence.center?.lng !== undefined
            ? String(response.locationSettings.geofence.center.lng)
            : '',
        radiusMeters: String(response.locationSettings.geofence.radiusMeters || 200),
      })
    } finally {
      setLocationSettingsLoading(false)
    }
  }

  useEffect(() => {
    loadUsers().catch(() => undefined)
  }, [token, isSuperAdmin, selectedAdminId])

  useEffect(() => {
    loadAdminSeatAssignments().catch(() => undefined)
  }, [token, isSuperAdmin])

  useEffect(() => {
    loadBankOverview().catch(() => undefined)
  }, [token])

  useEffect(() => {
    loadVacationRequests().catch(() => undefined)
  }, [token])

  useEffect(() => {
    loadLocationSettings().catch(() => undefined)
  }, [token])

  useEffect(() => {
    if (!isSuperAdmin || selectedAdminId === 'ALL') return
    if (form.role === 'ADMIN' || form.role === 'SUPERADMIN') return

    setForm((prev) => {
      if (prev.organizationAdminId) return prev
      return { ...prev, organizationAdminId: selectedAdminId }
    })
  }, [isSuperAdmin, selectedAdminId, form.role])

  const handleCreate = async () => {
    if (!token) return
    setError('')
    setNotice('')

    const needsAdminOwner = isSuperAdmin && TEAM_ROLE_OPTIONS.includes(form.role)
    if (needsAdminOwner && !form.organizationAdminId) {
      setError('Selecione qual ADMIN será responsável por este usuário.')
      return
    }

    try {
      const createPayload: Record<string, unknown> = {
        email: form.email,
        name: form.name,
        role: form.role,
        password: form.password,
        supervisorId: form.supervisorId || null,
      }

      if (needsAdminOwner) {
        createPayload.organizationAdminId = form.organizationAdminId
      }

      if (isSuperAdmin && form.role === 'ADMIN') {
        createPayload.adminPlanStatus = form.adminPlanStatus
      }

      const response = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(createPayload),
      })

      const payload = await response.json().catch(() => ({}))

      if (response.status === 402) {
        const checkoutUrl = payload?.billing?.stripe?.checkoutUrl
        if (checkoutUrl) {
          setNotice('Redirecionando para checkout das cadeiras adicionais...')
          window.location.assign(checkoutUrl)
          return
        }

        throw new Error(
          payload?.message ||
            'Limite de cadeiras excedido. Configure Stripe no backend para redirecionamento automático.'
        )
      }

      if (!response.ok) {
        throw new Error(payload?.message || 'Erro ao criar usuario')
      }

      setForm({
        email: '',
        name: '',
        role: 'MEMBER',
        password: '',
        supervisorId: '',
        organizationAdminId: isSuperAdmin && selectedAdminId !== 'ALL' ? selectedAdminId : '',
        adminPlanStatus: 'ACTIVE',
      })
      await loadUsers()
      await loadAdminSeatAssignments()
      setNotice('Usuario criado com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar usuario')
    }
  }

  const handleUpdate = async (userId: string, updates: UserUpdatePayload) => {
    if (!token) return
    setError('')
    setNotice('')

    try {
      await apiFetch(`/users/${userId}`, { token, method: 'PATCH', body: updates })
      await loadUsers()
      await loadAdminSeatAssignments()
      setNotice('Usuario atualizado com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar usuario')
    }
  }

  const handleDelete = async (userId: string) => {
    if (!token) return
    setError('')
    setNotice('')

    try {
      await apiFetch(`/users/${userId}`, { token, method: 'DELETE' })
      await loadUsers()
      await loadAdminSeatAssignments()
      setNotice('Usuario removido com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover usuario')
    }
  }

  const handleSetPin = async (userId: string) => {
    if (!token) return

    const pin = pinInputs[userId] || ''
    setError('')
    setNotice('')
    setPinLoadingByUser((prev) => ({ ...prev, [userId]: true }))

    try {
      await apiFetch(`/admin/users/${userId}/pin`, {
        token,
        method: 'PATCH',
        body: { pin },
      })

      setPinInputs((prev) => ({ ...prev, [userId]: '' }))
      setNotice('PIN definido com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao definir PIN')
    } finally {
      setPinLoadingByUser((prev) => ({ ...prev, [userId]: false }))
    }
  }

  const handleResetPin = async (userId: string) => {
    if (!token) return

    setError('')
    setNotice('')
    setPinLoadingByUser((prev) => ({ ...prev, [userId]: true }))

    try {
      await apiFetch(`/admin/users/${userId}/pin`, {
        token,
        method: 'DELETE',
      })

      setPinInputs((prev) => ({ ...prev, [userId]: '' }))
      setNotice('PIN resetado com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao resetar PIN')
    } finally {
      setPinLoadingByUser((prev) => ({ ...prev, [userId]: false }))
    }
  }

  const handleUpdateWorkSettings = async (userId: string) => {
    if (!token) return

    const current = workSettingsByUser[userId]
    if (!current) return

    setError('')
    setNotice('')
    setErrorByUser((prev) => ({ ...prev, [userId]: '' }))
    setNoticeByUser((prev) => ({ ...prev, [userId]: '' }))
    setWorkSettingsLoadingByUser((prev) => ({ ...prev, [userId]: true }))

    try {
      const body: Record<string, unknown> = {}

      if (current.contractDailyHours.trim() !== '') {
        const parsedMinutes = parseHoursToMinutes(current.contractDailyHours)
        if (parsedMinutes === null) {
          setErrorByUser((prev) => ({
            ...prev,
            [userId]: 'Jornada inválida. Use o formato hh:mm entre 1:00 e 24:00 (ex.: 8:20).',
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

      if (current.hourlyRate.trim() !== '') {
        const parsedRate = parseCurrencyValue(current.hourlyRate)
        if (parsedRate === null) {
          setErrorByUser((prev) => ({
            ...prev,
            [userId]: 'Valor-hora inválido. Use um número válido, ex.: $7 ou $7.5.',
          }))
          return
        }
        body.hourlyRate = parsedRate
      }

      if (current.timeZone.trim() !== '') {
        body.timeZone = current.timeZone.trim()
      }

      if (Object.keys(body).length === 0) {
        setErrorByUser((prev) => ({
          ...prev,
          [userId]: 'Preencha ao menos um campo de jornada/valor-hora para salvar.',
        }))
        return
      }

      await apiFetch(`/admin/users/${userId}/work-settings`, {
        token,
        method: 'PATCH',
        body,
      })

      setNoticeByUser((prev) => ({
        ...prev,
        [userId]: 'Jornada e valor-hora atualizados com sucesso.',
      }))
      await loadUsers()
    } catch (err) {
      setErrorByUser((prev) => ({
        ...prev,
        [userId]: err instanceof Error ? err.message : 'Erro ao atualizar jornada/valor-hora',
      }))
    } finally {
      setWorkSettingsLoadingByUser((prev) => ({ ...prev, [userId]: false }))
    }
  }

  const handlePayPendingBankHours = async (userId: string) => {
    if (!token) return

    setError('')
    setNotice('')
    setBankNotice('')
    setBankPayLoadingByUser((prev) => ({ ...prev, [userId]: true }))
    try {
      const response = await apiFetch<{ message: string }>(`/admin/users/${userId}/bank-hours/pay`, {
        token,
        method: 'PATCH',
        body: { payAllPending: true },
      })
      setBankNotice(response.message || 'Baixa realizada com sucesso.')
      await loadBankOverview()
      await loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao dar baixa no banco de horas')
    } finally {
      setBankPayLoadingByUser((prev) => ({ ...prev, [userId]: false }))
    }
  }

  const handleReviewVacationByHr = async (requestId: string, decision: 'CONFIRM' | 'REJECT') => {
    if (!token) return

    const comment = vacationReviewCommentById[requestId] || ''
    setVacationError('')
    setVacationNotice('')

    if (decision === 'REJECT' && comment.trim().length < 5) {
      setVacationError('Comentário obrigatório para rejeição do RH (mínimo 5 caracteres).')
      return
    }

    setVacationActionLoadingById((prev) => ({ ...prev, [requestId]: true }))
    try {
      await apiFetch(`/vacations/${requestId}/hr-review`, {
        token,
        method: 'PATCH',
        body: {
          decision,
          comment: comment || undefined,
        },
      })

      setVacationNotice(
        decision === 'CONFIRM'
          ? 'Solicitação confirmada pelo RH.'
          : 'Solicitação rejeitada pelo RH.'
      )
      await loadVacationRequests()
      setVacationReviewCommentById((prev) => ({ ...prev, [requestId]: '' }))
    } catch (err) {
      setVacationError(err instanceof Error ? err.message : 'Erro ao revisar solicitação')
    } finally {
      setVacationActionLoadingById((prev) => ({ ...prev, [requestId]: false }))
    }
  }

  const handleSaveLocationSettings = async () => {
    if (!token) return
    setError('')
    setNotice('')
    setLocationSettingsSaving(true)

    try {
      const lat = Number(locationSettingsForm.centerLat)
      const lng = Number(locationSettingsForm.centerLng)
      const radius = Number(locationSettingsForm.radiusMeters)

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setError('Latitude e longitude do estabelecimento são obrigatórias e válidas.')
        return
      }

      if (!Number.isFinite(radius) || radius <= 0) {
        setError('Raio da cerca deve ser maior que zero.')
        return
      }

      const response = await apiFetch<{ locationSettings: AdminLocationSettings; message: string }>(
        '/admin/location-settings',
        {
          token,
          method: 'PATCH',
          body: {
            locationValidationSource: locationSettingsForm.locationValidationSource,
            enabled: locationSettingsForm.enabled,
            mode: locationSettingsForm.mode,
            requireLocation: locationSettingsForm.requireLocation,
            radiusMeters: radius,
            center: {
              lat,
              lng,
            },
          },
        }
      )

      setLocationSettings(response.locationSettings)
      setNotice(response.message || 'Configuração de localização atualizada com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar configuração de localização')
    } finally {
      setLocationSettingsSaving(false)
    }
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">Admin</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">Gestao de usuarios centralizada.</h2>
        <p className="mt-4 text-sm text-slate-600">Crie perfis, ajuste roles e atribua supervisores.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {isSuperAdmin ? (
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm lg:col-span-2">
            <div className="grid gap-4 md:grid-cols-[1.2fr_1fr] md:items-end">
              <label className="text-xs text-slate-600">
                Entrar no time de um ADMIN
                <select
                  value={selectedAdminId}
                  onChange={(event) => {
                    const nextAdminId = event.target.value
                    setSelectedAdminId(nextAdminId)
                    if (nextAdminId !== 'ALL') {
                      setForm((prev) => ({ ...prev, organizationAdminId: nextAdminId }))
                    }
                  }}
                  className="mt-1 w-full rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="ALL">Todos os admins</option>
                  {adminSeatAssignments.map((entry) => (
                    <option key={entry.admin.id} value={entry.admin.id}>
                      {entry.admin.name} ({entry.team.totalMembers} no time)
                    </option>
                  ))}
                </select>
              </label>

              {selectedAdminSnapshot ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">{selectedAdminSnapshot.admin.name}</p>
                  <p className="text-slate-500">{selectedAdminSnapshot.admin.email}</p>
                  <p className="mt-2">
                    Plano: {selectedAdminSnapshot.plan.name || 'Sem plano'} ({selectedAdminSnapshot.plan.status})
                  </p>
                  <p>
                    Time: {selectedAdminSnapshot.team.totalMembers} pessoas | HR: {selectedAdminSnapshot.team.byRole.HR} |
                    Supervisores: {selectedAdminSnapshot.team.byRole.SUPERVISOR} | Colaboradores:{' '}
                    {selectedAdminSnapshot.team.byRole.MEMBER}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  Selecione um admin para visualizar somente o time vinculado a ele.
                </p>
              )}
            </div>
          </div>
        ) : null}

        {isGrowthOrBetter ? (
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-slate-900">Localização do estabelecimento</h3>
              <button
                onClick={() => loadLocationSettings().catch(() => undefined)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
              >
                Atualizar
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Defina se o ponto valida pelo QR do terminal ou pela geolocalização do celular, e ajuste a posição do estabelecimento.
            </p>

          {locationSettingsLoading ? (
            <p className="mt-2 text-xs text-slate-500">Carregando configuração de localização...</p>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs text-slate-600">
              Método de validação
              <select
                value={locationSettingsForm.locationValidationSource}
                onChange={(event) =>
                  setLocationSettingsForm((prev) => ({
                    ...prev,
                    locationValidationSource: event.target.value as LocationValidationSource,
                  }))
                }
                className="mt-1 w-full rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                {(locationSettings?.allowedSources || ['MOBILE', 'TERMINAL_QR']).map((source) => (
                  <option key={source} value={source}>
                    {source === 'TERMINAL_QR' ? 'QR do terminal' : 'GPS do celular'}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs text-slate-600">
              Modo da cerca
              <select
                value={locationSettingsForm.mode}
                onChange={(event) =>
                  setLocationSettingsForm((prev) => ({
                    ...prev,
                    mode: event.target.value as 'ALERT' | 'REJECT',
                  }))
                }
                className="mt-1 w-full rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <option value="ALERT">ALERTA</option>
                <option value="REJECT">BLOQUEAR</option>
              </select>
            </label>

            <label className="text-xs text-slate-600">
              Raio (metros)
              <input
                value={locationSettingsForm.radiusMeters}
                onChange={(event) =>
                  setLocationSettingsForm((prev) => ({ ...prev, radiusMeters: event.target.value }))
                }
                type="number"
                min={1}
                className="mt-1 w-full rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
              />
            </label>

            <label className="text-xs text-slate-600">
              Latitude
              <input
                value={locationSettingsForm.centerLat}
                onChange={(event) =>
                  setLocationSettingsForm((prev) => ({ ...prev, centerLat: event.target.value }))
                }
                type="number"
                step="0.000001"
                className="mt-1 w-full rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
              />
            </label>

            <label className="text-xs text-slate-600">
              Longitude
              <input
                value={locationSettingsForm.centerLng}
                onChange={(event) =>
                  setLocationSettingsForm((prev) => ({ ...prev, centerLng: event.target.value }))
                }
                type="number"
                step="0.000001"
                className="mt-1 w-full rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
              />
            </label>

            <div className="flex flex-col gap-2 pt-5 text-xs text-slate-700">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={locationSettingsForm.enabled}
                  onChange={(event) =>
                    setLocationSettingsForm((prev) => ({ ...prev, enabled: event.target.checked }))
                  }
                />
                Cerca virtual ativa
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={locationSettingsForm.requireLocation}
                  onChange={(event) =>
                    setLocationSettingsForm((prev) => ({ ...prev, requireLocation: event.target.checked }))
                  }
                />
                Exigir GPS quando modo celular
              </label>
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={handleSaveLocationSettings}
              disabled={locationSettingsSaving}
              className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {locationSettingsSaving ? 'Salvando...' : 'Salvar configuração de localização'}
            </button>
          </div>
        </div>
        ) : null}

        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Usuarios</h3>
          {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
          {notice ? <p className="mt-2 text-xs text-emerald-600">{notice}</p> : null}

          <div className="mt-5 space-y-4">
            {users.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum usuario cadastrado.</p>
            ) : (
              users.map((user) => (
                <div key={user.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                  <div className="flex items-center gap-3">
                    <UserAvatar name={user.name} photoUrl={user.photoUrl} size="md" />
                    <div className="w-full space-y-2">
                      <input
                        value={editNames[user.id] || ''}
                        onChange={(event) =>
                          setEditNames((prev) => ({ ...prev, [user.id]: event.target.value }))
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-1 text-sm"
                      />
                      <p className="text-xs text-slate-500">{user.email}</p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Conta</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-center">
                      <select
                        value={user.role}
                        onChange={(event) => {
                          const nextRole = event.target.value as Role

                          if (
                            isSuperAdmin &&
                            user.role === 'ADMIN' &&
                            nextRole !== 'ADMIN' &&
                            nextRole !== 'SUPERADMIN'
                          ) {
                            const preferredAdminId =
                              selectedAdminId !== 'ALL' && selectedAdminId !== user.id
                                ? selectedAdminId
                                : ''
                            const fallbackAdminId =
                              preferredAdminId ||
                              adminSeatAssignments.find((entry) => entry.admin.id !== user.id)?.admin.id ||
                              ''

                            if (!fallbackAdminId) {
                              setError(
                                'Para remover papel ADMIN, selecione no dropdown superior o novo ADMIN responsável pelo usuário.'
                              )
                              return
                            }

                            handleUpdate(user.id, {
                              role: nextRole,
                              organizationAdminId: fallbackAdminId,
                            })
                            return
                          }

                          handleUpdate(user.id, { role: nextRole })
                        }}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs"
                      >
                        {getRoleOptionsForUser(user).map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleUpdate(user.id, { name: editNames[user.id] || user.name })}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                      >
                        Salvar nome
                      </button>
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-700"
                      >
                        Remover usuário
                      </button>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs text-slate-500 sm:grid-cols-[auto_1fr] sm:items-center">
                      <span>Supervisor:</span>
                      <select
                        value={user.supervisor?.id || ''}
                        onChange={(event) =>
                          handleUpdate(user.id, { supervisorId: event.target.value || null })
                        }
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs"
                      >
                        <option value="">Sem supervisor</option>
                        {users
                          .filter((candidate) => candidate.role !== 'MEMBER' && candidate.id !== user.id)
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name}
                            </option>
                          ))}
                      </select>
                    </div>

                    {isSuperAdmin && user.role !== 'SUPERADMIN' ? (
                      <div className="mt-2 grid gap-2 text-xs text-slate-500 sm:grid-cols-[auto_1fr] sm:items-center">
                        <span>Admin dono:</span>
                        {user.role === 'ADMIN' ? (
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">
                            {user.name} (self)
                          </span>
                        ) : (
                          <select
                            value={resolveUserAdminOwnerId(user)}
                            onChange={(event) =>
                              handleUpdate(user.id, {
                                organizationAdminId: event.target.value || null,
                              })
                            }
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs"
                          >
                            <option value="">Selecione o ADMIN responsável</option>
                            {adminSeatAssignments.map((entry) => (
                              <option key={entry.admin.id} value={entry.admin.id}>
                                {entry.admin.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    ) : null}

                    {user.role === 'ADMIN' ? (
                      <p className="mt-2 text-xs text-slate-600">
                        Plano: {user.adminPlan?.name || 'Sem plano'} ({user.adminPlanStatus || 'INACTIVE'})
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-3 rounded-2xl border border-slate-200/70 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Segurança</p>
                    <div className="mt-2 grid gap-2 text-xs text-slate-500 md:grid-cols-[1fr_auto_auto] md:items-center">
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={8}
                        value={pinInputs[user.id] || ''}
                        onChange={(event) =>
                          setPinInputs((prev) => ({
                            ...prev,
                            [user.id]: event.target.value.replace(/\D/g, '').slice(0, 8),
                          }))
                        }
                        placeholder="PIN 4 a 8 dígitos"
                        className="w-full rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs"
                      />
                      <button
                        onClick={() => handleSetPin(user.id)}
                        disabled={Boolean(pinLoadingByUser[user.id])}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 disabled:opacity-50"
                      >
                        Definir PIN
                      </button>
                      <button
                        onClick={() => handleResetPin(user.id)}
                        disabled={Boolean(pinLoadingByUser[user.id])}
                        className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-700 disabled:opacity-50"
                      >
                        Resetar PIN
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 rounded-2xl border border-slate-200/70 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Jornada e custo</p>
                    <div className="mt-2 grid gap-2 text-xs text-slate-500 md:grid-cols-6 md:items-center">
                      <input
                        type="text"
                        value={workSettingsByUser[user.id]?.contractDailyHours || ''}
                        onChange={(event) =>
                          setWorkSettingsByUser((prev) => ({
                            ...prev,
                            [user.id]: {
                              ...(prev[user.id] || {
                                contractDailyHours: '',
                                workdayStartTime: '',
                                workdayEndTime: '',
                                hourlyRate: '',
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
                        value={workSettingsByUser[user.id]?.workdayStartTime || ''}
                        onChange={(event) =>
                          setWorkSettingsByUser((prev) => ({
                            ...prev,
                            [user.id]: {
                              ...(prev[user.id] || {
                                contractDailyHours: '',
                                workdayStartTime: '',
                                workdayEndTime: '',
                                hourlyRate: '',
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
                        value={workSettingsByUser[user.id]?.workdayEndTime || ''}
                        onChange={(event) =>
                          setWorkSettingsByUser((prev) => ({
                            ...prev,
                            [user.id]: {
                              ...(prev[user.id] || {
                                contractDailyHours: '',
                                workdayStartTime: '',
                                workdayEndTime: '',
                                hourlyRate: '',
                                timeZone: 'America/New_York',
                              }),
                              workdayEndTime: event.target.value,
                            },
                          }))
                        }
                        className="w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                      />
                      <input
                        type="text"
                        value={workSettingsByUser[user.id]?.hourlyRate || ''}
                        onChange={(event) =>
                          setWorkSettingsByUser((prev) => ({
                            ...prev,
                            [user.id]: {
                              ...(prev[user.id] || {
                                contractDailyHours: '',
                                workdayStartTime: '',
                                workdayEndTime: '',
                                hourlyRate: '',
                                timeZone: 'America/New_York',
                              }),
                              hourlyRate: normalizeCurrencyInput(event.target.value),
                            },
                          }))
                        }
                        placeholder="$7"
                        className="w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                      />
                      <select
                        value={workSettingsByUser[user.id]?.timeZone || 'America/New_York'}
                        onChange={(event) =>
                          setWorkSettingsByUser((prev) => ({
                            ...prev,
                            [user.id]: {
                              ...(prev[user.id] || {
                                contractDailyHours: '',
                                workdayStartTime: '',
                                workdayEndTime: '',
                                hourlyRate: '',
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
                        onClick={() => handleUpdateWorkSettings(user.id)}
                        disabled={Boolean(workSettingsLoadingByUser[user.id])}
                        className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Salvar jornada/valor
                      </button>
                    </div>
                  </div>

                  {errorByUser[user.id] ? (
                    <p className="mt-2 text-xs text-rose-600">{errorByUser[user.id]}</p>
                  ) : null}
                  {noticeByUser[user.id] ? (
                    <p className="mt-2 text-xs text-emerald-600">{noticeByUser[user.id]}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Novo usuario</h3>
          <div className="mt-4 space-y-4">
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Nome completo"
              className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            />
            <input
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="Email"
              type="email"
              className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            />
            <input
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="Senha inicial"
              type="password"
              className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            />
            <select
              value={form.role}
              onChange={(event) => {
                const nextRole = event.target.value as Role
                setForm((prev) => ({
                  ...prev,
                  role: nextRole,
                  organizationAdminId:
                    nextRole === 'ADMIN' || nextRole === 'SUPERADMIN'
                      ? ''
                      : prev.organizationAdminId || (selectedAdminId !== 'ALL' ? selectedAdminId : ''),
                }))
              }}
              className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm"
            >
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            {isSuperAdmin && TEAM_ROLE_OPTIONS.includes(form.role) ? (
              <select
                value={form.organizationAdminId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, organizationAdminId: event.target.value }))
                }
                className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm"
              >
                <option value="">Selecione o ADMIN responsável</option>
                {adminSeatAssignments.map((entry) => (
                  <option key={entry.admin.id} value={entry.admin.id}>
                    {entry.admin.name}
                  </option>
                ))}
              </select>
            ) : null}
            {isSuperAdmin && form.role === 'ADMIN' ? (
              <select
                value={form.adminPlanStatus}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    adminPlanStatus: event.target.value as AdminPlanStatus,
                  }))
                }
                className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm"
              >
                <option value="ACTIVE">Plano ACTIVE</option>
                <option value="INACTIVE">Plano INACTIVE</option>
              </select>
            ) : null}
            <select
              value={form.supervisorId}
              onChange={(event) => setForm((prev) => ({ ...prev, supervisorId: event.target.value }))}
              className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm"
            >
              <option value="">Supervisor (opcional)</option>
              {users
                .filter((user) => user.role !== 'MEMBER')
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
            </select>
            <button
              onClick={handleCreate}
              className="w-full rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
            >
              Criar usuario
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-900">Férias (RH)</h3>
            <button
              onClick={() => loadVacationRequests().catch(() => undefined)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
            >
              Atualizar
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Solicitações aprovadas pelo supervisor aguardando confirmação final do RH.
          </p>
          {vacationError ? <p className="mt-2 text-xs text-rose-600">{vacationError}</p> : null}
          {vacationNotice ? <p className="mt-2 text-xs text-emerald-600">{vacationNotice}</p> : null}

          <div className="mt-4 space-y-3">
            {vacationLoading ? <p className="text-sm text-slate-500">Carregando solicitações de férias...</p> : null}
            {!vacationLoading && visibleVacationRequests.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma solicitação pendente de RH.</p>
            ) : null}

            {visibleVacationRequests.map((request) => (
              <div key={request.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-sm font-semibold text-slate-800">{request.user.name}</p>
                <p className="text-xs text-slate-500">{request.user.email}</p>
                <p className="mt-2 text-xs text-slate-600">
                  Periodo: {new Date(request.startDate).toLocaleDateString('pt-BR')} até{' '}
                  {new Date(request.endDate).toLocaleDateString('pt-BR')}
                </p>
                {request.supervisor ? (
                  <p className="mt-1 text-xs text-slate-600">Supervisor: {request.supervisor.name}</p>
                ) : null}
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
                    onClick={() => handleReviewVacationByHr(request.id, 'CONFIRM')}
                    disabled={Boolean(vacationActionLoadingById[request.id])}
                    className="rounded-full bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Confirmar
                  </button>
                  <button
                    onClick={() => handleReviewVacationByHr(request.id, 'REJECT')}
                    disabled={Boolean(vacationActionLoadingById[request.id])}
                    className="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                  >
                    Rejeitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-900">Banco de horas</h3>
            <button
              onClick={() => loadBankOverview().catch(() => undefined)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
            >
              Atualizar
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Visualize credito, saldo devedor e pendencias para baixa por colaborador.
          </p>
          {bankNotice ? <p className="mt-2 text-xs text-emerald-600">{bankNotice}</p> : null}

          <div className="mt-4 space-y-2">
            {bankLoading ? <p className="text-sm text-slate-500">Carregando banco de horas...</p> : null}
            {!bankLoading && visibleBankOverview.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum dado de banco de horas disponível.</p>
            ) : null}
            {visibleBankOverview.map((row) => (
              <div key={row.user.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{row.user.name}</p>
                    <p className="text-xs text-slate-500">{row.user.email}</p>
                  </div>
                  <button
                    onClick={() => handlePayPendingBankHours(row.user.id)}
                    disabled={Boolean(bankPayLoadingByUser[row.user.id]) || row.bankHours.pendingMinutes <= 0}
                    className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {bankPayLoadingByUser[row.user.id] ? 'Processando...' : 'Dar baixa pendente'}
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
      </div>
    </section>
  )
}

export default AdminDashboard
