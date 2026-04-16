import { useEffect, useMemo, useState } from 'react'
import { API_BASE, apiFetch, buildIdempotencyHeaders } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'

type Role = 'SUPERADMIN' | 'ADMIN' | 'HR' | 'SUPERVISOR' | 'MEMBER'
type InvitableRole = 'HR' | 'SUPERVISOR' | 'MEMBER'

type User = {
  id: string
  name: string
  email: string
  role: Role
  isActive?: boolean
  supervisor?: {
    id: string
    name: string
    email: string
    role: Role
  } | null
}

type AdminSeatPayload = {
  admin: {
    id: string
    name: string
    email: string
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
    activeMembers?: number
    inactiveMembers?: number
    deactivatedMembers?: Array<{
      id: string
      name: string
      email: string
      role: Role
      isActive?: boolean
    }>
  }
  seats: Array<{
    seatNumber: number
    occupied: boolean
    occupant: {
      id: string
      name: string
      email: string
      role: Role
      isActive?: boolean
    } | null
  }>
}

type TeamInviteLinkResponse = {
  message?: string
  invite?: {
    url?: string
    role?: string
    expiresAt?: string
  }
  purchase?: {
    url?: string
    suggestedQuantity?: number
  }
  idempotency?: {
    ignored?: boolean
  }
}

const TEAM_ROLES: Role[] = ['HR', 'SUPERVISOR', 'MEMBER']

