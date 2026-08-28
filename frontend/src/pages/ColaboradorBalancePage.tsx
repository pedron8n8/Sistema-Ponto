import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTimeZone } from '../context/TimezoneContext'
import { useTranslation } from 'react-i18next'
import { formatDateWithTimeZone, formatDateTimeWithTimeZone } from '../lib/timezone'

type BankHoursEntryType = 'ACCRUAL' | 'ADJUSTMENT' | 'EXPIRY'
type BankHoursPaymentStatus = 'PENDING' | 'PAID'

type BankHoursEntry = {
  id: string
  type: BankHoursEntryType
  paymentStatus: BankHoursPaymentStatus
  minutes: number
  description?: string | null
  expiresAt?: string | null
  expiredAt?: string | null
  paidAt?: string | null
  createdAt: string
  timeEntry?: {
    id: string
    clockIn: string
    clockOut: string | null
  } | null
}

type BankHoursSummary = {
  balanceMinutes: number
  limitMinutes: number | null
  expiryMonths: number
  policyCode: string | null
  expiredMinutes: number
}

type BankHoursResponse = {
  bankHours: BankHoursSummary
  entries: BankHoursEntry[]
}

const formatMinutesLabel = (minutes: number) => {
  const safeMinutes = Math.trunc(Number(minutes) || 0)
  const absolute = Math.abs(safeMinutes)
  const hours = Math.floor(absolute / 60)
  const mins = absolute % 60
  const sign = safeMinutes < 0 ? '-' : ''
  return `${sign}${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`
}

const formatSignedMinutesLabel = (minutes: number) => {
  const safeMinutes = Math.trunc(Number(minutes) || 0)
  const prefix = safeMinutes > 0 ? '+' : ''
  return `${prefix}${formatMinutesLabel(safeMinutes)}`
}

