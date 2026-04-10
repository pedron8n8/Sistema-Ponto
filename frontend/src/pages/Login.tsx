import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import LanguageSwitcher from '../components/LanguageSwitcher'
import PageMeta from '../components/PageMeta'

const Login = () => {
  const navigate = useNavigate()
  const { signIn, signUp, signInWithGoogle } = useAuth()
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [googleLoading, setGoogleLoading] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)

  const handleEmailSignIn = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setNotice('')
    setEmailLoading(true)

    try {
      await signIn(email, password)
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.signinFail'))
    } finally {
      setEmailLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError('')
    setNotice('')
    setGoogleLoading(true)

    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.oauthFail'))
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleCreateAccount = async () => {
    setError('')
    setNotice('')
    setCreateLoading(true)

    try {
      await signUp(email, password)
      setNotice(t('auth.signupSuccess'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.signupFail'))
    } finally {
      setCreateLoading(false)
    }
  }

  return (
    <div className="min-h-screen px-6 py-10">
      <PageMeta titleKey="seo.login.title" descriptionKey="seo.login.description" />
      <LanguageSwitcher fixed />
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-2xl bg-teal-700/90" />
          <div className="leading-tight">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{t('brand.product')}</p>
            <h1 className="text-xl font-semibold text-slate-900">{t('brand.name')}</h1>
          </div>
        </div>
        <span className="text-xs uppercase tracking-[0.3em] text-slate-400">{t('common.login')}</span>
      </div>

      <div className="mx-auto mt-14 grid w-full max-w-5xl gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
          <p className="text-xs uppercase tracking-[0.3em] text-teal-700">{t('auth.eyebrow')}</p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-900">{t('auth.heroTitle')}</h2>
          <p className="mt-3 text-sm text-slate-600">{t('auth.heroText')}</p>
          <div className="mt-10 rounded-2xl border border-slate-100 bg-slate-50/70 p-5 text-xs text-slate-500">
            {t('auth.hint')}
          </div>

          <div className="mt-8 rounded-2xl border border-slate-100 bg-white/90 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('auth.linksTitle')}</p>
            <p className="mt-2 text-sm text-slate-600">{t('auth.linksSubtitle')}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to="/"
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-400"
              >
                {t('common.getStarted')}
              </Link>
              <Link
                to="/pricing"
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-400"
              >
                {t('common.viewPricing')}
              </Link>
            </div>
          </div>
        </section>

        <form onSubmit={handleEmailSignIn} className="rounded-3xl border border-slate-100 bg-white/90 p-8 shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-900">{t('auth.title')}</h2>
          <p className="mt-2 text-sm text-slate-600">{t('auth.subtitle')}</p>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading || emailLoading || createLoading}
            className="mt-6 w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {googleLoading ? t('auth.googleLoading') : t('auth.googleButton')}
          </button>

          <label className="mt-6 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('auth.emailLabel')}</label>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
            placeholder={t('auth.emailPlaceholder')}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
          />

          <label className="mt-6 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('auth.passwordLabel')}</label>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
            placeholder={t('auth.passwordPlaceholder')}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
          />

          {error ? <p className="mt-4 text-xs text-rose-600">{error}</p> : null}
          {notice ? <p className="mt-4 text-xs text-emerald-600">{notice}</p> : null}

          <button
            type="submit"
            disabled={googleLoading || emailLoading || createLoading}
            className="mt-8 w-full rounded-full bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
          >
            {emailLoading ? t('auth.emailLoading') : t('auth.emailButton')}
          </button>

          <button
            type="button"
            onClick={handleCreateAccount}
            disabled={googleLoading || emailLoading || createLoading}
            className="mt-3 w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-60"
          >
            {createLoading ? t('auth.createLoading') : t('auth.createButton')}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
