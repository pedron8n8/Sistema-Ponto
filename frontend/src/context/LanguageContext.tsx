import { createContext, useContext, useEffect, useMemo, useState } from 'react'

type Language = 'en' | 'pt-BR'

type LanguageContextState = {
  language: Language
  setLanguage: (language: Language) => void
  tr: (en: string, ptBR: string) => string
}

const LANGUAGE_STORAGE_KEY = 'systemaPonto.language'

const LanguageContext = createContext<LanguageContextState | undefined>(undefined)

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const [language, setLanguageState] = useState<Language>('en')

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (saved === 'en' || saved === 'pt-BR') {
      setLanguageState(saved)
    }
  }, [])

  const setLanguage = (nextLanguage: Language) => {
    setLanguageState(nextLanguage)
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage)
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
