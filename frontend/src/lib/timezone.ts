export const TIME_ZONE_OPTIONS = [
  { value: 'America/New_York', label: 'EST/EDT (New York)' },
  { value: 'America/Sao_Paulo', label: 'BRT (Sao Paulo)' },
  { value: 'Europe/Lisbon', label: 'Portugal (Lisbon)' },
  { value: 'Africa/Cairo', label: 'Egypt (Cairo)' },
  { value: 'UTC', label: 'UTC' },
] as const

export const DEFAULT_VIEW_TIME_ZONE = 'America/New_York'
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
