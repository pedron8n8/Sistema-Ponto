import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type FinanceOverviewResponse = {
  generatedAt: string
  stripe: {
    configured: boolean
    reason: string | null
  }
  plan: {
    id: string | null
    code: string | null
    name: string | null
    status: 'ACTIVE' | 'INACTIVE' | string
    linkedAt: string | null
    monthlyPriceUsd: number
    isCatalogActive: boolean
    nextBillingAt: string | null
    subscriptionStatus: string | null
  }
  billing: {
    seatLimit: number | null
    activeSeats: number
    contractedExtraSeats: number
    availableSeats: number | null
    overageSeats: number
    extraSeatPriceUsd: number
  }
  actions: {
    changePlanPath: string
    buySeatsPath: string
  }
}

type FinanceInvoice = {
  id: string
  sourceType: 'BASE_PLAN' | 'ADDITIONAL_SEATS' | string
  stripeSessionId: string
  stripeInvoiceId: string | null
  stripeSubscriptionId: string | null
  status: string | null
  paymentStatus: string | null
  mode: string | null
  currency: string | null
  amountTotal: number | null
  amountSubtotal: number | null
  expectedMonthlyAmountUsd: number | null
  overageSeats: number | null
  customerEmail: string | null
  sessionCreatedAt: string | null
  paidAt: string | null
  syncedAt: string
  createdAt: string
}

