import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

type PageMetaProps = {
  titleKey: string
  descriptionKey: string
}

const normalizeHtmlLanguage = (language?: string) => {
  return language?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en'
}

const ensureDescriptionMeta = () => {
  const current = document.querySelector('meta[name="description"]')
  if (current) {
    return current as HTMLMetaElement
  }

  const created = document.createElement('meta')
  created.setAttribute('name', 'description')
  document.head.appendChild(created)
  return created
}

const PageMeta = ({ titleKey, descriptionKey }: PageMetaProps) => {
  const { t, i18n } = useTranslation()

  useEffect(() => {
    document.title = t(titleKey)

    const descriptionMeta = ensureDescriptionMeta()
    descriptionMeta.setAttribute('content', t(descriptionKey))

    document.documentElement.lang = normalizeHtmlLanguage(i18n.resolvedLanguage || i18n.language)
  }, [t, i18n.resolvedLanguage, i18n.language, titleKey, descriptionKey])

  return null
}

export default PageMeta
