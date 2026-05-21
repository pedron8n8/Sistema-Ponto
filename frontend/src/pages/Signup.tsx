import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import LanguageSwitcher from '../components/LanguageSwitcher'
import BrandWordmark from '../components/BrandWordmark'
import PageMeta from '../components/PageMeta'
import { apiFetch } from '../lib/api'
import { splitMessageLink } from '../lib/errorMessage'

type InvitePreview = {
  role: 'HR' | 'SUPERVISOR' | 'MEMBER'
  expiresAt: string
  admin: {
    id: string
    name: string
    email: string
  }
}

const Signup = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { signUp, signInWithGoogle } = useAuth()
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US'
  const inviteToken = String(searchParams.get('invite') || '').trim()
  const isInviteFlow = inviteToken.length > 0

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')

  const invitedRoleLabel = useMemo(() => {
    if (!invitePreview) return ''

    if (invitePreview.role === 'HR') return 'HR'
    if (invitePreview.role === 'SUPERVISOR') return t('signup.inviteRoleSupervisor')
    return t('signup.inviteRoleMember')
  }, [invitePreview, t])

  const parsedInviteError = useMemo(() => splitMessageLink(inviteError), [inviteError])
  const parsedSubmitError = useMemo(() => splitMessageLink(error), [error])

  useEffect(() => {
    if (!isInviteFlow) {
      setInvitePreview(null)
      setInviteError('')
      return
    }

    let canceled = false
    setInviteLoading(true)
    setInviteError('')

    apiFetch<{ invite: InvitePreview }>(`/auth/invite/preview?token=${encodeURIComponent(inviteToken)}`)
      .then((response) => {
        if (canceled) return
        setInvitePreview(response.invite)
      })
      .catch((err) => {
        if (canceled) return
        setInvitePreview(null)
        setInviteError(err instanceof Error ? err.message : t('signup.inviteInvalid'))
      })
      .finally(() => {
        if (canceled) return
        setInviteLoading(false)
      })

    return () => {
      canceled = true
    }
  }, [inviteToken, isInviteFlow, t])

  const handleCreateAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setNotice('')

    if (isInviteFlow) {
      if (inviteLoading) {
        setError(t('signup.inviteLoading'))
        return
      }

      if (!invitePreview) {
        setError(inviteError || t('signup.inviteInvalid'))
        return
      }
    }

    if (password !== confirmPassword) {
      setError(t('signup.passwordMismatch', 'As senhas nao coincidem.'))
      return
    }

    setLoading(true)

    try {
      const normalizedEmail = String(email || '').trim().toLowerCase()
      if (normalizedEmail.includes('@')) {
        try {
          const availability = await apiFetch<{ available: boolean }>(
            `/auth/check-email?email=${encodeURIComponent(normalizedEmail)}`
          )
          if (!availability.available) {
            setError(
              t(
                'signup.emailTaken',
                'Esse email ja esta cadastrado. Faca login ou recupere sua senha.'
              )
            )
            setLoading(false)
            return
          }
        } catch {
          // Falha do check nao bloqueia signup -- backend ainda valida.
        }
      }

      await signUp({
        name,
        email,
        phone,
        password,
        inviteToken: isInviteFlow ? inviteToken : undefined,
      })

      setNotice(t('signup.success'))
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('signup.createFail'))
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    if (isInviteFlow) {
      setError(t('signup.inviteGoogleDisabled'))
      return
    }

    setError('')
    setNotice('')
    setGoogleLoading(true)

    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('signup.googleFail'))
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <div className="min-h-screen px-6 py-10">
      <PageMeta titleKey="seo.signup.title" descriptionKey="seo.signup.description" />
      <LanguageSwitcher fixed />

      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-2xl bg-gradient-to-br from-teal-500 to-sky-500 shadow-[0_8px_16px_-6px_rgba(14,116,144,0.4)]" />
          <div className="leading-tight">
            <BrandWordmark className="text-2xl" />
          </div>
        </div>
        <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
          {t('signup.pageTag')}
        </span>
      </div>

      <div className="mx-auto mt-14 grid w-full max-w-5xl gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
          <p className="text-xs uppercase tracking-[0.3em] text-teal-700">
            {isInviteFlow ? t('signup.inviteEyebrow') : t('signup.buyerOnboarding')}
          </p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-900">{t('signup.title')}</h2>
          <p className="mt-3 text-sm text-slate-600">
            {isInviteFlow ? t('signup.inviteSubtitle') : t('signup.subtitle')}
          </p>

          {isInviteFlow ? (
            <div className="mt-6 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">{t('signup.inviteDetailsTitle')}</p>

              {inviteLoading ? <p className="mt-2 text-sm text-cyan-900">{t('signup.inviteLoading')}</p> : null}

              {inviteError ? (
                <p className="mt-2 text-sm text-rose-700">
                  {parsedInviteError.text || inviteError}
                  {parsedInviteError.url ? (
                    <>
                      {' '}
                      <a
                        href={parsedInviteError.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold underline decoration-rose-400 underline-offset-2 hover:text-rose-900"
                      >
                        {t('common.here')}
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}

              {invitePreview ? (
                <div className="mt-2 space-y-1 text-sm text-cyan-950">
                  <p>
                    {t('signup.inviteAdminLabel')} {invitePreview.admin.name} ({invitePreview.admin.email})
                  </p>
                  <p>
                    {t('signup.inviteRoleLabel')} {invitedRoleLabel}
                  </p>
                  <p>
                    {t('signup.inviteExpiresLabel')}{' '}
                    {new Date(invitePreview.expiresAt).toLocaleString(locale)}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-8 rounded-2xl border border-slate-100 bg-white/90 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('signup.googleInfoTitle')}</p>
            <p className="mt-2 text-sm text-slate-600">
              {isInviteFlow ? t('signup.inviteGoogleInfoText') : t('signup.googleInfoText')}
            </p>
          </div>
        </section>

        <form onSubmit={handleCreateAccount} className="rounded-3xl border border-slate-100 bg-white/90 p-8 shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-900">{t('signup.formTitle')}</h2>
          <p className="mt-2 text-sm text-slate-600">{t('signup.formSubtitle')}</p>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading || googleLoading || isInviteFlow}
            className="mt-6 w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {googleLoading ? t('signup.googleLoading') : t('signup.googleButton')}
          </button>

          <label className="mt-6 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('signup.nameLabel')}
          </label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            type="text"
            required
            minLength={2}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            placeholder={t('signup.namePlaceholder')}
          />

          <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('signup.emailLabel')}
          </label>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            placeholder={t('signup.emailPlaceholder')}
          />

          <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('signup.phoneLabel')}
          </label>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            type="tel"
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            placeholder={t('signup.phonePlaceholder')}
          />

          <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('signup.passwordLabel')}
          </label>
          <div className="relative mt-2">
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
              placeholder={t('signup.passwordPlaceholder')}
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

          <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('signup.confirmPasswordLabel', 'Confirmar senha *')}
          </label>
          <div className="relative mt-2">
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type={showConfirmPassword ? 'text' : 'password'}
              required
              minLength={6}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
              placeholder={t('signup.confirmPasswordPlaceholder', 'Repita a senha')}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((prev) => !prev)}
              aria-label={
                showConfirmPassword
                  ? t('common.hidePassword', 'Ocultar senha')
                  : t('common.showPassword', 'Mostrar senha')
              }
              className="absolute inset-y-0 right-3 flex items-center text-slate-500 hover:text-slate-700"
            >
              {showConfirmPassword ? (
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

          {error ? (
            <p className="mt-4 text-xs text-rose-600">
              {parsedSubmitError.text || error}
              {parsedSubmitError.url ? (
                <>
                  {' '}
                  <a
                    href={parsedSubmitError.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold underline decoration-rose-400 underline-offset-2 hover:text-rose-700"
                  >
                    {t('common.here')}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          {notice ? <p className="mt-4 text-xs text-emerald-600">{notice}</p> : null}

          <button
            type="submit"
            disabled={loading || googleLoading}
            className="mt-8 w-full rounded-full bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
          >
            {loading ? t('signup.submitLoading') : t('signup.submitButton')}
          </button>

          <Link
            to="/login"
            className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500"
          >
            {t('signup.backToLogin')}
          </Link>
        </form>
      </div>
    </div>
  )
}

export default Signup
