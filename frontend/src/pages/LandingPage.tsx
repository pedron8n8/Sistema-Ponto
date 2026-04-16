import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import PageMeta from '../components/PageMeta'
import PublicLayout from '../components/public/PublicLayout'
import { getMarketingPlans } from '../lib/marketingPlans'

const iconClassName = 'h-5 w-5'

const featureIcons = [
  (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={iconClassName}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7V12L15 14" />
    </svg>
  ),
  (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={iconClassName}>
      <path d="M12 4.2L18.8 7.1V12.2C18.8 15.8 16.4 19 12 20.1C7.6 19 5.2 15.8 5.2 12.2V7.1L12 4.2Z" />
      <path d="M9.5 12.1L11.2 13.8L14.8 10.2" />
    </svg>
  ),
  (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={iconClassName}>
      <path d="M3.8 10.4L12 5.2L20.2 10.4V18.8H3.8V10.4Z" />
      <path d="M8.4 14.2H15.6" />
      <path d="M8.4 16.8H13.4" />
    </svg>
  ),
  (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={iconClassName}>
      <circle cx="8" cy="8.6" r="2.1" />
      <circle cx="16" cy="9.4" r="1.9" />
      <path d="M4.6 18.1C5.1 15.9 6.9 14.5 8.9 14.5C11 14.5 12.7 15.9 13.2 18.1" />
      <path d="M13.5 17.5C13.9 16.1 15 15.2 16.2 15.2C17.5 15.2 18.6 16.1 19 17.5" />
    </svg>
  ),
  (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={iconClassName}>
      <path d="M5.2 18.8H18.8" />
      <path d="M8.2 18.8C8.4 15.8 10.1 13.9 12.2 13.9C14.3 13.9 16 15.8 16.2 18.8" />
      <circle cx="12.2" cy="10.1" r="2.1" />
      <path d="M16.8 6.2L19.8 9.2" />
    </svg>
  ),
  (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={iconClassName}>
      <path d="M6 4.2H14.6L18 7.4V19.8H6V4.2Z" />
      <path d="M14.2 4.2V7.6H18" />
      <path d="M8.4 11.3H15.4" />
      <path d="M8.4 14.4H15.4" />
    </svg>
  ),
]

