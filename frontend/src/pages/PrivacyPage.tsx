import { useTranslation } from 'react-i18next'
import PageMeta from '../components/PageMeta'
import PublicLayout from '../components/public/PublicLayout'

const sections: Array<{ titleKey: string; bodyKey: string }> = [
  { titleKey: 'privacy.section1Title', bodyKey: 'privacy.section1Body' },
  { titleKey: 'privacy.section2Title', bodyKey: 'privacy.section2Body' },
  { titleKey: 'privacy.section3Title', bodyKey: 'privacy.section3Body' },
  { titleKey: 'privacy.section4Title', bodyKey: 'privacy.section4Body' },
  { titleKey: 'privacy.section5Title', bodyKey: 'privacy.section5Body' },
  { titleKey: 'privacy.section6Title', bodyKey: 'privacy.section6Body' },
  { titleKey: 'privacy.section7Title', bodyKey: 'privacy.section7Body' },
  { titleKey: 'privacy.section8Title', bodyKey: 'privacy.section8Body' },
]

const PrivacyPage = () => {
  const { t } = useTranslation()
  const contactEmail = t('footer.contactValue')

  return (
    <PublicLayout>
      <PageMeta titleKey="seo.privacy.title" descriptionKey="seo.privacy.description" />

      <article className="mx-auto w-full max-w-4xl rounded-[2rem] border border-white/80 bg-white/85 p-8 shadow-[0_26px_45px_-34px_rgba(15,23,42,0.65)] backdrop-blur sm:p-11">
        <p className="text-xs font-semibold uppercase tracking-[0.26em] text-teal-700">{t('privacy.eyebrow')}</p>
        <h1 className="mt-4 text-3xl font-semibold text-slate-900 sm:text-4xl">{t('privacy.title')}</h1>
        <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">{t('privacy.updated')}</p>
        <p className="mt-6 text-sm leading-relaxed text-slate-700 sm:text-base">{t('privacy.intro')}</p>

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

export default PrivacyPage
