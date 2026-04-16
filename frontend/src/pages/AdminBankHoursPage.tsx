import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'

type KpiPeriod = 'daily' | 'weekly' | 'monthly'

type HoursKpiItem = {
  member: {
    id: string
    name: string
    email: string
  }
  expectedMinutes: number
  workedMinutes: number
  overtimeMinutes: number
}

type HoursKpiResponse = {
  summary: {
    expectedMinutes: number
    workedMinutes: number
    overtimeMinutes: number
  }
  byCollaborator: HoursKpiItem[]
}

type BankHoursOverviewItem = {
  user: {
    id: string
    name: string
    email: string
    role: string
  }
  bankHours: {
    balanceMinutes: number
    creditMinutes: number
    debtMinutes: number
    pendingMinutes: number
    paidMinutes: number
  }
}

const formatMinutesLabel = (minutes: number) => {
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const mins = absolute % 60
  const sign = minutes < 0 ? '-' : ''
  return `${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

const AdminBankHoursPage = () => {
  const { session } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const locale = isPt ? 'pt-BR' : 'en-US'
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token

  const [period, setPeriod] = useState<KpiPeriod>('weekly')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [kpiPayload, setKpiPayload] = useState<HoursKpiResponse | null>(null)
  const [bankOverview, setBankOverview] = useState<BankHoursOverviewItem[]>([])
  const [bankPayLoadingByUser, setBankPayLoadingByUser] = useState<Record<string, boolean>>({})

  const loadData = async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const [kpisResponse, bankResponse] = await Promise.all([
        apiFetch<HoursKpiResponse>(`/supervisor/kpis/hours?period=${period}`, { token }),
        apiFetch<{ overview: BankHoursOverviewItem[] }>('/admin/bank-hours/overview', { token }),
      ])

      setKpiPayload(kpisResponse)
      setBankOverview(bankResponse.overview || [])
    } catch (err) {
      setKpiPayload(null)
      setBankOverview([])
      setError(
        err instanceof Error
          ? err.message
          : t('Could not load banked-hours overview.', 'Erro ao carregar visao de banco de horas')
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData().catch(() => undefined)
  }, [token, period])

  const bankByUserId = useMemo(() => {
    return bankOverview.reduce<Record<string, BankHoursOverviewItem>>((acc, item) => {
      acc[item.user.id] = item
      return acc
    }, {})
  }, [bankOverview])

  const kpiByUserId = useMemo(() => {
    const entries = kpiPayload?.byCollaborator || []
    return entries.reduce<Record<string, HoursKpiItem>>((acc, item) => {
      acc[item.member.id] = item
      return acc
    }, {})
  }, [kpiPayload])

  const combinedRows = useMemo(() => {
    const idSet = new Set<string>()

    Object.keys(bankByUserId).forEach((id) => idSet.add(id))
    Object.keys(kpiByUserId).forEach((id) => idSet.add(id))

    return Array.from(idSet)
      .map((userId) => {
        const kpi = kpiByUserId[userId]
        const bank = bankByUserId[userId]

        return {
          userId,
          name: kpi?.member.name || bank?.user.name || t('No name', 'Sem nome'),
          email: kpi?.member.email || bank?.user.email || '-',
          role: bank?.user.role || '-',
          expectedMinutes: kpi?.expectedMinutes || 0,
          workedMinutes: kpi?.workedMinutes || 0,
          overtimeMinutes: kpi?.overtimeMinutes || 0,
          balanceMinutes: bank?.bankHours.balanceMinutes || 0,
          pendingMinutes: bank?.bankHours.pendingMinutes || 0,
          paidMinutes: bank?.bankHours.paidMinutes || 0,
        }
      })
        .sort((a, b) => a.name.localeCompare(b.name, locale))
      }, [bankByUserId, kpiByUserId, locale, t])

  const handlePayPendingBankHours = async (userId: string) => {
    if (!token) return

    setError('')
    setNotice('')
    setBankPayLoadingByUser((prev) => ({ ...prev, [userId]: true }))

    try {
      const response = await apiFetch<{ message: string }>(`/admin/users/${userId}/bank-hours/pay`, {
        token,
        method: 'PATCH',
        body: { payAllPending: true },
      })

      setNotice(
        response.message ||
          t(
            'Banked-hours payout recorded successfully.',
            'Baixa de banco de horas registrada com sucesso.'
          )
      )
      await loadData()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not process banked-hours payout.', 'Erro ao dar baixa no banco de horas')
      )
    } finally {
      setBankPayLoadingByUser((prev) => ({ ...prev, [userId]: false }))
    }
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Admin', 'Admin')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{t('Banked hours', 'Banco de horas')}</h2>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'Track weekly and overtime hours by user, with banked-hours balances and pending payouts.',
            'Acompanhe horas semanais e extras por usuario, com saldo e pendencias de banco de horas.'
          )}
        </p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as KpiPeriod)}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="daily">{t('Daily', 'Diario')}</option>
            <option value="weekly">{t('Weekly', 'Semanal')}</option>
            <option value="monthly">{t('Monthly', 'Mensal')}</option>
          </select>

          <button
            onClick={() => loadData().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          >
            {t('Refresh', 'Atualizar')}
          </button>
        </div>

        {loading ? <p className="mt-3 text-sm text-slate-500">{t('Loading data...', 'Carregando dados...')}</p> : null}
        {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
        {notice ? <p className="mt-3 text-xs text-emerald-600">{notice}</p> : null}
      </div>

      {kpiPayload ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Expected', 'Previsto')}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatMinutesLabel(kpiPayload.summary.expectedMinutes)}
            </p>
          </div>
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Worked', 'Realizado')}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatMinutesLabel(kpiPayload.summary.workedMinutes)}
            </p>
          </div>
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Overtime', 'Horas extras')}</p>
            <p className="mt-2 text-2xl font-semibold text-rose-700">
              {formatMinutesLabel(kpiPayload.summary.overtimeMinutes)}
            </p>
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">
          {t('Hours and balances by user', 'Horas e saldo por usuario')}
        </h3>

        <div className="mt-4 space-y-3">
          {combinedRows.length === 0 ? (
            <p className="text-sm text-slate-500">
              {t('No team member found for the selected period.', 'Nenhum colaborador encontrado para o periodo selecionado.')}
            </p>
          ) : (
            combinedRows.map((row) => (
              <div key={row.userId} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{row.name}</p>
                    <p className="text-xs text-slate-500">{row.email}</p>
                    <p className="mt-1 text-xs text-slate-600">Role: {row.role}</p>
                  </div>

                  <button
                    onClick={() => handlePayPendingBankHours(row.userId)}
                    disabled={Boolean(bankPayLoadingByUser[row.userId]) || row.pendingMinutes <= 0}
                    className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {bankPayLoadingByUser[row.userId]
                      ? t('Processing...', 'Processando...')
                      : t('Post pending payout', 'Dar baixa pendente')}
                  </button>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-slate-700 md:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{t('Expected', 'Previsto')}</p>
                    <p className="mt-1 font-semibold">{formatMinutesLabel(row.expectedMinutes)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{t('Worked', 'Realizado')}</p>
                    <p className="mt-1 font-semibold">{formatMinutesLabel(row.workedMinutes)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{t('OT', 'HE')}</p>
                    <p className="mt-1 font-semibold text-rose-700">{formatMinutesLabel(row.overtimeMinutes)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{t('Balance', 'Saldo')}</p>
                    <p className="mt-1 font-semibold">{formatMinutesLabel(row.balanceMinutes)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{t('Pending', 'Pendente')}</p>
                    <p className="mt-1 font-semibold text-amber-700">{formatMinutesLabel(row.pendingMinutes)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{t('Paid', 'Pago')}</p>
                    <p className="mt-1 font-semibold text-emerald-700">{formatMinutesLabel(row.paidMinutes)}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

export default AdminBankHoursPage
