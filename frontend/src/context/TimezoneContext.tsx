import { createContext, useContext, useMemo, useState } from 'react'
import { DEFAULT_VIEW_TIME_ZONE, isValidTimeZone } from '../lib/timezone'

type TimezoneState = {
  viewTimeZone: string
  setViewTimeZone: (value: string) => void
}

const STORAGE_KEY = 'systemaPonto.viewTimeZone'

const getInitialTimeZone = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw && isValidTimeZone(raw)) {
      return raw
    }
  } catch {
    return DEFAULT_VIEW_TIME_ZONE
  }

  return DEFAULT_VIEW_TIME_ZONE
}

const TimezoneContext = createContext<TimezoneState | undefined>(undefined)

export const TimezoneProvider = ({ children }: { children: React.ReactNode }) => {
  const [viewTimeZone, setViewTimeZoneState] = useState<string>(() => getInitialTimeZone())

  const setViewTimeZone = (value: string) => {
    if (!isValidTimeZone(value)) return

    setViewTimeZoneState(value)
    try {
      window.localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // noop
    }
  }

  const value = useMemo(() => ({ viewTimeZone, setViewTimeZone }), [viewTimeZone])

  return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>
}

export const useTimeZone = () => {
  const ctx = useContext(TimezoneContext)
  if (!ctx) {
    throw new Error('useTimeZone must be used inside TimezoneProvider')
  }
  return ctx
}
