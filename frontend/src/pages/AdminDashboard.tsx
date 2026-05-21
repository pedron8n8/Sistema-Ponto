import { useEffect, useState } from 'react'
import {
  API_BASE,
  apiFetch,
  buildIdempotencyHeaders,
  resolveApiAssetUrl,
  translateApiMessage,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { usePlan } from '../hooks/usePlan'
import { TIME_ZONE_OPTIONS } from '../lib/timezone'
import UserAvatar from '../components/UserAvatar'
import { useTranslation } from 'react-i18next'

type Role = 'SUPERADMIN' | 'ADMIN' | 'HR' | 'SUPERVISOR' | 'MEMBER'
type AdminPlanStatus = 'ACTIVE' | 'INACTIVE'
type InvitableRole = 'HR' | 'SUPERVISOR' | 'MEMBER'

type User = {
  id: string
  email: string
  name: string
  phone?: string | null
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

type TeamInviteLinkResponse = {
  message?: string
  invite?: {
    role: InvitableRole
    expiresAt: string
    ttlHours: number
    token: string
    url: string
  }
  purchase?: {
    url?: string
    suggestedQuantity?: number
  }
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
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const getRequestTypeLabel = (requestType: 'VACATION' | 'DAY_OFF') =>
    requestType === 'DAY_OFF' ? t('Day off', 'Folga') : t('Vacation', 'Férias')
  const locale = isPt ? 'pt-BR' : 'en-US'
  const token = session?.access_token
  const isSuperAdmin = profile?.role === 'SUPERADMIN'
  const isAdmin = profile?.role === 'ADMIN'
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
  const [createLoading, setCreateLoading] = useState(false)
  const [inviteRole, setInviteRole] = useState<InvitableRole>('MEMBER')
  const [inviteTtlHours, setInviteTtlHours] = useState('72')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteNotice, setInviteNotice] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [invitePurchaseUrl, setInvitePurchaseUrl] = useState('')

  const roleOptions = isSuperAdmin ? SUPERADMIN_ROLE_OPTIONS : TEAM_ROLE_OPTIONS
  const selectedAdminSnapshot =
    selectedAdminId === 'ALL'
      ? null
      : adminSeatAssignments.find((entry) => entry.admin.id === selectedAdminId) || null
  const currentSeatSnapshot = isSuperAdmin
    ? selectedAdminSnapshot
    : adminSeatAssignments[0] || null
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
          timeZone: user.timeZone || 'America/Chicago',
        }
        return acc
      }, {})
    )
  }

  const loadAdminSeatAssignments = async () => {
    if (!token) return

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
    if (!token || createLoading) return
    setError('')
    setNotice('')

    const needsAdminOwner = isSuperAdmin && TEAM_ROLE_OPTIONS.includes(form.role)
    if (needsAdminOwner && !form.organizationAdminId) {
      setError(
        t(
          'Select which ADMIN will be responsible for this user.',
          'Selecione qual ADMIN sera responsavel por este usuario.'
        )
      )
      return
    }

    setCreateLoading(true)

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

      const idempotencyHeaders = await buildIdempotencyHeaders(createPayload)

      const response = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...idempotencyHeaders,
        },
        body: JSON.stringify(createPayload),
      })

      const payload = await response.json().catch(() => ({}))

      if (response.status === 202 && payload?.idempotency?.ignored) {
        setNotice(
          (payload?.message ? translateApiMessage(payload.message) : '') ||
            t('Duplicate request was ignored successfully.', 'Requisicao duplicada ignorada com sucesso.')
        )
        return
      }

      if (response.status === 402) {
        const checkoutUrl = payload?.billing?.stripe?.checkoutUrl
        if (checkoutUrl) {
          setNotice(
            t(
              'Redirecting to additional seats checkout...',
              'Redirecionando para checkout das cadeiras adicionais...'
            )
          )
          window.location.assign(checkoutUrl)
          return
        }

        throw new Error(
          translateApiMessage(
            payload?.message ||
            t(
              'Seat limit exceeded. Configure Stripe on the backend for automatic redirection.',
              'Limite de cadeiras excedido. Configure Stripe no backend para redirecionamento automatico.'
            )
          )
        )
      }

      if (!response.ok) {
        throw new Error(
          translateApiMessage(payload?.message || t('Could not create user.', 'Erro ao criar usuario'))
        )
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
      setNotice(t('User created successfully.', 'Usuario criado com sucesso.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not create user.', 'Erro ao criar usuario'))
    } finally {
      setCreateLoading(false)
    }
  }

  const handleGenerateInviteLink = async () => {
    if (!token || inviteLoading) return

    setInviteError('')
    setInviteNotice('')
    setInvitePurchaseUrl('')

    const parsedTtl = Number(inviteTtlHours)
    if (!Number.isInteger(parsedTtl) || parsedTtl < 1) {
      setInviteError(
        t(
          'Invite TTL must be an integer greater than or equal to 1 hour.',
          'TTL do convite deve ser inteiro maior ou igual a 1 hora.'
        )
      )
      return
    }

    setInviteLoading(true)
    try {
      const requestBody = {
        role: inviteRole,
        expiresInHours: parsedTtl,
      }

      const response = await fetch(`${API_BASE}/users/me/team-invite-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      })

      const payload = (await response.json().catch(() => ({}))) as TeamInviteLinkResponse

      if (response.status === 202) {
        setInviteNotice(
          (payload?.message ? translateApiMessage(payload.message) : '') ||
            t(
              'Duplicate request ignored. Click again to generate a new invite.',
              'Requisicao duplicada ignorada. Clique novamente para gerar um novo convite.'
            )
        )
        return
      }

      if (!response.ok) {
        const purchaseUrl = String(payload?.purchase?.url || '').trim()
        if (purchaseUrl) {
          setInvitePurchaseUrl(purchaseUrl)
        }

        throw new Error(
          translateApiMessage(
            payload?.message ||
              t('Could not generate invite link.', 'Erro ao gerar link de convite.')
          )
        )
      }

      const nextInviteUrl = String(payload?.invite?.url || '').trim()
      if (!nextInviteUrl) {
        throw new Error(
          t('Backend did not return invite URL.', 'Backend nao retornou URL de convite.')
        )
      }

      setInviteUrl(nextInviteUrl)
      setInvitePurchaseUrl('')
      setInviteNotice(
        t(
          'Invite link generated. Share it with the employee.',
          'Link de convite gerado. Compartilhe com o funcionario.'
        )
      )
    } catch (err) {
      setInviteError(
        err instanceof Error
          ? err.message
          : t('Could not generate invite link.', 'Erro ao gerar link de convite.')
      )
    } finally {
      setInviteLoading(false)
    }
  }

  const handleCopyInviteLink = async () => {
    if (!inviteUrl) return

    try {
      await navigator.clipboard.writeText(inviteUrl)
      setInviteNotice(
        t('Invite link copied to clipboard.', 'Link de convite copiado para a area de transferencia.')
      )
    } catch {
      setInviteError(
        t(
          'Could not copy automatically. Copy manually from the field.',
          'Nao foi possivel copiar automaticamente. Copie manualmente no campo.'
        )
      )
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
      setNotice(t('User updated successfully.', 'Usuario atualizado com sucesso.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not update user.', 'Erro ao atualizar usuario'))
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
      setNotice(t('User removed successfully.', 'Usuario removido com sucesso.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not remove user.', 'Erro ao remover usuario'))
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
      setNotice(t('PIN set successfully.', 'PIN definido com sucesso.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not set PIN.', 'Erro ao definir PIN'))
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
      setNotice(t('PIN reset successfully.', 'PIN resetado com sucesso.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not reset PIN.', 'Erro ao resetar PIN'))
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
            [userId]: t(
              'Invalid workday. Use hh:mm between 1:00 and 24:00 (e.g. 8:20).',
              'Jornada invalida. Use o formato hh:mm entre 1:00 e 24:00 (ex.: 8:20).'
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

      if (current.hourlyRate.trim() !== '') {
        const parsedRate = parseCurrencyValue(current.hourlyRate)
        if (parsedRate === null) {
          setErrorByUser((prev) => ({
            ...prev,
            [userId]: t(
              'Invalid hourly rate. Use a valid number, e.g. $7 or $7.5.',
              'Valor-hora invalido. Use um numero valido, ex.: $7 ou $7.5.'
            ),
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
          [userId]: t(
            'Fill at least one workday/hourly-rate field before saving.',
            'Preencha ao menos um campo de jornada/valor-hora para salvar.'
          ),
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
        [userId]: t(
          'Workday and hourly rate updated successfully.',
          'Jornada e valor-hora atualizados com sucesso.'
        ),
      }))
      await loadUsers()
    } catch (err) {
      setErrorByUser((prev) => ({
        ...prev,
        [userId]:
          err instanceof Error
            ? err.message
            : t('Could not update workday/hourly rate.', 'Erro ao atualizar jornada/valor-hora'),
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
      setBankNotice(
        response.message
          ? translateApiMessage(response.message)
          : t('Payment posted successfully.', 'Baixa realizada com sucesso.')
      )
      await loadBankOverview()
      await loadUsers()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not post bank-hours payment.', 'Erro ao dar baixa no banco de horas')
      )
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
      setVacationError(
        t(
          'Comment is required for HR rejection (minimum 5 characters).',
          'Comentario obrigatorio para rejeicao do RH (minimo 5 caracteres).'
        )
      )
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
          ? t('Request confirmed by HR.', 'Solicitacao confirmada pelo RH.')
          : t('Request rejected by HR.', 'Solicitacao rejeitada pelo RH.')
      )
      await loadVacationRequests()
      setVacationReviewCommentById((prev) => ({ ...prev, [requestId]: '' }))
    } catch (err) {
      setVacationError(
        err instanceof Error
          ? err.message
          : t('Could not review request.', 'Erro ao revisar solicitacao')
      )
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
        setError(
          t(
            'Store latitude and longitude are required and must be valid.',
            'Latitude e longitude do estabelecimento sao obrigatorias e validas.'
          )
        )
        return
      }

      if (!Number.isFinite(radius) || radius <= 0) {
        setError(t('Geofence radius must be greater than zero.', 'Raio da cerca deve ser maior que zero.'))
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
      setNotice(
        response.message
          ? translateApiMessage(response.message)
          : t(
              'Location settings updated successfully.',
              'Configuracao de localizacao atualizada com sucesso.'
            )
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not save location settings.', 'Erro ao salvar configuracao de localizacao')
      )
    } finally {
      setLocationSettingsSaving(false)
    }
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Admin', 'Admin')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">
          {t('Centralized user management.', 'Gestao de usuarios centralizada.')}
        </h2>
        <p className="mt-4 text-sm text-slate-600">
          {t('Create profiles, adjust roles, and assign supervisors.', 'Crie perfis, ajuste roles e atribua supervisores.')}
        </p>
      </div>

      {isAdmin && currentSeatSnapshot && currentSeatSnapshot.billing.overageSeats > 0 ? (
        <div className="rounded-3xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-800">
            {t('Seat adjustment required', 'Ajuste de cadeiras necessario')}
          </p>
          <p className="mt-2 text-sm text-amber-900">
            {t('Your team currently has', 'Seu time esta com')} {currentSeatSnapshot.billing.occupiedSeats}{' '}
            {t('user(s) for a limit of', 'usuario(s) para um limite de')} {currentSeatSnapshot.billing.seatLimit}.
            {' '}
            {t('You need to remove', 'Voce precisa remover')} {currentSeatSnapshot.billing.overageSeats}{' '}
            {t('person(s) from the team or purchase', 'pessoa(s) do time ou contratar')}{' '}
            {currentSeatSnapshot.billing.overageSeats} {t('additional seat(s).', 'cadeira(s) adicional(is).')}
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {isSuperAdmin ? (
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm lg:col-span-2">
            <div className="grid gap-4 md:grid-cols-[1.2fr_1fr] md:items-end">
              <label className="text-xs text-slate-600">
                {t('Switch to an ADMIN team', 'Entrar no time de um ADMIN')}
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
                  <option value="ALL">{t('All admins', 'Todos os admins')}</option>
                  {adminSeatAssignments.map((entry) => (
                    <option key={entry.admin.id} value={entry.admin.id}>
                      {entry.admin.name} ({entry.team.totalMembers} {t('in team', 'no time')})
                    </option>
                  ))}
                </select>
              </label>

              {selectedAdminSnapshot ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">{selectedAdminSnapshot.admin.name}</p>
                  <p className="text-slate-500">{selectedAdminSnapshot.admin.email}</p>
                  <p className="mt-2">
                    {t('Plan:', 'Plano:')} {selectedAdminSnapshot.plan.name || t('No plan', 'Sem plano')} ({selectedAdminSnapshot.plan.status})
                  </p>
                  <p>
                    {t('Team:', 'Time:')} {selectedAdminSnapshot.team.totalMembers} {t('people', 'pessoas')} | HR: {selectedAdminSnapshot.team.byRole.HR} |
                    {t('Supervisors:', 'Supervisores:')} {selectedAdminSnapshot.team.byRole.SUPERVISOR} | {t('Members:', 'Colaboradores:')}{' '}
                    {selectedAdminSnapshot.team.byRole.MEMBER}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  {t(
                    'Select an admin to view only the team linked to that admin.',
                    'Selecione um admin para visualizar somente o time vinculado a ele.'
                  )}
                </p>
              )}
            </div>
          </div>
        ) : null}

        {isGrowthOrBetter ? (
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-slate-900">
                {t('Store location', 'Localizacao do estabelecimento')}
              </h3>
              <button
                onClick={() => loadLocationSettings().catch(() => undefined)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
              >
                {t('Refresh', 'Atualizar')}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {t(
                'Choose whether attendance is validated by terminal QR or mobile geolocation, and adjust the store position.',
                'Defina se o ponto valida pelo QR do terminal ou pela geolocalizacao do celular, e ajuste a posicao do estabelecimento.'
              )}
            </p>

          {locationSettingsLoading ? (
            <p className="mt-2 text-xs text-slate-500">
              {t('Loading location settings...', 'Carregando configuracao de localizacao...')}
            </p>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs text-slate-600">
              {t('Validation method', 'Metodo de validacao')}
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
                    {source === 'TERMINAL_QR' ? t('Terminal QR', 'QR do terminal') : t('Mobile GPS', 'GPS do celular')}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs text-slate-600">
              {t('Geofence mode', 'Modo da cerca')}
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
                <option value="ALERT">{t('ALERT', 'ALERTA')}</option>
                <option value="REJECT">{t('REJECT', 'BLOQUEAR')}</option>
              </select>
            </label>

            <label className="text-xs text-slate-600">
              {t('Radius (meters)', 'Raio (metros)')}
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
              {t('Latitude', 'Latitude')}
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
              {t('Longitude', 'Longitude')}
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
                {t('Enable geofence', 'Cerca virtual ativa')}
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={locationSettingsForm.requireLocation}
                  onChange={(event) =>
                    setLocationSettingsForm((prev) => ({ ...prev, requireLocation: event.target.checked }))
                  }
                />
                {t('Require GPS when using mobile mode', 'Exigir GPS quando modo celular')}
              </label>
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={handleSaveLocationSettings}
              disabled={locationSettingsSaving}
              className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {locationSettingsSaving
                ? t('Saving...', 'Salvando...')
                : t('Save location settings', 'Salvar configuracao de localizacao')}
            </button>
          </div>
        </div>
        ) : null}

        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">{t('Users', 'Usuarios')}</h3>
          {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
          {notice ? <p className="mt-2 text-xs text-emerald-600">{notice}</p> : null}

          <div className="mt-5 space-y-4">
            {users.length === 0 ? (
              <p className="text-sm text-slate-500">{t('No users registered.', 'Nenhum usuario cadastrado.')}</p>
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
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{t('Account', 'Conta')}</p>
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
                                t(
                                  'To remove ADMIN role, select in the top dropdown the new ADMIN responsible for this user.',
                                  'Para remover papel ADMIN, selecione no dropdown superior o novo ADMIN responsavel pelo usuario.'
                                )
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
                        {t('Save name', 'Salvar nome')}
                      </button>
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-700"
                      >
                        {t('Remove user', 'Remover usuario')}
                      </button>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs text-slate-500 sm:grid-cols-[auto_1fr] sm:items-center">
                      <span>{t('Supervisor:', 'Supervisor:')}</span>
                      <select
                        value={user.supervisor?.id || ''}
                        onChange={(event) =>
                          handleUpdate(user.id, { supervisorId: event.target.value || null })
                        }
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs"
                      >
                        <option value="">{t('No supervisor', 'Sem supervisor')}</option>
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
                        <span>{t('Owner admin:', 'Admin dono:')}</span>
                        {user.role === 'ADMIN' ? (
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">
                            {user.name} ({t('self', 'proprio')})
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
                            <option value="">{t('Select the responsible ADMIN', 'Selecione o ADMIN responsavel')}</option>
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
                        {t('Plan:', 'Plano:')} {user.adminPlan?.name || t('No plan', 'Sem plano')} ({user.adminPlanStatus || 'INACTIVE'})
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-3 rounded-2xl border border-slate-200/70 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{t('Security', 'Seguranca')}</p>
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
                        placeholder={t('PIN 4 to 8 digits', 'PIN 4 a 8 digitos')}
                        className="w-full rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs"
                      />
                      <button
                        onClick={() => handleSetPin(user.id)}
                        disabled={Boolean(pinLoadingByUser[user.id])}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 disabled:opacity-50"
                      >
                        {t('Set PIN', 'Definir PIN')}
                      </button>
                      <button
                        onClick={() => handleResetPin(user.id)}
                        disabled={Boolean(pinLoadingByUser[user.id])}
                        className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-700 disabled:opacity-50"
                      >
                        {t('Reset PIN', 'Resetar PIN')}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 rounded-2xl border border-slate-200/70 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                      {t('Workday and cost', 'Jornada e custo')}
                    </p>
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
                                timeZone: 'America/Chicago',
                              }),
                              contractDailyHours: event.target.value,
                            },
                          }))
                        }
                        placeholder={t('Workday (hh:mm) e.g. 8:20', 'Jornada (hh:mm) ex: 8:20')}
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
                                timeZone: 'America/Chicago',
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
                                timeZone: 'America/Chicago',
                              }),
                              hourlyRate: normalizeCurrencyInput(event.target.value),
                            },
                          }))
                        }
                        placeholder="$7"
                        className="w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                      />
                      <select
                        value={workSettingsByUser[user.id]?.timeZone || 'America/Chicago'}
                        onChange={(event) =>
                          setWorkSettingsByUser((prev) => ({
                            ...prev,
                            [user.id]: {
                              ...(prev[user.id] || {
                                contractDailyHours: '',
                                workdayStartTime: '',
                                workdayEndTime: '',
                                hourlyRate: '',
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
                        onClick={() => handleUpdateWorkSettings(user.id)}
                        disabled={Boolean(workSettingsLoadingByUser[user.id])}
                        className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {t('Save workday/rate', 'Salvar jornada/valor')}
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
          <h3 className="text-lg font-semibold text-slate-900">{t('New user', 'Novo usuario')}</h3>
          <div className="mt-4 space-y-4">
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder={t('Full name', 'Nome completo')}
              className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            />
            <input
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              placeholder={t('Email', 'Email')}
              type="email"
              className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            />
            <input
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              placeholder={t('Initial password', 'Senha inicial')}
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
                <option value="">{t('Select the responsible ADMIN', 'Selecione o ADMIN responsavel')}</option>
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
                <option value="ACTIVE">{t('Plan ACTIVE', 'Plano ACTIVE')}</option>
                <option value="INACTIVE">{t('Plan INACTIVE', 'Plano INACTIVE')}</option>
              </select>
            ) : null}
            <select
              value={form.supervisorId}
              onChange={(event) => setForm((prev) => ({ ...prev, supervisorId: event.target.value }))}
              className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm"
            >
              <option value="">{t('Supervisor (optional)', 'Supervisor (opcional)')}</option>
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
              disabled={createLoading}
              className="w-full rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {createLoading ? t('Creating...', 'Criando...') : t('Create user', 'Criar usuario')}
            </button>

            {isAdmin ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {t('Invite link', 'Link de convite')}
                </p>
                <p className="mt-2 text-xs text-slate-600">
                  {t(
                    'Choose the role and generate a link. Whoever signs up with this link is automatically added to your team.',
                    'Escolha a funcao e gere um link. Quem cadastrar com esse link entra automaticamente no seu time.'
                  )}
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <select
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value as InvitableRole)}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs"
                  >
                    <option value="MEMBER">{t('Member', 'Colaborador')}</option>
                    <option value="SUPERVISOR">{t('Supervisor', 'Supervisor')}</option>
                    <option value="HR">HR</option>
                  </select>

                  <input
                    type="number"
                    min="1"
                    value={inviteTtlHours}
                    onChange={(event) => setInviteTtlHours(event.target.value)}
                    placeholder={t('TTL in hours', 'TTL em horas')}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs"
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateInviteLink}
                    disabled={inviteLoading}
                    className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {inviteLoading
                      ? t('Generating invite...', 'Gerando convite...')
                      : t('Generate invite link', 'Gerar link de convite')}
                  </button>

                  {inviteUrl ? (
                    <button
                      type="button"
                      onClick={handleCopyInviteLink}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                    >
                      {t('Copy link', 'Copiar link')}
                    </button>
                  ) : null}
                </div>

                {inviteUrl ? (
                  <input
                    readOnly
                    value={inviteUrl}
                    className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                  />
                ) : null}

                {inviteError ? <p className="mt-2 text-xs text-rose-600">{inviteError}</p> : null}
                {invitePurchaseUrl ? (
                  <p className="mt-1 text-xs text-rose-700">
                    {t('Buy additional seats by clicking', 'Compre assentos adicionais clicando')}{' '}
                    <a
                      href={invitePurchaseUrl}
                      className="font-semibold underline underline-offset-2"
                    >
                      {t('here', 'aqui')}
                    </a>
                    .
                  </p>
                ) : null}
                {inviteNotice ? <p className="mt-2 text-xs text-emerald-600">{inviteNotice}</p> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-900">{t('Vacation (HR)', 'Ferias (RH)')}</h3>
            <button
              onClick={() => loadVacationRequests().catch(() => undefined)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
            >
              {t('Refresh', 'Atualizar')}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {t(
              'Requests approved by supervisor waiting for final HR confirmation.',
              'Solicitacoes aprovadas pelo supervisor aguardando confirmacao final do RH.'
            )}
          </p>
          {vacationError ? <p className="mt-2 text-xs text-rose-600">{vacationError}</p> : null}
          {vacationNotice ? <p className="mt-2 text-xs text-emerald-600">{vacationNotice}</p> : null}

          <div className="mt-4 space-y-3">
            {vacationLoading ? (
              <p className="text-sm text-slate-500">
                {t('Loading vacation requests...', 'Carregando solicitacoes de ferias...')}
              </p>
            ) : null}
            {!vacationLoading && visibleVacationRequests.length === 0 ? (
              <p className="text-sm text-slate-500">
                {t('No HR-pending requests.', 'Nenhuma solicitacao pendente de RH.')}
              </p>
            ) : null}

            {visibleVacationRequests.map((request) => (
              <div key={request.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-sm font-semibold text-slate-800">{request.user.name}</p>
                <p className="text-xs text-slate-500">{request.user.email}</p>
                <p className="mt-2 text-xs text-slate-600">
                  {t('Period:', 'Periodo:')} {new Date(request.startDate).toLocaleDateString(locale)} {t('to', 'ate')}{' '}
                  {new Date(request.endDate).toLocaleDateString(locale)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {t('Type:', 'Tipo:')} {getRequestTypeLabel(request.requestType || 'VACATION')}
                </p>
                {request.supervisor ? (
                  <p className="mt-1 text-xs text-slate-600">
                    {t('Supervisor:', 'Supervisor:')} {request.supervisor.name}
                  </p>
                ) : null}
                {request.reason ? (
                  <p className="mt-1 text-xs text-slate-600">
                    {t('Reason:', 'Motivo:')} {request.reason}
                  </p>
                ) : null}

                <input
                  value={vacationReviewCommentById[request.id] || ''}
                  onChange={(event) =>
                    setVacationReviewCommentById((prev) => ({
                      ...prev,
                      [request.id]: event.target.value,
                    }))
                  }
                  placeholder={t('Comment (required for rejection)', 'Comentario (obrigatorio para rejeicao)')}
                  className="mt-3 w-full rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
                />

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-900">{t('Banked hours', 'Banco de horas')}</h3>
            <button
              onClick={() => loadBankOverview().catch(() => undefined)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
            >
              {t('Refresh', 'Atualizar')}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {t(
              'View credit, debt balance, and pending amounts to post per employee.',
              'Visualize credito, saldo devedor e pendencias para baixa por colaborador.'
            )}
          </p>
          {bankNotice ? <p className="mt-2 text-xs text-emerald-600">{bankNotice}</p> : null}

          <div className="mt-4 space-y-2">
            {bankLoading ? (
              <p className="text-sm text-slate-500">{t('Loading banked hours...', 'Carregando banco de horas...')}</p>
            ) : null}
            {!bankLoading && visibleBankOverview.length === 0 ? (
              <p className="text-sm text-slate-500">
                {t('No banked-hours data available.', 'Nenhum dado de banco de horas disponivel.')}
              </p>
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
                    {bankPayLoadingByUser[row.user.id]
                      ? t('Processing...', 'Processando...')
                      : t('Post pending amount', 'Dar baixa pendente')}
                  </button>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
                  <span className="rounded-full bg-white px-3 py-1">
                    {t('Credit:', 'Credito:')} {formatMinutesLabel(row.bankHours.creditMinutes)}
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
      </div>
    </section>
  )
}

export default AdminDashboard
