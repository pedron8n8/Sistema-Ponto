export const TIME_ZONE_OPTIONS = [
  { value: 'America/New_York', label: 'EST/EDT (New York)' },
  { value: 'America/Sao_Paulo', label: 'BRT (Sao Paulo)' },
  { value: 'Europe/Lisbon', label: 'Portugal (Lisbon)' },
  { value: 'Africa/Cairo', label: 'Egypt (Cairo)' },
  { value: 'UTC', label: 'UTC' },
] as const

export const DEFAULT_VIEW_TIME_ZONE = 'America/New_York'

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
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(locale, { timeZone, ...(options || {}) }).format(date)
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
