import { useTranslation } from 'react-i18next'
import BrandWordmark from './BrandWordmark'

type LoadingScreenProps = {
  label?: string
  hint?: string
}

const LoadingScreen = ({ label, hint }: LoadingScreenProps) => {
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const resolvedLabel = label ?? t('Loading information', 'Carregando informacoes')
  const resolvedHint = hint ?? t('Please wait a moment.', 'Aguarde um instante.')

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-white/70 px-6 py-10 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-full max-w-md rounded-3xl border border-white/90 bg-white/90 p-8 text-center shadow-[0_20px_45px_-30px_rgba(15,23,42,0.6)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-sky-500 shadow-[0_10px_20px_-10px_rgba(14,116,144,0.55)]">
          <div className="h-6 w-6 rounded-full border-2 border-white/40 border-t-white animate-spin motion-reduce:animate-none" />
        </div>
        <div className="mt-5">
          <BrandWordmark className="text-lg" />
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-900">{resolvedLabel}</p>
        {resolvedHint ? <p className="mt-1 text-xs text-slate-500">{resolvedHint}</p> : null}
      </div>
    </div>
  )
}

export default LoadingScreen
