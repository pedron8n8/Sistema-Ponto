import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type AdditionalSeatsCheckoutResponse = {
  message?: string
  billing?: {
    requestedSeats: number
    unitPriceUsd: number
    monthlyTotalUsd: number
  }
  stripe?: {
    configured?: boolean
    checkoutUrl?: string | null
    sessionId?: string | null
    quantity?: number
    currency?: string
  }
}

const normalizeQuantity = (value: unknown, fallback = 1) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback

  const rounded = Math.floor(parsed)
  if (rounded < 1) return fallback

  return Math.min(500, rounded)
}

const AdminSeatPurchasePage = () => {
  const { session, profile } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const [searchParams] = useSearchParams()
  const token = session?.access_token

  const requiredSeatsFromQuery = useMemo(
    () => normalizeQuantity(searchParams.get('required'), 1),
    [searchParams]
  )

  const [quantity, setQuantity] = useState(String(requiredSeatsFromQuery))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const canBuySeats = profile?.role === 'ADMIN'

  const handleStartCheckout = async () => {
    if (!token) {
      setError(t('Session expired. Sign in again.', 'Sessao expirada. Faca login novamente.'))
      return
    }

    const normalizedQuantity = normalizeQuantity(quantity, 0)
    if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1) {
      setError(
        t(
          'Enter a valid integer quantity greater than or equal to 1.',
          'Informe uma quantidade inteira valida maior ou igual a 1.'
        )
      )
      return
    }

    setError('')
    setNotice('')
    setLoading(true)

    try {
      const response = await apiFetch<AdditionalSeatsCheckoutResponse>('/users/me/additional-seats/checkout', {
        token,
        method: 'POST',
        body: {
          quantity: normalizedQuantity,
        },
      })

      const checkoutUrl = String(response?.stripe?.checkoutUrl || '').trim()
      if (!checkoutUrl) {
        throw new Error(
          t(
            'Backend did not return Stripe checkout URL.',
            'Backend nao retornou a URL de checkout Stripe.'
          )
        )
      }

      setNotice(
        t(
          'Redirecting to Stripe checkout...',
          'Redirecionando para o checkout Stripe...'
        )
      )
      window.location.assign(checkoutUrl)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(
              'Could not start additional seats checkout.',
              'Nao foi possivel iniciar checkout de assentos adicionais.'
            )
      )
    } finally {
      setLoading(false)
    }
  }

  if (!canBuySeats) {
    return (
      <section className="rounded-3xl border border-amber-300 bg-amber-50/90 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-800">
          {t('Restricted access', 'Acesso restrito')}
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-amber-950">
          {t('Only ADMIN can buy seats', 'Apenas ADMIN pode comprar assentos')}
        </h2>
        <p className="mt-2 text-sm text-amber-900">
          {t(
            'Ask an account administrator to complete this purchase.',
            'Peca para um administrador da conta concluir essa compra.'
          )}
        </p>
        <Link
          to="/app/admin/overview"
          className="mt-4 inline-flex rounded-full border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-800"
        >
          {t('Back to admin panel', 'Voltar para painel admin')}
        </Link>
      </section>
    )
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
      <div className="rounded-3xl border border-white/80 bg-white/85 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">
          {t('Additional seats', 'Assentos adicionais')}
        </p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">
          {t('Buy seats for your team', 'Compre assentos para seu time')}
        </h2>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'Choose how many additional seats you want and continue to Stripe checkout.',
            'Escolha quantos assentos adicionais voce quer e continue para o checkout Stripe.'
          )}
        </p>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('Quantity of seats', 'Quantidade de assentos')}
          </label>
          <input
            type="number"
            min="1"
            max="500"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"
          />
          <p className="mt-2 text-xs text-slate-500">
            {t('Tip:', 'Dica:')} {t(
              'you can start with the exact amount needed right now and increase later.',
              'voce pode iniciar com a quantidade exata necessaria agora e aumentar depois.'
            )}
          </p>
        </div>

        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
        {notice ? <p className="mt-4 text-sm text-emerald-700">{notice}</p> : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleStartCheckout}
            disabled={loading}
            className="rounded-full bg-slate-900 px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white disabled:opacity-60"
          >
            {loading
              ? t('Opening checkout...', 'Abrindo checkout...')
              : t('Continue to Stripe', 'Continuar para Stripe')}
          </button>

          <Link
            to="/app/admin/overview"
            className="rounded-full border border-slate-200 bg-white px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700"
          >
            {t('Back to admin panel', 'Voltar para painel admin')}
          </Link>
        </div>
      </div>

      <aside className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">
          {t('How billing works', 'Como a cobranca funciona')}
        </h3>
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
          <li>
            {t(
              'Each additional seat adds a monthly recurring amount in Stripe.',
              'Cada assento adicional soma um valor mensal recorrente no Stripe.'
            )}
          </li>
          <li>
            {t(
              'After payment, return to the app and seat limits are synchronized.',
              'Depois do pagamento, volte para o app e os limites de assentos sao sincronizados.'
            )}
          </li>
          <li>
            {t(
              'You can always buy more seats later using this same screen.',
              'Voce sempre pode comprar mais assentos depois usando esta mesma tela.'
            )}
          </li>
        </ul>
      </aside>
    </section>
  )
}

export default AdminSeatPurchasePage
