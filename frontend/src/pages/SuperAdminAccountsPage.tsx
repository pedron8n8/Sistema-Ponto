import { useEffect, useMemo, useState } from 'react'
import { apiFetch, translateApiMessage } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'
import { getMarketingPlans } from '../lib/marketingPlans'

type AdminPlanStatus = 'ACTIVE' | 'INACTIVE'

type PlanCatalogItem = {
  id: string
  code: string
  name: string
  monthlyPriceUsd: number
  isActive: boolean
}

type MarketingPlanId = 'starter' | 'growth' | 'pro'

type PaymentHistoryItem = {
  id: string
  createdAt: string | null
  status: string | null
  paymentStatus: string | null
  mode: string | null
  currency: string | null
  amountTotal: number | null
  amountSubtotal: number | null
  expectedMonthlyAmountUsd: number | null
  overageSeats: number | null
  customerEmail: string | null
  subscriptionId: string | null
  invoiceId: string | null
}

type SuperAdminAccountItem = {
  admin: {
    id: string
    name: string | null
    email: string
    createdAt: string
  }
  plan: {
    id: string | null
    code: string | null
    name: string | null
    status: AdminPlanStatus
    linkedAt: string | null
    monthlyPriceUsd: number
    isCatalogActive: boolean
  }
  users: {
    managedUsers: number
    totalUsersIncludingAdmin: number
    byRole: {
      HR: number
      SUPERVISOR: number
      MEMBER: number
    }
  }
  billing: {
    seatLimit: number | null
    occupiedSeats: number
    availableSeats: number | null
    overageSeats: number
    extraSeatPriceUsd: number
  }
  mrr: {
    active: boolean
    basePlanUsd: number
    overageUsd: number
    totalUsd: number
  }
  paymentHistory: PaymentHistoryItem[]
}

type SuperAdminOverviewPayload = {
  generatedAt: string
  stripe: {
    configured: boolean
    reason: string | null
    sessionsScanned: number
    lookbackDays: number
  }
  summary: {
    totalAccounts: number
    activePlans: number
    expiredPlans: number
    totalManagedUsers: number
    totalUsersIncludingAdmins: number
    totalMrrUsd: number
  }
  planCatalog?: PlanCatalogItem[]
  accounts: SuperAdminAccountItem[]
}

type LinkedAccountUser = {
  id: string
  email: string
  name: string
  phone?: string | null
  role: 'SUPERADMIN' | 'ADMIN' | 'HR' | 'SUPERVISOR' | 'MEMBER'
  organizationAdminId?: string | null
  createdAt?: string
  workdayStartTime?: string | null
  workdayEndTime?: string | null
  contractDailyMinutes?: number
  hourlyRate?: number | null
  timeZone?: string
  supervisor?: {
    id: string
    name: string
    email: string
    role: 'SUPERADMIN' | 'ADMIN' | 'HR' | 'SUPERVISOR' | 'MEMBER'
  } | null
}

type LinkedAccountsResponse = {
  users: LinkedAccountUser[]
}

type AdminConfigForm = {
  adminPlanCode: string
  adminPlanName: string
  adminPlanMonthlyPrice: string
  adminPlanStatus: AdminPlanStatus
  adminSeatLimit: string
  adminExtraSeatPrice: string
}

type PlanFilter = 'ALL' | AdminPlanStatus

type UpdateAdminConfigResponse = {
  message?: string
  seatValidation?: {
    seatLimit: number | null
    occupiedSeats: number
    overageSeats: number
    requiresDownsizeOrUpgrade: boolean
    message: string
  }
}

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

const formatUsd = (value: number | null | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return usdFormatter.format(value)
}

const formatDateTime = (value: string | null | undefined, locale = 'pt-BR') => {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}

const formatWorkday = (start: string | null | undefined, end: string | null | undefined) => {
  if (!start && !end) return '-'
  return `${start || '--:--'} - ${end || '--:--'}`
}

const normalizePlanCode = (value: string | null | undefined) => String(value || '').trim().toUpperCase()

const MARKETING_PLAN_CODE_BY_ID: Record<MarketingPlanId, string> = {
  starter: 'STARTER',
  growth: 'GROWTH',
  pro: 'PRO',
}

const resolveMarketingPlanCode = (planId: string) => {
  const normalizedId = String(planId || '').trim().toLowerCase() as MarketingPlanId
  return MARKETING_PLAN_CODE_BY_ID[normalizedId] || normalizePlanCode(planId)
}

const parseMarketingPlanPrice = (value: string | null | undefined) => {
  const normalized = String(value || '')
    .replace(/[^0-9,.-]/g, '')
    .replace(',', '.')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Number(parsed.toFixed(2))
}

