import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'

type Role = 'ADMIN' | 'SUPERVISOR' | 'MEMBER'

type User = {
  id: string
  email: string
  name: string
  role: Role
  supervisor?: {
    id: string
    name: string
    email: string
  } | null
}

const roles: Role[] = ['ADMIN', 'SUPERVISOR', 'MEMBER']

const AdminDashboard = () => {
  const { session } = useAuth()
  const token = session?.access_token
  const [users, setUsers] = useState<User[]>([])
  const [editNames, setEditNames] = useState<Record<string, string>>({})
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
  }

  useEffect(() => {
    loadUsers().catch(() => undefined)
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
          <div className="mt-5 space-y-3">
            {users.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum usuario cadastrado.</p>
            ) : (
              users.map((user) => (
                <div key={user.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
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
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleUpdate(user.id, { name: editNames[user.id] || user.name })}
                        className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600"
                      >
                        Salvar
                      </button>
                      <select
                        value={user.role}
                        onChange={(event) => handleUpdate(user.id, { role: event.target.value as Role })}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                      >
                        {roles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-[auto_1fr] sm:items-center">
                    <span>Supervisor:</span>
                    <select
                      value={user.supervisor?.id || ''}
                      onChange={(event) =>
                        handleUpdate(user.id, { supervisorId: event.target.value || null })
                      }
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
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
      </div>
    </section>
  )
}

export default AdminDashboard
