import { CONSENT_EVENT, getConsent, type ConsentState } from './consent'

const SCRIPT_ID = 'omnipunt-analytics-loader'
const INLINE_ID = 'omnipunt-analytics-inline'

const measurementId = (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined)?.trim()

const isBrowser = typeof window !== 'undefined'

const removeNode = (id: string) => {
  if (!isBrowser) return
  const node = document.getElementById(id)
  if (node?.parentNode) node.parentNode.removeChild(node)
}

const injectGoogleAnalytics = (id: string) => {
  if (!isBrowser) return
  if (document.getElementById(SCRIPT_ID)) return

  const script = document.createElement('script')
  script.id = SCRIPT_ID
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
  document.head.appendChild(script)

  const inline = document.createElement('script')
  inline.id = INLINE_ID
  inline.text = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', '${id}', { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
  `
  document.head.appendChild(inline)
}

const disableAnalytics = () => {
  if (!isBrowser) return
  removeNode(SCRIPT_ID)
  removeNode(INLINE_ID)
  const w = window as unknown as Record<string, unknown>
  delete w.gtag
  delete w.dataLayer
  if (measurementId) {
    ;(window as unknown as Record<string, boolean>)[`ga-disable-${measurementId}`] = true
  }
}

const applyConsent = (state: ConsentState) => {
  if (!isBrowser) return
  if (state.analytics && measurementId) {
    injectGoogleAnalytics(measurementId)
  } else {
    disableAnalytics()
  }
}

let initialized = false

export const initAnalyticsGate = () => {
  if (!isBrowser || initialized) return
  initialized = true
  applyConsent(getConsent())
  window.addEventListener(CONSENT_EVENT, (event) => {
    const detail = (event as CustomEvent<ConsentState>).detail ?? getConsent()
    applyConsent(detail)
  })
}
