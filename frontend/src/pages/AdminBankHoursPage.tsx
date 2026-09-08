import { useEffect, useMemo, useState } from 'react'
import { apiFetch, translateApiMessage } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'

type KpiPeriod = 'daily' | 'weekly' | 'monthly'

type HoursKpiItem = {
  member: {
    id: string
    name: string
    email: string
  }
  expectedMinutes: number
  workedMinutes: number
  overtimeMinutes: number
}

type HoursKpiResponse = {
  summary: {
    expectedMinutes: number
    workedMinutes: number
    overtimeMinutes: number
  }
  byCollaborator: HoursKpiItem[]
}

type BankHoursOverviewItem = {
  user: {
    id: string
    name: string
    email: string
    role: string
  }
  bankHours: {
    balanceMinutes: number
    creditMinutes: number
    debtMinutes: number
    pendingMinutes: number
    paidMinutes: number
  }
}

const formatMinutesLabel = (minutes: number) => {
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const mins = absolute % 60
  const sign = minutes < 0 ? '-' : ''
  return `${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

const AdminBankHoursPage = () => {
  const { session } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const locale = isPt ? 'pt-BR' : 'en-US'
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token

  const [period, setPeriod] = useState<KpiPeriod>('weekly')

  // Limiar de HE curta da conta. `overtimeEnabled` desligado envia null, porque
  // no backend "desligado" e null e nao zero — a coluna e nullable de proposito.
  const [overtimeEnabled, setOvertimeEnabled] = useState(false)
  const [overtimeMinutesInput, setOvertimeMinutesInput] = useState('10')
  const [overtimeMaxMinutes, setOvertimeMaxMinutes] = useState(120)
  const [savedOvertimeMinutes, setSavedOvertimeMinutes] = useState<number | null>(null)
  const [overtimeUpdatedAt, setOvertimeUpdatedAt] = useState<string | null>(null)
  const [savingOvertimeSettings, setSavingOvertimeSettings] = useState(false)
  const [overtimeSettingsError, setOvertimeSettingsError] = useState('')
  const [overtimeSettingsNotice, setOvertimeSettingsNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [kpiPayload, setKpiPayload] = useState<HoursKpiResponse | null>(null)
  const [bankOverview, setBankOverview] = useState<BankHoursOverviewItem[]>([])
  const [bankPayLoadingByUser, setBankPayLoadingByUser] = useState<Record<string, boolean>>({})

  const loadData = async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const [kpisResponse, bankResponse] = await Promise.all([
        apiFetch<HoursKpiResponse>(`/supervisor/kpis/hours?period=${period}`, { token }),
        apiFetch<{ overview: BankHoursOverviewItem[] }>('/admin/bank-hours/overview', { token }),
      ])

      setKpiPayload(kpisResponse)
      setBankOverview(bankResponse.overview || [])
    } catch (err) {
      setKpiPayload(null)
      setBankOverview([])
      setError(
        err instanceof Error
          ? err.message
          : t('Could not load banked-hours overview.', 'Erro ao carregar visao de banco de horas')
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData().catch(() => undefined)
  }, [token, period])

  type OvertimeSettings = {
    overtimeMinMinutes: number | null
    enabled: boolean
    maxMinutes: number
    // Procedencia: quem mudou e quando. Antes so existia um console.log no
    // servidor, que morre com o container.
    updatedAt: string | null
    updatedById: string | null
  }

  const applyOvertimeSettings = (settings: OvertimeSettings) => {
    setOvertimeEnabled(settings.enabled)
    setOvertimeMaxMinutes(settings.maxMinutes || 120)
    // Estado REALMENTE gravado, separado do estado do formulario. Sem isso a
    // tela so mostra o que voce digitou, e marcar o checkbox sem salvar fica
    // visualmente identico a ter salvo.
    setSavedOvertimeMinutes(settings.overtimeMinMinutes)
    setOvertimeUpdatedAt(settings.updatedAt)
    // Desligado mantem o ultimo valor visivel no campo, para religar nao exigir
    // digitar tudo de novo.
    if (settings.overtimeMinMinutes) setOvertimeMinutesInput(String(settings.overtimeMinMinutes))
  }

  const loadOvertimeSettings = async () => {
    if (!token) return
    try {
      const settings = await apiFetch<OvertimeSettings>('/admin/overtime-settings', { token })
      applyOvertimeSettings(settings)
    } catch (err) {
      setOvertimeSettingsError(
        err instanceof Error
          ? translateApiMessage(err.message)
          : t('Could not load the overtime rule.', 'Erro ao carregar a regra de hora extra')
      )
    }
  }

  useEffect(() => {
    loadOvertimeSettings().catch(() => undefined)
  }, [token])

  const saveOvertimeSettings = async () => {
    // Sem `return` mudo: sem sessao o clique nao mandava requisicao nenhuma e
    // nao dizia nada, deixando "salvei e nao mudou" indistinguivel de bug.
    if (!token) {
      setOvertimeSettingsError(
        t('Session expired. Sign in again.', 'Sessao expirada. Entre novamente.')
      )
      return
    }

    setOvertimeSettingsError('')
    setOvertimeSettingsNotice('')

    // Ligado exige um inteiro valido; desligado ignora o campo e envia null.
    let payload: number | null = null
    if (overtimeEnabled) {
      const parsed = Number(overtimeMinutesInput)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > overtimeMaxMinutes) {
        setOvertimeSettingsError(
          t(
            `Enter a whole number of minutes between 1 and ${overtimeMaxMinutes}.`,
            `Informe um numero inteiro de minutos entre 1 e ${overtimeMaxMinutes}.`
          )
        )
        return
      }
      payload = parsed
    }

    setSavingOvertimeSettings(true)
    try {
      const settings = await apiFetch<OvertimeSettings>('/admin/overtime-settings', {
        token,
        method: 'PATCH',
        body: { overtimeMinMinutes: payload },
      })
      applyOvertimeSettings(settings)
      setOvertimeSettingsNotice(
        settings.enabled
          ? t(
              `Overtime under ${settings.overtimeMinMinutes} minutes in a day no longer counts.`,
              `Hora extra abaixo de ${settings.overtimeMinMinutes} minutos no dia deixa de contar.`
            )
          : t('Short-overtime rule turned off.', 'Regra de hora extra curta desligada.')
      )
    } catch (err) {
      // apiFetch ja exibe o toast do erro; aqui fica so o estado inline.
      setOvertimeSettingsError(
        err instanceof Error
          ? translateApiMessage(err.message)
          : t('Could not save the overtime rule.', 'Erro ao salvar a regra de hora extra')
      )
    } finally {
      setSavingOvertimeSettings(false)
    }
  }

  // Compara o formulario com o que esta gravado. Desligado nos dois lados e
  // "sem alteracao", qualquer que seja o numero digitado no campo desabilitado.
  const hasUnsavedOvertimeChange = overtimeEnabled
    ? Number(overtimeMinutesInput) !== savedOvertimeMinutes
    : savedOvertimeMinutes !== null

  const bankByUserId = useMemo(() => {
    return bankOverview.reduce<Record<string, BankHoursOverviewItem>>((acc, item) => {
      acc[item.user.id] = item
      return acc
    }, {})
  }, [bankOverview])

  const kpiByUserId = useMemo(() => {
    const entries = kpiPayload?.byCollaborator || []
    return entries.reduce<Record<string, HoursKpiItem>>((acc, item) => {
      acc[item.member.id] = item
      return acc
    }, {})
  }, [kpiPayload])

  const combinedRows = useMemo(() => {
    const idSet = new Set<string>()

    Object.keys(bankByUserId).forEach((id) => idSet.add(id))
    Object.keys(kpiByUserId).forEach((id) => idSet.add(id))

    return Array.from(idSet)
      .map((userId) => {
        const kpi = kpiByUserId[userId]
        const bank = bankByUserId[userId]

        return {
          userId,
          name: kpi?.member.name || bank?.user.name || t('No name', 'Sem nome'),
          email: kpi?.member.email || bank?.user.email || '-',
          role: bank?.user.role || '-',
          expectedMinutes: kpi?.expectedMinutes || 0,
          workedMinutes: kpi?.workedMinutes || 0,
          overtimeMinutes: kpi?.overtimeMinutes || 0,
          balanceMinutes: bank?.bankHours.balanceMinutes || 0,
          pendingMinutes: bank?.bankHours.pendingMinutes || 0,
          paidMinutes: bank?.bankHours.paidMinutes || 0,
        }
      })
        .sort((a, b) => a.name.localeCompare(b.name, locale))
      }, [bankByUserId, kpiByUserId, locale, t])

  const handlePayPendingBankHours = async (userId: string) => {
    if (!token) return

    setError('')
    setNotice('')
    setBankPayLoadingByUser((prev) => ({ ...prev, [userId]: true }))

    try {
      const response = await apiFetch<{ message: string }>(`/admin/users/${userId}/bank-hours/pay`, {
        token,
        method: 'PATCH',
        body: { payAllPending: true },
      })

      setNotice(
        response.message
          ? translateApiMessage(response.message)
          : t(
              'Banked-hours payout recorded successfully.',
              'Baixa de banco de horas registrada com sucesso.'
            )
      )
      await loadData()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not process banked-hours payout.', 'Erro ao dar baixa no banco de horas')
      )
    } finally {
      setBankPayLoadingByUser((prev) => ({ ...prev, [userId]: false }))
    }
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Admin', 'Admin')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{t('Banked hours', 'Banco de horas')}</h2>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'Track weekly and overtime hours by user, with banked-hours balances and pending payouts.',
            'Acompanhe horas semanais e extras por usuario, com saldo e pendencias de banco de horas.'
          )}
        </p>
      </div>

      {/* Limiar de HE curta: politica de jornada da CONTA inteira, por isso mora
          na tela de politica de horas e nao no cadastro de cada colaborador. */}
      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">
          {t('Short overtime', 'Hora extra curta')}
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          {t(
            'Overtime below this many minutes in a day is not counted as overtime. Crossing it counts the full amount.',
            'Hora extra abaixo desta quantidade de minutos no dia nao e considerada hora extra. Ao cruzar, conta o valor cheio.'
          )}
        </p>

        {/* O teto tem base legal, e quem configura precisa ver isso na tela:
            sem a nota, 10 parece um limite arbitrario do produto — e o campo
            aceitava 120, o que permitia apagar 2h de HE trabalhada por dia. */}
        <p className="mt-2 text-xs text-slate-500">
          {t(
            `Capped at ${overtimeMaxMinutes} minutes: CLT art. 58 §1º tolerates about 5 minutes per punch and 10 minutes a day. Above that it is worked time and must be paid.`,
            `Limitado a ${overtimeMaxMinutes} minutos: a CLT (art. 58 §1º) tolera cerca de 5 minutos por marcacao e 10 minutos no dia. Acima disso e tempo trabalhado e deve ser pago.`
          )}
        </p>

        {overtimeSettingsError ? (
          <p className="mt-3 text-sm text-rose-600">{overtimeSettingsError}</p>
        ) : null}
        {overtimeSettingsNotice ? (
          <p className="mt-3 text-sm text-emerald-700">{overtimeSettingsNotice}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex min-h-[44px] items-center gap-2 rounded-2xl border border-slate-200 px-4 text-sm md:min-h-0 md:py-2">
            <input
              type="checkbox"
              checked={overtimeEnabled}
              onChange={(event) => {
                setOvertimeEnabled(event.target.checked)
                setOvertimeSettingsNotice('')
              }}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span>{t('Ignore short overtime', 'Desconsiderar hora extra curta')}</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span>{t('Minimum minutes', 'Minutos minimos')}</span>
            <input
              type="number"
              min={1}
              max={overtimeMaxMinutes}
              step={1}
              value={overtimeMinutesInput}
              disabled={!overtimeEnabled}
              onChange={(event) => {
                setOvertimeMinutesInput(event.target.value)
                setOvertimeSettingsNotice('')
              }}
              className="min-h-[44px] w-24 rounded-2xl border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50 disabled:text-slate-400 md:min-h-0 md:py-2"
            />
          </label>

          <button
            type="button"
            onClick={saveOvertimeSettings}
            disabled={savingOvertimeSettings}
            className="min-h-[44px] rounded-full bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50 md:min-h-0 md:py-2"
          >
            {savingOvertimeSettings ? t('Saving...', 'Salvando...') : t('Save', 'Salvar')}
          </button>
        </div>

        {/* O que esta GRAVADO, nao o que esta digitado. Marcar o checkbox sem
            salvar era visualmente identico a ter salvo, e a unica forma de
            saber a verdade era consultar o banco. */}
        <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
          <p className="text-sm text-slate-700">
            <span className="font-semibold">{t('Saved rule:', 'Regra gravada:')}</span>{' '}
            {savedOvertimeMinutes
              ? t(
                  `overtime under ${savedOvertimeMinutes} minutes a day is ignored`,
                  `hora extra abaixo de ${savedOvertimeMinutes} minutos no dia e ignorada`
                )
              : t('off — all overtime counts', 'desligada — toda hora extra conta')}
          </p>
          {/* Quando a regra passou a valer. Vale para o desligamento tambem:
              "desde quando esta desligada" e uma pergunta igualmente legitima. */}
          {overtimeUpdatedAt ? (
            <p className="mt-1 text-xs text-slate-500">
              {t('Last changed on', 'Ultima alteracao em')}{' '}
              {new Date(overtimeUpdatedAt).toLocaleString(locale, {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </p>
          ) : null}
          {hasUnsavedOvertimeChange ? (
            <p className="mt-1 text-xs font-semibold text-amber-700">
              {t('You have unsaved changes. Click Save.', 'Ha alteracao nao salva. Clique em Salvar.')}
            </p>
          ) : null}
        </div>

        <p className="mt-3 text-xs text-slate-500">
          {t(
            'Applies to new calculations. Past days only change when they are recalculated.',
            'Vale para novos calculos. Dias passados so mudam quando forem recalculados.'
          )}
        </p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as KpiPeriod)}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="daily">{t('Daily', 'Diario')}</option>
            <option value="weekly">{t('Weekly', 'Semanal')}</option>
            <option value="monthly">{t('Monthly', 'Mensal')}</option>
          </select>

          <button
            onClick={() => loadData().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          >
            {t('Refresh', 'Atualizar')}
          </button>
        </div>

        {loading ? <p className="mt-3 text-sm text-slate-500">{t('Loading data...', 'Carregando dados...')}</p> : null}
        {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
        {notice ? <p className="mt-3 text-xs text-emerald-600">{notice}</p> : null}
      </div>

      {kpiPayload ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Expected', 'Previsto')}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatMinutesLabel(kpiPayload.summary.expectedMinutes)}
            </p>
          </div>
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Worked', 'Realizado')}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatMinutesLabel(kpiPayload.summary.workedMinutes)}
            </p>
          </div>
          <div className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Overtime', 'Horas extras')}</p>
            <p className="mt-2 text-2xl font-semibold text-rose-700">
              {formatMinutesLabel(kpiPayload.summary.overtimeMinutes)}
            </p>
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">
          {t('Hours and balances by user', 'Horas e saldo por usuario')}
        </h3>

        <div className="mt-4 space-y-3">
          {combinedRows.length === 0 ? (
            <p className="text-sm text-slate-500">
              {t('No team member found for the selected period.', 'Nenhum colaborador encontrado para o periodo selecionado.')}
            </p>
          ) : (
            combinedRows.map((row) => (
              <div key={row.userId} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{row.name}</p>
                    <p className="text-xs text-slate-500">{row.email}</p>
                    <p className="mt-1 text-xs text-slate-600">Role: {row.role}</p>
                  </div>

                  <button
                    onClick={() => handlePayPendingBankHours(row.userId)}
                    disabled={Boolean(bankPayLoadingByUser[row.userId]) || row.pendingMinutes <= 0}
                    className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {bankPayLoadingByUser[row.userId]
                      ? t('Processing...', 'Processando...')
                      : t('Post pending payout', 'Dar baixa pendente')}
                  </button>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-slate-700 md:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{t('Expected', 'Previsto')}</p>
                    <p className="mt-1 font-semibold">{formatMinutesLabel(row.expectedMinutes)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{t('Worked', 'Realizado')}</p>
                    <p className="mt-1 font-semibold">{formatMinutesLabel(row.workedMinutes)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{t('OT', 'HE')}</p>
                    <p className="mt-1 font-semibold text-rose-700">{formatMinutesLabel(row.overtimeMinutes)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{t('Balance', 'Saldo')}</p>
                    <p className="mt-1 font-semibold">{formatMinutesLabel(row.balanceMinutes)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{t('Pending', 'Pendente')}</p>
                    <p className="mt-1 font-semibold text-amber-700">{formatMinutesLabel(row.pendingMinutes)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{t('Paid', 'Pago')}</p>
                    <p className="mt-1 font-semibold text-emerald-700">{formatMinutesLabel(row.paidMinutes)}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

export default AdminBankHoursPage
