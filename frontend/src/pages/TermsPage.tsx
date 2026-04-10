import { useTranslation } from 'react-i18next'
import PageMeta from '../components/PageMeta'
import PublicLayout from '../components/public/PublicLayout'

const sections: Array<{ titleKey: string; bodyKey: string }> = [
  { titleKey: 'terms.section1Title', bodyKey: 'terms.section1Body' },
  { titleKey: 'terms.section2Title', bodyKey: 'terms.section2Body' },
  { titleKey: 'terms.section3Title', bodyKey: 'terms.section3Body' },
  { titleKey: 'terms.section4Title', bodyKey: 'terms.section4Body' },
  { titleKey: 'terms.section5Title', bodyKey: 'terms.section5Body' },
  { titleKey: 'terms.section6Title', bodyKey: 'terms.section6Body' },
  { titleKey: 'terms.section7Title', bodyKey: 'terms.section7Body' },
  { titleKey: 'terms.section8Title', bodyKey: 'terms.section8Body' },
]

const TermsPage = () => {
  const { t } = useTranslation()
  const contactEmail = t('footer.contactValue')

  return (
    <PublicLayout>
      <PageMeta titleKey="seo.terms.title" descriptionKey="seo.terms.description" />

      <article className="mx-auto w-full max-w-4xl rounded-[2rem] border border-white/80 bg-white/85 p-8 shadow-[0_26px_45px_-34px_rgba(15,23,42,0.65)] backdrop-blur sm:p-11">
        <p className="text-xs font-semibold uppercase tracking-[0.26em] text-cyan-700">{t('terms.eyebrow')}</p>
        <h1 className="mt-4 text-3xl font-semibold text-slate-900 sm:text-4xl">{t('terms.title')}</h1>
        <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">{t('terms.updated')}</p>
        <p className="mt-6 text-sm leading-relaxed text-slate-700 sm:text-base">{t('terms.intro')}</p>

        <div className="mt-8 space-y-6">
          {sections.map((section) => (
            <section key={section.titleKey} className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-5">
              <h2 className="text-lg font-semibold text-slate-900">{t(section.titleKey)}</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-700 sm:text-base">
                {t(section.bodyKey, { email: contactEmail })}
              </p>
            </section>
          ))}
        </div>
      </article>
    </PublicLayout>
  )
}

export default TermsPage
