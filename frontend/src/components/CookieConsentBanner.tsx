import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { acceptAll, getConsent, hasDecided, rejectAll, setConsent } from '../lib/consent'

const CookieConsentBanner = () => {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)

  useEffect(() => {
    if (!hasDecided()) {
      const current = getConsent()
      setAnalytics(current.analytics)
      setMarketing(current.marketing)
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  const handleAcceptAll = () => {
    acceptAll()
    setVisible(false)
  }

  const handleRejectAll = () => {
    rejectAll()
    setVisible(false)
  }

  const handleSavePreferences = () => {
    setConsent({ analytics, marketing })
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t('cookies.title')}
      className="fixed inset-x-0 bottom-0 z-[100] px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-[0_20px_50px_-25px_rgba(15,23,42,0.45)] backdrop-blur sm:p-6">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700">
              {t('cookies.eyebrow')}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">
              {t('cookies.title')}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              {t('cookies.intro')}{' '}
              <Link to="/consent" className="font-medium text-teal-700 underline hover:text-teal-900">
                {t('cookies.readPolicy')}
              </Link>
              .
            </p>
          </div>

          {showDetails && (
            <div className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{t('cookies.cat.necessary.name')}</p>
                  <p className="mt-1 text-xs text-slate-600">{t('cookies.cat.necessary.desc')}</p>
                </div>
                <span className="rounded-full bg-slate-200 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-700">
                  {t('cookies.alwaysOn')}
                </span>
              </div>

              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-semibold text-slate-900">
                    {t('cookies.cat.analytics.name')}
                  </span>
                  <span className="mt-1 block text-xs text-slate-600">
                    {t('cookies.cat.analytics.desc')}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                  className="mt-1 h-4 w-4 cursor-pointer accent-teal-600"
                />
              </label>

              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-semibold text-slate-900">
                    {t('cookies.cat.marketing.name')}
                  </span>
                  <span className="mt-1 block text-xs text-slate-600">
                    {t('cookies.cat.marketing.desc')}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                  className="mt-1 h-4 w-4 cursor-pointer accent-teal-600"
                />
              </label>
            </div>
          )}

          <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-400"
            >
              {showDetails ? t('cookies.hidePreferences') : t('cookies.preferences')}
            </button>
            <button
              type="button"
              onClick={handleRejectAll}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-400"
            >
              {t('cookies.rejectAll')}
            </button>
            {showDetails && (
              <button
                type="button"
                onClick={handleSavePreferences}
                className="rounded-full border border-teal-600 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-teal-700 transition hover:bg-teal-50"
              >
                {t('cookies.savePreferences')}
              </button>
            )}
            <button
              type="button"
              onClick={handleAcceptAll}
              className="rounded-full bg-teal-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-teal-700"
            >
              {t('cookies.acceptAll')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CookieConsentBanner