const LandingPage = () => {
  const { t } = useTranslation()
  const plans = getMarketingPlans(t)

  const featureItems = [
    {
      title: t('landing.features.clockTitle'),
      description: t('landing.features.clockDesc'),
    },
    {
      title: t('landing.features.faceTitle'),
      description: t('landing.features.faceDesc'),
    },
    {
      title: t('landing.features.geoTitle'),
      description: t('landing.features.geoDesc'),
    },
    {
      title: t('landing.features.approvalTitle'),
      description: t('landing.features.approvalDesc'),
    },
    {
      title: t('landing.features.vacationTitle'),
      description: t('landing.features.vacationDesc'),
    },
    {
      title: t('landing.features.reportTitle'),
      description: t('landing.features.reportDesc'),
    },
  ]

  const steps = [
    {
      title: t('landing.how.step1Title'),
      description: t('landing.how.step1Desc'),
    },
    {
      title: t('landing.how.step2Title'),
      description: t('landing.how.step2Desc'),
    },
    {
      title: t('landing.how.step3Title'),
      description: t('landing.how.step3Desc'),
    },
  ]

  const testimonials = [
    {
      quote: t('landing.testimonials.quote1'),
      author: t('landing.testimonials.author1'),
      role: t('landing.testimonials.role1'),
    },
    {
      quote: t('landing.testimonials.quote2'),
      author: t('landing.testimonials.author2'),
      role: t('landing.testimonials.role2'),
    },
    {
      quote: t('landing.testimonials.quote3'),
      author: t('landing.testimonials.author3'),
      role: t('landing.testimonials.role3'),
    },
  ]

  const proofItems = [
    {
      label: t('landing.proof.availabilityLabel'),
      value: t('landing.proof.availabilityValue'),
    },
    {
      label: t('landing.proof.latencyLabel'),
      value: t('landing.proof.latencyValue'),
    },
    {
      label: t('landing.proof.teamsLabel'),
      value: t('landing.proof.teamsValue'),
    },
  ]

  return (
    <PublicLayout>
      <PageMeta titleKey="seo.landing.title" descriptionKey="seo.landing.description" />

      <div className="mx-auto w-full max-w-7xl">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/80 bg-white/75 p-7 shadow-[0_32px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur sm:p-11">
          <div className="absolute right-[-10%] top-[-20%] h-60 w-60 rounded-full bg-cyan-300/20 blur-3xl" />
          <div className="absolute bottom-[-35%] left-[-8%] h-64 w-64 rounded-full bg-teal-300/25 blur-3xl" />

          <div className="relative grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="reveal">
              <p className="inline-flex rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-700">
                {t('landing.hero.badge')}
              </p>
              <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight text-slate-900 sm:text-5xl">
                {t('landing.hero.headline')}
              </h1>
              <p className="mt-5 max-w-2xl text-base text-slate-600 sm:text-lg">{t('landing.hero.subheadline')}</p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  to="/signup"
                  className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-slate-700"
                >
                  {t('landing.hero.primary')}
                </Link>
                <Link
                  to="/pricing"
                  className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-500"
                >
                  {t('landing.hero.secondary')}
                </Link>
              </div>
            </div>

            <div className="reveal reveal-delay-1 grid gap-3 rounded-3xl border border-white/80 bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 p-5 text-white shadow-[0_20px_40px_-30px_rgba(15,23,42,0.95)]">
              {proofItems.map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/15 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-teal-100/85">{item.label}</p>
                  <p className="mt-2 text-3xl font-semibold">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="mt-16">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-teal-700">{t('landing.features.eyebrow')}</p>
          <h2 className="mt-4 text-3xl font-semibold text-slate-900 sm:text-4xl">{t('landing.features.title')}</h2>
          <p className="mt-3 max-w-3xl text-sm text-slate-600 sm:text-base">{t('landing.features.subtitle')}</p>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {featureItems.map((feature, index) => (
              <article
                key={feature.title}
                className="reveal rounded-3xl border border-slate-200/75 bg-white/85 p-5 shadow-[0_18px_30px_-28px_rgba(15,23,42,0.7)] backdrop-blur"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="inline-flex rounded-2xl bg-teal-100 p-2 text-teal-700">{featureIcons[index]}</div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-16 rounded-[2rem] border border-white/80 bg-white/70 p-7 shadow-[0_24px_45px_-35px_rgba(15,23,42,0.65)] backdrop-blur sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-cyan-700">{t('landing.how.eyebrow')}</p>
          <h2 className="mt-4 text-3xl font-semibold text-slate-900 sm:text-4xl">{t('landing.how.title')}</h2>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <div key={step.title} className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                  {index + 1}
                </p>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{step.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-teal-700">{t('landing.testimonials.eyebrow')}</p>
          <h2 className="mt-4 text-3xl font-semibold text-slate-900 sm:text-4xl">{t('landing.testimonials.title')}</h2>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {testimonials.map((item) => (
              <blockquote key={item.author} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_32px_-28px_rgba(15,23,42,0.7)]">
                <p className="text-sm leading-relaxed text-slate-700">{item.quote}</p>
                <footer className="mt-4 border-t border-slate-100 pt-4">
                  <p className="text-sm font-semibold text-slate-900">{item.author}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{item.role}</p>
                </footer>
              </blockquote>
            ))}
          </div>
        </section>

        <section id="pricing" className="mt-16">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-cyan-700">{t('landing.pricingPreview.eyebrow')}</p>
          <h2 className="mt-4 text-3xl font-semibold text-slate-900 sm:text-4xl">{t('landing.pricingPreview.title')}</h2>
          <p className="mt-3 text-sm text-slate-600 sm:text-base">{t('landing.pricingPreview.subtitle')}</p>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {plans.map((plan) => {
              const canCheckout = Boolean(plan.checkoutLink)

              return (
                <article
                  key={plan.id}
                  className={`rounded-3xl border p-6 shadow-[0_20px_34px_-30px_rgba(15,23,42,0.8)] ${
                    plan.highlight
                      ? 'border-teal-400 bg-gradient-to-b from-teal-50 to-white'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  {plan.highlight ? (
                    <span className="inline-flex rounded-full bg-teal-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white">
                      {t('common.mostPopular')}
                    </span>
                  ) : null}
                  <h3 className="mt-4 text-xl font-semibold text-slate-900">{plan.name}</h3>
                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{plan.seats}</p>
                  <p className="mt-4 text-4xl font-semibold text-slate-900">
                    {plan.price}
                    <span className="ml-1 text-base text-slate-500">{t('pricing.period')}</span>
                  </p>
                  <p className="mt-3 text-sm text-slate-600">{plan.description}</p>

                  <ul className="mt-5 space-y-2">
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
                    className={`mt-6 inline-flex w-full justify-center rounded-full px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] transition ${
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

        <section className="mt-16 rounded-[2rem] border border-slate-900 bg-slate-900 p-8 text-white shadow-[0_26px_46px_-34px_rgba(2,6,23,0.85)] sm:p-11">
          <h2 className="text-3xl font-semibold sm:text-4xl">{t('landing.finalCta.title')}</h2>
          <p className="mt-4 max-w-3xl text-sm text-slate-200 sm:text-base">{t('landing.finalCta.subtitle')}</p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/signup"
              className="rounded-full bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-slate-900 transition hover:bg-teal-50"
            >
              {t('landing.finalCta.primary')}
            </Link>
            <Link
              to="/pricing"
              className="rounded-full border border-white/35 px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white transition hover:border-white/70"
            >
              {t('landing.finalCta.secondary')}
            </Link>
          </div>
        </section>
      </div>
    </PublicLayout>
  )
}

export default LandingPage
