import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import LanguageSwitcher from '../components/LanguageSwitcher'
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

    setLoading(true)

    try {
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
          <span className="h-10 w-10 rounded-2xl bg-teal-700/90" />
          <div className="leading-tight">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{t('brand.product')}</p>
            <h1 className="text-xl font-semibold text-slate-900">{t('brand.name')}</h1>
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
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
            minLength={6}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            placeholder={t('signup.passwordPlaceholder')}
          />

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
