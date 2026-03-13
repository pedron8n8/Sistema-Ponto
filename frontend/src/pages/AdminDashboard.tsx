import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { TIME_ZONE_OPTIONS } from '../lib/timezone'

type Role = 'ADMIN' | 'SUPERVISOR' | 'MEMBER'

type User = {
  id: string
  email: string
  name: string
  role: Role
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

const roles: Role[] = ['ADMIN', 'SUPERVISOR', 'MEMBER']

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
  const { session } = useAuth()
  const token = session?.access_token
  const [users, setUsers] = useState<User[]>([])
  const [editNames, setEditNames] = useState<Record<string, string>>({})
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({})
  const [pinLoadingByUser, setPinLoadingByUser] = useState<Record<string, boolean>>({})
  const [workSettingsByUser, setWorkSettingsByUser] = useState<Record<string, WorkSettingsForm>>({})
  const [workSettingsLoadingByUser, setWorkSettingsLoadingByUser] = useState<Record<string, boolean>>({})
  const [bankOverview, setBankOverview] = useState<BankHoursOverviewItem[]>([])
  const [bankLoading, setBankLoading] = useState(false)
  const [bankPayLoadingByUser, setBankPayLoadingByUser] = useState<Record<string, boolean>>({})
  const [bankNotice, setBankNotice] = useState('')
  const [errorByUser, setErrorByUser] = useState<Record<string, string>>({})
  const [noticeByUser, setNoticeByUser] = useState<Record<string, string>>({})
  const [form, setForm] = useState({
    email: '',
    name: '',
    role: 'MEMBER' as Role,
    password: '',
    supervisorId: '',
  })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadUsers = async () => {
    if (!token) return
    const response = await apiFetch<{ users: User[] }>('/users', { token })

    setUsers(response.users)
    setEditNames(
      response.users.reduce<Record<string, string>>((acc, user) => {
        acc[user.id] = user.name
        return acc
      }, {})
    )
    setWorkSettingsByUser(
      response.users.reduce<Record<string, WorkSettingsForm>>((acc, user) => {
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

  useEffect(() => {
    loadUsers().catch(() => undefined)
  }, [token])

  useEffect(() => {
    loadBankOverview().catch(() => undefined)
  }, [token])

  const handleCreate = async () => {
    if (!token) return
    setError('')
    setNotice('')

    try {
      await apiFetch('/users', {
        token,
        method: 'POST',
        body: {
          email: form.email,
          name: form.name,
          role: form.role,
          password: form.password,
          supervisorId: form.supervisorId || null,
        },
      })

      setForm({ email: '', name: '', role: 'MEMBER', password: '', supervisorId: '' })
      await loadUsers()
      setNotice('Usuario criado com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar usuario')
    }
  }

  const handleUpdate = async (userId: string, updates: Partial<User> & { supervisorId?: string | null }) => {
    if (!token) return
    setError('')
    setNotice('')

    try {
      await apiFetch(`/users/${userId}`, { token, method: 'PATCH', body: updates })
      await loadUsers()
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

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">Admin</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">Gestao de usuarios centralizada.</h2>
        <p className="mt-4 text-sm text-slate-600">Crie perfis, ajuste roles e atribua supervisores.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
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
                  <div className="space-y-2">
                    <input
                      value={editNames[user.id] || ''}
                      onChange={(event) =>
                        setEditNames((prev) => ({ ...prev, [user.id]: event.target.value }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-1 text-sm"
                    />
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Conta</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-center">
                      <select
                        value={user.role}
                        onChange={(event) => handleUpdate(user.id, { role: event.target.value as Role })}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs"
                      >
                        {roles.map((role) => (
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
              onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as Role }))}
              className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm"
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
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
            {!bankLoading && bankOverview.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum dado de banco de horas disponível.</p>
            ) : null}
            {bankOverview.map((row) => (
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
