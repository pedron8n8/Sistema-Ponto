import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type LanguageSwitcherProps = {
  fixed?: boolean
}

const normalizeLanguage = (rawLanguage?: string) => {
  return rawLanguage?.toLowerCase().startsWith('pt') ? 'pt' : 'en'
}

const LanguageSwitcher = ({ fixed = false }: LanguageSwitcherProps) => {
  const { i18n, t } = useTranslation()
  const activeLanguage = useMemo(
    () => normalizeLanguage(i18n.resolvedLanguage || i18n.language),
    [i18n.resolvedLanguage, i18n.language]
  )

  const handleLanguageChange = (nextLanguage: 'en' | 'pt') => {
    window.localStorage.setItem('i18nextLng', nextLanguage)
    void i18n.changeLanguage(nextLanguage)
  }

  const buttonClassName = (isActive: boolean) =>
    `text-xs font-semibold uppercase tracking-[0.2em] transition ${
      isActive ? 'text-teal-700' : 'text-slate-500 hover:text-slate-700'
    }`

  return (
    <div
      className={fixed
        ? 'fixed right-4 top-4 z-50 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm'
        : 'rounded-full border border-slate-200 bg-white px-3 py-1.5'}
      role="group"
      aria-label={t('language.switchLabel')}
    >
      <button
        type="button"
        onClick={() => handleLanguageChange('en')}
        aria-pressed={activeLanguage === 'en'}
        className={buttonClassName(activeLanguage === 'en')}
      >
        {t('language.en')}
      </button>
      <span className="mx-1 text-slate-300">|</span>
      <button
        type="button"
        onClick={() => handleLanguageChange('pt')}
        aria-pressed={activeLanguage === 'pt'}
        className={buttonClassName(activeLanguage === 'pt')}
      >
        {t('language.pt')}
      </button>
    </div>
  )
}

export default LanguageSwitcher
