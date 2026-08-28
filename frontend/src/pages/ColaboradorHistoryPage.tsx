import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTimeZone } from '../context/TimezoneContext'
import { useTranslation } from 'react-i18next'
import { formatDateTimeWithTimeZone, formatDateWithTimeZone, formatTimeWithTimeZone } from '../lib/timezone'

const CORRECTION_ACTION = 'MEMBER_CORRECTION_REQUESTED'
const REASON_MIN_LENGTH = 5
const REASON_MAX_LENGTH = 500

type ApprovalLog = {
  id: string
  action: string
  comment?: string | null
  timestamp: string
}

type TimeEntry = {
  id: string
  clockIn: string
  clockOut: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  workedMinutes?: number
  overtimeMinutes50?: number
  overtimeMinutes100?: number
  logs?: ApprovalLog[]
}

type CompleteProfile = {
  id: string
  hourlyRate?: number | null
}

type DayHistory = {
  date: string
  workedMinutes: number
  overtimeMinutes50: number
  overtimeMinutes100: number
  entries: TimeEntry[]
  gainAmount: number
}

const formatMinutesLabel = (minutes: number) => {
  const safeMinutes = Math.max(0, Math.floor(minutes))
  const hours = Math.floor(safeMinutes / 60)
  const mins = safeMinutes % 60
  return `${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`
}

const calculateGain = (entry: TimeEntry, hourlyRate: number) => {
  if (!hourlyRate || hourlyRate <= 0) return 0

  const workedMinutes = Math.max(0, Math.floor(Number(entry.workedMinutes) || 0))
  const overtime50 = Math.max(0, Math.floor(Number(entry.overtimeMinutes50) || 0))
  const overtime100 = Math.max(0, Math.floor(Number(entry.overtimeMinutes100) || 0))
  const regularMinutes = Math.max(0, workedMinutes - overtime50 - overtime100)

  const regularAmount = (regularMinutes / 60) * hourlyRate
  const overtime50Amount = (overtime50 / 60) * hourlyRate * 1.5
  const overtime100Amount = (overtime100 / 60) * hourlyRate * 2

  return Number((regularAmount + overtime50Amount + overtime100Amount).toFixed(2))
}