const AdminUsersPage = () => {
  const { session, profile } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const locale = isPt ? 'pt-BR' : 'en-US'
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [users, setUsers] = useState<User[]>([])
  const [adminSeatAssignments, setAdminSeatAssignments] = useState<AdminSeatPayload[]>([])
  const [selectedAdminId, setSelectedAdminId] = useState('')

  const [createLoading, setCreateLoading] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'MEMBER' as InvitableRole,
    supervisorId: '',
  })

  const [inviteRole, setInviteRole] = useState<InvitableRole>('MEMBER')
  const [inviteTtlHours, setInviteTtlHours] = useState('72')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteNotice, setInviteNotice] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [invitePurchaseUrl, setInvitePurchaseUrl] = useState('')

  const canManageUsers = profile?.role === 'ADMIN'
  const isSuperAdmin = profile?.role === 'SUPERADMIN'

  const loadUsers = async () => {
    if (!token) return

    try {
      const response = await apiFetch<{ users: User[] }>('/users?limit=300', { token })
      setUsers(response.users || [])
    } catch (err) {
      if (isSuperAdmin) {
        setUsers([])
        return
      }
      throw err
    }
  }

  const loadAdminSeatAssignments = async () => {
    if (!token) return

    const response = await apiFetch<{ admins: AdminSeatPayload[] }>('/users/admin-seats', { token })
    setAdminSeatAssignments(response.admins || [])
  }

  const loadData = async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      await Promise.all([loadUsers(), loadAdminSeatAssignments()])
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not load user data.', 'Erro ao carregar dados de usuarios')
      )
      setUsers([])
      setAdminSeatAssignments([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData().catch(() => undefined)
  }, [token])

  useEffect(() => {
    if (adminSeatAssignments.length === 0) {
      setSelectedAdminId('')
      return
    }

    if (selectedAdminId && adminSeatAssignments.some((item) => item.admin.id === selectedAdminId)) {
      return
    }

    setSelectedAdminId(adminSeatAssignments[0].admin.id)
  }, [adminSeatAssignments, selectedAdminId])

  const selectedSeatAssignment = useMemo(() => {
    if (adminSeatAssignments.length === 0) return null
    if (!selectedAdminId) return adminSeatAssignments[0]
    return adminSeatAssignments.find((item) => item.admin.id === selectedAdminId) || adminSeatAssignments[0]
  }, [adminSeatAssignments, selectedAdminId])

  const fallbackActiveFromSeats = useMemo(() => {
    const seatPayload = selectedSeatAssignment
    if (!seatPayload) return [] as User[]

    return seatPayload.seats
      .map((seat) => seat.occupant)
      .filter((occupant): occupant is NonNullable<typeof occupant> => Boolean(occupant))
      .map((occupant) => ({
        id: occupant.id,
        name: occupant.name,
        email: occupant.email,
        role: occupant.role,
        isActive: true,
      }))
  }, [selectedSeatAssignment])

  const fallbackInactiveFromSeats = useMemo(() => {
    const seatPayload = selectedSeatAssignment
    if (!seatPayload) return [] as User[]

    return (seatPayload.team.deactivatedMembers || []).map((member) => ({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      isActive: false,
    }))
  }, [selectedSeatAssignment])

  const activeUsers = useMemo(() => {
    const fromUsers = users.filter((user) => TEAM_ROLES.includes(user.role) && user.isActive !== false)
    if (fromUsers.length > 0) return fromUsers
    return fallbackActiveFromSeats
  }, [users, fallbackActiveFromSeats])

  const inactiveUsers = useMemo(() => {
    const fromUsers = users.filter((user) => TEAM_ROLES.includes(user.role) && user.isActive === false)
    if (fromUsers.length > 0) return fromUsers
    return fallbackInactiveFromSeats
  }, [users, fallbackInactiveFromSeats])

  const supervisorOptions = useMemo(() => {
    return users
      .filter((user) => user.isActive !== false)
      .filter((user) => ['ADMIN', 'HR', 'SUPERVISOR'].includes(user.role))
      .sort((a, b) => a.name.localeCompare(b.name, locale))
  }, [users, locale])

  const refreshTeamData = async () => {
    await Promise.all([loadUsers(), loadAdminSeatAssignments()])
  }

  const handleCreate = async () => {
    if (!token || createLoading || !canManageUsers) return

    setError('')
    setNotice('')

    if (form.name.trim().length < 2) {
      setError(t('Name must have at least 2 characters.', 'Nome deve ter pelo menos 2 caracteres.'))
      return
    }

    if (!form.email.includes('@')) {
      setError(t('Invalid email.', 'Email invalido.'))
      return
    }

    if (form.password.length < 6) {
      setError(t('Password must have at least 6 characters.', 'Senha deve ter pelo menos 6 caracteres.'))
      return
    }

    setCreateLoading(true)

    try {
      const createPayload = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        role: form.role,
        supervisorId: form.supervisorId || null,
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

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string
        billing?: {
          stripe?: {
            checkoutUrl?: string
          }
        }
        idempotency?: {
          ignored?: boolean
        }
      }

      if (response.status === 202 && payload?.idempotency?.ignored) {
        setNotice(
          payload.message ||
            t('Duplicate request ignored successfully.', 'Requisicao duplicada ignorada com sucesso.')
        )
        return
      }

      if (response.status === 402) {
        const checkoutUrl = String(payload?.billing?.stripe?.checkoutUrl || '').trim()
        if (checkoutUrl) {
          setNotice(
            t(
              'Redirecting to additional seats checkout...',
              'Redirecionando para o checkout de assentos adicionais...'
            )
          )
          window.location.assign(checkoutUrl)
          return
        }

        throw new Error(
          payload.message ||
            t(
              'Seat limit exceeded for creating a new user.',
              'Limite de cadeiras excedido para criacao de novo usuario.'
            )
        )
      }

      if (!response.ok) {
        throw new Error(payload.message || t('Could not create user.', 'Erro ao criar usuario.'))
      }

      setForm({
        name: '',
        email: '',
        password: '',
        role: 'MEMBER',
        supervisorId: '',
      })

      await refreshTeamData()
      setNotice(t('User created successfully.', 'Usuario criado com sucesso.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not create user.', 'Erro ao criar usuario.'))
    } finally {
      setCreateLoading(false)
    }
  }

  const handleGenerateInviteLink = async () => {
    if (!token || inviteLoading || !canManageUsers) return

    setInviteError('')
    setInviteNotice('')
    setInvitePurchaseUrl('')

    const parsedTtl = Number(inviteTtlHours)
    if (!Number.isInteger(parsedTtl) || parsedTtl < 1) {
      setInviteError(
        t(
          'Invite TTL must be an integer greater than or equal to 1 hour.',
          'TTL do convite deve ser um inteiro maior ou igual a 1 hora.'
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
          payload?.message ||
            t(
              'Duplicate request ignored. Click again to generate a new invite.',
              'Requisicao duplicada ignorada. Clique novamente para gerar novo convite.'
            )
        )
        return
      }

      if (!response.ok) {
        const purchaseUrl = String(payload?.purchase?.url || '').trim()
        if (purchaseUrl) {
          setInvitePurchaseUrl(purchaseUrl)
        }

        throw new Error(payload?.message || t('Could not generate invite link.', 'Erro ao gerar link de convite.'))
      }

      const nextInviteUrl = String(payload?.invite?.url || '').trim()
      if (!nextInviteUrl) {
        throw new Error(t('Backend did not return invite URL.', 'Backend nao retornou URL de convite.'))
      }

      setInviteUrl(nextInviteUrl)
      setInvitePurchaseUrl('')
      setInviteNotice(t('Invite link generated successfully.', 'Link de convite gerado com sucesso.'))
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
      setInviteNotice(t('Invite link copied.', 'Link de convite copiado.'))
    } catch {
      setInviteError(
        t(
          'Could not copy automatically. Copy manually from the field.',
          'Nao foi possivel copiar automaticamente. Copie manualmente no campo.'
        )
      )
    }
  }

  const handleDeactivate = async (userId: string) => {
    if (!token || !canManageUsers) return

    setError('')
    setNotice('')

    try {
      await apiFetch(`/users/${userId}`, {
        token,
        method: 'PATCH',
        body: { isActive: false },
      })

      await refreshTeamData()
      setNotice(t('User deactivated and seat released.', 'Usuario desativado e cadeira liberada.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not deactivate user.', 'Erro ao desativar usuario.'))
    }
  }

  const handleReactivate = async (userId: string) => {
    if (!token || !canManageUsers) return

    setError('')
    setNotice('')

    try {
      await apiFetch(`/users/${userId}`, {
        token,
        method: 'PATCH',
        body: { isActive: true },
      })

      await refreshTeamData()
      setNotice(t('User reactivated successfully.', 'Usuario reativado com sucesso.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not reactivate user.', 'Erro ao reativar usuario.'))
    }
  }

  const handleDelete = async (userId: string) => {
    if (!token || !canManageUsers) return

    const confirmed = window.confirm(
      t(
        'Are you sure you want to permanently remove this user?',
        'Tem certeza que deseja remover este usuario permanentemente?'
      )
    )
    if (!confirmed) return

    setError('')
    setNotice('')

    try {
      await apiFetch(`/users/${userId}`, { token, method: 'DELETE' })
      await refreshTeamData()
      setNotice(t('User removed successfully.', 'Usuario removido com sucesso.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not remove user.', 'Erro ao remover usuario.'))
    }
  }

  const selectedSeatLimit = selectedSeatAssignment?.billing.seatLimit ?? null
  const selectedOccupiedSeats = selectedSeatAssignment?.billing.occupiedSeats ?? 0
  const selectedAvailableSeats = selectedSeatAssignment?.billing.availableSeats ?? null
  const selectedInactiveCount =
    selectedSeatAssignment?.team.inactiveMembers ?? inactiveUsers.length

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Admin', 'Admin')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{t('Users and seats', 'Usuarios e assentos')}</h2>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'Create, deactivate and remove team users, with visibility into free seats and deactivated users.',
            'Crie, desative e remova usuarios do time, com visibilidade de cadeiras livres e usuarios desativados.'
          )}
        </p>
      </div>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div> : null}
      {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{notice}</div> : null}

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">{t('Seat summary', 'Resumo de cadeiras')}</h3>
          <div className="flex items-center gap-2">
            {adminSeatAssignments.length > 1 ? (
              <select
                value={selectedAdminId}
                onChange={(event) => setSelectedAdminId(event.target.value)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs"
              >
                {adminSeatAssignments.map((item) => (
                  <option key={item.admin.id} value={item.admin.id}>
                    {item.admin.name} ({item.admin.email})
                  </option>
                ))}
              </select>
            ) : null}

            <button
              onClick={() => loadData().catch(() => undefined)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
            >
              {t('Refresh', 'Atualizar')}
            </button>
          </div>
        </div>

        {loading && adminSeatAssignments.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t('Loading seats...', 'Carregando assentos...')}</p>
        ) : null}

        {selectedSeatAssignment ? (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{t('Limit', 'Limite')}</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">
                  {selectedSeatLimit === null ? t('Unlimited', 'Ilimitado') : selectedSeatLimit}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{t('Occupied', 'Ocupadas')}</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">{selectedOccupiedSeats}</p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{t('Available', 'Livres')}</p>
                <p className="mt-1 text-xl font-semibold text-emerald-700">
                  {selectedAvailableSeats === null ? t('N/A', 'N/A') : selectedAvailableSeats}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{t('Deactivated', 'Desativados')}</p>
                <p className="mt-1 text-xl font-semibold text-amber-700">{selectedInactiveCount}</p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {selectedSeatAssignment.seats.length === 0 ? (
                <p className="text-sm text-slate-500">{t('No seats configured.', 'Nenhuma cadeira configurada.')}</p>
              ) : (
                selectedSeatAssignment.seats.map((seat) => (
                  <div
                    key={`seat-${seat.seatNumber}`}
                    className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2"
                  >
                    <p className="text-xs font-semibold text-slate-700">
                      {t('Seat', 'Cadeira')} {seat.seatNumber}
                    </p>
                    <p className="text-xs text-slate-600">
                      {seat.occupant ? `${seat.occupant.name} (${seat.occupant.role})` : t('Available', 'Livre')}
                    </p>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-500">{t('No seat data to display.', 'Sem dados de assentos para exibir.')}</p>
        )}
      </div>

      {canManageUsers ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">{t('Create user', 'Criar usuario')}</h3>
            <p className="mt-2 text-xs text-slate-500">
              {t('New team member for your workspace.', 'Novo colaborador para o seu time.')}
            </p>

            <div className="mt-4 grid gap-2">
              <input
                type="text"
                placeholder={t('Name', 'Nome')}
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <input
                type="email"
                placeholder={t('Email', 'Email')}
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <input
                type="password"
                placeholder={t('Temporary password', 'Senha provisoria')}
                value={form.password}
                onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm"
              />

              <div className="grid gap-2 md:grid-cols-2">
                <select
                  value={form.role}
                  onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as InvitableRole }))}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="MEMBER">MEMBER</option>
                  <option value="SUPERVISOR">SUPERVISOR</option>
                  <option value="HR">HR</option>
                </select>

                <select
                  value={form.supervisorId}
                  onChange={(event) => setForm((prev) => ({ ...prev, supervisorId: event.target.value }))}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">{t('No supervisor', 'Sem supervisor')}</option>
                  {supervisorOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} ({option.role})
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleCreate}
                disabled={createLoading}
                className="mt-1 rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {createLoading ? t('Creating...', 'Criando...') : t('Create user', 'Criar usuario')}
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">{t('Generate invite', 'Gerar convite')}</h3>
            <p className="mt-2 text-xs text-slate-500">
              {t('Share a signup link with your team.', 'Compartilhe um link de cadastro para o time.')}
            </p>

            <div className="mt-4 grid gap-2">
              <div className="grid gap-2 md:grid-cols-2">
                <select
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as InvitableRole)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="MEMBER">MEMBER</option>
                  <option value="SUPERVISOR">SUPERVISOR</option>
                  <option value="HR">HR</option>
                </select>

                <input
                  type="number"
                  min={1}
                  value={inviteTtlHours}
                  onChange={(event) => setInviteTtlHours(event.target.value)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder={t('TTL in hours', 'TTL em horas')}
                />
              </div>

              <button
                onClick={handleGenerateInviteLink}
                disabled={inviteLoading}
                className="rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {inviteLoading
                  ? t('Generating...', 'Gerando...')
                  : t('Generate invite link', 'Gerar link de convite')}
              </button>

              {inviteUrl ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{t('Invite URL', 'URL de convite')}</p>
                  <input
                    readOnly
                    value={inviteUrl}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                  <button
                    onClick={handleCopyInviteLink}
                    className="mt-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                  >
                    {t('Copy link', 'Copiar link')}
                  </button>
                </div>
              ) : null}

              {invitePurchaseUrl ? (
                <a
                  href={invitePurchaseUrl}
                  className="inline-flex w-fit rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
                >
                  {t(
                    'Buy seats to unlock new invites',
                    'Comprar assentos para liberar novos convites'
                  )}
                </a>
              ) : null}

              {inviteError ? <p className="text-xs text-rose-600">{inviteError}</p> : null}
              {inviteNotice ? <p className="text-xs text-emerald-600">{inviteNotice}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{t('Active users', 'Usuarios ativos')}</h3>
        <div className="mt-4 space-y-3">
          {activeUsers.length === 0 ? (
            <p className="text-sm text-slate-500">{t('No active team user.', 'Nenhum usuario ativo no time.')}</p>
          ) : (
            activeUsers.map((user) => (
              <div key={user.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                    <p className="mt-1 text-xs text-slate-600">Role: {user.role}</p>
                  </div>

                  {canManageUsers ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleDeactivate(user.id)}
                        disabled={user.id === profile?.id}
                        className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 disabled:opacity-50"
                      >
                        {t('Deactivate', 'Desativar')}
                      </button>

                      <button
                        onClick={() => handleDelete(user.id)}
                        disabled={user.id === profile?.id}
                        className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50"
                      >
                        {t('Remove', 'Remover')}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{t('Deactivated users', 'Usuarios desativados')}</h3>
        <div className="mt-4 space-y-3">
          {inactiveUsers.length === 0 ? (
            <p className="text-sm text-slate-500">{t('No deactivated user.', 'Nenhum usuario desativado.')}</p>
          ) : (
            inactiveUsers.map((user) => (
              <div key={user.id} className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                    <p className="mt-1 text-xs text-slate-600">Role: {user.role}</p>
                  </div>

                  {canManageUsers ? (
                    <button
                      onClick={() => handleReactivate(user.id)}
                      className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      {t('Reactivate', 'Reativar')}
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

export default AdminUsersPage
