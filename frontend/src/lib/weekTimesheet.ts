import { addDaysToDateKey, getDateKeyWithTimeZone } from './timezone'

export type TimesheetDuration = {
  totalMinutes: number
  formatted: string
}

export type TimesheetEntry = {
  id: string
  clockIn: string
  clockOut?: string | null
  breakMinutes?: number | null
  breakStartedAt?: string | null
  duration?: TimesheetDuration | null
}

export type TimesheetEntryRow = {
  entry: TimesheetEntry
  minutes: number
  durationLabel: string
  // Registro em aberto no dia corrente: o tempo dele cresce a cada tick.
  isLive: boolean
}

export type TimesheetDay = {
  dateKey: string
  entries: TimesheetEntryRow[]
  totalMinutes: number
  totalLabel: string
  hasLiveEntry: boolean
}

/**
 * Um registro em aberto so acumula tempo ao vivo dentro dessa janela. Nao ha
 * fechamento automatico no backend, entao um ponto esquecido ficaria crescendo
 * para sempre e inflaria o dia no relatorio. A janela e maior que um dia para
 * nao matar turno que atravessa a meia-noite.
 */
export const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000

const toMs = (value?: string | Date | null) => {
  if (!value) return null
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

const toWholeMinutes = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

/**
 * Pausa total do registro: a coluna crua (breakMinutes) mais a pausa em
 * andamento a partir de breakStartedAt. Mesma convencao do backend
 * (resolveBreakMinutes em time.controller.js) e do ColaboradorDashboard.
 */
export const resolveBreakMinutes = (entry: TimesheetEntry, nowMs: number) => {
  const startedAt = toMs(entry.breakStartedAt)
  const ongoing = startedAt === null ? 0 : Math.max(0, Math.floor((nowMs - startedAt) / 60000))
  return toWholeMinutes(entry.breakMinutes) + ongoing
}

const resolveClosedMinutes = (entry: TimesheetEntry) => {
  const totalMinutes = Number(entry.duration?.totalMinutes)
  if (Number.isFinite(totalMinutes)) return Math.max(0, Math.floor(totalMinutes))

  const start = toMs(entry.clockIn)
  const end = toMs(entry.clockOut)
  if (start === null || end === null) return 0

  const gross = Math.max(0, Math.floor((end - start) / 60000))
  return Math.max(0, gross - toWholeMinutes(entry.breakMinutes))
}

/** Tempo decorrido de um registro ainda em aberto, ja sem as pausas. */
export const resolveLiveMinutes = (entry: TimesheetEntry, nowMs: number) => {
  const start = toMs(entry.clockIn)
  if (start === null) return 0
  const elapsed = Math.max(0, Math.floor((nowMs - start) / 60000))
  return Math.max(0, elapsed - resolveBreakMinutes(entry, nowMs))
}

/** Registro em aberto que ainda representa uma jornada em andamento. */
export const isLiveEntry = (entry: TimesheetEntry, nowMs: number) => {
  if (entry.clockOut) return false
  const start = toMs(entry.clockIn)
  return start !== null && nowMs - start <= LIVE_WINDOW_MS
}

/**
 * Minutos de um registro. Em aberto so acumula com allowLive: um ponto
 * esquecido fora da janela ao vivo nao pode crescer indefinidamente.
 */
export const resolveEntryMinutes = (
  entry: TimesheetEntry,
  nowMs: number,
  options: { allowLive?: boolean } = {}
) => {
  if (entry.clockOut) return resolveClosedMinutes(entry)
  return options.allowLive ? resolveLiveMinutes(entry, nowMs) : 0
}

export const formatClockMinutes = (minutes: number) => {
  const safe = Math.max(0, Math.floor(minutes))
  const hours = Math.floor(safe / 60)
  const mins = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

export const formatDurationLabel = (minutes: number) => {
  const safe = Math.max(0, Math.floor(minutes))
  return `${Math.floor(safe / 60)}h ${safe % 60}m`
}

export const buildWeekDays = ({
  dateKeys,
  entries,
  timeZone,
  nowMs,
}: {
  dateKeys: string[]
  entries: TimesheetEntry[]
  timeZone: string
  nowMs: number
}): TimesheetDay[] => {
  return dateKeys.map((dateKey) => {
    const dayEntries = entries.filter(
      (entry) => toMs(entry.clockIn) !== null && getDateKeyWithTimeZone(entry.clockIn, timeZone) === dateKey
    )

    const rows: TimesheetEntryRow[] = dayEntries.map((entry) => {
      const isLive = isLiveEntry(entry, nowMs)
      const minutes = resolveEntryMinutes(entry, nowMs, { allowLive: isLive })
      // Uma formatacao so na coluna. O 'formatted' do backend inclui segundos
      // ("8h 12m 30s") e ficava lado a lado com o "3h 15m" do registro ao vivo,
      // na mesma coluna do mesmo dia.
      const durationLabel = entry.clockOut || isLive ? formatDurationLabel(minutes) : ''

      return { entry, minutes, durationLabel, isLive }
    })

    const totalMinutes = rows.reduce((acc, row) => acc + row.minutes, 0)

    return {
      dateKey,
      entries: rows,
      totalMinutes,
      totalLabel: formatClockMinutes(totalMinutes),
      hasLiveEntry: rows.some((row) => row.isLive),
    }
  })
}

/**
 * Segunda-feira da semana que contem a chave informada. A aritmetica acontece
 * em UTC puro a partir de 'YYYY-MM-DD', entao a semana e a do calendario que o
 * usuario esta vendo, nunca a do fuso da maquina dele.
 */
export const startOfWeekKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(utc.getTime())) return dateKey
  const weekday = utc.getUTCDay()
  return addDaysToDateKey(dateKey, weekday === 0 ? -6 : 1 - weekday)
}
