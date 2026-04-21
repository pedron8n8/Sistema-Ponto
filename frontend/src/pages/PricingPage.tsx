import { useTranslation } from 'react-i18next'
import PageMeta from '../components/PageMeta'
import PublicLayout from '../components/public/PublicLayout'
import { getMarketingPlans } from '../lib/marketingPlans'

const PricingPage = () => {
  const { t } = useTranslation()
  const plans = getMarketingPlans(t)

  return (
    <PublicLayout>
      <PageMeta titleKey="seo.pricing.title" descriptionKey="seo.pricing.description" />

      <section className="mx-auto w-full max-w-7xl">
        <div className="rounded-[2rem] border border-white/80 bg-white/80 p-8 shadow-[0_24px_40px_-35px_rgba(15,23,42,0.6)] backdrop-blur sm:p-11">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-cyan-700">{t('pricing.eyebrow')}</p>
          <h1 className="mt-4 text-4xl font-semibold text-slate-900 sm:text-5xl">{t('pricing.title')}</h1>
          <p className="mt-4 max-w-3xl text-sm text-slate-600 sm:text-base">{t('pricing.subtitle')}</p>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => {
            const canCheckout = Boolean(plan.checkoutLink)

            return (
              <article
                key={plan.id}
                className={`rounded-3xl border p-6 shadow-[0_18px_35px_-30px_rgba(15,23,42,0.7)] ${
                  plan.highlight
                    ? 'border-teal-500 bg-gradient-to-b from-teal-50 via-white to-white'
                    : 'border-slate-200 bg-white'
                }`}
              >
                {plan.highlight ? (
                  <span className="inline-flex rounded-full bg-teal-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white">
                    {t('common.mostPopular')}
                  </span>
                ) : null}

                <h2 className="mt-4 text-2xl font-semibold text-slate-900">{plan.name}</h2>
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">{plan.seats}</p>

                <div className="mt-5 flex items-end gap-2">
                  <span className="text-4xl font-semibold text-slate-900">{plan.price}</span>
                  <span className="text-sm text-slate-500">{t('pricing.period')}</span>
                </div>

                <p className="mt-3 text-sm text-slate-600">{plan.description}</p>

                <ul className="mt-6 space-y-2">
                  {plan.features.map((feature) => (
                    <li key={`${plan.id}-${feature}`} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-teal-600" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <a
                  href={plan.checkoutLink || '#'}
                  target={canCheckout ? '_blank' : undefined}
                  rel={canCheckout ? 'noreferrer' : undefined}
                  aria-disabled={!canCheckout}
                  className={`mt-7 inline-flex w-full items-center justify-center rounded-full px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                    canCheckout
                      ? 'bg-slate-900 text-white hover:bg-slate-700'
                      : 'cursor-not-allowed bg-slate-200 text-slate-500'
                  }`}
                >
                  {canCheckout ? t('pricing.cta') : t('pricing.missingCheckout')}
                </a>
              </article>
            )
          })}
        </div>
      </section>
    </PublicLayout>
  )
}

export default PricingPage
