import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from '../LanguageSwitcher'
import BrandWordmark from '../BrandWordmark'
import { useAuth } from '../../context/AuthContext'

type PublicLayoutProps = {
  children: React.ReactNode
}

const PublicLayout = ({ children }: PublicLayoutProps) => {
  const { t: i18nT, i18n } = useTranslation()
  const { session, profile } = useAuth()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (key: string) => i18nT(key)
  const label = (en: string, pt: string) => i18nT(isPt ? pt : en)

  const hasActivePlan = profile?.role === 'SUPERADMIN' || profile?.currentPlanStatus === 'ACTIVE'
  const accountPath = hasActivePlan ? '/app' : '/app/escolher-plano'
  const accountName = profile?.name?.split(' ')[0] || label('Account', 'Conta')

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_12%_10%,rgba(13,148,136,0.1),transparent_38%),radial-gradient(circle_at_90%_0%,rgba(56,189,248,0.1),transparent_32%),linear-gradient(180deg,#f8fafc_0%,#f1f5f9_58%,#ecfeff_100%)] text-slate-900">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/70 bg-white/85 backdrop-blur-lg">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Link to="/" className="group flex items-center gap-3">
            <span className="h-9 w-9 rounded-2xl bg-gradient-to-br from-teal-500 to-sky-500 shadow-[0_8px_16px_-6px_rgba(14,116,144,0.4)]" />
            <div className="leading-tight">
              <BrandWordmark className="text-xl" />
            </div>
          </Link>

          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            <a href="/#features" className="transition hover:text-slate-900">
              {t('publicNav.features')}
            </a>
            <Link to="/pricing" className="transition hover:text-slate-900">
              {t('publicNav.pricing')}
            </Link>
            {session ? (
              <Link to={accountPath} className="transition hover:text-slate-900">
                {label('My account', 'Minha conta')}
              </Link>
            ) : (
              <Link to="/login" className="transition hover:text-slate-900">
                {t('publicNav.login')}
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            {session ? (
              <Link
                to={accountPath}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-800 transition hover:border-slate-400"
              >
                {label('Account', 'Conta')}: {accountName}
              </Link>
            ) : (
              <Link
                to="/login"
                className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-slate-700"
              >
                {t('publicNav.login')}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="px-5 pb-12 pt-28 sm:px-8">{children}</main>

      <footer className="border-t border-slate-200/70 bg-white/75 px-5 py-10 sm:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
          <div>
            <BrandWordmark className="text-base" />
            <p className="mt-1 text-xs text-slate-500">{t('footer.copyright')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            <Link to="/privacy" className="transition hover:text-slate-900">
              {t('footer.privacy')}
            </Link>
            <Link to="/terms" className="transition hover:text-slate-900">
              {t('footer.terms')}
            </Link>
            <Link to="/pricing" className="transition hover:text-slate-900">
              {t('footer.pricing')}
            </Link>
            <a href={`mailto:${t('footer.contactValue')}`} className="transition hover:text-slate-900">
              {t('footer.contact')}
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default PublicLayout
