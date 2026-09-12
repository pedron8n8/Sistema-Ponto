export const TIME_ZONE_OPTIONS = [
  { value: 'America/Chicago', label: 'CST/CDT (Chicago)' },
  { value: 'America/New_York', label: 'EST/EDT (New York)' },
  { value: 'America/Sao_Paulo', label: 'BRT (Sao Paulo)' },
  { value: 'Europe/Lisbon', label: 'Portugal (Lisbon)' },
  { value: 'Africa/Cairo', label: 'Egypt (Cairo)' },
  { value: 'UTC', label: 'UTC' },
] as const

export const DEFAULT_VIEW_TIME_ZONE = 'America/Chicago'
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/

export const isValidTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

export const formatDateWithTimeZone = (
  value: string | Date,
  timeZone: string,
  locale = 'pt-BR',
  options?: Intl.DateTimeFormatOptions
) => {
  const isDateOnly = typeof value === 'string' && DATE_ONLY_REGEX.test(value)
  const date = value instanceof Date
    ? value
    : new Date(isDateOnly ? `${value}T00:00:00.000Z` : value)

  return new Intl.DateTimeFormat(locale, {
    timeZone: isDateOnly ? 'UTC' : timeZone,
    ...(options || {}),
  }).format(date)
}

export const formatTimeWithTimeZone = (
  value: string | Date,
  timeZone: string,
  locale = 'pt-BR',
  options?: Intl.DateTimeFormatOptions
) => {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(options || {}),
  }).format(date)
}

export const getDateKeyWithTimeZone = (value: string | Date, timeZone: string) => {
  const date = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export const formatDateTimeWithTimeZone = (
  value: string | Date,
  timeZone: string,
  locale = 'pt-BR',
  options?: Intl.DateTimeFormatOptions
) => {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
    ...(options || {}),
  }).format(date)
}

/**
 * Deslocamento do fuso, em ms, no instante dado. Formata o instante no fuso
 * alvo e reinterpreta o resultado como UTC: a diferenca e o offset, ja com
 * horario de verao aplicado.
 */
const getTimeZoneOffsetMs = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    // Em alguns ambientes meia-noite sai como '24' em vez de '00'.
    Number(values.hour) % 24,
    Number(values.minute),
    Number(values.second)
  )
  // O formatador nao devolve milissegundos e todo offset e multiplo de minuto,
  // entao a fracao de segundo do instante original volta aqui. Sem isso o
  // offset erra por ate 999ms e 23:59:59.999 vaza para o dia seguinte.
  return asUtc + date.getUTCMilliseconds() - date.getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Converte uma hora de parede ('YYYY-MM-DD' mais um deslocamento dentro do dia)
 * no fuso informado para o instante UTC correspondente. Duas passadas: a
 * primeira aproxima o offset, a segunda corrige a borda de horario de verao.
 */
export const zonedWallTimeToUtc = (dateKey: string, timeOfDayMs: number, timeZone: string) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date(NaN)
  }

  const naiveUtc = Date.UTC(year, month - 1, day) + timeOfDayMs
  let instant = naiveUtc - getTimeZoneOffsetMs(new Date(naiveUtc), timeZone)
  instant = naiveUtc - getTimeZoneOffsetMs(new Date(instant), timeZone)
  return new Date(instant)
}

/** Instante UTC em que o dia comeca no fuso de visualizacao. */
export const startOfZonedDayUtc = (dateKey: string, timeZone: string) =>
  zonedWallTimeToUtc(dateKey, 0, timeZone)

/** Instante UTC do ultimo milissegundo do dia no fuso de visualizacao. */
export const endOfZonedDayUtc = (dateKey: string, timeZone: string) =>
  zonedWallTimeToUtc(dateKey, DAY_MS - 1, timeZone)

/**
 * Soma dias a uma chave 'YYYY-MM-DD' sem passar pelo fuso local do browser:
 * a aritmetica acontece em UTC puro, entao a chave devolvida e sempre a do
 * calendario, nunca a de um fuso intermediario.
 */
export const addDaysToDateKey = (dateKey: string, days: number) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  const shiftedYear = shifted.getUTCFullYear()
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0')
  return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`
}