const toAdminConfigForm = (
  account: SuperAdminAccountItem,
  defaultPlanName = 'Starter'
): AdminConfigForm => ({
  adminPlanCode: account.plan.code || 'STARTER',
  adminPlanName: account.plan.name || defaultPlanName,
  adminPlanMonthlyPrice: String(account.plan.monthlyPriceUsd ?? 0),
  adminPlanStatus: account.plan.status,
  adminSeatLimit: String(account.billing.seatLimit ?? Math.max(1, account.billing.occupiedSeats || 1)),
  adminExtraSeatPrice: String(account.billing.extraSeatPriceUsd ?? 7.5),
})

const statusBadgeClass = (status: AdminPlanStatus) => {
  if (status === 'ACTIVE') {
    return 'bg-emerald-100 text-emerald-800 border-emerald-200'
  }

  return 'bg-rose-100 text-rose-800 border-rose-200'
}

const SuperAdminAccountsPage = () => {
  const { session } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const locale = isPt ? 'pt-BR' : 'en-US'
  const token = session?.access_token

  const [payload, setPayload] = useState<SuperAdminOverviewPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [planFilter, setPlanFilter] = useState<PlanFilter>('ALL')
  const [search, setSearch] = useState('')
  const [adminConfigById, setAdminConfigById] = useState<Record<string, AdminConfigForm>>({})
  const [configErrorById, setConfigErrorById] = useState<Record<string, string>>({})
  const [configNoticeById, setConfigNoticeById] = useState<Record<string, string>>({})
  const [configSavingById, setConfigSavingById] = useState<Record<string, boolean>>({})
  const [selectedAdminForModal, setSelectedAdminForModal] = useState<SuperAdminAccountItem['admin'] | null>(null)
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccountUser[]>([])
  const [linkedAccountsLoading, setLinkedAccountsLoading] = useState(false)
  const [linkedAccountsError, setLinkedAccountsError] = useState('')
  const [selectedAdminForDelete, setSelectedAdminForDelete] = useState<SuperAdminAccountItem | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteNotice, setDeleteNotice] = useState('')

  const loadOverview = async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const response = await apiFetch<SuperAdminOverviewPayload>(
        '/users/superadmin/accounts-overview?paymentHistoryLimit=8',
        { token }
      )
      setPayload(response)

      const pricingCatalogByCode = new Map<string, PlanCatalogItem>()
      getMarketingPlans(i18nT).forEach((plan) => {
        const code = resolveMarketingPlanCode(plan.id)
        if (!code) return

        pricingCatalogByCode.set(code, {
          id: code,
          code,
          name: String(plan.name || code),
          monthlyPriceUsd: parseMarketingPlanPrice(plan.price),
          isActive: true,
        })
      })

      const catalogByCode = new Map<string, PlanCatalogItem>()
      ;(response.planCatalog || []).forEach((plan) => {
        const normalizedCode = normalizePlanCode(plan.code)
        if (!normalizedCode) return
        const pricingPlan = pricingCatalogByCode.get(normalizedCode)

        catalogByCode.set(normalizedCode, {
          id: plan.id || pricingPlan?.id || normalizedCode,
          code: normalizedCode,
          name: pricingPlan?.name || String(plan.name || normalizedCode),
          monthlyPriceUsd: Number(plan.monthlyPriceUsd ?? pricingPlan?.monthlyPriceUsd ?? 0),
          isActive: Boolean(plan.isActive ?? pricingPlan?.isActive ?? true),
        })
      })

      pricingCatalogByCode.forEach((plan, code) => {
        if (catalogByCode.has(code)) return
        catalogByCode.set(code, plan)
      })

      const fallbackPlan =
        catalogByCode.get('STARTER') || Array.from(catalogByCode.values())[0] || null

      setAdminConfigById(
        response.accounts.reduce<Record<string, AdminConfigForm>>((acc, account) => {
          const baseForm = toAdminConfigForm(account, fallbackPlan?.name || t('Starter', 'Starter'))
          const normalizedCode = normalizePlanCode(baseForm.adminPlanCode || fallbackPlan?.code || 'STARTER')
          const selectedPlan = catalogByCode.get(normalizedCode) || fallbackPlan

          acc[account.admin.id] = {
            ...baseForm,
            adminPlanCode: selectedPlan?.code || normalizedCode || 'STARTER',
            adminPlanName: selectedPlan?.name || baseForm.adminPlanName,
            adminPlanMonthlyPrice: String(selectedPlan?.monthlyPriceUsd ?? baseForm.adminPlanMonthlyPrice),
          }
          return acc
        }, {})
      )
      setConfigErrorById({})
      setConfigNoticeById({})
    } catch (err) {
      setPayload(null)
      setError(
        err instanceof Error
          ? err.message
          : t('Could not load superadmin overview.', 'Erro ao carregar visao superadmin.')
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOverview().catch(() => undefined)
  }, [token])

  const filteredAccounts = useMemo(() => {
    const accounts = payload?.accounts || []

    return accounts.filter((account) => {
      if (planFilter !== 'ALL' && account.plan.status !== planFilter) {
        return false
      }

      if (!search.trim()) {
        return true
      }

      const normalized = search.trim().toLowerCase()
      const candidate = `${account.admin.name || ''} ${account.admin.email}`.toLowerCase()
      return candidate.includes(normalized)
    })
  }, [payload, planFilter, search])

  const filteredSummary = useMemo(() => {
    return filteredAccounts.reduce(
      (acc, account) => {
        acc.totalAccounts += 1
        if (account.plan.status === 'ACTIVE') {
          acc.activePlans += 1
        } else {
          acc.expiredPlans += 1
        }
        acc.totalUsersIncludingAdmins += account.users.totalUsersIncludingAdmin
        acc.totalMrrUsd = Number((acc.totalMrrUsd + account.mrr.totalUsd).toFixed(2))
        return acc
      },
      {
        totalAccounts: 0,
        activePlans: 0,
        expiredPlans: 0,
        totalUsersIncludingAdmins: 0,
        totalMrrUsd: 0,
      }
    )
  }, [filteredAccounts])

  const generatedAt = payload?.generatedAt ? formatDateTime(payload.generatedAt, locale) : '-'

  const defaultExtraSeatPrice = useMemo(() => {
    const value = payload?.accounts?.[0]?.billing?.extraSeatPriceUsd
    return String(value ?? 7.5)
  }, [payload])

  const availablePlans = useMemo<PlanCatalogItem[]>(() => {
    const serverPlanByCode = new Map<string, PlanCatalogItem>()

    ;(payload?.planCatalog || []).forEach((plan) => {
      const normalizedCode = normalizePlanCode(plan.code)
      if (!normalizedCode) return

      serverPlanByCode.set(normalizedCode, {
        ...plan,
        code: normalizedCode,
        name: String(plan.name || normalizedCode),
        monthlyPriceUsd: Number(plan.monthlyPriceUsd || 0),
      })
    })

    const plansFromPricing = getMarketingPlans(i18nT)
      .map((plan) => {
        const code = resolveMarketingPlanCode(plan.id)
        if (!code) return null

        const serverPlan = serverPlanByCode.get(code)
        return {
          id: serverPlan?.id || code,
          code,
          name: String(plan.name || code),
          monthlyPriceUsd: Number(
            (serverPlan?.monthlyPriceUsd ?? parseMarketingPlanPrice(plan.price)).toFixed(2)
          ),
          isActive: Boolean(serverPlan?.isActive ?? true),
        } satisfies PlanCatalogItem
      })
      .filter((plan): plan is PlanCatalogItem => Boolean(plan))

    if (plansFromPricing.length > 0) {
      return plansFromPricing
    }

    return Array.from(serverPlanByCode.values()).sort((a, b) => {
      const byName = a.name.localeCompare(b.name, locale)
      if (byName !== 0) return byName
      return a.code.localeCompare(b.code)
    })
  }, [payload, i18nT, locale])

  const availablePlansByCode = useMemo(
    () => new Map(availablePlans.map((plan) => [normalizePlanCode(plan.code), plan])),
    [availablePlans]
  )

  const handleAdminConfigField = (
    adminId: string,
    field: keyof AdminConfigForm,
    value: string | AdminPlanStatus
  ) => {
    const defaultPlan = availablePlans[0]

    setAdminConfigById((prev) => {
      const current = prev[adminId] || {
        adminPlanCode: defaultPlan?.code || 'STARTER',
        adminPlanName: defaultPlan?.name || t('Starter', 'Starter'),
        adminPlanMonthlyPrice: String(defaultPlan?.monthlyPriceUsd ?? 30),
        adminPlanStatus: 'INACTIVE' as AdminPlanStatus,
        adminSeatLimit: '1',
        adminExtraSeatPrice: defaultExtraSeatPrice,
      }

      if (field === 'adminPlanCode') {
        const normalizedCode =
          normalizePlanCode(String(value || defaultPlan?.code || 'STARTER')) ||
          defaultPlan?.code ||
          'STARTER'
        const selectedPlan = availablePlansByCode.get(normalizedCode) || defaultPlan

        return {
          ...prev,
          [adminId]: {
            ...current,
            adminPlanCode: selectedPlan?.code || normalizedCode,
            adminPlanName: selectedPlan?.name || current.adminPlanName,
            adminPlanMonthlyPrice: selectedPlan
              ? String(selectedPlan.monthlyPriceUsd)
              : current.adminPlanMonthlyPrice,
          },
        }
      }

      return {
        ...prev,
        [adminId]: {
          ...current,
          [field]: value,
        },
      }
    })
  }

  const saveAdminConfig = async (adminId: string) => {
    if (!token) return

    const form = adminConfigById[adminId]
    if (!form) return

    setConfigErrorById((prev) => ({ ...prev, [adminId]: '' }))
    setConfigNoticeById((prev) => ({ ...prev, [adminId]: '' }))

    const planCode = String(form.adminPlanCode || '').trim().toUpperCase()
    const planName = String(form.adminPlanName || '').trim()
    const planMonthlyPrice = Number(form.adminPlanMonthlyPrice)
    const seatLimit = Number(form.adminSeatLimit)
    const extraSeatPrice = Number(form.adminExtraSeatPrice)

    if (!planCode || !planName) {
      setConfigErrorById((prev) => ({
        ...prev,
        [adminId]: t(
          'Provide both plan code and plan name before saving.',
          'Informe codigo e nome do plano para salvar.'
        ),
      }))
      return
    }

    if (!Number.isFinite(planMonthlyPrice) || planMonthlyPrice < 0) {
      setConfigErrorById((prev) => ({
        ...prev,
        [adminId]: t('Invalid monthly plan price.', 'Preco mensal do plano invalido.'),
      }))
      return
    }

    if (!Number.isInteger(seatLimit) || seatLimit < 1) {
      setConfigErrorById((prev) => ({
        ...prev,
        [adminId]: t(
          'Seat limit must be an integer greater than or equal to 1.',
          'Limite de cadeiras deve ser inteiro maior ou igual a 1.'
        ),
      }))
      return
    }

    if (!Number.isFinite(extraSeatPrice) || extraSeatPrice < 0) {
      setConfigErrorById((prev) => ({
        ...prev,
        [adminId]: t('Invalid extra seat price.', 'Valor da cadeira extra invalido.'),
      }))
      return
    }

    setConfigSavingById((prev) => ({ ...prev, [adminId]: true }))
    try {
      const response = await apiFetch<UpdateAdminConfigResponse>(`/users/${adminId}`, {
        token,
        method: 'PATCH',
        body: {
          adminPlanCode: planCode,
          adminPlanName: planName,
          adminPlanMonthlyPrice: Number(planMonthlyPrice.toFixed(2)),
          adminPlanStatus: form.adminPlanStatus,
          adminSeatLimit: Math.floor(seatLimit),
          adminExtraSeatPrice: Number(extraSeatPrice.toFixed(2)),
        },
      })

      setConfigNoticeById((prev) => ({
        ...prev,
        [adminId]:
          response?.seatValidation?.message
            ? translateApiMessage(response.seatValidation.message)
            : t('Configuration saved successfully.', 'Configuracao salva com sucesso.'),
      }))

      await loadOverview()
    } catch (err) {
      setConfigErrorById((prev) => ({
        ...prev,
        [adminId]:
          err instanceof Error
            ? err.message
            : t('Could not save ADMIN configuration.', 'Erro ao salvar configuracao do ADMIN.'),
      }))
    } finally {
      setConfigSavingById((prev) => ({ ...prev, [adminId]: false }))
    }
  }

  const openLinkedAccountsModal = async (account: SuperAdminAccountItem) => {
    if (!token) return

    setSelectedAdminForModal(account.admin)
    setLinkedAccounts([])
    setLinkedAccountsError('')
    setLinkedAccountsLoading(true)

    try {
      const response = await apiFetch<LinkedAccountsResponse>(
        `/users?organizationAdminId=${account.admin.id}&limit=200`,
        { token }
      )

      const roleOrder: Record<LinkedAccountUser['role'], number> = {
        ADMIN: 0,
        HR: 1,
        SUPERVISOR: 2,
        MEMBER: 3,
        SUPERADMIN: 4,
      }

      const sorted = [...(response.users || [])].sort((a, b) => {
        const roleDiff = roleOrder[a.role] - roleOrder[b.role]
        if (roleDiff !== 0) return roleDiff
        return String(a.name || '').localeCompare(String(b.name || ''), locale)
      })

      setLinkedAccounts(sorted)
    } catch (err) {
      setLinkedAccountsError(
        err instanceof Error
          ? err.message
          : t(
              'Could not load accounts linked to this ADMIN.',
              'Erro ao carregar contas vinculadas ao ADMIN.'
            )
      )
    } finally {
      setLinkedAccountsLoading(false)
    }
  }

  const closeLinkedAccountsModal = () => {
    setSelectedAdminForModal(null)
    setLinkedAccounts([])
    setLinkedAccountsError('')
    setLinkedAccountsLoading(false)
  }

  const openDeleteAccountModal = (account: SuperAdminAccountItem) => {
    setSelectedAdminForDelete(account)
    setDeleteConfirmText('')
    setDeleteError('')
    setDeleteNotice('')
    setDeleteLoading(false)
  }

  const closeDeleteAccountModal = () => {
    if (deleteLoading) return
    setSelectedAdminForDelete(null)
    setDeleteConfirmText('')
    setDeleteError('')
  }

  const confirmDeleteAccount = async () => {
    if (!token || !selectedAdminForDelete) return

    const expectedEmail = String(selectedAdminForDelete.admin.email || '').trim().toLowerCase()
    const typedEmail = String(deleteConfirmText || '').trim().toLowerCase()

    if (!expectedEmail || expectedEmail !== typedEmail) {
      setDeleteError(
        t(
          'Type the admin email exactly to confirm deletion.',
          'Digite o email do admin exatamente para confirmar a exclusao.'
        )
      )
      return
    }

    setDeleteLoading(true)
    setDeleteError('')
    setDeleteNotice('')

    try {
      await apiFetch(`/users/${selectedAdminForDelete.admin.id}`, {
        token,
        method: 'DELETE',
      })
      setDeleteNotice(
        t(
          `Account ${expectedEmail} deleted.`,
          `Conta ${expectedEmail} excluida.`
        )
      )
      setSelectedAdminForDelete(null)
      setDeleteConfirmText('')
      await loadOverview()
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : t('Could not delete account.', 'Erro ao excluir a conta.')
      )
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-cyan-700">
          {t('SuperAdmin', 'SuperAdmin')}
        </p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">
          {t('Accounts, plans and recurring revenue', 'Contas, planos e receitas recorrentes')}
        </h2>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'Consolidated view of all ADMIN accounts: active/expired plans, total users, MRR by account and additional seat payment history.',
            'Visao consolidada de todas as contas ADMIN: plano ativo/expirado, total de usuarios, MRR por conta e historico de pagamentos de cadeiras adicionais.'
          )}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
            {t('Updated at:', 'Atualizado em:')} {generatedAt}
          </span>
          <span
            className={`rounded-full border px-3 py-1 ${
              payload?.stripe.configured
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            {t('Stripe:', 'Stripe:')} {payload?.stripe.configured ? t('connected', 'conectado') : t('unavailable', 'indisponivel')}
          </span>
          {payload?.stripe.sessionsScanned !== undefined ? (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
              {t('Sessions scanned:', 'Sessoes varridas:')} {payload.stripe.sessionsScanned}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-100 bg-white/90 p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Accounts', 'Contas')}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{filteredSummary.totalAccounts}</p>
        </article>

        <article className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">{t('Active plans', 'Planos ativos')}</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-800">{filteredSummary.activePlans}</p>
        </article>

        <article className="rounded-2xl border border-rose-100 bg-rose-50/70 p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-rose-700">{t('Expired plans', 'Planos expirados')}</p>
          <p className="mt-2 text-3xl font-semibold text-rose-800">{filteredSummary.expiredPlans}</p>
        </article>

        <article className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">{t('Total MRR', 'MRR total')}</p>
          <p className="mt-2 text-3xl font-semibold text-cyan-800">{formatUsd(filteredSummary.totalMrrUsd)}</p>
        </article>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPlanFilter('ALL')}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] ${
                planFilter === 'ALL'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-600'
              }`}
            >
              {t('All', 'Todos')}
            </button>
            <button
              type="button"
              onClick={() => setPlanFilter('ACTIVE')}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] ${
                planFilter === 'ACTIVE'
                  ? 'bg-emerald-700 text-white'
                  : 'border border-slate-200 bg-white text-slate-600'
              }`}
            >
              {t('Active', 'Ativos')}
            </button>
            <button
              type="button"
              onClick={() => setPlanFilter('INACTIVE')}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] ${
                planFilter === 'INACTIVE'
                  ? 'bg-rose-700 text-white'
                  : 'border border-slate-200 bg-white text-slate-600'
              }`}
            >
              {t('Expired', 'Expirados')}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('Search by name or email', 'Buscar por nome ou email')}
              className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            />
            <button
              type="button"
              onClick={() => loadOverview().catch(() => undefined)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-700"
            >
              {t('Refresh', 'Atualizar')}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">
          {t('Loading superadmin overview...', 'Carregando visao superadmin...')}
        </p>
      ) : null}
      {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

      <div className="space-y-4">
        {filteredAccounts.length === 0 && !loading ? (
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 text-sm text-slate-500 shadow-sm">
            {t('No accounts found with the current filters.', 'Nenhuma conta encontrada com os filtros atuais.')}
          </div>
        ) : null}

        {filteredAccounts.map((account) => (
          <article key={account.admin.id} className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <button
                  type="button"
                  onClick={() => openLinkedAccountsModal(account)}
                  className="text-left text-lg font-semibold text-slate-900 hover:text-cyan-700"
                >
                  {account.admin.name || t('No name', 'Sem nome')}
                </button>
                <p className="text-sm text-slate-600">{account.admin.email}</p>
                <p className="mt-1 font-mono text-[10px] text-slate-400">ID: {account.admin.id}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {t('Account created on', 'Conta criada em')}{' '}
                  {formatDateTime(account.admin.createdAt, locale)}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openLinkedAccountsModal(account)}
                    className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-cyan-800"
                  >
                    {t('View linked accounts', 'Ver contas vinculadas')}
                  </button>
                  <button
                    type="button"
                    onClick={() => openDeleteAccountModal(account)}
                    className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-rose-700 hover:bg-rose-100"
                  >
                    {t('Delete account', 'Excluir conta')}
                  </button>
                </div>
              </div>

              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] ${statusBadgeClass(
                  account.plan.status
                )}`}
              >
                {account.plan.status === 'ACTIVE' ? t('Active', 'Ativo') : t('Expired', 'Expirado')}
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">{t('Plan', 'Plano')}</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {account.plan.name || t('No plan', 'Sem plano')}
                </p>
                <p className="text-xs text-slate-500">
                  {t('Code:', 'Codigo:')} {account.plan.code || '-'}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">{t('Users', 'Usuarios')}</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {account.users.totalUsersIncludingAdmin} {t('total', 'total')} ({account.users.managedUsers}{' '}
                  {t('team', 'time')})
                </p>
                <p className="text-xs text-slate-500">
                  HR {account.users.byRole.HR} | SUP {account.users.byRole.SUPERVISOR} | MEMBER {account.users.byRole.MEMBER}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">{t('Seats', 'Cadeiras')}</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {t('Limit', 'Limite')}{' '}
                  {account.billing.seatLimit === null ? t('Unlimited', 'Ilimitado') : account.billing.seatLimit}
                </p>
                <p className="text-xs text-slate-500">
                  {t('Occupied', 'Ocupadas')} {account.billing.occupiedSeats} | {t('Available', 'Disponiveis')}{' '}
                  {account.billing.availableSeats === null ? '-' : account.billing.availableSeats} |{' '}
                  {t('Overage', 'Excedente')} {account.billing.overageSeats}
                </p>
              </div>

              <div className="rounded-2xl border border-cyan-100 bg-cyan-50/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.15em] text-cyan-700">
                  {t('Account MRR', 'MRR da conta')}
                </p>
                <p className="mt-1 text-sm font-semibold text-cyan-800">{formatUsd(account.mrr.totalUsd)}</p>
                <p className="text-xs text-cyan-700">
                  {t('Base', 'Base')} {formatUsd(account.mrr.basePlanUsd)} + {t('Overage', 'Excedente')}{' '}
                  {formatUsd(account.mrr.overageUsd)}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  {t('ADMIN configuration', 'Configuracao do ADMIN')}
                </h3>
                <button
                  type="button"
                  onClick={() => saveAdminConfig(account.admin.id)}
                  disabled={Boolean(configSavingById[account.admin.id])}
                  className="rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-white disabled:opacity-60"
                >
                  {configSavingById[account.admin.id] ? t('Saving...', 'Salvando...') : t('Save', 'Salvar')}
                </button>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-6">
                <label className="text-xs text-slate-600">
                  {t('Plan', 'Plano')}
                  <select
                    value={adminConfigById[account.admin.id]?.adminPlanCode || ''}
                    onChange={(event) =>
                      handleAdminConfigField(account.admin.id, 'adminPlanCode', event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    {availablePlans.map((plan) => (
                      <option key={plan.id || plan.code} value={plan.code}>
                        {plan.name} ({plan.code}){plan.isActive ? '' : ` - ${t('inactive', 'inativo')}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  {t('Plan name', 'Nome do plano')}
                  <input
                    value={adminConfigById[account.admin.id]?.adminPlanName || ''}
                    readOnly
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  {t('Monthly price (USD)', 'Preco mensal (USD)')}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={adminConfigById[account.admin.id]?.adminPlanMonthlyPrice || ''}
                    onChange={(event) =>
                      handleAdminConfigField(account.admin.id, 'adminPlanMonthlyPrice', event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  {t('Plan status', 'Status do plano')}
                  <select
                    value={adminConfigById[account.admin.id]?.adminPlanStatus || 'INACTIVE'}
                    onChange={(event) =>
                      handleAdminConfigField(
                        account.admin.id,
                        'adminPlanStatus',
                        event.target.value as AdminPlanStatus
                      )
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="ACTIVE">{t('ACTIVE', 'ATIVO')}</option>
                    <option value="INACTIVE">{t('INACTIVE', 'INATIVO')}</option>
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  {t('Seat limit', 'Limite de cadeiras')}
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={adminConfigById[account.admin.id]?.adminSeatLimit || ''}
                    onChange={(event) =>
                      handleAdminConfigField(account.admin.id, 'adminSeatLimit', event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  {t('Extra seat (USD)', 'Cadeira extra (USD)')}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={adminConfigById[account.admin.id]?.adminExtraSeatPrice || ''}
                    onChange={(event) =>
                      handleAdminConfigField(account.admin.id, 'adminExtraSeatPrice', event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                </label>
              </div>

              {configErrorById[account.admin.id] ? (
                <p className="mt-3 text-xs text-rose-700">{configErrorById[account.admin.id]}</p>
              ) : null}
              {configNoticeById[account.admin.id] ? (
                <p className="mt-3 text-xs text-emerald-700">{configNoticeById[account.admin.id]}</p>
              ) : null}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  {t('Payment history', 'Historico de pagamento')}
                </h3>
                <span className="text-xs text-slate-500">
                  {t('Last', 'Ultimos')} {account.paymentHistory.length} {t('records', 'registros')}
                </span>
              </div>

              {account.paymentHistory.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  {t(
                    'No Stripe checkout records for this account.',
                    'Sem registros de checkout Stripe para esta conta.'
                  )}
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-xs text-slate-600">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] uppercase tracking-[0.15em] text-slate-500">
                        <th className="px-2 py-2 font-semibold">{t('Date', 'Data')}</th>
                        <th className="px-2 py-2 font-semibold">{t('Status', 'Status')}</th>
                        <th className="px-2 py-2 font-semibold">{t('Paid amount', 'Valor pago')}</th>
                        <th className="px-2 py-2 font-semibold">{t('Expected amount', 'Valor esperado')}</th>
                        <th className="px-2 py-2 font-semibold">{t('Overage', 'Excedente')}</th>
                        <th className="px-2 py-2 font-semibold">{t('Billing email', 'Email cobranca')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {account.paymentHistory.map((payment) => (
                        <tr key={payment.id} className="border-b border-slate-100/80 last:border-b-0">
                          <td className="px-2 py-2">{formatDateTime(payment.createdAt, locale)}</td>
                          <td className="px-2 py-2">
                            {payment.paymentStatus || '-'} / {payment.status || '-'}
                          </td>
                          <td className="px-2 py-2">
                            {payment.amountTotal !== null && payment.currency
                              ? `${payment.amountTotal.toFixed(2)} ${payment.currency}`
                              : '-'}
                          </td>
                          <td className="px-2 py-2">{formatUsd(payment.expectedMonthlyAmountUsd)}</td>
                          <td className="px-2 py-2">{payment.overageSeats ?? '-'}</td>
                          <td className="px-2 py-2">{payment.customerEmail || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      {deleteNotice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {deleteNotice}
        </div>
      ) : null}

      {selectedAdminForDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-rose-200 bg-white shadow-2xl">
            <div className="border-b border-slate-100 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-rose-700">
                {t('Destructive action', 'Acao destrutiva')}
              </p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">
                {t('Delete ADMIN account', 'Excluir conta de ADMIN')}
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                {t(
                  'This will permanently remove the admin from Supabase and the database. Any users in their organization may be left without an admin owner.',
                  'Isto vai remover o admin permanentemente do Supabase e do banco. Usuarios da organizacao podem ficar sem admin responsavel.'
                )}
              </p>
              <p className="mt-3 text-sm text-slate-700">
                <span className="font-semibold">{selectedAdminForDelete.admin.name || t('No name', 'Sem nome')}</span>
                <br />
                <span className="text-slate-500">{selectedAdminForDelete.admin.email}</span>
              </p>
              <p className="mt-3 text-xs text-slate-500">
                {t('Linked users (excluding admin):', 'Usuarios vinculados (sem o admin):')}{' '}
                <strong className="text-slate-700">{selectedAdminForDelete.users.managedUsers}</strong>
              </p>
            </div>

            <div className="p-5">
              <label className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-600">
                {t('Type the email to confirm:', 'Digite o email para confirmar:')}
              </label>
              <input
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                placeholder={selectedAdminForDelete.admin.email}
                autoFocus
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                disabled={deleteLoading}
              />

              {deleteError ? (
                <p className="mt-3 text-xs text-rose-700">{deleteError}</p>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDeleteAccountModal}
                  disabled={deleteLoading}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-700 disabled:opacity-60"
                >
                  {t('Cancel', 'Cancelar')}
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteAccount}
                  disabled={deleteLoading}
                  className="rounded-full bg-rose-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-white hover:bg-rose-800 disabled:opacity-60"
                >
                  {deleteLoading ? t('Deleting...', 'Excluindo...') : t('Delete permanently', 'Excluir definitivamente')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedAdminForModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="max-h-[85vh] w-full max-w-6xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  {t('Linked accounts', 'Contas vinculadas')}
                </p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">
                  {selectedAdminForModal.name || t('No name', 'Sem nome')}
                </h3>
                <p className="text-sm text-slate-600">{selectedAdminForModal.email}</p>
              </div>
              <button
                type="button"
                onClick={closeLinkedAccountsModal}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-slate-700"
              >
                {t('Close', 'Fechar')}
              </button>
            </div>

            <div className="max-h-[65vh] overflow-auto p-5">
              {linkedAccountsLoading ? (
                <p className="text-sm text-slate-500">
                  {t('Loading linked accounts...', 'Carregando contas vinculadas...')}
                </p>
              ) : null}

              {linkedAccountsError ? (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {linkedAccountsError}
                </p>
              ) : null}

              {!linkedAccountsLoading && !linkedAccountsError && linkedAccounts.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {t('No linked accounts found.', 'Nenhuma conta vinculada encontrada.')}
                </p>
              ) : null}

              {!linkedAccountsLoading && !linkedAccountsError && linkedAccounts.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1400px] text-left text-xs text-slate-600">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] uppercase tracking-[0.15em] text-slate-500">
                        <th className="px-2 py-2 font-semibold">{t('Name', 'Nome')}</th>
                        <th className="px-2 py-2 font-semibold">{t('Email', 'Email')}</th>
                        <th className="px-2 py-2 font-semibold">ID</th>
                        <th className="px-2 py-2 font-semibold">{t('Phone', 'Telefone')}</th>
                        <th className="px-2 py-2 font-semibold">Role</th>
                        <th className="px-2 py-2 font-semibold">{t('Supervisor', 'Supervisor')}</th>
                        <th className="px-2 py-2 font-semibold">{t('Workday', 'Jornada')}</th>
                        <th className="px-2 py-2 font-semibold">{t('Hourly rate', 'Valor hora')}</th>
                        <th className="px-2 py-2 font-semibold">{t('Time zone', 'Fuso')}</th>
                        <th className="px-2 py-2 font-semibold">{t('Created at', 'Criado em')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linkedAccounts.map((user) => (
                        <tr key={user.id} className="border-b border-slate-100/80 last:border-b-0">
                          <td className="px-2 py-2 font-semibold text-slate-800">{user.name || '-'}</td>
                          <td className="px-2 py-2">{user.email}</td>
                          <td className="px-2 py-2 font-mono text-[10px]">{user.id}</td>
                          <td className="px-2 py-2">{user.phone || '-'}</td>
                          <td className="px-2 py-2">{user.role}</td>
                          <td className="px-2 py-2">{user.supervisor?.name || '-'}</td>
                          <td className="px-2 py-2">{formatWorkday(user.workdayStartTime, user.workdayEndTime)}</td>
                          <td className="px-2 py-2">
                            {(() => {
                              const parsedRate = Number(user.hourlyRate)
                              return Number.isFinite(parsedRate) ? formatUsd(parsedRate) : '-'
                            })()}
                          </td>
                          <td className="px-2 py-2">{user.timeZone || '-'}</td>
                          <td className="px-2 py-2">{formatDateTime(user.createdAt, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default SuperAdminAccountsPage
