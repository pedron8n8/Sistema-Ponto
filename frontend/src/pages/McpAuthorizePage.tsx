import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import BrandWordmark from '../components/BrandWordmark'
import LanguageSwitcher from '../components/LanguageSwitcher'
import LoadingScreen from '../components/LoadingScreen'

type McpConnection = {
  id: string
  name: string
  toolCount: number
  scopes: string[]
  isActive: boolean
}

type AuthorizationRequestResponse = {
  request: {
    id: string
    clientName: string
    clientUri: string | null
    scopes: string[]
    expiresAt: string
  }
  actor: {
    id: string
    name: string | null
    email: string
    role: string
    canManageConnections: boolean
  }
  connections: McpConnection[]
}

const PRIMARY_BTN =
  'rounded-full bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60'
const SECONDARY_BTN =
  'rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-60'

/**
 * Tela de consentimento do fluxo OAuth do MCP.
 *
 * Rota publica de proposito: quem chega aqui vem do redirect de /authorize no
 * backend e pode nao estar logado. Se nao estiver, manda para /login com
 * ?returnTo apontando de volta para este pedido.
 */
const McpAuthorizePage = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { session, profile, loading: authLoading } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)

  const requestId = searchParams.get('request_id') || ''
  const token = session?.access_token

  const [loading, setLoading] = useState(true)
  const [deciding, setDeciding] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<AuthorizationRequestResponse | null>(null)
  const [connectionId, setConnectionId] = useState('')

  useEffect(() => {
    if (authLoading) return
    if (session) return

    const returnTo = `${window.location.pathname}${window.location.search}`
    navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true })
  }, [authLoading, navigate, session])

  useEffect(() => {
    if (!token || !profile || !requestId) {
      if (!requestId) setLoading(false)
      return
    }

    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError('')

      try {
        const response = await apiFetch<AuthorizationRequestResponse>(
          `/mcp/oauth/request/${requestId}`,
          { token }
        )
        if (cancelled) return

        setData(response)
        const firstActive = response.connections.find((connection) => connection.isActive)
        if (firstActive) setConnectionId(firstActive.id)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error
            ? err.message
            : t('Could not load the authorization request.', 'Erro ao carregar o pedido de autorizacao.')
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load().catch(() => undefined)

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, profile, requestId])

  const decide = async (approve: boolean) => {
    if (!token || deciding) return
    if (approve && !connectionId) {
      setError(t('Pick a connection to authorize.', 'Escolha uma conexao para autorizar.'))
      return
    }

    setDeciding(true)
    setError('')

    try {
      const response = await apiFetch<{ redirectUrl: string }>('/mcp/oauth/authorize', {
        token,
        method: 'POST',
        body: { requestId, approve, ...(approve ? { connectionId } : {}) },
      })

      // Volta para o cliente MCP com o code (ou com error=access_denied).
      window.location.assign(response.redirectUrl)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not complete the authorization.', 'Erro ao concluir a autorizacao.')
      )
      setDeciding(false)
    }
  }

  if (authLoading || (session && loading)) {
    return <LoadingScreen />
  }

  if (!session) {
    return <LoadingScreen />
  }

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-3xl border border-white/80 bg-white/85 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <BrandWordmark />
          <LanguageSwitcher />
        </div>
        {children}
      </div>
    </div>
  )

  if (!requestId) {
    return shell(
      <>
        <h1 className="mt-6 text-xl font-semibold text-slate-900">
          {t('Missing authorization request', 'Pedido de autorizacao ausente')}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {t(
            'Open this page from your AI client, not directly.',
            'Abra esta pagina a partir do seu cliente de IA, nao direto.'
          )}
        </p>
        <Link to="/app" className={`mt-6 inline-block ${SECONDARY_BTN}`}>
          {t('Back to the app', 'Voltar ao painel')}
        </Link>
      </>
    )
  }

  if (error && !data) {
    return shell(
      <>
        <h1 className="mt-6 text-xl font-semibold text-slate-900">
          {t('Authorization unavailable', 'Autorizacao indisponivel')}
        </h1>
        <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          {error}
        </p>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'Authorization requests expire in 5 minutes. Try connecting again from your AI client.',
            'Pedidos de autorizacao expiram em 5 minutos. Tente conectar novamente pelo seu cliente de IA.'
          )}
        </p>
        <Link to="/app" className={`mt-6 inline-block ${SECONDARY_BTN}`}>
          {t('Back to the app', 'Voltar ao painel')}
        </Link>
      </>
    )
  }

  if (!data) return shell(<LoadingScreen />)

  const activeConnections = data.connections.filter((connection) => connection.isActive)

  return shell(
    <>
      <p className="mt-6 text-xs uppercase tracking-[0.3em] text-teal-700">
        {t('Authorize access', 'Autorizar acesso')}
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">
        {data.request.clientName} {t('wants to access OmniPunt', 'quer acessar o OmniPunt')}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        {t('Signed in as', 'Conectado como')}{' '}
        <span className="font-semibold text-slate-800">
          {data.actor.name || data.actor.email}
        </span>{' '}
        ({data.actor.role}).{' '}
        {t(
          'The AI will act with your permissions, limited to the functions of the connection you pick.',
          'A IA vai agir com as suas permissoes, limitada as funcoes da conexao que voce escolher.'
        )}
      </p>

      {activeConnections.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">
            {t('No connection available', 'Nenhuma conexao disponivel')}
          </p>
          <p className="mt-1 text-xs">
            {t(
              'Your company has no active MCP connection. An ADMIN or INTEGRATOR needs to create one first.',
              'Sua empresa nao tem nenhuma conexao MCP ativa. Um ADMIN ou INTEGRATOR precisa criar uma primeiro.'
            )}
          </p>
          {data.actor.canManageConnections ? (
            <Link to="/app/admin/mcp" className={`mt-4 inline-block ${SECONDARY_BTN}`}>
              {t('Create a connection', 'Criar uma conexao')}
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="mt-6 grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('Which connection?', 'Qual conexao?')}
          </p>
          {activeConnections.map((connection) => (
            <label
              key={connection.id}
              className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-sm ${
                connectionId === connection.id
                  ? 'border-teal-500 bg-teal-50/60'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <input
                type="radio"
                name="mcp-connection"
                className="mt-1"
                checked={connectionId === connection.id}
                onChange={() => setConnectionId(connection.id)}
              />
              <span>
                <span className="font-semibold text-slate-800">{connection.name}</span>
                <span className="block text-xs text-slate-500">
                  {connection.toolCount} {t('functions', 'funcoes')} ·{' '}
                  {connection.scopes.join(' · ')}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      {error ? (
        <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          className={PRIMARY_BTN}
          onClick={() => decide(true)}
          disabled={deciding || activeConnections.length === 0}
        >
          {deciding ? t('Authorizing...', 'Autorizando...') : t('Authorize', 'Autorizar')}
        </button>
        <button
          type="button"
          className={SECONDARY_BTN}
          onClick={() => decide(false)}
          disabled={deciding}
        >
          {t('Cancel', 'Cancelar')}
        </button>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        {t(
          'You can revoke this access at any time in Admin > MCP / AI.',
          'Voce pode revogar este acesso quando quiser em Admin > MCP / IA.'
        )}
      </p>
    </>
  )
}

export default McpAuthorizePage
