import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'

type CatalogTool = {
  name: string
  title: string
  titleEn: string
  description: string
  access: 'read' | 'write'
  roles: string[]
  plans: string[] | null
  method: string
  path: string
  sensitive: boolean
}

type CatalogGroup = {
  group: string
  label: string
  labelEn: string
  tools: CatalogTool[]
}

type CatalogResponse = {
  mcpUrl: string
  groups: CatalogGroup[]
  totalTools: number
}

type McpConnection = {
  id: string
  name: string
  tools: string[]
  toolCount: number
  scopes: string[]
  isActive: boolean
  createdAt: string
  updatedAt: string
  connectedClients?: number
}

type ConnectionsResponse = {
  mcpUrl: string
  connections: McpConnection[]
}

type ConnectedClient = {
  clientId: string
  clientName: string
  authorizedBy: { id: string; name: string | null; email: string; role: string } | null
  authorizedAt: string
  lastUsedAt: string | null
}

const CARD = 'rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm'
const HERO =
  'rounded-3xl border border-white/80 bg-white/85 p-7 shadow-[0_16px_38px_-30px_rgba(15,23,42,0.6)] backdrop-blur'
const PRIMARY_BTN =
  'rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60'
const SECONDARY_BTN =
  'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60'
const FIELD_LABEL = 'text-xs font-semibold uppercase tracking-[0.2em] text-slate-500'
const INPUT = 'rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm'

// Grupos que mexem em dinheiro ou expoem dado financeiro comecam desmarcados.
const OFF_BY_DEFAULT = new Set(['billing', 'platform'])

