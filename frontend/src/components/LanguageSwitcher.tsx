import { useLanguage } from '../context/LanguageContext'

type LanguageSwitcherProps = {
  fixed?: boolean
}

const LanguageSwitcher = ({ fixed = false }: LanguageSwitcherProps) => {
  const { language, setLanguage } = useLanguage()

  return (
    <div
      className={fixed
        ? 'fixed right-4 top-4 z-50 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm'
        : 'rounded-full border border-slate-200 bg-white px-3 py-1.5'}
    >
      <select
        aria-label="Language"
        value={language}
        onChange={(event) => setLanguage(event.target.value as 'en' | 'pt-BR')}
        className="bg-transparent text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 outline-none"
      >
        <option value="en">EN</option>
        <option value="pt-BR">pt-BR</option>
      </select>
    </div>
  )
}

export default LanguageSwitcher
