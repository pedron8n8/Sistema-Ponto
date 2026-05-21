import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import LanguageSwitcher from '../components/LanguageSwitcher'
import BrandWordmark from '../components/BrandWordmark'
import PageMeta from '../components/PageMeta'

const Login = () => {
  const navigate = useNavigate()
  const { signIn, signInWithGoogle, resetPassword, session, profile, loading, profileError } = useAuth()
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [googleLoading, setGoogleLoading] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  useEffect(() => {
    if (loading || !session || !profile) return

    if (profile.role === 'SUPERADMIN') {
      navigate('/app/superadmin/accounts', { replace: true })
      return
    }

    navigate(profile.currentPlanStatus === 'ACTIVE' ? '/app' : '/app/escolher-plano', { replace: true })
  }, [loading, navigate, profile, session])

  const resolveGoogleSignInError = (err: unknown) => {
    if (!(err instanceof Error)) {
      return t('auth.oauthFail')
    }

    const normalizedErrorMessage = err.message.toLowerCase()
    if (
      normalizedErrorMessage.includes('google_provider_disabled') ||
      normalizedErrorMessage.includes('unsupported provider') ||
      normalizedErrorMessage.includes('provider is not enabled')
    ) {
      return t('auth.googleProviderDisabled')
    }

    return err.message || t('auth.oauthFail')
  }

  // const resolveSlackSignInError = (err: unknown) => {
  //   if (!(err instanceof Error)) {
  //     return t('auth.oauthFail')
  //   }

  //   const normalizedErrorMessage = err.message.toLowerCase()
  //   if (
  //     normalizedErrorMessage.includes('slack_provider_disabled') ||
  //     normalizedErrorMessage.includes('unsupported provider') ||
  //     normalizedErrorMessage.includes('provider is not enabled')
  //   ) {
  //     return t('auth.slackProviderDisabled', 'Slack provider disabled')
  //   }

  //   return err.message || t('auth.oauthFail')
  // }

  const handleEmailSignIn = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setNotice('')
    setEmailLoading(true)

    try {
      await signIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.signinFail'))
    } finally {
      setEmailLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    setError('')
    setNotice('')

    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!normalizedEmail.includes('@')) {
      setError(t('auth.forgotEmailRequired', 'Informe seu email para receber o link de redefinicao.'))
      return
    }

    setResetLoading(true)

    try {
      await resetPassword(normalizedEmail)
      setNotice(
        t(
          'auth.forgotSent',
          'Enviamos um link de redefinicao para o seu email. Verifique a caixa de entrada.'
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.forgotFail', 'Nao foi possivel enviar o link de redefinicao.'))
    } finally {
      setResetLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError('')
    setGoogleLoading(true)

    try {
      await signInWithGoogle()
    } catch (err) {
      setError(resolveGoogleSignInError(err))
    } finally {
      setGoogleLoading(false)
    }
  }


  const handleCreateAccount = () => {
    navigate('/signup')
  }

  return (
    <div className="min-h-screen px-6 py-10">
      <PageMeta titleKey="seo.login.title" descriptionKey="seo.login.description" />
      <LanguageSwitcher fixed />
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <Link to="/" className="flex items-center gap-3 transition hover:opacity-80" aria-label="Voltar para o inicio">
          <span className="h-10 w-10 rounded-2xl bg-gradient-to-br from-teal-500 to-sky-500 shadow-[0_8px_16px_-6px_rgba(14,116,144,0.4)]" />
          <div className="leading-tight">
            <BrandWordmark className="text-2xl" />
          </div>
        </Link>
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

          <div className="mt-6 grid gap-3">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading || emailLoading}
              className="w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {googleLoading ? t('auth.googleLoading') : t('auth.googleButton')}
            </button>
          </div>

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
          <div className="relative mt-2">
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type={showPassword ? 'text' : 'password'}
              required
              placeholder={t('auth.passwordPlaceholder')}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={
                showPassword
                  ? t('common.hidePassword', 'Ocultar senha')
                  : t('common.showPassword', 'Mostrar senha')
              }
              className="absolute inset-y-0 right-3 flex items-center text-slate-500 hover:text-slate-700"
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
                  <path d="M3 3l18 18" />
                  <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                  <path d="M9.4 5.2A10.6 10.6 0 0 1 12 5c5 0 9 4 10 7-0.4 1.1-1.2 2.5-2.4 3.7" />
                  <path d="M6.4 6.4C4.2 7.9 2.6 10.2 2 12c1 3 5 7 10 7 1.6 0 3.1-0.4 4.4-1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
                  <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={handleForgotPassword}
            disabled={resetLoading || emailLoading || googleLoading}
            className="mt-3 inline-flex text-xs font-semibold text-teal-700 transition hover:text-teal-900 disabled:opacity-60"
          >
            {resetLoading
              ? t('auth.forgotSending', 'Enviando link...')
              : t('auth.forgotPassword', 'Esqueceu a senha?')}
          </button>

          {error || profileError ? (
            <p className="mt-4 text-xs text-rose-600">{error || profileError}</p>
          ) : null}
          {notice ? <p className="mt-4 text-xs text-emerald-600">{notice}</p> : null}

          <button
            type="submit"
            disabled={googleLoading || emailLoading}
            className="mt-8 w-full rounded-full bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
          >
            {emailLoading ? t('auth.emailLoading') : t('auth.emailButton')}
          </button>

          <button
            type="button"
            onClick={handleCreateAccount}
            disabled={googleLoading || emailLoading}
            className="mt-3 w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-60"
          >
            {t('auth.createButton')}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
