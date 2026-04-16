import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'

type AdminSeatPayload = {
  admin: {
    id: string
    name: string
    email: string
  }
  billing: {
    seatLimit: number | null
    occupiedSeats: number
    availableSeats: number | null
    overageSeats: number
    extraSeatPriceUsd: number
  }
  seats: Array<{
    seatNumber: number
    occupied: boolean
    occupant: {
      id: string
      name: string
      email: string
      role: string
      organizationAdminId: string
    } | null
  }>
}

const AdminBillingResultPage = () => {
  const { session } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const status = params.get('status')
  const reason = params.get('reason')
  const [admins, setAdmins] = useState<AdminSeatPayload[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isSuccess = status === 'success'
  const isError = status === 'error' || status === 'cancel'
  const isCheckoutCancelled = reason === 'checkout_cancelled' || status === 'cancel'

  const title = isSuccess
    ? t('Payment confirmed', 'Pagamento confirmado')
    : isError
      ? t('Stripe checkout failed', 'Falha no checkout Stripe')
      : t('Stripe checkout status', 'Status do checkout Stripe')

  const description = isSuccess
    ? t(
        'Additional seats subscription was completed on Stripe. You can return and continue setup.',
        'A assinatura das cadeiras adicionais foi concluida no Stripe. Voce ja pode voltar e continuar o cadastro.'
      )
    : isCheckoutCancelled
      ? t(
          'Checkout was canceled on Stripe. No charge was completed for additional seats.',
          'O checkout foi cancelado no Stripe. Nenhuma cobranca foi concluida para as cadeiras adicionais.'
        )
      : isError
        ? t(
            'Stripe returned an error while processing checkout. Review data and try again.',
            'O Stripe retornou erro ao processar o checkout. Revise os dados e tente novamente.'
          )
        : t(
            'Could not identify checkout result. Verify on Stripe and try again.',
            'Nao foi possivel identificar o resultado do checkout. Verifique no Stripe e tente novamente.'
          )

  const badgeClass = isSuccess
    ? 'bg-emerald-100 text-emerald-800'
    : isError
      ? 'bg-rose-100 text-rose-800'
      : 'bg-slate-200 text-slate-700'

  const badgeText = isSuccess
    ? t('Success', 'Sucesso')
    : isError
      ? t('Error', 'Erro')
      : t('Undefined', 'Indefinido')

  const loadSeatAssignments = async () => {
    if (!token) return

    setLoading(true)
    setError('')
    try {
      const response = await apiFetch<{ admins: AdminSeatPayload[] }>('/users/admin-seats', { token })
      setAdmins(response.admins || [])
    } catch (err) {
      setAdmins([])
      setError(
        err instanceof Error
          ? err.message
          : t('Could not load seats by admin.', 'Erro ao carregar cadeiras por admin')
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSeatAssignments().catch(() => undefined)
  }, [token])

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Admin', 'Admin')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{title}</h2>
        <p className="mt-3 text-sm text-slate-600">{description}</p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${badgeClass}`}>
          {badgeText}
        </span>

        <div className="mt-5 flex flex-wrap gap-2">
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

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-slate-900">
            {t('Seats by admin and occupancy', 'Cadeiras por admin e ocupacao')}
          </h3>
          <button
            onClick={() => loadSeatAssignments().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
          >
            {t('Refresh', 'Atualizar')}
          </button>
        </div>

        {loading ? (
          <p className="mt-3 text-sm text-slate-500">{t('Loading seats...', 'Carregando cadeiras...')}</p>
        ) : null}
        {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}

        <div className="mt-4 space-y-4">
          {admins.length === 0 && !loading ? (
            <p className="text-sm text-slate-500">
              {t('No admins found to display seat occupancy.', 'Nenhum admin encontrado para exibir ocupacao de cadeiras.')}
            </p>
          ) : null}

          {admins.map((item) => (
            <div key={item.admin.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{item.admin.name}</p>
                  <p className="text-xs text-slate-500">{item.admin.email}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.15em] text-slate-600">
                  <span className="rounded-full bg-white px-3 py-1">
                    {t('Limit:', 'Limite:')} {item.billing.seatLimit === null ? t('Unlimited', 'Ilimitado') : item.billing.seatLimit}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1">
                    {t('Occupied:', 'Ocupadas:')} {item.billing.occupiedSeats}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1">
                    {t('Available:', 'Vagas:')} {item.billing.availableSeats === null ? '-' : item.billing.availableSeats}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1">
                    {t('Overage:', 'Excedente:')} {item.billing.overageSeats}
                  </span>
                </div>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {item.seats.map((seat) => (
                  <div
                    key={`${item.admin.id}-${seat.seatNumber}`}
                    className={`rounded-xl border px-3 py-2 text-xs ${
                      seat.occupied ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <p className="font-semibold text-slate-800">
                      {t('Seat', 'Cadeira')} {seat.seatNumber}
                    </p>
                    {seat.occupied && seat.occupant ? (
                      <>
                        <p className="mt-1 text-slate-700">{seat.occupant.name}</p>
                        <p className="text-slate-500">{seat.occupant.email}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.15em] text-slate-500">
                          {seat.occupant.role}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-slate-500">{t('Seat available', 'Vaga disponivel')}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default AdminBillingResultPage
