import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const NotFound = () => {
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-3xl font-semibold text-slate-900">{t('Page not found', 'Pagina nao encontrada')}</h2>
      <p className="text-sm text-slate-600">{t('Return to the main dashboard.', 'Volte para o painel principal.')}</p>
      <Link
        to="/app"
        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600"
      >
        {t('Go to dashboard', 'Ir para dashboard')}
      </Link>
    </div>
  )
}

export default NotFound