const ColaboradorBalancePage = () => {
  const { session } = useAuth()
  const { viewTimeZone } = useTimeZone()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const locale = isPt ? 'pt-BR' : 'en-US'

  const token = session?.access_token

  const [summary, setSummary] = useState<BankHoursSummary | null>(null)
  const [entries, setEntries] = useState<BankHoursEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const typeLabel = (type: BankHoursEntryType) =>
    t(
      {
        ACCRUAL: 'Accrual',
        ADJUSTMENT: 'Adjustment',
        EXPIRY: 'Expiry',
      }[type] || type,
      {
        ACCRUAL: 'Crédito',
        ADJUSTMENT: 'Ajuste',
        EXPIRY: 'Expiração',
      }[type] || type
    )

  const paymentStatusLabel = (status: BankHoursPaymentStatus) =>
    t(
      {
        PENDING: 'Not paid',
        PAID: 'Paid',
      }[status] || status,
      {
        PENDING: 'Não pago',
        PAID: 'Pago',
      }[status] || status
    )

  const loadBankHours = async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const response = await apiFetch<BankHoursResponse>('/time/bank-hours/me', { token })
      setSummary(response.bankHours || null)
      setEntries(Array.isArray(response.entries) ? response.entries : [])
    } catch (err) {
      setSummary(null)
      setEntries([])
      setError(err instanceof Error ? err.message : t('Failed to load hours bank', 'Erro ao carregar banco de horas'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBankHours().catch(() => undefined)
  }, [token])

  const balanceMinutes = summary?.balanceMinutes ?? 0
  const isNegative = balanceMinutes < 0

  const hasNothing = useMemo(
    () => !loading && !error && summary !== null && balanceMinutes === 0 && entries.length === 0,
    [loading, error, summary, balanceMinutes, entries.length]
  )

  return (
    <section className="grid gap-4 sm:gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-5 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur sm:p-8">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Member', 'Colaborador')}</p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-900 sm:mt-4 sm:text-3xl">
          {t('Hours bank balance', 'Saldo do banco de horas')}
        </h2>
        <p className="mt-2 text-sm text-slate-600 sm:mt-3">
          {t(
            'Your current balance and the most recent movements in your hours bank.',
            'Seu saldo atual e as movimentações mais recentes do seu banco de horas.'
          )}
        </p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm sm:p-6">
        <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">{t('Current balance', 'Saldo atual')}</p>
        <p
          className={`mt-2 text-4xl font-semibold tabular-nums sm:text-5xl ${
            isNegative ? 'text-rose-600' : 'text-emerald-700'
          }`}
        >
          {loading && !summary ? '--' : formatSignedMinutesLabel(balanceMinutes)}
        </p>

        {summary ? (
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-600">
            <span className="rounded-full bg-slate-100 px-3 py-1">
              {t('Limit:', 'Limite:')}{' '}
              {summary.limitMinutes === null || summary.limitMinutes === undefined
                ? t('No limit', 'Sem limite')
                : formatMinutesLabel(summary.limitMinutes)}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1">
              {t('Expires in:', 'Expira em:')} {summary.expiryMonths} {t('month(s)', 'mês(es)')}
            </span>
            {summary.policyCode ? (
              <span className="rounded-full bg-slate-100 px-3 py-1">
                {t('Policy:', 'Política:')} {summary.policyCode}
              </span>
            ) : null}
            {summary.expiredMinutes > 0 ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
                {t('Expired now:', 'Expirado agora:')} {formatMinutesLabel(summary.expiredMinutes)}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4">
          <button
            type="button"
            onClick={() => loadBankHours().catch(() => undefined)}
            disabled={loading}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 disabled:opacity-60"
          >
            {loading ? t('Loading...', 'Carregando...') : t('Refresh', 'Atualizar')}
          </button>
        </div>

        {error ? (
          <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900">{t('Recent movements', 'Movimentações recentes')}</h3>
        <p className="mt-1 text-xs text-slate-500">
          {t('Last 30 entries.', 'Últimos 30 lançamentos.')}
        </p>

        <div className="mt-4 space-y-3">
          {loading && entries.length === 0 ? (
            <p className="text-sm text-slate-500">{t('Loading balance...', 'Carregando saldo...')}</p>
          ) : error ? (
            <p className="text-sm text-slate-500">
              {t('Could not load your movements.', 'Não foi possível carregar suas movimentações.')}
            </p>
          ) : entries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-center">
              <p className="text-sm font-semibold text-slate-700">
                {hasNothing
                  ? t('You have no hours bank yet.', 'Você ainda não tem banco de horas.')
                  : t('No movements to show.', 'Nenhuma movimentação para exibir.')}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {t(
                  'Overtime credited to the hours bank will show up here.',
                  'As horas extras creditadas no banco de horas aparecem aqui.'
                )}
              </p>
            </div>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                      entry.type === 'EXPIRY'
                        ? 'bg-amber-100 text-amber-800'
                        : entry.type === 'ADJUSTMENT'
                          ? 'bg-sky-100 text-sky-800'
                          : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {typeLabel(entry.type)}
                  </span>
                  <span
                    className={`text-base font-semibold tabular-nums ${
                      Number(entry.minutes) < 0 ? 'text-rose-600' : 'text-slate-900'
                    }`}
                  >
                    {formatSignedMinutesLabel(entry.minutes)}
                  </span>
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  {formatDateTimeWithTimeZone(entry.createdAt, viewTimeZone, locale)}
                </p>

                {entry.description ? (
                  <p className="mt-1 text-xs text-slate-600">{entry.description}</p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
                  <span
                    className={`rounded-full px-3 py-1 ${
                      entry.paymentStatus === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-white'
                    }`}
                  >
                    {t('Payment:', 'Pagamento:')} {paymentStatusLabel(entry.paymentStatus)}
                    {entry.paymentStatus === 'PAID' && entry.paidAt
                      ? ` · ${formatDateWithTimeZone(entry.paidAt, viewTimeZone, locale)}`
                      : ''}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1">
                    {entry.expiredAt
                      ? `${t('Expired on:', 'Expirado em:')} ${formatDateWithTimeZone(entry.expiredAt, viewTimeZone, locale)}`
                      : entry.expiresAt
                        ? `${t('Expires on:', 'Expira em:')} ${formatDateWithTimeZone(entry.expiresAt, viewTimeZone, locale)}`
                        : t('No expiry', 'Sem expiração')}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

export default ColaboradorBalancePage