const AdminMcpPage = () => {
  const { session, profile } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const locale = isPt ? 'pt-BR' : 'en-US'
  const token = session?.access_token

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [catalog, setCatalog] = useState<CatalogGroup[]>([])
  const [mcpUrl, setMcpUrl] = useState('')
  const [connections, setConnections] = useState<McpConnection[]>([])

  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)

  const [clientsFor, setClientsFor] = useState<string | null>(null)
  const [clients, setClients] = useState<ConnectedClient[]>([])
  const [loadingClients, setLoadingClients] = useState(false)

  const canManage = profile?.role === 'ADMIN' || profile?.role === 'INTEGRATOR' || profile?.role === 'SUPERADMIN'

  const groupLabel = (group: CatalogGroup) => (isPt ? group.label : group.labelEn)
  const toolTitle = (tool: CatalogTool) => (isPt ? tool.title : tool.titleEn)

  const load = async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const [catalogResponse, connectionsResponse] = await Promise.all([
        apiFetch<CatalogResponse>('/mcp/catalog', { token }),
        apiFetch<ConnectionsResponse>('/mcp/connections', { token }),
      ])

      setCatalog(catalogResponse.groups)
      setMcpUrl(connectionsResponse.mcpUrl || catalogResponse.mcpUrl)
      setConnections(connectionsResponse.connections)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not load MCP connections.', 'Erro ao carregar conexoes MCP.')
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const totalTools = useMemo(
    () => catalog.reduce((sum, group) => sum + group.tools.length, 0),
    [catalog]
  )

  const toggleTool = (toolName: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(toolName)) next.delete(toolName)
      else next.add(toolName)
      return next
    })
  }

  const setGroupTools = (group: CatalogGroup, access: 'read' | 'write' | 'all', on: boolean) => {
    const names = group.tools
      .filter((tool) => access === 'all' || tool.access === access)
      .map((tool) => tool.name)

    setSelected((current) => {
      const next = new Set(current)
      for (const toolName of names) {
        if (on) next.add(toolName)
        else next.delete(toolName)
      }
      return next
    })
  }

  const groupState = (group: CatalogGroup, access: 'read' | 'write' | 'all') => {
    const names = group.tools
      .filter((tool) => access === 'all' || tool.access === access)
      .map((tool) => tool.name)
    if (names.length === 0) return 'none'
    const on = names.filter((toolName) => selected.has(toolName)).length
    if (on === 0) return 'none'
    return on === names.length ? 'all' : 'some'
  }

  const resetForm = () => {
    setName('')
    setSelected(new Set())
    setEditingId(null)
  }

  const startEdit = (connection: McpConnection) => {
    setEditingId(connection.id)
    setName(connection.name)
    setSelected(new Set(connection.tools))
    setNotice('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async () => {
    if (!token || saving) return

    if (name.trim().length < 2) {
      setError(t('Give the connection a name.', 'Informe um nome para a conexao.'))
      return
    }
    if (selected.size === 0) {
      setError(t('Select at least one function.', 'Selecione ao menos uma funcao.'))
      return
    }

    setSaving(true)
    setError('')
    setNotice('')

    try {
      const body = { name: name.trim(), tools: Array.from(selected) }

      if (editingId) {
        await apiFetch(`/mcp/connections/${editingId}`, { token, method: 'PATCH', body })
        setNotice(t('Connection updated.', 'Conexao atualizada.'))
      } else {
        await apiFetch('/mcp/connections', { token, method: 'POST', body })
        setNotice(
          t(
            'Connection created. Now add the URL below in your AI client.',
            'Conexao criada. Agora adicione a URL abaixo no seu cliente de IA.'
          )
        )
      }

      resetForm()
      await load()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('Could not save connection.', 'Erro ao salvar conexao.')
      )
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (connection: McpConnection) => {
    if (!token) return

    setError('')
    setNotice('')

    try {
      await apiFetch(`/mcp/connections/${connection.id}`, {
        token,
        method: 'PATCH',
        body: { isActive: !connection.isActive },
      })
      setNotice(
        connection.isActive
          ? t('Connection disabled. Connected AIs lose access now.', 'Conexao desativada. As IAs conectadas perdem acesso agora.')
          : t('Connection enabled.', 'Conexao reativada.')
      )
      await load()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('Could not update connection.', 'Erro ao atualizar conexao.')
      )
    }
  }

  const remove = async (connection: McpConnection) => {
    if (!token) return

    setError('')
    setNotice('')

    try {
      await apiFetch(`/mcp/connections/${connection.id}`, { token, method: 'DELETE' })
      setNotice(t('Connection removed and access revoked.', 'Conexao removida e acesso revogado.'))
      if (editingId === connection.id) resetForm()
      if (clientsFor === connection.id) setClientsFor(null)
      await load()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('Could not remove connection.', 'Erro ao remover conexao.')
      )
    }
  }

  const loadClients = async (connection: McpConnection) => {
    if (!token) return

    if (clientsFor === connection.id) {
      setClientsFor(null)
      return
    }

    setLoadingClients(true)
    setClientsFor(connection.id)
    setClients([])

    try {
      const response = await apiFetch<{ clients: ConnectedClient[] }>(
        `/mcp/connections/${connection.id}/clients`,
        { token }
      )
      setClients(response.clients)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('Could not load connected AIs.', 'Erro ao carregar IAs conectadas.')
      )
    } finally {
      setLoadingClients(false)
    }
  }

  const disconnectClient = async (connectionId: string, clientId: string) => {
    if (!token) return

    try {
      await apiFetch(`/mcp/connections/${connectionId}/clients/${clientId}`, {
        token,
        method: 'DELETE',
      })
      setNotice(t('AI disconnected.', 'IA desconectada.'))
      const connection = connections.find((item) => item.id === connectionId)
      if (connection) {
        setClientsFor(null)
        await loadClients(connection)
      }
      await load()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('Could not disconnect.', 'Erro ao desconectar.')
      )
    }
  }

  const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale) : t('never', 'nunca')

  if (!canManage) {
    return (
      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-8 text-slate-800">
        <p className="text-xs uppercase tracking-[0.28em] text-amber-700">
          {t('Access required', 'Acesso necessario')}
        </p>
        <h2 className="mt-3 text-2xl font-semibold">
          {t('MCP connections unavailable', 'Conexoes MCP indisponiveis')}
        </h2>
        <p className="mt-2 text-sm text-amber-900">
          {t(
            'Only ADMIN and INTEGRATOR can create MCP connections.',
            'Somente ADMIN e INTEGRATOR podem criar conexoes MCP.'
          )}
        </p>
      </section>
    )
  }

  return (
    <section className="grid gap-6">
      <div className={HERO}>
        <p className="text-xs uppercase tracking-[0.3em] text-teal-700">MCP</p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-900">
          {t('AI connections', 'Conexoes de IA')}
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          {t(
            'Create a connection, choose exactly which functions it may read and write, then add the URL below in Claude or another MCP client. When connecting, the person signs in here and picks which connection to authorize — the AI then acts with that person permissions, limited by what you checked.',
            'Crie uma conexao, escolha exatamente quais funcoes ela pode ler e escrever, e depois adicione a URL abaixo no Claude ou em outro cliente MCP. Ao conectar, a pessoa faz login aqui e escolhe qual conexao autorizar — a IA passa a agir com as permissoes dela, limitada ao que voce marcou.'
          )}
        </p>

        {mcpUrl ? (
          <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            <p className={FIELD_LABEL}>{t('MCP server URL', 'URL do servidor MCP')}</p>
            <code className="mt-2 block break-all text-sm text-slate-800">{mcpUrl}</code>
            <p className="mt-3 text-xs text-slate-500">
              {t('In Claude Code:', 'No Claude Code:')}
            </p>
            <code className="mt-1 block break-all text-xs text-slate-700">
              claude mcp add --transport http omnipunt {mcpUrl}
            </code>
          </div>
        ) : null}
      </div>

      {/* ---------------------------------------------------------- formulario */}
      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">
            {editingId
              ? t('Edit connection', 'Editar conexao')
              : t('New connection', 'Nova conexao')}
          </h3>
          <p className="text-xs text-slate-500">
            {selected.size} / {totalTools} {t('functions selected', 'funcoes selecionadas')}
          </p>
        </div>

        <div className="mt-4 grid gap-2">
          <label className={FIELD_LABEL}>{t('Connection name', 'Nome da conexao')}</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('e.g. Claude - HR team', 'ex.: Claude - equipe de RH')}
            className={INPUT}
          />
        </div>

        <p className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-xs text-slate-600">
          {t(
            'Select only what the AI actually needs. A connection with dozens of tools makes the model pick worse, and every checked function is a permission you are granting.',
            'Selecione so o que a IA realmente precisa. Uma conexao com dezenas de ferramentas faz o modelo escolher pior, e cada funcao marcada e uma permissao que voce esta concedendo.'
          )}
        </p>

        <div className="mt-4 grid gap-3">
          {catalog.map((group) => {
            const readState = groupState(group, 'read')
            const writeState = groupState(group, 'write')
            const hasRead = group.tools.some((tool) => tool.access === 'read')
            const hasWrite = group.tools.some((tool) => tool.access === 'write')
            const isRisky = OFF_BY_DEFAULT.has(group.group)

            return (
              <details
                key={group.group}
                className={`rounded-2xl border p-4 ${
                  isRisky ? 'border-amber-200 bg-amber-50/50' : 'border-slate-100 bg-slate-50/70'
                }`}
              >
                <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                  {groupLabel(group)}{' '}
                  <span className="font-normal text-slate-500">
                    ({group.tools.filter((tool) => selected.has(tool.name)).length}/{group.tools.length})
                  </span>
                  {isRisky ? (
                    <span className="ml-2 text-xs font-normal text-amber-700">
                      {t('sensitive', 'sensivel')}
                    </span>
                  ) : null}
                </summary>

                <div className="mt-3 flex flex-wrap gap-2">
                  {hasRead ? (
                    <button
                      type="button"
                      className={SECONDARY_BTN}
                      onClick={() => setGroupTools(group, 'read', readState !== 'all')}
                    >
                      {readState === 'all'
                        ? t('Clear read', 'Limpar leitura')
                        : t('All read', 'Toda leitura')}
                    </button>
                  ) : null}
                  {hasWrite ? (
                    <button
                      type="button"
                      className={SECONDARY_BTN}
                      onClick={() => setGroupTools(group, 'write', writeState !== 'all')}
                    >
                      {writeState === 'all'
                        ? t('Clear write', 'Limpar escrita')
                        : t('All write', 'Toda escrita')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={SECONDARY_BTN}
                    onClick={() => setGroupTools(group, 'all', groupState(group, 'all') !== 'all')}
                  >
                    {groupState(group, 'all') === 'all'
                      ? t('Clear all', 'Limpar tudo')
                      : t('Select all', 'Marcar tudo')}
                  </button>
                </div>

                <div className="mt-3 grid gap-2">
                  {group.tools.map((tool) => (
                    <label
                      key={tool.name}
                      className="flex items-start gap-2 text-sm text-slate-700"
                      title={tool.description}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.has(tool.name)}
                        onChange={() => toggleTool(tool.name)}
                      />
                      <span>
                        <span className="font-medium">{toolTitle(tool)}</span>
                        <span
                          className={`ml-2 text-[11px] uppercase tracking-[0.12em] ${
                            tool.access === 'write' ? 'text-rose-700' : 'text-teal-700'
                          }`}
                        >
                          {tool.access === 'write' ? t('write', 'escrita') : t('read', 'leitura')}
                        </span>
                        {tool.sensitive ? (
                          <span className="ml-2 text-[11px] uppercase tracking-[0.12em] text-amber-700">
                            {t('sensitive', 'sensivel')}
                          </span>
                        ) : null}
                        {tool.plans ? (
                          <span className="ml-2 text-[11px] uppercase tracking-[0.12em] text-slate-400">
                            {tool.plans.join('/')}
                          </span>
                        ) : null}
                        <span className="block text-xs text-slate-500">{tool.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </details>
            )
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" className={PRIMARY_BTN} onClick={save} disabled={saving || loading}>
            {saving
              ? t('Saving...', 'Salvando...')
              : editingId
                ? t('Save changes', 'Salvar alteracoes')
                : t('Create connection', 'Criar conexao')}
          </button>
          {editingId ? (
            <button type="button" className={SECONDARY_BTN} onClick={resetForm}>
              {t('Cancel', 'Cancelar')}
            </button>
          ) : null}
        </div>
      </div>

      {/* ---------------------------------------------------------- conexoes */}
      <div className="grid gap-4 lg:grid-cols-2">
        {connections.map((connection) => (
          <div key={connection.id} className={CARD}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{connection.name}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {connection.toolCount} {t('functions', 'funcoes')} ·{' '}
                  {connection.isActive ? t('active', 'ativa') : t('disabled', 'desativada')}
                  {connection.connectedClients
                    ? ` · ${connection.connectedClients} ${t('active tokens', 'tokens ativos')}`
                    : ''}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                  connection.isActive
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {connection.isActive ? t('on', 'on') : t('off', 'off')}
              </span>
            </div>

            <p className="mt-3 text-xs text-slate-500">{connection.scopes.join(' · ')}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={SECONDARY_BTN} onClick={() => startEdit(connection)}>
                {t('Edit permissions', 'Editar permissoes')}
              </button>
              <button type="button" className={SECONDARY_BTN} onClick={() => loadClients(connection)}>
                {clientsFor === connection.id
                  ? t('Hide connected AIs', 'Ocultar IAs conectadas')
                  : t('Connected AIs', 'IAs conectadas')}
              </button>
              <button type="button" className={SECONDARY_BTN} onClick={() => toggleActive(connection)}>
                {connection.isActive ? t('Disable', 'Desativar') : t('Enable', 'Reativar')}
              </button>
              <button
                type="button"
                className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700"
                onClick={() => remove(connection)}
              >
                {t('Remove', 'Remover')}
              </button>
            </div>

            {clientsFor === connection.id ? (
              <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                {loadingClients ? (
                  <p className="text-xs text-slate-500">{t('Loading...', 'Carregando...')}</p>
                ) : clients.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    {t('No AI connected yet.', 'Nenhuma IA conectada ainda.')}
                  </p>
                ) : (
                  <div className="grid gap-3">
                    {clients.map((client) => (
                      <div
                        key={`${client.clientId}-${client.authorizedBy?.id}`}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="text-xs text-slate-600">
                          <p className="font-semibold text-slate-800">{client.clientName}</p>
                          <p>
                            {t('authorized by', 'autorizado por')}{' '}
                            {client.authorizedBy?.name || client.authorizedBy?.email || '—'} (
                            {client.authorizedBy?.role})
                          </p>
                          <p>
                            {t('last used', 'ultimo uso')}: {formatDate(client.lastUsedAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          className={SECONDARY_BTN}
                          onClick={() => disconnectClient(connection.id, client.clientId)}
                        >
                          {t('Disconnect', 'Desconectar')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {connections.length === 0 && !loading ? (
        <p className="text-sm text-slate-500">
          {t('No connection created yet.', 'Nenhuma conexao criada ainda.')}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
          {notice}
        </p>
      ) : null}
    </section>
  )
}

export default AdminMcpPage
