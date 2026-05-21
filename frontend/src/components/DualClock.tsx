import { useEffect, useMemo, useState } from 'react'

const CST_TIME_ZONE = 'America/Chicago'

const getBrowserTimeZone = (): string => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz || CST_TIME_ZONE
  } catch {
    return CST_TIME_ZONE
  }
}

const formatTime = (date: Date, timeZone: string, withSeconds = false): string => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
      hour12: false,
    }).format(date)
  } catch {
    return date.toISOString().slice(11, withSeconds ? 19 : 16)
  }
}

const getZoneShortLabel = (date: Date, timeZone: string): string => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(date)
    const name = parts.find((p) => p.type === 'timeZoneName')?.value
    if (name) return name
  } catch {
    /* noop */
  }
  return timeZone.split('/').pop() || timeZone
}

type DualClockProps = {
  variant?: 'mini' | 'card'
  className?: string
  showSeconds?: boolean
}

const DualClock = ({ variant = 'mini', className = '', showSeconds = false }: DualClockProps) => {
  const localTimeZone = useMemo(getBrowserTimeZone, [])
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const localTime = formatTime(now, localTimeZone, showSeconds)
  const cstTime = formatTime(now, CST_TIME_ZONE, showSeconds)
  const localLabel = getZoneShortLabel(now, localTimeZone)
  const isAlreadyCst = localTimeZone === CST_TIME_ZONE

  if (variant === 'card') {
    return (
      <div
        className={`rounded-2xl border border-white/80 bg-white/85 px-5 py-4 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.55)] backdrop-blur ${className}`}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Local time
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums text-slate-900">{localTime}</span>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{localLabel}</span>
        </div>
        {!isAlreadyCst ? (
          <div className="mt-2 flex items-baseline gap-2 text-slate-600">
            <span className="text-base tabular-nums">{cstTime}</span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">CST (Chicago)</span>
          </div>
        ) : (
          <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">System default</p>
        )}
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col items-end leading-tight text-slate-700 ${className}`}
      title={`Local time (${localTimeZone}) + CST reference`}
    >
      <span className="text-xs font-semibold tabular-nums">
        {localTime}
        <span className="ml-1 text-[10px] font-medium uppercase text-slate-500">{localLabel}</span>
      </span>
      {!isAlreadyCst ? (
        <span className="text-[10px] tabular-nums text-slate-500">
          {cstTime}
          <span className="ml-1 uppercase">CST</span>
        </span>
      ) : null}
    </div>
  )
}

export default DualClock
