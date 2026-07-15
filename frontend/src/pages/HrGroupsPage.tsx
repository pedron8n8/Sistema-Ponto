import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'

type Role = 'SUPERADMIN' | 'ADMIN' | 'HR' | 'SUPERVISOR' | 'MEMBER'
type ManageableRole = 'SUPERVISOR' | 'MEMBER'

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

const MANAGEABLE_ROLES: ManageableRole[] = ['SUPERVISOR', 'MEMBER']
const isManageableRole = (role: Role): role is ManageableRole => MANAGEABLE_ROLES.includes(role as ManageableRole)

// ponytail: HR nao convida/cria usuarios por essa tela ainda, so gerencia os existentes.
// Criacao pode ser adicionada depois reaproveitando POST /users (backend ja aceita HR).
const HrGroupsPage = () => {
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

  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({
    name: '',
    role: 'MEMBER' as ManageableRole,
    supervisorId: '',
  })
  const [editSaving, setEditSaving] = useState(false)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())

  const loadUsers = async () => {
    if (!token) return
    setLoading(true)
    setError('')

    try {
      const response = await apiFetch<{ users: User[] }>('/users?limit=300', { token })
      setUsers(response.users || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not load users.', 'Erro ao carregar usuarios.'))
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers().catch(() => undefined)
  }, [token])

  const activeUsers = useMemo(() => users.filter((user) => user.isActive !== false), [users])
  const inactiveUsers = useMemo(() => users.filter((user) => user.isActive === false), [users])

  const supervisorOptions = useMemo(() => {
    return users
      .filter((user) => user.isActive !== false)
      .filter((user) => ['ADMIN', 'HR', 'SUPERVISOR'].includes(user.role))
      .sort((a, b) => a.name.localeCompare(b.name, locale))
  }, [users, locale])

  // Arvore sempre organizada pela hierarquia real: Admin -> HR -> Supervisor -> Membros.
  // Quem nao tem supervisor definido cai direto sob o Admin da organizacao (raiz implicita).
  const tree = useMemo(() => {
    const byId = new Map(activeUsers.map((user) => [user.id, user]))
    const admin = activeUsers.find((user) => user.role === 'ADMIN') || null

    const childrenById = new Map<string, User[]>()
    const roots: User[] = []

    for (const user of activeUsers) {
      if (user.role === 'ADMIN') continue
      const parentId = user.supervisor?.id && byId.has(user.supervisor.id) ? user.supervisor.id : admin?.id
      if (!parentId) {
        roots.push(user)
        continue
      }
      const bucket = childrenById.get(parentId) || []
      bucket.push(user)
      childrenById.set(parentId, bucket)
    }

    const sortByName = (list: User[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, locale))
    for (const [key, list] of childrenById) childrenById.set(key, sortByName(list))

    return { admin, childrenById, roots: sortByName(roots) }
  }, [activeUsers, locale])

  const openUserEditor = (user: User) => {
    if (!isManageableRole(user.role)) return
    setEditingUserId(user.id)
    setEditDraft({
      name: user.name || '',
      role: user.role,
      supervisorId: user.supervisor?.id || '',
    })
    setError('')
    setNotice('')
  }

  const closeUserEditor = () => {
    setEditingUserId(null)
    setEditDraft({ name: '', role: 'MEMBER', supervisorId: '' })
  }

  const handleSaveUserData = async () => {
    if (!token || !editingUserId || editSaving) return

    const trimmedName = editDraft.name.trim()
    if (trimmedName.length < 2) {
      setError(t('Name must have at least 2 characters.', 'Nome deve ter pelo menos 2 caracteres.'))
      return
    }

    setError('')
    setNotice('')
    setEditSaving(true)

    try {
      await apiFetch(`/users/${editingUserId}`, {
        token,
        method: 'PATCH',
        body: {
          name: trimmedName,
          role: editDraft.role,
          supervisorId: editDraft.supervisorId || null,
        },
      })

      closeUserEditor()
      await loadUsers()
      setNotice(t('User updated successfully.', 'Usuario atualizado com sucesso.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not update user.', 'Erro ao atualizar usuario.'))
    } finally {
      setEditSaving(false)
    }
  }

  const handleToggleActive = async (user: User) => {
    if (!token) return

    setError('')
    setNotice('')

    try {
      await apiFetch(`/users/${user.id}`, {
        token,
        method: 'PATCH',
        body: { isActive: user.isActive === false },
      })

      await loadUsers()
      setNotice(
        user.isActive === false
          ? t('User reactivated successfully.', 'Usuario reativado com sucesso.')
          : t('User deactivated successfully.', 'Usuario desativado com sucesso.')
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not update user.', 'Erro ao atualizar usuario.'))
    }
  }

  const toggleCollapse = (userId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const renderTree = (user: User, visited: Set<string> = new Set()) => {
    if (visited.has(user.id)) return null
    const nextVisited = new Set(visited).add(user.id)
    const children = tree.childrenById.get(user.id) || []
    const hasChildren = children.length > 0
    const collapsed = collapsedIds.has(user.id)

    return (
      <div key={user.id} className="space-y-2">
        <div className="flex items-start gap-2">
          {hasChildren ? (
            <button
              onClick={() => toggleCollapse(user.id)}
              aria-label={collapsed ? t('Expand', 'Expandir') : t('Collapse', 'Recolher')}
              className="mt-4 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-600"
            >
              {collapsed ? '+' : '−'}
            </button>
          ) : (
            <span className="mt-4 h-6 w-6 shrink-0" />
          )}
          <div className="flex-1">{renderUserRow(user)}</div>
        </div>

        {hasChildren && !collapsed ? (
          <div className="ml-4 space-y-2 border-l-2 border-slate-100 pl-4">
            {children.map((child) => renderTree(child, nextVisited))}
          </div>
        ) : null}
      </div>
    )
  }

  const renderUserRow = (user: User) => {
    const manageable = isManageableRole(user.role)

    return (
      <div key={user.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {user.name} <span className="font-normal text-slate-500">({user.role})</span>
            </p>
            <p className="text-xs text-slate-500">{user.email}</p>
            <p className="mt-1 text-xs text-slate-600">
              {t('Supervisor', 'Supervisor')}: {user.supervisor ? `${user.supervisor.name} (${user.supervisor.role})` : t('None', 'Nenhum')}
            </p>
          </div>

          {manageable ? (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => (editingUserId === user.id ? closeUserEditor() : openUserEditor(user))}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                {editingUserId === user.id ? t('Close editor', 'Fechar edicao') : t('Edit', 'Editar')}
              </button>

              <button
                onClick={() => handleToggleActive(user)}
                disabled={user.id === profile?.id}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  user.isActive === false
                    ? 'border-teal-200 bg-teal-700 text-white'
                    : 'border-amber-200 bg-white text-amber-700'
                }`}
              >
                {user.isActive === false ? t('Reactivate', 'Reativar') : t('Deactivate', 'Desativar')}
              </button>
            </div>
          ) : (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-400">
              {t('View only', 'Somente visualizacao')}
            </span>
          )}
        </div>

        {manageable && editingUserId === user.id ? (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="grid gap-2 md:grid-cols-3">
              <input
                type="text"
                value={editDraft.name}
                onChange={(event) => setEditDraft((prev) => ({ ...prev, name: event.target.value }))}
                placeholder={t('Name', 'Nome')}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm"
              />

              <select
                value={editDraft.role}
                onChange={(event) => setEditDraft((prev) => ({ ...prev, role: event.target.value as ManageableRole }))}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="MEMBER">MEMBER</option>
                <option value="SUPERVISOR">SUPERVISOR</option>
              </select>

              <select
                value={editDraft.supervisorId}
                onChange={(event) => setEditDraft((prev) => ({ ...prev, supervisorId: event.target.value }))}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">{t('No supervisor', 'Sem supervisor')}</option>
                {supervisorOptions
                  .filter((option) => option.id !== user.id)
                  .map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} ({option.role})
                    </option>
                  ))}
              </select>
            </div>

            <button
              onClick={handleSaveUserData}
              disabled={editSaving}
              className="mt-2 rounded-full bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {editSaving ? t('Saving...', 'Salvando...') : t('Save', 'Salvar')}
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('HR', 'RH')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{t('Teams & groups', 'Equipes e grupos')}</h2>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'View everyone in your organization, move Members and Supervisors between teams, and put Supervisors under your supervision.',
            'Veja todos da sua organizacao, mova Membros e Supervisores entre times e coloque Supervisores sob sua supervisao.'
          )}
        </p>
      </div>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div> : null}
      {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{notice}</div> : null}

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">{t('Hierarchy', 'Hierarquia')}</h3>
          <button
            onClick={() => loadUsers().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
          >
            {t('Refresh', 'Atualizar')}
          </button>
        </div>

        {loading ? <p className="mt-3 text-sm text-slate-500">{t('Loading...', 'Carregando...')}</p> : null}

        <div className="mt-4 space-y-6">
          {tree.admin ? renderTree(tree.admin) : null}

          {tree.roots.length > 0 ? (
            <div>
              {tree.admin ? (
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {t('Unassigned', 'Sem vinculo')}
                </p>
              ) : null}
              <div className="mt-2 space-y-2">{tree.roots.map((user) => renderTree(user))}</div>
            </div>
          ) : null}

          {activeUsers.length === 0 && !loading ? (
            <p className="text-sm text-slate-500">{t('No users yet.', 'Nenhum usuario ainda.')}</p>
          ) : null}
        </div>
      </div>

      {inactiveUsers.length > 0 ? (
        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">{t('Deactivated users', 'Usuarios desativados')}</h3>
          <div className="mt-4 space-y-2">{inactiveUsers.map((user) => renderUserRow(user))}</div>
        </div>
      ) : null}
    </section>
  )
}

export default HrGroupsPage
