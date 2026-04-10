import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import i18n from '../i18n'

type Language = 'en' | 'pt-BR'

type LanguageContextState = {
  language: Language
  setLanguage: (language: Language) => void
  tr: (en: string, ptBR: string) => string
}

const LanguageContext = createContext<LanguageContextState | undefined>(undefined)

const normalizeLanguage = (rawLanguage?: string): Language => {
  return rawLanguage?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en'
}

const toI18nLanguage = (language: Language) => (language === 'pt-BR' ? 'pt' : 'en')

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const [language, setLanguageState] = useState<Language>(() =>
    normalizeLanguage(i18n.resolvedLanguage || i18n.language)
  )

  useEffect(() => {
    const handleLanguageChange = (nextLanguage: string) => {
      setLanguageState(normalizeLanguage(nextLanguage))
    }

    i18n.on('languageChanged', handleLanguageChange)

    return () => {
      i18n.off('languageChanged', handleLanguageChange)
    }
  }, [])

  const setLanguage = (nextLanguage: Language) => {
    void i18n.changeLanguage(toI18nLanguage(nextLanguage))
  }

  const tr = (en: string, ptBR: string) => (language === 'pt-BR' ? ptBR : en)

  const value = useMemo(() => ({ language, setLanguage, tr }), [language])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export const useLanguage = () => {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used inside LanguageProvider')
  }
  return context
}