type FinanceInvoicesResponse = {
  invoices: FinanceInvoice[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

type FinanceSyncResponse = {
  message?: string
  stripe?: {
    configured: boolean
    reason: string | null
    sessionsScanned: number
    lookbackDays: number
  }
  sync?: {
    invoicesUpserted: number
    totalPersistedInvoices: number
  }
}

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

const formatDateTime = (value: string | null | undefined, locale = 'pt-BR') => {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}

const formatCurrency = (value: number | null | undefined, currency: string | null | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  if (!currency || currency.toUpperCase() === 'USD') return usdFormatter.format(value)
  return `${value.toFixed(2)} ${currency.toUpperCase()}`
}

const sourceTypeLabel = (sourceType: string, t: (en: string, pt: string) => string) => {
  if (sourceType === 'BASE_PLAN') return t('Plan', 'Plano')
  if (sourceType === 'ADDITIONAL_SEATS') return t('Additional seats', 'Assentos adicionais')
  return sourceType || '-'
}

const normalizePlanCode = (value: string | null | undefined) => String(value || '').trim().toUpperCase()

const buildChangePlanLink = (basePath: string | null | undefined) => {
  const normalizedBasePath = String(basePath || '/app/escolher-plano').trim() || '/app/escolher-plano'
  const separator = normalizedBasePath.includes('?') ? '&' : '?'
  return `${normalizedBasePath}${separator}returnTo=${encodeURIComponent('/app/admin/financeiro')}`
}

const statusBadgeClass = (status: string | null | undefined) => {
  if (String(status || '').toLowerCase() === 'paid') {
    return 'border-emerald-200 bg-emerald-100 text-emerald-800'
  }

  if (String(status || '').toLowerCase() === 'no_payment_required') {
    return 'border-blue-200 bg-blue-100 text-blue-800'
  }

  return 'border-slate-200 bg-slate-100 text-slate-700'
}

const AdminFinancePage = () => {
  const { session, profile } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const locale = isPt ? 'pt-BR' : 'en-US'

  const token = session?.access_token
  const canAccess = profile?.role === 'ADMIN'

  const [overview, setOverview] = useState<FinanceOverviewResponse | null>(null)
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const hasLoadedOnceRef = useRef(false)
  const refreshInProgressRef = useRef(false)

  const loadOverview = useCallback(async () => {
    if (!token) return null

    const response = await apiFetch<FinanceOverviewResponse>('/users/me/finance/overview', {
      token,
      timeoutMs: 20000,
    })

    setOverview(response)
    return response
  }, [token])

  const loadInvoices = useCallback(async () => {
    if (!token) return null

    const response = await apiFetch<FinanceInvoicesResponse>('/users/me/finance/invoices?status=paid&page=1&limit=50', {
      token,
      timeoutMs: 20000,
    })

    setInvoices(response.invoices || [])
    return response
  }, [token])

  const normalizeFinanceErrorMessage = useCallback(
    (message: string) => {
      const normalized = String(message || '').trim()
      if (!normalized) {
        return t('Could not load financial data.', 'Nao foi possivel carregar os dados financeiros.')
      }

      if (!isPt && /muitas\s+requisi[cç][oõ]es/i.test(normalized)) {
        return 'Too many requests. Try again shortly.'
      }

      return normalized
    },
    [isPt, t]
  )

  const resolvePlanDisplayName = useCallback(
    (planCode: string | null | undefined, planName: string | null | undefined) => {
      const normalizedCode = normalizePlanCode(planCode)

      if (normalizedCode === 'STARTER') return t('Starter', 'Starter')
      if (normalizedCode === 'GROWTH') return t('Growth', 'Growth')
      if (normalizedCode === 'PRO') return t('Pro', 'Pro')

      const safeName = String(planName || '').trim()
      return safeName || '-'
    },
    [t]
  )

  const refreshFinanceData = useCallback(
    async ({ showNotice, runSync }: { showNotice: boolean; runSync: boolean }) => {
      if (!token || !canAccess) return
      if (refreshInProgressRef.current) return

      refreshInProgressRef.current = true

      if (!hasLoadedOnceRef.current) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }

      setError('')
      if (!showNotice) {
        setNotice('')
      }

      try {
        let syncResponse: FinanceSyncResponse | null = null

        if (runSync) {
          syncResponse = await apiFetch<FinanceSyncResponse>('/users/me/finance/invoices/sync', {
            token,
            method: 'POST',
            body: {},
            timeoutMs: 30000,
          })
        }

        await Promise.all([loadOverview(), loadInvoices()])

        if (showNotice) {
          if (runSync && syncResponse?.stripe?.configured === false) {
            setNotice(
              t(
                'Stripe is not configured. Showing persisted financial records only.',
                'Stripe nao configurado. Exibindo apenas registros financeiros persistidos.'
              )
            )
          } else {
            setNotice(t('Financial data updated successfully.', 'Dados financeiros atualizados com sucesso.'))
          }
        }
      } catch (err) {
        const rawMessage =
          err instanceof Error
            ? err.message
            : t('Could not load financial data.', 'Nao foi possivel carregar os dados financeiros.')

        setError(normalizeFinanceErrorMessage(rawMessage))
      } finally {
        hasLoadedOnceRef.current = true
        refreshInProgressRef.current = false
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token, canAccess, loadOverview, loadInvoices, normalizeFinanceErrorMessage, t]
  )

  useEffect(() => {
    if (!token || !canAccess) return
    refreshFinanceData({ showNotice: false, runSync: false }).catch(() => undefined)
  }, [token, canAccess])

  const nextBillingLabel = useMemo(
    () => formatDateTime(overview?.plan?.nextBillingAt, locale),
    [overview?.plan?.nextBillingAt, locale]
  )

  const changePlanLink = useMemo(
    () => buildChangePlanLink(overview?.actions.changePlanPath),
    [overview?.actions.changePlanPath]
  )

  if (!canAccess) {
    return (
      <section className="rounded-3xl border border-amber-300 bg-amber-50/90 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-800">
          {t('Restricted access', 'Acesso restrito')}
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-amber-950">
          {t('Only ADMIN can access Finance', 'Apenas ADMIN pode acessar o Financeiro')}
        </h2>
        <p className="mt-2 text-sm text-amber-900">
          {t(
            'Ask an account administrator to manage billing and invoices.',
            'Peca para o administrador da conta gerenciar cobranca e faturas.'
          )}
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-white/80 bg-white/85 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Admin', 'Admin')}</p>
            <h2 className="mt-4 text-3xl font-semibold text-slate-900">{t('Finance', 'Financeiro')}</h2>
            <p className="mt-3 text-sm text-slate-600">
              {t(
                'Manage plan, seat growth and paid invoices from one secure panel.',
                'Gerencie plano, crescimento de assentos e faturas pagas em um painel seguro.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => refreshFinanceData({ showNotice: true, runSync: true })}
            disabled={loading || refreshing}
            className="rounded-full border border-slate-200 bg-white px-5 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 disabled:opacity-60"
          >
            {loading || refreshing ? t('Updating...', 'Atualizando...') : t('Sync invoices', 'Sincronizar faturas')}
          </button>
        </div>

        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
        {notice ? <p className="mt-4 text-sm text-emerald-700">{notice}</p> : null}
        {!overview?.stripe.configured ? (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {t('Stripe unavailable:', 'Stripe indisponivel:')} {overview?.stripe.reason || 'STRIPE_NOT_CONFIGURED'}
          </p>
        ) : null}
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Active plan', 'Plano ativo')}</p>
          <p className="mt-2 text-xl font-semibold text-slate-900">
            {resolvePlanDisplayName(overview?.plan.code, overview?.plan.name)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{normalizePlanCode(overview?.plan.code) || '-'}</p>
          <p className="mt-2 text-sm text-slate-700">{formatCurrency(overview?.plan.monthlyPriceUsd, 'USD')}</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Plan status', 'Status do plano')}</p>
          <p className="mt-2 text-xl font-semibold text-slate-900">{overview?.plan.status || '-'}</p>
          <p className="mt-2 text-xs text-slate-500">
            {t('Subscription status:', 'Status da assinatura:')} {overview?.plan.subscriptionStatus || '-'}
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Next due date', 'Proximo vencimento')}</p>
          <p className="mt-2 text-xl font-semibold text-slate-900">{nextBillingLabel}</p>
          <p className="mt-2 text-xs text-slate-500">
            {t('Linked at:', 'Vinculado em:')} {formatDateTime(overview?.plan.linkedAt, locale)}
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Active seats', 'Cadeiras ativas')}</p>
          <p className="mt-2 text-xl font-semibold text-slate-900">
            {overview?.billing.activeSeats ?? 0}
            <span className="ml-2 text-sm font-medium text-slate-500">
              / {overview?.billing.seatLimit ?? t('Unlimited', 'Ilimitado')}
            </span>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {t('Extra seats contracted:', 'Assentos extras contratados:')} {overview?.billing.contractedExtraSeats ?? 0}
          </p>
        </article>
      </div>

      <section className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">{t('Billing actions', 'Acoes de cobranca')}</h3>
          <p className="text-xs text-slate-500">
            {t('Price per extra seat:', 'Preco por assento extra:')} {formatCurrency(overview?.billing.extraSeatPriceUsd, 'USD')}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            to={changePlanLink}
            className="rounded-full bg-slate-900 px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white"
          >
            {t('Change plan', 'Mudar plano')}
          </Link>
          <Link
            to={overview?.actions.buySeatsPath || '/app/admin/comprar-assentos'}
            className="rounded-full border border-slate-200 bg-white px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700"
          >
            {t('Increase seats', 'Aumentar cadeiras')}
          </Link>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-slate-900">{t('Paid invoices', 'Faturas pagas')}</h3>
          <p className="text-xs text-slate-500">
            {t('Records loaded:', 'Registros carregados:')} {invoices.length}
          </p>
        </div>

        {loading && invoices.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t('Loading invoices...', 'Carregando faturas...')}</p>
        ) : null}

        {!loading && invoices.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            {t('No paid invoices were found for this account yet.', 'Nenhuma fatura paga encontrada para esta conta ainda.')}
          </p>
        ) : null}

        {invoices.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs text-slate-600">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-[0.15em] text-slate-500">
                  <th className="px-2 py-2 font-semibold">{t('Paid at', 'Pago em')}</th>
                  <th className="px-2 py-2 font-semibold">{t('Type', 'Tipo')}</th>
                  <th className="px-2 py-2 font-semibold">{t('Status', 'Status')}</th>
                  <th className="px-2 py-2 font-semibold">{t('Amount', 'Valor')}</th>
                  <th className="px-2 py-2 font-semibold">{t('Email', 'Email')}</th>
                  <th className="px-2 py-2 font-semibold">{t('Stripe IDs', 'IDs Stripe')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-slate-100/80 last:border-b-0">
                    <td className="px-2 py-2">{formatDateTime(invoice.paidAt || invoice.sessionCreatedAt, locale)}</td>
                    <td className="px-2 py-2">{sourceTypeLabel(invoice.sourceType, t)}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(invoice.paymentStatus)}`}
                      >
                        {invoice.paymentStatus || '-'}
                      </span>
                    </td>
                    <td className="px-2 py-2">{formatCurrency(invoice.amountTotal, invoice.currency)}</td>
                    <td className="px-2 py-2">{invoice.customerEmail || '-'}</td>
                    <td className="px-2 py-2">
                      <div className="space-y-1">
                        <p className="text-[11px] text-slate-500">session: {invoice.stripeSessionId}</p>
                        <p className="text-[11px] text-slate-500">invoice: {invoice.stripeInvoiceId || '-'}</p>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </section>
  )
}

export default AdminFinancePage
