import { useEffect, useMemo, useState } from 'react'
import { apiFetch, translateApiMessage } from '../lib/api'
import {
  OVERTIME_BUFFER_DEFAULT,
  OVERTIME_BUFFER_MAX,
  fetchOvertimeSettings,
  parseBufferMinutes,
  saveOvertimeSettings,
} from '../lib/overtimeSettings'
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
  const { session, profile } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const locale = isPt ? 'pt-BR' : 'en-US'
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token

  // Esta tela e alcancavel por ADMIN e por INTEGRATOR, mas as duas metades dela
  // tem guards diferentes no backend: /admin/overtime-settings (tolerancia de
  // hora extra) concede ['ADMIN','INTEGRATOR'], enquanto /admin/bank-hours/overview
  // e o pagamento de pendencia ficam abaixo do router.use(roleCheck(['ADMIN'])).
  //
  // O flag existe para NAO pedir o que vai voltar 403: `loadData` usava um
  // Promise.all, entao o 403 do overview derrubava junto o KPI de horas — que o
  // INTEGRATOR TEM direito de ver, porque /supervisor/kpis/hours lista 'HR' e o
  // roleCheck expande HR para INTEGRATOR. O resultado era uma tela de erro para
  // quem tinha permissao, mais um toast do apiFetch em cada abertura.
  const canManageBankHours = profile?.role === 'ADMIN' || profile?.role === 'SUPERADMIN'

  const [period, setPeriod] = useState<KpiPeriod>('weekly')

  // Tolerancia (buffer) de hora extra da conta: minutos acima da jornada que
  // nao viram HE. 15 e o padrao do backend quando nunca foi configurado; 0 desliga.
  const [overtimeBufferInput, setOvertimeBufferInput] = useState(String(OVERTIME_BUFFER_DEFAULT))
  const [savedOvertimeBuffer, setSavedOvertimeBuffer] = useState<number | null>(null)
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
        // Sem o `canManageBankHours` este item era um 403 garantido para o
        // INTEGRATOR e, por ser Promise.all, levava o KPI embora com ele.
        canManageBankHours
          ? apiFetch<{ overview: BankHoursOverviewItem[] }>('/admin/bank-hours/overview', { token })
          : Promise.resolve({ overview: [] as BankHoursOverviewItem[] }),
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

  // `canManageBankHours` na lista de dependencias: o profile chega por uma requisicao
  // separada da sessao, entao um ADMIN podia rodar o primeiro loadData com o
  // flag ainda false e ficar sem o overview ate mexer no filtro de periodo.
  useEffect(() => {
    loadData().catch(() => undefined)
  }, [token, period, canManageBankHours])

  // Estado REALMENTE gravado, separado do estado do formulario. Sem isso a
  // tela so mostra o que voce digitou, e digitar sem salvar fica visualmente
  // identico a ter salvo.
  const applyOvertimeSettings = (bufferMinutes: number) => {
    setSavedOvertimeBuffer(bufferMinutes)
    setOvertimeBufferInput(String(bufferMinutes))
  }

  const loadOvertimeSettings = async () => {
    if (!token) return
    try {
      applyOvertimeSettings(await fetchOvertimeSettings(token))
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

  const handleSaveOvertimeSettings = async () => {
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

    const parsed = parseBufferMinutes(overtimeBufferInput)
    if (parsed === null) {
      setOvertimeSettingsError(
        t(
          `Enter a whole number of minutes between 0 and ${OVERTIME_BUFFER_MAX}.`,
          `Informe um numero inteiro de minutos entre 0 e ${OVERTIME_BUFFER_MAX}.`
        )
      )
      return
    }

    setSavingOvertimeSettings(true)
    try {
      const response = await saveOvertimeSettings(token, parsed)
      const saved = response.overtimeSettings.bufferMinutes
      applyOvertimeSettings(saved)
      setOvertimeSettingsNotice(
        saved > 0
          ? t(
              `Overtime up to ${saved} minutes in a day does not count.`,
              `Hora extra de ate ${saved} minutos no dia nao conta.`
            )
          : t('Tolerance turned off: every extra minute counts.', 'Tolerancia desligada: todo minuto extra conta.')
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

  const hasUnsavedOvertimeChange =
    savedOvertimeBuffer !== null && parseBufferMinutes(overtimeBufferInput) !== savedOvertimeBuffer

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

      {/* Tolerancia de HE: politica de jornada da CONTA inteira, por isso mora
          na tela de politica de horas e nao no cadastro de cada colaborador.
          A mesma configuracao tambem e editavel no painel do ADMIN. */}
      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">
          {t('Overtime tolerance', 'Tolerancia de hora extra')}
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          {t(
            'Minutes past the daily contract that do not generate overtime. It is a trigger, not a discount: crossing it counts the full amount.',
            'Minutos acima da jornada diaria que nao geram hora extra. E um gatilho, nao um desconto: ao cruzar, conta o valor cheio.'
          )}
        </p>

        {overtimeSettingsError ? (
          <p className="mt-3 text-sm text-rose-600">{overtimeSettingsError}</p>
        ) : null}
        {overtimeSettingsNotice ? (
          <p className="mt-3 text-sm text-emerald-700">{overtimeSettingsNotice}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span>{t('Tolerance (minutes)', 'Tolerancia (minutos)')}</span>
            <input
              type="number"
              min={0}
              max={OVERTIME_BUFFER_MAX}
              step={1}
              value={overtimeBufferInput}
              onChange={(event) => {
                setOvertimeBufferInput(event.target.value)
                setOvertimeSettingsNotice('')
              }}
              className="min-h-[44px] w-24 rounded-2xl border border-slate-200 bg-white px-3 text-sm md:min-h-0 md:py-2"
            />
            <span className="text-xs text-slate-500">
              {t(`default ${OVERTIME_BUFFER_DEFAULT} min; 0 turns it off`, `padrao ${OVERTIME_BUFFER_DEFAULT} min; 0 desliga`)}
            </span>
          </label>

          <button
            type="button"
            onClick={handleSaveOvertimeSettings}
            disabled={savingOvertimeSettings}
            className="min-h-[44px] rounded-full bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50 md:min-h-0 md:py-2"
          >
            {savingOvertimeSettings ? t('Saving...', 'Salvando...') : t('Save', 'Salvar')}
          </button>
        </div>

        {/* O que esta GRAVADO, nao o que esta digitado. Digitar sem salvar era
            visualmente identico a ter salvo. */}
        <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
          <p className="text-sm text-slate-700">
            <span className="font-semibold">{t('Saved rule:', 'Regra gravada:')}</span>{' '}
            {savedOvertimeBuffer === null
              ? t('loading...', 'carregando...')
              : savedOvertimeBuffer > 0
                ? t(
                    `overtime up to ${savedOvertimeBuffer} minutes in a day does not count`,
                    `hora extra de ate ${savedOvertimeBuffer} minutos no dia nao conta`
                  )
                : t('off — every extra minute counts', 'desligada — todo minuto extra conta')}
          </p>
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
          {canManageBankHours
            ? t('Hours and balances by user', 'Horas e saldo por usuario')
            : /* Sem saldo na tabela, prometer "e saldo" no titulo seria mentir. */
              t('Hours by user', 'Horas por usuario')}
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
                    {/* `role` so existe na linha do overview. Quando o overview
                        nao foi carregado, `combinedRows` devolve '-', e
                        "Role: -" em toda linha parece dado corrompido. */}
                    {row.role !== '-' ? (
                      <p className="mt-1 text-xs text-slate-600">Role: {row.role}</p>
                    ) : null}
                  </div>

                  {/* Dar baixa e PATCH /admin/users/:id/bank-hours/pay, abaixo
                      do roleCheck(['ADMIN']). Escondido em vez de desabilitado
                      porque um botao habilitado que sempre volta 403 ensina o
                      INTEGRATOR a ignorar toast de erro. */}
                  {canManageBankHours ? (
                    <button
                      onClick={() => handlePayPendingBankHours(row.userId)}
                      disabled={Boolean(bankPayLoadingByUser[row.userId]) || row.pendingMinutes <= 0}
                      className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {bankPayLoadingByUser[row.userId]
                        ? t('Processing...', 'Processando...')
                        : t('Post pending payout', 'Dar baixa pendente')}
                    </button>
                  ) : null}
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
                  {/* Saldo/Pendente/Pago vem SO de /admin/bank-hours/overview.
                      Sem o overview, `combinedRows` preenche esses tres campos
                      com 0 (fallback `|| 0`), e "Saldo 00:00" para quem nunca
                      recebeu o dado leria como saldo zerado de verdade. */}
                  {canManageBankHours ? (
                    <>
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
                    </>
                  ) : null}
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
