import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PageMeta from '../components/PageMeta'
import PublicLayout from '../components/public/PublicLayout'
import { getConsent, resetConsent, setConsent, type ConsentState } from '../lib/consent'

type DataRow = {
  category: string
  fields: string
  purpose: string
  legalBasis: string
  retention: string
}

const dataInventoryKeys = [
  'account',
  'authentication',
  'biometric',
  'photo',
  'timeEntries',
  'geolocation',
  'ipDevice',
  'approvalLogs',
  'bankHours',
  'vacation',
  'slack',
  'billing',
  'preferences',
] as const

const cookieRows = ['necessary', 'analytics', 'marketing'] as const

const ConsentPolicyPage = () => {
  const { t } = useTranslation()
  const contactEmail = t('footer.contactValue')
  const [consent, setConsentState] = useState<ConsentState>(() => getConsent())

  useEffect(() => {
    setConsentState(getConsent())
  }, [])

  const toggle = (key: 'analytics' | 'marketing') => {
    const next = { analytics: consent.analytics, marketing: consent.marketing, [key]: !consent[key] }
    const updated = setConsent(next)
    setConsentState(updated)
  }

  const handleReset = () => {
    resetConsent()
    setConsentState(getConsent())
  }

  const rows: DataRow[] = dataInventoryKeys.map((k) => ({
    category: t(`consent.inventory.${k}.category`),
    fields: t(`consent.inventory.${k}.fields`),
    purpose: t(`consent.inventory.${k}.purpose`),
    legalBasis: t(`consent.inventory.${k}.legalBasis`),
    retention: t(`consent.inventory.${k}.retention`),
  }))

  return (
    <PublicLayout>
      <PageMeta titleKey="seo.consent.title" descriptionKey="seo.consent.description" />

      <article className="mx-auto w-full max-w-5xl rounded-[2rem] border border-white/80 bg-white/85 p-8 shadow-[0_26px_45px_-34px_rgba(15,23,42,0.65)] backdrop-blur sm:p-11">
        <p className="text-xs font-semibold uppercase tracking-[0.26em] text-teal-700">{t('consent.eyebrow')}</p>
        <h1 className="mt-4 text-3xl font-semibold text-slate-900 sm:text-4xl">{t('consent.title')}</h1>
        <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">{t('consent.updated')}</p>
        <p className="mt-6 text-sm leading-relaxed text-slate-700 sm:text-base">{t('consent.intro')}</p>

        <section className="mt-8 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-5">
          <h2 className="text-lg font-semibold text-slate-900">{t('consent.controllerTitle')}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            {t('consent.controllerBody', { email: contactEmail })}
          </p>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-5">
          <h2 className="text-lg font-semibold text-slate-900">{t('consent.legalBasisTitle')}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">{t('consent.legalBasisBody')}</p>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200/80 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">{t('consent.inventoryTitle')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{t('consent.inventoryIntro')}</p>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <th scope="col" className="py-2 pr-3">{t('consent.table.category')}</th>
                  <th scope="col" className="py-2 pr-3">{t('consent.table.fields')}</th>
                  <th scope="col" className="py-2 pr-3">{t('consent.table.purpose')}</th>
                  <th scope="col" className="py-2 pr-3">{t('consent.table.legalBasis')}</th>
                  <th scope="col" className="py-2 pr-3">{t('consent.table.retention')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((row, idx) => (
                  <tr key={idx} className="align-top text-slate-700">
                    <td className="py-3 pr-3 font-medium text-slate-900">{row.category}</td>
                    <td className="py-3 pr-3">{row.fields}</td>
                    <td className="py-3 pr-3">{row.purpose}</td>
                    <td className="py-3 pr-3">{row.legalBasis}</td>
                    <td className="py-3 pr-3">{row.retention}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-5">
          <h2 className="text-lg font-semibold text-slate-900">{t('consent.ipTitle')}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">{t('consent.ipBody')}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>{t('consent.ipBullet1')}</li>
            <li>{t('consent.ipBullet2')}</li>
            <li>{t('consent.ipBullet3')}</li>
          </ul>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-5">
          <h2 className="text-lg font-semibold text-slate-900">{t('consent.biometricTitle')}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">{t('consent.biometricBody')}</p>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-5">
          <h2 className="text-lg font-semibold text-slate-900">{t('consent.retentionTitle')}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">{t('consent.retentionBody')}</p>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-5">
          <h2 className="text-lg font-semibold text-slate-900">{t('consent.processorsTitle')}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">{t('consent.processorsBody')}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>{t('consent.processor.supabase')}</li>
            <li>{t('consent.processor.stripe')}</li>
            <li>{t('consent.processor.slack')}</li>
            <li>{t('consent.processor.googleFonts')}</li>
            <li>{t('consent.processor.analytics')}</li>
          </ul>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200/80 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">{t('consent.cookiesTitle')}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">{t('consent.cookiesBody')}</p>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <th scope="col" className="py-2 pr-3">{t('consent.cookieTable.category')}</th>
                  <th scope="col" className="py-2 pr-3">{t('consent.cookieTable.purpose')}</th>
                  <th scope="col" className="py-2 pr-3">{t('consent.cookieTable.examples')}</th>
                  <th scope="col" className="py-2 pr-3">{t('consent.cookieTable.retention')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {cookieRows.map((c) => (
                  <tr key={c} className="align-top text-slate-700">
                    <td className="py-3 pr-3 font-medium text-slate-900">{t(`consent.cookies.${c}.name`)}</td>
                    <td className="py-3 pr-3">{t(`consent.cookies.${c}.purpose`)}</td>
                    <td className="py-3 pr-3">{t(`consent.cookies.${c}.examples`)}</td>
                    <td className="py-3 pr-3">{t(`consent.cookies.${c}.retention`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-teal-200 bg-teal-50/60 p-5">
          <h2 className="text-lg font-semibold text-slate-900">{t('consent.managePreferencesTitle')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{t('consent.managePreferencesBody')}</p>

          <div className="mt-4 space-y-3">
            <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{t('cookies.cat.necessary.name')}</p>
                <p className="mt-1 text-xs text-slate-600">{t('cookies.cat.necessary.desc')}</p>
              </div>
              <span className="rounded-full bg-slate-200 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-700">
                {t('cookies.alwaysOn')}
              </span>
            </div>

            <label className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-3">
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
                checked={consent.analytics}
                onChange={() => toggle('analytics')}
                className="mt-1 h-4 w-4 cursor-pointer accent-teal-600"
              />
            </label>

            <label className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-3">
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
                checked={consent.marketing}
                onChange={() => toggle('marketing')}
                className="mt-1 h-4 w-4 cursor-pointer accent-teal-600"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <p className="text-xs text-slate-500">
                {consent.decidedAt
                  ? t('consent.decidedAt', { date: new Date(consent.decidedAt).toLocaleString() })
                  : t('consent.notDecidedYet')}
              </p>
              <button
                type="button"
                onClick={handleReset}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-400"
              >
                {t('consent.resetButton')}
              </button>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-5">
          <h2 className="text-lg font-semibold text-slate-900">{t('consent.rightsTitle')}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            {t('consent.rightsBody', { email: contactEmail })}
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>{t('consent.rights.access')}</li>
            <li>{t('consent.rights.correction')}</li>
            <li>{t('consent.rights.deletion')}</li>
            <li>{t('consent.rights.portability')}</li>
            <li>{t('consent.rights.objection')}</li>
            <li>{t('consent.rights.withdraw')}</li>
          </ul>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-5">
          <h2 className="text-lg font-semibold text-slate-900">{t('consent.contactTitle')}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            {t('consent.contactBody', { email: contactEmail })}
          </p>
        </section>
      </article>
    </PublicLayout>
  )
}

export default ConsentPolicyPage
