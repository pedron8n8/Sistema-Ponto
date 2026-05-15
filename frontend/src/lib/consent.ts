export type ConsentCategory = 'necessary' | 'analytics' | 'marketing'

export type ConsentState = {
  necessary: true
  analytics: boolean
  marketing: boolean
  version: number
  decidedAt: string | null
}

const STORAGE_KEY = 'omnipunt.consent.v1'
const CURRENT_VERSION = 1

export const CONSENT_EVENT = 'omnipunt:consent-change'

const defaultState: ConsentState = {
  necessary: true,
  analytics: false,
  marketing: false,
  version: CURRENT_VERSION,
  decidedAt: null,
}

const isBrowser = typeof window !== 'undefined'

export const getConsent = (): ConsentState => {
  if (!isBrowser) return defaultState
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState
    const parsed = JSON.parse(raw) as Partial<ConsentState>
    if (parsed.version !== CURRENT_VERSION) return defaultState
    return {
      necessary: true,
      analytics: Boolean(parsed.analytics),
      marketing: Boolean(parsed.marketing),
      version: CURRENT_VERSION,
      decidedAt: typeof parsed.decidedAt === 'string' ? parsed.decidedAt : null,
    }
  } catch {
    return defaultState
  }
}

export const hasDecided = (): boolean => {
  const state = getConsent()
  return state.decidedAt !== null
}

const persist = (state: ConsentState) => {
  if (!isBrowser) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent<ConsentState>(CONSENT_EVENT, { detail: state }))
}

export const setConsent = (input: { analytics: boolean; marketing: boolean }): ConsentState => {
  const next: ConsentState = {
    necessary: true,
    analytics: Boolean(input.analytics),
    marketing: Boolean(input.marketing),
    version: CURRENT_VERSION,
    decidedAt: new Date().toISOString(),
  }
  persist(next)
  return next
}

export const acceptAll = (): ConsentState =>
  setConsent({ analytics: true, marketing: true })

export const rejectAll = (): ConsentState =>
  setConsent({ analytics: false, marketing: false })

export const resetConsent = () => {
  if (!isBrowser) return
  window.localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent<ConsentState>(CONSENT_EVENT, { detail: defaultState }))
}

export const subscribeConsent = (handler: (state: ConsentState) => void): (() => void) => {
  if (!isBrowser) return () => {}
  const listener = (event: Event) => {
    const custom = event as CustomEvent<ConsentState>
    handler(custom.detail ?? getConsent())
  }
  window.addEventListener(CONSENT_EVENT, listener)
  return () => window.removeEventListener(CONSENT_EVENT, listener)
}