const ColaboradorHistoryPage = () => {
  const { session } = useAuth()
  const { viewTimeZone } = useTimeZone()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const locale = isPt ? 'pt-BR' : 'en-US'

  const correctionRequestsOf = (entry: TimeEntry) =>
    (entry.logs || []).filter((log) => log.action === CORRECTION_ACTION)

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value)

  const statusLabel = (status: TimeEntry['status']) =>
    t(
      {
        PENDING: 'Pending',
        APPROVED: 'Approved',
        REJECTED: 'Rejected',
      }[status] || status,
      {
        PENDING: 'Pendente',
        APPROVED: 'Aprovado',
        REJECTED: 'Rejeitado',
      }[status] || status
    )

  const token = session?.access_token

  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [hourlyRate, setHourlyRate] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [correctionEntryId, setCorrectionEntryId] = useState<string | null>(null)
  const [correctionReason, setCorrectionReason] = useState('')
  const [correctionError, setCorrectionError] = useState('')
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false)

  const trimmedReason = correctionReason.trim()
  const reasonTooShort = trimmedReason.length < REASON_MIN_LENGTH
  const reasonTooLong = trimmedReason.length > REASON_MAX_LENGTH
  const reasonIsValid = !reasonTooShort && !reasonTooLong

  const openCorrectionForm = (entryId: string) => {
    setCorrectionEntryId(entryId)
    setCorrectionReason('')
    setCorrectionError('')
  }

  const closeCorrectionForm = () => {
    setCorrectionEntryId(null)
    setCorrectionReason('')
    setCorrectionError('')
  }

  const submitCorrection = async (entryId: string) => {
    if (!token || correctionSubmitting) return

    // Mesma regra do backend (5 a 500 caracteres): valida aqui para o
    // colaborador receber o aviso na hora, sem gastar um 400 de ida e volta.
    if (!reasonIsValid) {
      setCorrectionError(
        t(
          `Describe the adjustment in ${REASON_MIN_LENGTH} to ${REASON_MAX_LENGTH} characters.`,
          `Descreva o ajuste em ${REASON_MIN_LENGTH} a ${REASON_MAX_LENGTH} caracteres.`
        )
      )
      return
    }

    setCorrectionSubmitting(true)
    setCorrectionError('')

    try {
      await apiFetch<{ message: string; log?: ApprovalLog }>(`/time/${entryId}/request-correction`, {
        token,
        method: 'POST',
        body: { reason: trimmedReason },
      })

      closeCorrectionForm()
      // Recarrega em vez de inserir o log otimisticamente: GET /time/me ja devolve
      // os `logs` do registro, e um reenvio identico volta como 202 sem `log`.
      await loadData()
    } catch (err) {
      const status = (err as { status?: number })?.status

      if (status === 409) {
        // O supervisor aprovou o registro enquanto o formulario estava aberto:
        // recarrega para o status na tela refletir o que o servidor ja decidiu.
        await loadData().catch(() => undefined)
        setCorrectionError(
          t(
            'This entry was approved in the meantime. Talk to your supervisor to change it.',
            'Este registro foi aprovado nesse meio-tempo. Fale com seu supervisor para alterá-lo.'
          )
        )
      } else {
        setCorrectionError(
          err instanceof Error
            ? err.message
            : t('Failed to send the adjustment request', 'Erro ao enviar o pedido de ajuste')
        )
      }
    } finally {
      setCorrectionSubmitting(false)
    }
  }

  const loadData = async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const [entriesResponse, profileResponse] = await Promise.all([
        apiFetch<{ entries: TimeEntry[] }>('/time/me?limit=120', { token }),
        apiFetch<{ user: CompleteProfile }>('/users/me/profile-complete', { token }),
      ])

      setEntries(entriesResponse.entries || [])
      setHourlyRate(Number(profileResponse.user?.hourlyRate || 0))
    } catch (err) {
      setEntries([])
      setHourlyRate(0)
      setError(err instanceof Error ? err.message : t('Failed to load history', 'Erro ao carregar histórico'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData().catch(() => undefined)
  }, [token])

  const groupedByDay = useMemo(() => {
    const map = new Map<string, DayHistory>()

    for (const entry of entries) {
      const dateKey = entry.clockIn ? new Date(entry.clockIn).toISOString().slice(0, 10) : 'unknown'
      const current =
        map.get(dateKey) ||
        ({
          date: dateKey,
          workedMinutes: 0,
          overtimeMinutes50: 0,
          overtimeMinutes100: 0,
          entries: [],
          gainAmount: 0,
        } as DayHistory)

      current.entries.push(entry)

      const worked = Math.max(0, Math.floor(Number(entry.workedMinutes) || 0))
      const overtime50 = Math.max(0, Math.floor(Number(entry.overtimeMinutes50) || 0))
      const overtime100 = Math.max(0, Math.floor(Number(entry.overtimeMinutes100) || 0))

      current.workedMinutes += worked
      current.overtimeMinutes50 += overtime50
      current.overtimeMinutes100 += overtime100
      current.gainAmount += calculateGain(entry, hourlyRate)

      map.set(dateKey, current)
    }

    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date))
  }, [entries, hourlyRate])

  const totals = useMemo(() => {
    return groupedByDay.reduce(
      (acc, day) => {
        acc.workedMinutes += day.workedMinutes
        acc.gainAmount += day.gainAmount
        return acc
      },
      { workedMinutes: 0, gainAmount: 0 }
    )
  }, [groupedByDay])

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Member', 'Colaborador')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">
          {t('Time history and earnings', 'Histórico de ponto e ganhos')}
        </h2>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'See how much you worked and earned per day based on your configured hourly rate.',
            'Veja quanto você trabalhou e quanto ganhou por dia, com base na sua hora cadastrada.'
          )}
        </p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {t('Hourly rate:', 'Valor/hora:')} {hourlyRate > 0 ? formatCurrency(hourlyRate) : t('Not set', 'Não definido')}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {t('Total worked:', 'Total trabalhado:')} {formatMinutesLabel(totals.workedMinutes)}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {t('Total earned:', 'Total ganho:')} {formatCurrency(totals.gainAmount)}
          </span>
        </div>

        <div className="mt-4">
          <button
            onClick={() => loadData().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          >
            {t('Refresh', 'Atualizar')}
          </button>
        </div>

        {loading ? <p className="mt-3 text-sm text-slate-500">{t('Loading history...', 'Carregando histórico...')}</p> : null}
        {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{t('Per day', 'Por dia')}</h3>

        <div className="mt-4 space-y-4">
          {groupedByDay.length === 0 ? (
            <p className="text-sm text-slate-500">{t('No records in this period.', 'Sem registros no período.')}</p>
          ) : (
            groupedByDay.map((day) => (
              <div key={day.date} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {day.date === 'unknown'
                      ? t('Invalid date', 'Data inválida')
                      : formatDateWithTimeZone(`${day.date}T00:00:00.000Z`, viewTimeZone)}
                  </p>
                  <p className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                    {t('Earnings:', 'Ganho:')} {formatCurrency(day.gainAmount)}
                  </p>
                </div>

                <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                  <span className="rounded-full bg-white px-3 py-1">
                    {t('Worked:', 'Trabalhado:')} {formatMinutesLabel(day.workedMinutes)}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1">
                    {t('Overtime 50%:', 'HE 50%:')} {formatMinutesLabel(day.overtimeMinutes50)}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1">
                    {t('Overtime 100%:', 'HE 100%:')} {formatMinutesLabel(day.overtimeMinutes100)}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {day.entries.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs text-slate-600">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p>
                          {entry.clockIn ? formatTimeWithTimeZone(entry.clockIn, viewTimeZone) : '--'} -{' '}
                          {entry.clockOut ? formatTimeWithTimeZone(entry.clockOut, viewTimeZone) : t('Open', 'Em aberto')}
                        </p>
                        <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-700">
                          {statusLabel(entry.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {t('Earnings in entry:', 'Ganho no registro:')} {formatCurrency(calculateGain(entry, hourlyRate))}
                      </p>

                      {correctionRequestsOf(entry).map((log) => (
                        <div
                          key={log.id}
                          className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"
                        >
                          <p className="font-semibold uppercase tracking-[0.15em]">
                            {t('Adjustment requested', 'Ajuste solicitado')}
                          </p>
                          <p className="mt-1">{log.comment || t('No description.', 'Sem descrição.')}</p>
                          <p className="mt-1 text-[10px] text-amber-700">
                            {formatDateTimeWithTimeZone(log.timestamp, viewTimeZone, locale)}
                          </p>
                        </div>
                      ))}

                      {entry.status !== 'APPROVED' && correctionEntryId !== entry.id ? (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => openCorrectionForm(entry.id)}
                            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-700"
                          >
                            {t('Request adjustment', 'Pedir ajuste')}
                          </button>
                        </div>
                      ) : null}

                      {correctionEntryId === entry.id ? (
                        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <label
                            htmlFor={`correction-${entry.id}`}
                            className="text-[11px] font-semibold text-slate-700"
                          >
                            {t('What needs to be fixed?', 'O que precisa ser corrigido?')}
                          </label>
                          <textarea
                            id={`correction-${entry.id}`}
                            value={correctionReason}
                            onChange={(event) => {
                              setCorrectionReason(event.target.value)
                              setCorrectionError('')
                            }}
                            maxLength={REASON_MAX_LENGTH}
                            rows={3}
                            placeholder={t(
                              'e.g. I clocked out at 6pm but forgot to register it.',
                              'ex: saí às 18h mas esqueci de registrar.'
                            )}
                            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                          />
                          <p className="mt-1 text-[10px] text-slate-500">
                            {trimmedReason.length}/{REASON_MAX_LENGTH}{' '}
                            {reasonTooShort
                              ? t(
                                  `(at least ${REASON_MIN_LENGTH} characters)`,
                                  `(mínimo de ${REASON_MIN_LENGTH} caracteres)`
                                )
                              : ''}
                          </p>

                          {correctionError ? (
                            <p className="mt-2 text-[11px] text-rose-600">{correctionError}</p>
                          ) : null}

                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => submitCorrection(entry.id).catch(() => undefined)}
                              disabled={!reasonIsValid || correctionSubmitting}
                              className="rounded-full bg-slate-900 px-4 py-2 text-[11px] font-medium text-white disabled:opacity-50"
                            >
                              {correctionSubmitting ? t('Sending...', 'Enviando...') : t('Send request', 'Enviar pedido')}
                            </button>
                            <button
                              type="button"
                              onClick={closeCorrectionForm}
                              disabled={correctionSubmitting}
                              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-700 disabled:opacity-50"
                            >
                              {t('Cancel', 'Cancelar')}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

export default ColaboradorHistoryPage
