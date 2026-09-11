import { useEffect, useMemo, useState } from 'react'
import { API_BASE, apiFetch, translateApiMessage } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTimeZone } from '../context/TimezoneContext'
import { useTranslation } from 'react-i18next'
import { formatDateWithTimeZone, formatTimeWithTimeZone, getDateKeyWithTimeZone } from '../lib/timezone'
import { buildWeekDays, type TimesheetEntry } from '../lib/weekTimesheet'

// A semana corrente e "ao vivo": o registro em aberto cresce no relogio local
// e uma batida feita em outro dispositivo entra sem o usuario recarregar.
const LIVE_TICK_MS = 30_000
const LIVE_REFRESH_MS = 60_000

const API_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, '')

type TimeEntry = TimesheetEntry

type ExportJobResponse = {
  jobId: string
}

type ExportStatusResponse = {
  state: 'waiting' | 'active' | 'completed' | 'failed' | string
  result?: {
    filename: string
    downloadUrl: string
  }
  error?: string
}

type DailyBreakdownRow = {
  user: {
    id: string
    name: string
    email: string
    hourlyRate: number
    timeZone?: string
  }
  workedMinutes: number
  bankHoursAccruedMinutes: number
  totalCost: number
}

type DailyBreakdownResponse = {
  date: string
  rows: DailyBreakdownRow[]
  summary: {
    totalEmployees: number
    totalWorkedMinutes: number
    totalBankHoursAccruedMinutes: number
    totalCost: number
  }
}

