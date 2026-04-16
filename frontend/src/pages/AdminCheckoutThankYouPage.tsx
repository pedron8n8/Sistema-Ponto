import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'

const AdminCheckoutThankYouPage = () => {
  const location = useLocation()
  const { session, profile } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const params = new URLSearchParams(location.search)
  const sessionId = params.get('session_id')
  const token = session?.access_token
  const hasAttemptedSyncRef = useRef(false)
  const [syncState, setSyncState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [syncMessage, setSyncMessage] = useState('')

  useEffect(() => {
    if (!token || !sessionId || hasAttemptedSyncRef.current || profile?.role !== 'ADMIN') {
      return
    }

    hasAttemptedSyncRef.current = true
    setSyncState('loading')
    setSyncMessage('')

    apiFetch<{ billing?: { newlyContractedSeats?: number; contractedExtraSeats?: number } }>(
      '/users/me/additional-seats/confirm',
      {
        method: 'PATCH',
        token,
        body: { stripeSessionId: sessionId },
      }
    )
      .then((response) => {
        const newlyContractedSeats = Number(response?.billing?.newlyContractedSeats ?? 0)
        const contractedExtraSeats = Number(response?.billing?.contractedExtraSeats ?? 0)

        setSyncState('success')
        if (newlyContractedSeats > 0) {
          setSyncMessage(
            t(
              `Saved ${newlyContractedSeats} new extra seat(s). Total contracted extras: ${contractedExtraSeats}.`,
              `Foram salvas ${newlyContractedSeats} nova(s) cadeira(s) extra(s). Total de extras contratadas: ${contractedExtraSeats}.`
            )
          )
        } else {
          setSyncMessage(
            t(
              'Additional seats were synchronized successfully in the database.',
              'As cadeiras adicionais foram sincronizadas com sucesso no banco de dados.'
            )
          )
        }
      })
      .catch((error: unknown) => {
        setSyncState('error')
        setSyncMessage(
          error instanceof Error
            ? error.message
            : t(
                'Could not synchronize additional seats in the database.',
                'Nao foi possivel sincronizar as cadeiras adicionais no banco de dados.'
              )
        )
      })
  }, [profile?.role, sessionId, t, token])

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-8 shadow-[0_16px_40px_-30px_rgba(5,46,22,0.45)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-emerald-700">
          {t('Purchase approved', 'Compra aprovada')}
        </p>
        <h2 className="mt-4 text-3xl font-semibold text-emerald-950">
          {t('Thank you for your purchase', 'Obrigado pela compra')}
        </h2>
        <p className="mt-3 text-sm text-emerald-900/80">
          {t(
            'Stripe confirmed the additional seats subscription. You can now return to the dashboard and continue team setup.',
            'O Stripe confirmou a assinatura das cadeiras adicionais. Agora voce pode voltar ao painel e continuar o cadastro do time.'
          )}
        </p>
        {sessionId ? (
          <p className="mt-3 rounded-xl border border-emerald-200 bg-white/80 px-3 py-2 text-xs text-emerald-900/80">
            {t('Stripe session:', 'Sessao Stripe:')} {sessionId}
          </p>
        ) : null}

        {syncState === 'loading' ? (
          <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            {t('Synchronizing seat data in database...', 'Sincronizando dados de cadeiras no banco...')}
          </p>
        ) : null}

        {syncState === 'success' ? (
          <p className="mt-3 rounded-xl border border-emerald-200 bg-white/80 px-3 py-2 text-xs text-emerald-900/80">
            {syncMessage}
          </p>
        ) : null}

        {syncState === 'error' ? (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {syncMessage}
          </p>
        ) : null}
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <Link
            to="/app/admin/overview"
            className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white"
          >
            {t('Back to Admin Overview', 'Voltar para Admin Overview')}
          </Link>
          <Link
            to="/app"
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
          >
            {t('Go to overview', 'Ir para visao geral')}
          </Link>
        </div>
      </div>
    </section>
  )
}

export default AdminCheckoutThankYouPage
