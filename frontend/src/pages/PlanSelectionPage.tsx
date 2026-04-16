import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { getMarketingPlans } from '../lib/marketingPlans'

type PlanId = 'starter' | 'growth' | 'pro'

type PlanConfig = {
  code: 'STARTER' | 'GROWTH' | 'PRO'
  maxSeats: number
}

const PLAN_CONFIG: Record<PlanId, PlanConfig> = {
  starter: { code: 'STARTER', maxSeats: 3 },
  growth: { code: 'GROWTH', maxSeats: 5 },
  pro: { code: 'PRO', maxSeats: 7 },
}

type ChoosePlanResponse = {
  message?: string
  checkout?: {
    url?: string | null
    sessionId?: string | null
    provider?: string
  }
}

const clampSeatLimit = (value: number, maxSeats: number) => {
  const normalized = Number.isFinite(value) ? Math.floor(value) : 1
  return Math.max(1, Math.min(maxSeats, normalized))
}

const PlanSelectionPage = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { session, profile, refreshProfile, signOut } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)

  const checkoutStatus = searchParams.get('status')
  const stripeSessionId = searchParams.get('session_id')
  const checkoutFinalizeStartedRef = useRef(false)

  const plans = useMemo(() => {
    return getMarketingPlans(i18nT).map((plan) => ({
      ...plan,
      ...PLAN_CONFIG[plan.id],
    }))
  }, [i18nT])

  const [selectedPlanId, setSelectedPlanId] = useState<PlanId>('growth')
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) || plans[0]

  const [seatLimit, setSeatLimit] = useState(1)
  const [saving, setSaving] = useState(false)
  const [finalizingCheckout, setFinalizingCheckout] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const canManageOwnPlan = profile?.role === 'ADMIN'

  useEffect(() => {
    if (!selectedPlan) return

    setSeatLimit((currentValue) => clampSeatLimit(currentValue, selectedPlan.maxSeats))
  }, [selectedPlan])

  useEffect(() => {
    if (checkoutStatus !== 'cancel') return

    setError('')
    setNotice(
      t(
        'Stripe checkout was canceled. You can adjust the plan and try again.',
        'O checkout Stripe foi cancelado. Voce pode ajustar o plano e tentar novamente.'
      )
    )
  }, [checkoutStatus, t])

  useEffect(() => {
    if (
      checkoutStatus !== 'success' ||
      !stripeSessionId ||
      !session?.access_token ||
      checkoutFinalizeStartedRef.current
    ) {
      return
    }

    checkoutFinalizeStartedRef.current = true
    setFinalizingCheckout(true)
    setError('')
    setNotice(
      t(
        'Confirming your Stripe payment and activating your plan...',
        'Confirmando seu pagamento no Stripe e ativando seu plano...'
      )
    )

    apiFetch('/users/me/plan', {
      method: 'PATCH',
      token: session.access_token,
      body: {
        stripeSessionId,
      },
    })
      .then(async () => {
        await refreshProfile()
        navigate('/app', { replace: true })
      })
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : t(
                'Could not confirm Stripe checkout.',
                'Nao foi possivel confirmar o checkout Stripe.'
              )
        )
      })
      .finally(() => {
        setFinalizingCheckout(false)
      })
  }, [checkoutStatus, stripeSessionId, session?.access_token, refreshProfile, navigate, t])

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setNotice('')

    if (!session?.access_token) {
      setError(t('Your session has expired. Please sign in again.', 'Sua sessao expirou. Faca login novamente.'))
      return
    }

    if (!selectedPlan) {
      setError(t('Select a plan before continuing.', 'Selecione um plano antes de continuar.'))
      return
    }

    if (!canManageOwnPlan) {
      setError(
        t(
          'Only ADMIN accounts can choose a subscription plan. Contact your administrator.',
          'Somente contas ADMIN podem escolher o plano. Fale com o administrador da conta.'
        )
      )
      return
    }

    setSaving(true)

    try {
      const response = await apiFetch<ChoosePlanResponse>('/users/me/plan', {
        method: 'PATCH',
        token: session.access_token,
        body: {
          planCode: selectedPlan.code,
          seatLimit,
          startCheckout: true,
        },
      })

      const checkoutUrl = response?.checkout?.url
      if (checkoutUrl) {
        setNotice(
          t(
            'Redirecting to Stripe checkout...',
            'Redirecionando para o checkout Stripe...'
          )
        )
        window.location.assign(checkoutUrl)
        return
      }

      await refreshProfile()
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not update plan.', 'Nao foi possivel atualizar o plano.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_14%_8%,rgba(6,182,212,0.14),transparent_34%),radial-gradient(circle_at_90%_100%,rgba(20,184,166,0.15),transparent_40%),linear-gradient(180deg,#f8fafc_0%,#f0f9ff_100%)] px-5 py-8 sm:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <section className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_30px_60px_-44px_rgba(2,132,199,0.45)] sm:p-8">
          <div className="pointer-events-none absolute -left-20 top-8 h-44 w-44 rounded-full bg-cyan-200/45 blur-3xl" />
          <div className="pointer-events-none absolute -right-16 bottom-8 h-52 w-52 rounded-full bg-teal-200/40 blur-3xl" />

          <div className="relative z-10">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">
                  {t('Complete your account setup', 'Finalize seu cadastro')}
                </p>
                <h1 className="mt-3 text-3xl font-semibold text-slate-900 sm:text-4xl">
                  {t('Choose your plan and seat limit', 'Escolha seu plano e limite de cadeiras')}
                </h1>
                <p className="mt-3 max-w-3xl text-sm text-slate-600 sm:text-base">
                  {t(
                    'You will be redirected to Stripe checkout. After payment confirmation, your access is released in /app.',
                    'Voce sera redirecionado ao checkout Stripe. Depois da confirmacao do pagamento, seu acesso e liberado no /app.'
                  )}
                </p>
              </div>

              <button
                onClick={signOut}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 transition hover:border-slate-400"
              >
                {t('Sign out', 'Sair')}
              </button>
            </header>

            {!canManageOwnPlan ? (
              <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {t(
                  'Your user is not ADMIN. Ask an account administrator to choose a plan and unlock access.',
                  'Seu usuario nao e ADMIN. Peca ao administrador da conta para escolher um plano e liberar o acesso.'
                )}
              </div>
            ) : null}

            <form onSubmit={onSubmit} className="mt-8 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
              <div className="grid gap-4">
                {plans.map((plan) => {
                  const selected = plan.id === selectedPlan?.id

                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`rounded-3xl border p-5 text-left transition ${
                        selected
                          ? 'border-cyan-500 bg-cyan-50/70 shadow-[0_24px_36px_-28px_rgba(6,182,212,0.8)]'
                          : 'border-slate-200 bg-white hover:border-cyan-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{plan.code}</p>
                          <h2 className="mt-1 text-2xl font-semibold text-slate-900">{plan.name}</h2>
                        </div>
                        <div className="text-right">
                          <p className="text-3xl font-semibold text-slate-900">{plan.price}</p>
                          <p className="text-xs text-slate-500">{t('per month', 'por mes')}</p>
                        </div>
                      </div>

                      <p className="mt-3 text-sm text-slate-600">{plan.description}</p>

                      <div className="mt-4 inline-flex rounded-full border border-cyan-200 bg-cyan-100/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-800">
                        {t('Seat cap', 'Limite de cadeiras')}: {plan.maxSeats}
                      </div>

                      <div className="mt-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                          {t('Plan differentials', 'Diferenciais do plano')}
                        </p>
                        <ul className="mt-3 grid gap-2">
                          {plan.features.map((feature) => (
                            <li key={`${plan.id}-${feature}`} className="flex items-start gap-2 text-sm text-slate-700">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-cyan-600" />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </button>
                  )
                })}
              </div>

              <aside className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                  {t('Summary', 'Resumo da escolha')}
                </p>

                <h3 className="mt-3 text-xl font-semibold text-slate-900">{selectedPlan?.name || '-'}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {t('Plan code', 'Codigo do plano')}: {selectedPlan?.code || '-'}
                </p>

                <label className="mt-6 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {t(
                    'Initial seat limit for your workspace',
                    'Limite inicial de cadeiras do workspace'
                  )}
                </label>
                <input
                  type="range"
                  min={1}
                  max={selectedPlan?.maxSeats || 1}
                  value={seatLimit}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value)
                    const nextLimit = clampSeatLimit(nextValue, selectedPlan?.maxSeats || 1)
                    setSeatLimit(nextLimit)
                  }}
                  className="mt-2 w-full accent-cyan-600"
                  disabled={!canManageOwnPlan || saving || finalizingCheckout}
                />

                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={selectedPlan?.maxSeats || 1}
                    value={seatLimit}
                    onChange={(event) => {
                      const rawValue = Number(event.target.value)
                      const nextLimit = clampSeatLimit(rawValue, selectedPlan?.maxSeats || 1)
                      setSeatLimit(nextLimit)
                    }}
                    className="w-24 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                    disabled={!canManageOwnPlan || saving || finalizingCheckout}
                  />
                  <p className="text-xs text-slate-500">
                    {t('maximum for this plan', 'maximo para este plano')}: {selectedPlan?.maxSeats || 1}
                  </p>
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  {t(
                    'Seat count here is only your initial in-app limit and does not change plan price. You can increase seats later inside the system.',
                    'A quantidade de cadeiras aqui e apenas o limite inicial no sistema e nao altera o valor do plano. Depois voce consegue aumentar as cadeiras dentro do sistema.'
                  )}
                </p>

                <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Account', 'Conta')}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{profile?.name || '-'}</p>
                  <p className="text-xs text-slate-500">{profile?.email || '-'}</p>
                </div>

                {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
                {notice ? <p className="mt-4 text-sm text-emerald-700">{notice}</p> : null}

                <button
                  type="submit"
                  disabled={!canManageOwnPlan || saving || finalizingCheckout}
                  className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-slate-900 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {finalizingCheckout
                    ? t('Confirming payment...', 'Confirmando pagamento...')
                    : saving
                      ? t('Opening Stripe checkout...', 'Abrindo checkout Stripe...')
                      : t('Go to Stripe checkout', 'Ir para checkout Stripe')}
                </button>
              </aside>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}

export default PlanSelectionPage