const Reports = () => {
  const { session, profile } = useAuth()
  const { viewTimeZone } = useTimeZone()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const locale = isPt ? 'pt-BR' : 'en-US'
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token
  const formatDateInput = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return formatDateInput(d)
  })
  const [endDate, setEndDate] = useState(() => formatDateInput(new Date()))
  const canExportTeam = profile?.role === 'SUPERVISOR' || profile?.role === 'HR' || profile?.role === 'INTEGRATOR' || profile?.role === 'ADMIN' || profile?.role === 'SUPERADMIN'
  const [includeTeam, setIncludeTeam] = useState(canExportTeam)
  const [message, setMessage] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [dailyBreakdown, setDailyBreakdown] = useState<DailyBreakdownResponse | null>(null)
  const [dailyBreakdownLoading, setDailyBreakdownLoading] = useState(false)
  const [dailyBreakdownError, setDailyBreakdownError] = useState('')
  const [weekLoading, setWeekLoading] = useState(false)
  const [weekError, setWeekError] = useState('')
  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date()
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1)
    const start = new Date(now)
    start.setDate(diff)
    start.setHours(0, 0, 0, 0)
    return start
  })

  const weekEnd = useMemo(() => {
    const end = new Date(weekStart)
    end.setDate(end.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    return end
  }, [weekStart])
  const weekStartKey = formatDateInput(weekStart)
  const weekEndKey = formatDateInput(weekEnd)

  const formatMinutes = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = Math.max(0, minutes % 60)
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  }

  // O backend filtra clockIn por instante UTC, mas as linhas sao agrupadas pelo
  // dia no fuso de visualizacao. Pede um dia a mais de cada lado para nenhuma
  // batida da borda da semana sumir; dayRows depois recorta pelo dia certo.
  const queryStartKey = useMemo(() => {
    const start = new Date(weekStart)
    start.setDate(start.getDate() - 1)
    return formatDateInput(start)
  }, [weekStart])
  const queryEndKey = useMemo(() => {
    const end = new Date(weekEnd)
    end.setDate(end.getDate() + 1)
    return formatDateInput(end)
  }, [weekEnd])

  const loadWeek = async (options: { silent?: boolean } = {}) => {
    if (!token) return
    if (!options.silent) {
      setWeekLoading(true)
      setWeekError('')
    }
    const query = new URLSearchParams({
      startDate: queryStartKey,
      endDate: queryEndKey,
      limit: '200',
    })
    try {
      const response = await apiFetch<{ entries: TimeEntry[] }>(`/time/me?${query.toString()}`, { token })
      setEntries(response.entries)
      setNowMs(Date.now())
    } catch (err) {
      // Falha no refresh silencioso nao apaga o que ja esta na tela.
      if (options.silent) return
      setEntries([])
      setWeekError(err instanceof Error ? err.message : t('Failed to load reports.', 'Erro ao carregar relatorios'))
    } finally {
      if (!options.silent) setWeekLoading(false)
    }
  }

  useEffect(() => {
    loadWeek().catch(() => undefined)
  }, [token, queryStartKey, queryEndKey])

  const triggerBrowserDownload = async (downloadUrl: string, fallbackFilename: string) => {
    if (!token) return

    const resolvedUrl = downloadUrl.startsWith('http') ? downloadUrl : `${API_ORIGIN}${downloadUrl}`

    const response = await fetch(resolvedUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      let backendMessage = ''
      try {
        const payload = (await response.json()) as { message?: string }
        backendMessage = translateApiMessage(payload?.message || '')
      } catch {
        backendMessage = ''
      }
      throw new Error(backendMessage || t('Could not download report.', 'Nao foi possivel baixar o relatorio'))
    }

    const contentDisposition = response.headers.get('Content-Disposition') || ''
    const matchedName = contentDisposition.match(/filename="?([^";]+)"?/i)?.[1]
    const filename = matchedName || fallbackFilename

    const blob = await response.blob()
    const objectUrl = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.URL.revokeObjectURL(objectUrl)
  }

  const waitForExportAndDownload = async (jobId: string) => {
    if (!token) return

    const maxAttempts = 40
    const waitMs = 2000

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const status = await apiFetch<ExportStatusResponse>(`/reports/status/${jobId}`, { token })

      if (status.state === 'completed' && status.result) {
        await triggerBrowserDownload(status.result.downloadUrl, status.result.filename)
        setMessage(
          t(
            `Report ${status.result.filename} downloaded successfully.`,
            `Relatorio ${status.result.filename} baixado com sucesso.`
          )
        )
        return
      }

      if (status.state === 'failed') {
        throw new Error(
          status.error
            ? translateApiMessage(status.error)
            : t('Failed to generate report.', 'Falha ao gerar relatorio')
        )
      }

      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }

    throw new Error(
      t(
        'Export is taking longer than expected. Please check again in a moment.',
        'A exportacao demorou mais que o esperado. Verifique em alguns instantes.'
      )
    )
  }

  const handleExport = async () => {
    if (!token) return
    setMessage('')
    setIsExporting(true)
    try {
      const exportJob = await apiFetch<ExportJobResponse>('/reports/export', {
        token,
        method: 'POST',
        skipIdempotency: true,
        body: {
          startDate,
          endDate,
          teamId: canExportTeam && includeTeam && profile?.id ? profile.id : undefined,
          format: 'xlsx',
          timeZone: viewTimeZone,
        },
      })
      setMessage(t('Export started. Generating XLSX file...', 'Exportacao iniciada. Gerando arquivo XLSX...'))
      await waitForExportAndDownload(exportJob.jobId)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('Failed to request export.', 'Erro ao solicitar exportacao'))
    } finally {
      setIsExporting(false)
    }
  }

  const handleOpenDailyBreakdown = async (dateParam: string) => {
    if (!token) return
    setSelectedDay(dateParam)
    setDailyBreakdown(null)
    setDailyBreakdownLoading(true)
    setDailyBreakdownError('')

    try {
      const response = await apiFetch<DailyBreakdownResponse>(
        `/reports/daily-breakdown?date=${encodeURIComponent(dateParam)}&timeZone=${encodeURIComponent(viewTimeZone)}`,
        { token }
      )
      setDailyBreakdown(response)
    } catch (err) {
      setDailyBreakdown(null)
      setDailyBreakdownError(
        err instanceof Error
          ? err.message
          : t('Failed to load daily breakdown.', 'Erro ao carregar detalhamento do dia')
      )
    } finally {
      setDailyBreakdownLoading(false)
    }
  }

  const closeDailyBreakdown = () => {
    setSelectedDay(null)
    setDailyBreakdown(null)
    setDailyBreakdownError('')
  }

  const weekDateKeys = useMemo(
    () =>
      Array.from({ length: 7 }).map((_, index) => {
        const date = new Date(weekStart)
        date.setDate(date.getDate() + index)
        return formatDateInput(date)
      }),
    [weekStart]
  )

  const dayRows = useMemo(
    () => buildWeekDays({ dateKeys: weekDateKeys, entries, timeZone: viewTimeZone, nowMs }),
    [entries, viewTimeZone, weekDateKeys, nowMs]
  )

  const weekIncludesToday = useMemo(
    () => weekDateKeys.includes(getDateKeyWithTimeZone(new Date(nowMs), viewTimeZone)),
    [weekDateKeys, viewTimeZone, nowMs]
  )

  // Relogio: o registro em aberto precisa crescer sozinho, sem nova requisicao.
  useEffect(() => {
    if (!weekIncludesToday) return
    const interval = window.setInterval(() => setNowMs(Date.now()), LIVE_TICK_MS)
    return () => window.clearInterval(interval)
  }, [weekIncludesToday])

  // Batida feita no celular ou no terminal aparece aqui sem recarregar a pagina.
  useEffect(() => {
    if (!token || !weekIncludesToday) return
    const interval = window.setInterval(() => {
      loadWeek({ silent: true }).catch(() => undefined)
    }, LIVE_REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [token, weekIncludesToday, queryStartKey, queryEndKey])

  return (
    <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Reports', 'Relatorios')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">
          {t('Weekly timesheet, ready to export.', 'Timesheet semanal, pronto para exportar.')}
        </h2>
        <p className="mt-4 text-sm text-slate-600">
          {t(
            'Select a period and request export. The system generates an XLSX file in the background.',
            'Selecione o periodo e solicite a exportacao. O sistema gera uma planilha XLSX em background.'
          )}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            {t('Week from', 'Semana de')} {formatDateWithTimeZone(weekStartKey, viewTimeZone)} {t('to', 'a')}{' '}
            {formatDateWithTimeZone(weekEndKey, viewTimeZone)}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const prev = new Date(weekStart)
                prev.setDate(prev.getDate() - 7)
                setWeekStart(prev)
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
            >
              {t('Previous week', 'Semana anterior')}
            </button>
            <button
              onClick={() => {
                const next = new Date(weekStart)
                next.setDate(next.getDate() + 7)
                setWeekStart(next)
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
            >
              {t('Next week', 'Proxima semana')}
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3">
          {weekLoading ? (
            <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-slate-100 bg-white/80 p-6">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-700" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {t('Loading reports...', 'Carregando relatorios...')}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {t('Preparing the weekly timesheet.', 'Preparando o timesheet semanal.')}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
          {weekError && !weekLoading ? (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">
              {weekError}
            </div>
          ) : null}
          {!weekLoading && !weekError ? dayRows.map((day) => (
            <button
              key={day.dateKey}
              type="button"
              onClick={() => handleOpenDailyBreakdown(day.dateKey)}
              className="w-full rounded-2xl border border-slate-100 bg-white/80 p-4 text-left transition hover:border-teal-200 hover:bg-teal-50/30"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {formatDateWithTimeZone(day.dateKey, viewTimeZone, locale, { weekday: 'long' })}
                  </p>
                  <p className="text-xs text-slate-500">{formatDateWithTimeZone(day.dateKey, viewTimeZone)}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs ${
                    day.hasLiveEntry ? 'bg-teal-50 font-semibold text-teal-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {day.totalLabel}
                  {day.hasLiveEntry ? ` · ${t('running', 'em andamento')}` : ''}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-slate-600">
                {day.entries.length === 0 ? (
                  <p>{t('No records.', 'Sem registros.')}</p>
                ) : (
                  day.entries.map((row) => (
                    <div key={row.entry.id} className="flex items-center justify-between">
                      <span>
                        {formatTimeWithTimeZone(row.entry.clockIn, viewTimeZone)} -{' '}
                        {row.entry.clockOut
                          ? formatTimeWithTimeZone(row.entry.clockOut, viewTimeZone)
                          : t('Open', 'Em aberto')}
                      </span>
                      <span className={row.isLive ? 'font-semibold text-teal-700' : undefined}>
                        {row.durationLabel}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </button>
          )) : null}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{t('Request export', 'Solicitar exportacao')}</h3>
        <div className="mt-5 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('Start date', 'Data inicio')}
            </label>
            <input
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              type="date"
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('End date', 'Data fim')}
            </label>
            <input
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              type="date"
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm"
            />
          </div>
          {canExportTeam ? (
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {t('Scope', 'Escopo')}
              </label>
              <label className="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeTeam}
                  onChange={(event) => setIncludeTeam(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span>
                  {t('Include entire team', 'Incluir toda a equipe')}
                </span>
              </label>
              <p className="mt-1 text-[11px] text-slate-500">
                {t(
                  'When enabled, the spreadsheet covers every subordinate. Otherwise it only includes your own entries.',
                  'Quando ativo, a planilha cobre todos os subordinados. Caso contrario, inclui apenas suas proprias marcacoes.'
                )}
              </p>
            </div>
          ) : null}
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="w-full rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
          >
            {isExporting ? t('Generating file...', 'Gerando planilha...') : t('Request XLSX export', 'Solicitar exportacao XLSX')}
          </button>
          {message ? <p className="text-xs text-slate-600">{message}</p> : null}
        </div>
      </div>

      {selectedDay ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-3xl rounded-3xl border border-slate-100 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-teal-700">{t('Daily breakdown', 'Detalhamento diario')}</p>
                <h4 className="mt-2 text-xl font-semibold text-slate-900">
                  {formatDateWithTimeZone(selectedDay, viewTimeZone)}
                </h4>
              </div>
              <button
                type="button"
                onClick={closeDailyBreakdown}
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600"
              >
                {t('Close', 'Fechar')}
              </button>
            </div>

            <div className="mt-5">
              {dailyBreakdownLoading ? (
                <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 p-6">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-700" />
                    <p className="text-sm font-semibold text-slate-700">
                      {t('Loading breakdown...', 'Carregando detalhamento...')}
                    </p>
                  </div>
                </div>
              ) : null}
              {dailyBreakdownError ? <p className="text-sm text-rose-600">{dailyBreakdownError}</p> : null}

              {dailyBreakdown && !dailyBreakdownLoading ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{t('Collaborators', 'Colaboradores')}</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{dailyBreakdown.summary.totalEmployees}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{t('Worked hours', 'Horas trabalhadas')}</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {formatMinutes(dailyBreakdown.summary.totalWorkedMinutes)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{t('Banked hours (credit)', 'Banco (credito)')}</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {formatMinutes(dailyBreakdown.summary.totalBankHoursAccruedMinutes)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{t('Total cost', 'Custo total')}</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {formatCurrency(dailyBreakdown.summary.totalCost)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                    {dailyBreakdown.rows.length === 0 ? (
                      <p className="text-sm text-slate-500">{t('No data for this day.', 'Sem dados para este dia.')}</p>
                    ) : (
                      dailyBreakdown.rows.map((row) => (
                        <div key={row.user.id} className="rounded-2xl border border-slate-100 bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{row.user.name}</p>
                              <p className="text-xs text-slate-500">{row.user.email}</p>
                            </div>
                            <div className="text-xs text-slate-500">
                              {t('Hourly rate:', 'Valor/hora:')} {formatCurrency(row.user.hourlyRate || 0)}
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                            <span className="rounded-full bg-slate-100 px-3 py-1">
                              {t('Worked:', 'Trabalhado:')} {formatMinutes(row.workedMinutes)}
                            </span>
                            <span className="rounded-full bg-slate-100 px-3 py-1">
                              {t('Banked:', 'Banco:')} {formatMinutes(row.bankHoursAccruedMinutes)}
                            </span>
                            <span className="rounded-full bg-slate-100 px-3 py-1">
                              {t('Cost:', 'Custo:')} {formatCurrency(row.totalCost)}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default Reports
