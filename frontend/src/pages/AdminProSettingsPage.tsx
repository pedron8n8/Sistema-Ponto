import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { usePlan } from '../hooks/usePlan'
import { useTranslation } from 'react-i18next'

type ProSettingsResponse = {
  proFeatures: {
    liveness: {
      enabled: boolean
      maxAgeMs: number
      minFrames: number
      minHeadMovementDelta: number
    }
    publicApi: {
      enabled: boolean
      defaultTokenTtlHours: number
      maxTokenTtlHours: number
    }
    recommendations: {
      publicApiScope: string[]
      endpoints: string[]
    }
  }
}

type IssuedTokenResponse = {
  token: string
  tokenPreview: string
  expiresAt: string
  ttlHours: number
}

const AdminProSettingsPage = () => {
  const { session, profile } = useAuth()
  const { isPro } = usePlan()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const locale = isPt ? 'pt-BR' : 'en-US'
  const token = session?.access_token

  const [loading, setLoading] = useState(false)
  const [savingLiveness, setSavingLiveness] = useState(false)
  const [savingApi, setSavingApi] = useState(false)
  const [issuingToken, setIssuingToken] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [livenessForm, setLivenessForm] = useState({
    enabled: true,
    maxAgeMs: '15000',
    minFrames: '8',
    minHeadMovementDelta: '0.08',
  })

  const [apiForm, setApiForm] = useState({
    enabled: true,
    defaultTokenTtlHours: '24',
    maxTokenTtlHours: '168',
    issueTtlHours: '24',
  })

  const [issuedToken, setIssuedToken] = useState<IssuedTokenResponse | null>(null)

  const loadSettings = async () => {
    if (!token || !isPro) return

    setLoading(true)
    setError('')

    try {
      const response = await apiFetch<ProSettingsResponse>('/admin/pro/settings', { token })
      setLivenessForm({
        enabled: response.proFeatures.liveness.enabled,
        maxAgeMs: String(response.proFeatures.liveness.maxAgeMs),
        minFrames: String(response.proFeatures.liveness.minFrames),
        minHeadMovementDelta: String(response.proFeatures.liveness.minHeadMovementDelta),
      })
      setApiForm((current) => ({
        ...current,
        enabled: response.proFeatures.publicApi.enabled,
        defaultTokenTtlHours: String(response.proFeatures.publicApi.defaultTokenTtlHours),
        maxTokenTtlHours: String(response.proFeatures.publicApi.maxTokenTtlHours),
      }))
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not load PRO settings.', 'Erro ao carregar configuracoes PRO')
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSettings().catch(() => undefined)
  }, [token, isPro])

  const saveLiveness = async () => {
    if (!token) return

    setSavingLiveness(true)
    setError('')
    setNotice('')

    try {
      await apiFetch('/admin/pro/liveness', {
        token,
        method: 'PATCH',
        body: {
          enabled: livenessForm.enabled,
          maxAgeMs: Number(livenessForm.maxAgeMs),
          minFrames: Number(livenessForm.minFrames),
          minHeadMovementDelta: Number(livenessForm.minHeadMovementDelta),
        },
      })

      setNotice(
        t(
          'Liveness settings updated successfully.',
          'Configuracao de liveness atualizada com sucesso.'
        )
      )
      await loadSettings()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save liveness.', 'Erro ao salvar liveness'))
    } finally {
      setSavingLiveness(false)
    }
  }

  const savePublicApi = async () => {
    if (!token) return

    setSavingApi(true)
    setError('')
    setNotice('')

    try {
      await apiFetch('/admin/pro/public-api', {
        token,
        method: 'PATCH',
        body: {
          enabled: apiForm.enabled,
          defaultTokenTtlHours: Number(apiForm.defaultTokenTtlHours),
          maxTokenTtlHours: Number(apiForm.maxTokenTtlHours),
        },
      })

      setNotice(
        t(
          'Public API settings updated successfully.',
          'Configuracao da API publica atualizada com sucesso.'
        )
      )
      await loadSettings()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('Could not save public API.', 'Erro ao salvar API publica')
      )
    } finally {
      setSavingApi(false)
    }
  }

  const issueToken = async () => {
    if (!token) return

    setIssuingToken(true)
    setError('')
    setNotice('')

    try {
      const response = await apiFetch<IssuedTokenResponse>('/admin/pro/public-api/token', {
        token,
        method: 'POST',
        body: {
          expiresInHours: Number(apiForm.issueTtlHours),
          scopes: ['payroll:read'],
        },
      })

      setIssuedToken(response)
      setNotice(t('New token issued. Store it securely.', 'Novo token emitido. Armazene com seguranca.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not issue token.', 'Erro ao emitir token'))
    } finally {
      setIssuingToken(false)
    }
  }

  if (!isPro) {
    return (
      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-8 text-slate-800">
        <p className="text-xs uppercase tracking-[0.28em] text-amber-700">
          {t('Plan required', 'Plano necessario')}
        </p>
        <h2 className="mt-3 text-2xl font-semibold">
          {t('PRO settings unavailable', 'Configuracoes PRO indisponiveis')}
        </h2>
        <p className="mt-2 text-sm text-amber-900">
          {t(
            'This page requires an active PRO plan to configure liveness and public API.',
            'Essa tela exige plano PRO ativo para configurar liveness e API publica.'
          )}
        </p>
      </section>
    )
  }

  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/80 bg-white/85 p-7 shadow-[0_16px_38px_-30px_rgba(15,23,42,0.6)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.3em] text-rose-700">PRO</p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-900">
          {t('Facial liveness', 'Liveness facial')}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {t('Adjust runtime liveness proof parameters.', 'Ajuste os parametros de prova de vida em runtime.')}
        </p>

        <div className="mt-5 grid gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={livenessForm.enabled}
              onChange={(event) =>
                setLivenessForm((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
            {t('Liveness enabled', 'Liveness habilitado')}
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('Max age (ms)', 'Max age (ms)')}
          </label>
          <input
            value={livenessForm.maxAgeMs}
            onChange={(event) =>
              setLivenessForm((current) => ({ ...current, maxAgeMs: event.target.value }))
            }
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
          />

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('Min frames', 'Min frames')}
          </label>
          <input
            value={livenessForm.minFrames}
            onChange={(event) =>
              setLivenessForm((current) => ({ ...current, minFrames: event.target.value }))
            }
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
          />

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('Minimum head delta', 'Head delta minimo')}
          </label>
          <input
            value={livenessForm.minHeadMovementDelta}
            onChange={(event) =>
              setLivenessForm((current) => ({ ...current, minHeadMovementDelta: event.target.value }))
            }
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
          />

          <button
            onClick={saveLiveness}
            disabled={savingLiveness || loading}
            className="mt-2 rounded-full bg-rose-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {savingLiveness ? t('Saving...', 'Salvando...') : t('Save liveness', 'Salvar liveness')}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-white/80 bg-white/85 p-7 shadow-[0_16px_38px_-30px_rgba(15,23,42,0.6)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.3em] text-teal-700">PRO</p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-900">
          {t('Public payroll API', 'API publica de folha')}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {t('Configure TTL and issue token for external integrations.', 'Configure TTL e emita token para integracoes externas.')}
        </p>

        <div className="mt-5 grid gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={apiForm.enabled}
              onChange={(event) =>
                setApiForm((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
            {t('Public API enabled', 'API publica habilitada')}
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('Default TTL (hours)', 'TTL padrao (horas)')}
          </label>
          <input
            value={apiForm.defaultTokenTtlHours}
            onChange={(event) =>
              setApiForm((current) => ({ ...current, defaultTokenTtlHours: event.target.value }))
            }
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
          />

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('Maximum TTL (hours)', 'TTL maximo (horas)')}
          </label>
          <input
            value={apiForm.maxTokenTtlHours}
            onChange={(event) =>
              setApiForm((current) => ({ ...current, maxTokenTtlHours: event.target.value }))
            }
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
          />

          <button
            onClick={savePublicApi}
            disabled={savingApi || loading}
            className="mt-2 rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            {savingApi ? t('Saving...', 'Salvando...') : t('Save public API', 'Salvar API publica')}
          </button>

          <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('Token issuance', 'Emissao de token')}
            </p>
            <p className="mt-2 text-xs text-slate-600">
              {t('Current user:', 'Usuario atual:')} {profile?.email}
            </p>

            <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('New token TTL (hours)', 'TTL do novo token (horas)')}
            </label>
            <input
              value={apiForm.issueTtlHours}
              onChange={(event) =>
                setApiForm((current) => ({ ...current, issueTtlHours: event.target.value }))
              }
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"
            />

            <button
              onClick={issueToken}
              disabled={issuingToken || loading || profile?.role !== 'ADMIN'}
              className="mt-3 rounded-full bg-teal-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {issuingToken
                ? t('Issuing...', 'Emitindo...')
                : t('Issue payroll:read token', 'Emitir token payroll:read')}
            </button>
            {profile?.role !== 'ADMIN' ? (
              <p className="mt-2 text-xs text-amber-700">
                {t('Only ADMIN can issue public API token.', 'Somente ADMIN pode emitir token da API publica.')}
              </p>
            ) : null}
          </div>

          {issuedToken ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900">
              <p>
                <strong>{t('Expires at:', 'Expira em:')}</strong>{' '}
                {new Date(issuedToken.expiresAt).toLocaleString(locale)}
              </p>
              <p className="mt-1 break-all">
                <strong>{t('Token:', 'Token:')}</strong> {issuedToken.token}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {(error || notice) && (
        <div className="lg:col-span-2">
          {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
          {notice ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p> : null}
        </div>
      )}
    </section>
  )
}

export default AdminProSettingsPage
