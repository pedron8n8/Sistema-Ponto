import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'

type AdminPlanStatus = 'ACTIVE' | 'INACTIVE'

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
  accounts: SuperAdminAccountItem[]
}

type PlanFilter = 'ALL' | AdminPlanStatus

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

const formatUsd = (value: number | null | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return usdFormatter.format(value)
}

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return dateTimeFormatter.format(parsed)
}

const statusBadgeClass = (status: AdminPlanStatus) => {
  if (status === 'ACTIVE') {
    return 'bg-emerald-100 text-emerald-800 border-emerald-200'
  }

  return 'bg-rose-100 text-rose-800 border-rose-200'
}

const statusLabel = (status: AdminPlanStatus) => {
  if (status === 'ACTIVE') return 'Ativo'
  return 'Expirado'
}

const SuperAdminAccountsPage = () => {
  const { session } = useAuth()
  const token = session?.access_token

  const [payload, setPayload] = useState<SuperAdminOverviewPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [planFilter, setPlanFilter] = useState<PlanFilter>('ALL')
  const [search, setSearch] = useState('')

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
    } catch (err) {
      setPayload(null)
      setError(err instanceof Error ? err.message : 'Erro ao carregar visão superadmin')
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

  const generatedAt = payload?.generatedAt ? formatDateTime(payload.generatedAt) : '-'

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-cyan-700">SuperAdmin</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">Contas, planos e receitas recorrentes</h2>
        <p className="mt-3 text-sm text-slate-600">
          Visão consolidada de todas as contas ADMIN: plano ativo/expirado, total de usuários, MRR por conta e
          histórico de pagamentos de cadeiras adicionais.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1">Atualizado em: {generatedAt}</span>
          <span
            className={`rounded-full border px-3 py-1 ${
              payload?.stripe.configured
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            Stripe: {payload?.stripe.configured ? 'conectado' : 'indisponível'}
          </span>
          {payload?.stripe.sessionsScanned !== undefined ? (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
              Sessões varridas: {payload.stripe.sessionsScanned}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-100 bg-white/90 p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Contas</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{filteredSummary.totalAccounts}</p>
        </article>

        <article className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">Planos ativos</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-800">{filteredSummary.activePlans}</p>
        </article>

        <article className="rounded-2xl border border-rose-100 bg-rose-50/70 p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-rose-700">Planos expirados</p>
          <p className="mt-2 text-3xl font-semibold text-rose-800">{filteredSummary.expiredPlans}</p>
        </article>

        <article className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">MRR total</p>
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
              Todos
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
              Ativos
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
              Expirados
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome ou email"
              className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            />
            <button
              type="button"
              onClick={() => loadOverview().catch(() => undefined)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-700"
            >
              Atualizar
            </button>
          </div>
        </div>
      </div>

      {loading ? <p className="text-sm text-slate-500">Carregando visão superadmin...</p> : null}
      {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

      <div className="space-y-4">
        {filteredAccounts.length === 0 && !loading ? (
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 text-sm text-slate-500 shadow-sm">
            Nenhuma conta encontrada com os filtros atuais.
          </div>
        ) : null}

        {filteredAccounts.map((account) => (
          <article key={account.admin.id} className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-slate-900">{account.admin.name || 'Sem nome'}</p>
                <p className="text-sm text-slate-600">{account.admin.email}</p>
                <p className="mt-1 text-xs text-slate-500">Conta criada em {formatDateTime(account.admin.createdAt)}</p>
              </div>

              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] ${statusBadgeClass(
                  account.plan.status
                )}`}
              >
                {statusLabel(account.plan.status)}
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">Plano</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{account.plan.name || 'Sem plano'}</p>
                <p className="text-xs text-slate-500">Codigo: {account.plan.code || '-'}</p>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">Usuários</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {account.users.totalUsersIncludingAdmin} total ({account.users.managedUsers} time)
                </p>
                <p className="text-xs text-slate-500">
                  HR {account.users.byRole.HR} | SUP {account.users.byRole.SUPERVISOR} | MEMBER {account.users.byRole.MEMBER}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">Cadeiras</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  Limite {account.billing.seatLimit === null ? 'Ilimitado' : account.billing.seatLimit}
                </p>
                <p className="text-xs text-slate-500">
                  Ocupadas {account.billing.occupiedSeats} | Disponíveis{' '}
                  {account.billing.availableSeats === null ? '-' : account.billing.availableSeats} | Excedente{' '}
                  {account.billing.overageSeats}
                </p>
              </div>

              <div className="rounded-2xl border border-cyan-100 bg-cyan-50/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.15em] text-cyan-700">MRR da conta</p>
                <p className="mt-1 text-sm font-semibold text-cyan-800">{formatUsd(account.mrr.totalUsd)}</p>
                <p className="text-xs text-cyan-700">
                  Base {formatUsd(account.mrr.basePlanUsd)} + Excedente {formatUsd(account.mrr.overageUsd)}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Histórico de pagamento</h3>
                <span className="text-xs text-slate-500">Últimos {account.paymentHistory.length} registros</span>
              </div>

              {account.paymentHistory.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Sem registros de checkout Stripe para esta conta.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-xs text-slate-600">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] uppercase tracking-[0.15em] text-slate-500">
                        <th className="px-2 py-2 font-semibold">Data</th>
                        <th className="px-2 py-2 font-semibold">Status</th>
                        <th className="px-2 py-2 font-semibold">Valor pago</th>
                        <th className="px-2 py-2 font-semibold">Valor esperado</th>
                        <th className="px-2 py-2 font-semibold">Excedente</th>
                        <th className="px-2 py-2 font-semibold">Email cobrança</th>
                      </tr>
                    </thead>
                    <tbody>
                      {account.paymentHistory.map((payment) => (
                        <tr key={payment.id} className="border-b border-slate-100/80 last:border-b-0">
                          <td className="px-2 py-2">{formatDateTime(payment.createdAt)}</td>
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
    </section>
  )
}

export default SuperAdminAccountsPage
