import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import OvertimeReviewList, { type OvertimeEntry } from '../components/OvertimeReviewList'

// Janela propria da hora extra, separada do trabalho normal. A tela de
// pendencias continua sendo o lugar do ponto em si (aprovar/negar o registro,
// pedir ajuste, aprovar o periodo inteiro); aqui so se decide hora extra.
//
// Reaproveita GET /supervisor/entries e filtra no cliente por overtimeStatus: o
// endpoint nao tem filtro de HE, e criar um seria superficie nova de API para um
// recorte que a listagem do periodo ja traz.

type Subordinate = { id: string; name: string; email: string; supervisorId?: string | null }

type OvertimeFilter = 'PENDING' | 'DECIDED' | 'ALL'

const toYmd = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const startOfCurrentWeek = () => {
  const now = new Date()
  const weekday = (now.getDay() + 6) % 7 // 0 = segunda
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday)
}

const fmtHM = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`

// GET /supervisor/entries pagina, e antes esta tela nao paginava: mandava
// `limit=500` e jogava fora o `pagination.total` da resposta. Uma equipe com
// mais de 500 marcacoes no periodo tinha a fila cortada em silencio — o item
// 501 nunca chegava a `entries`, e como os contadores "Pendentes N" e
// "HE pendente Xh" sao derivados de `entries`, eles subcontavam junto. A fila
// truncada era indistinguivel de uma fila terminada.
const PAGE_SIZE = 200

const SupervisorOvertimePage = () => {
  const { session } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const locale = isPt ? 'pt-BR' : 'en-US'
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token

  const [entries, setEntries] = useState<OvertimeEntry[]>([])
  const [subordinates, setSubordinates] = useState<Subordinate[]>([])
  // Total do SERVIDOR no periodo, nao o que caiu na pagina. E a unica coisa
  // capaz de denunciar que a lista na tela esta incompleta.
  const [serverTotal, setServerTotal] = useState(0)
  // Quantas paginas estao na tela agora. Precisa ser lembrado porque, depois de
  // decidir uma HE, a lista tem de ser relida: reler so a pagina 1 devolveria o
  // revisor ao inicio de uma fila que ele tinha acabado de percorrer.
  const [pagesLoaded, setPagesLoaded] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [commentByEntry, setCommentByEntry] = useState<Record<string, string>>({})
  const [actionLoadingByEntry, setActionLoadingByEntry] = useState<Record<string, boolean>>({})

  const [overtimeFilter, setOvertimeFilter] = useState<OvertimeFilter>('PENDING')
  const [userId, setUserId] = useState('')
  const [startDate, setStartDate] = useState(() => toYmd(startOfCurrentWeek()))
  const [endDate, setEndDate] = useState(() => toYmd(new Date()))

  const fetchPage = async (page: number) => {
    const query = new URLSearchParams()
    // Sem filtro de status do ponto: a HE se decide ANTES do registro sair de
    // PENDING, mas uma HE ja decidida pode estar num registro aprovado, e a
    // aba "Decididas" tem que mostra-la.
    query.set('status', 'ALL')
    if (userId) query.set('userId', userId)
    query.set('startDate', startDate)
    query.set('endDate', endDate)
    query.set('limit', String(PAGE_SIZE))
    // `page`, 1-based, porque e o que o controller le:
    // `skip = (parseInt(page) - 1) * limit`. Mandar `offset` aqui nao daria
    // erro nenhum — seria ignorado em silencio, e todo "Carregar mais"
    // devolveria a pagina 1 de novo, duplicando a fila em vez de estende-la.
    query.set('page', String(page))

    return apiFetch<{
      entries: OvertimeEntry[]
      subordinates: Subordinate[]
      pagination?: { total?: number }
    }>(`/supervisor/entries?${query.toString()}`, { token })
  }

  // Carrega o intervalo fechado [fromPage, toPage]. `fromPage === 1` SUBSTITUI
  // a lista; acima disso concatena. Um caminho unico para os tres usos (abrir a
  // tela, "carregar mais" e reler depois de uma decisao) para que os contadores
  // nao possam divergir entre eles.
  const loadRange = async (fromPage: number, toPage: number) => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const collected: OvertimeEntry[] = []
      let subs: Subordinate[] | null = null
      let total = 0

      // Sequencial, nao em paralelo: as paginas sao fatias de um mesmo
      // ORDER BY, entao duas respostas tiradas de estados diferentes do banco
      // se misturariam na mesma lista (uma marcacao repetida, outra sumida).
      for (let page = fromPage; page <= toPage; page += 1) {
        const response = await fetchPage(page)
        collected.push(...(response.entries || []))
        if (response.subordinates) subs = response.subordinates
        total = response.pagination?.total ?? total
      }

      setEntries((prev) => (fromPage === 1 ? collected : [...prev, ...collected]))
      // Só sobrescreve o seletor de colaborador quando o campo realmente veio.
      // O seletor e o filtro que gerou esta requisicao: uma resposta que
      // omitisse `subordinates` zeraria as opcoes e o usuario perderia o
      // proprio filtro no meio da revisao.
      if (subs) setSubordinates(subs)
      setServerTotal(total)
      setPagesLoaded(toPage)
    } catch (err) {
      // Falha na primeira pagina significa que nao ha lista. Falha ao carregar
      // mais preserva o que ja estava na tela: apagar tudo por causa de um erro
      // de rede jogaria fora a leitura de quem estava no meio da fila.
      if (fromPage === 1) {
        setEntries([])
        setPagesLoaded(1)
      }
      setError(
        err instanceof Error ? err.message : t('Could not load overtime.', 'Erro ao carregar horas extras')
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Trocar filtro volta para a pagina 1 de proposito: `page` e um recorte do
    // resultado do filtro anterior e nao significa nada no novo.
    loadRange(1, 1).catch(() => undefined)
  }, [token, userId, startDate, endDate])

  const overtimeEntries = useMemo(
    () => entries.filter((entry) => entry.overtimeStatus || (entry.overtimeMinutes ?? 0) > 0),
    [entries]
  )

  const visibleEntries = useMemo(() => {
    if (overtimeFilter === 'PENDING') {
      return overtimeEntries.filter((entry) => entry.overtimeStatus === 'PENDING')
    }
    if (overtimeFilter === 'DECIDED') {
      return overtimeEntries.filter(
        (entry) => entry.overtimeStatus === 'APPROVED' || entry.overtimeStatus === 'REJECTED'
      )
    }
    return overtimeEntries
  }, [overtimeEntries, overtimeFilter])

  const pendingMinutes = useMemo(
    () =>
      overtimeEntries
        .filter((entry) => entry.overtimeStatus === 'PENDING')
        .reduce((acc, entry) => acc + (entry.overtimeMinutes ?? 0), 0),
    [overtimeEntries]
  )

  const pendingCount = useMemo(
    () => overtimeEntries.filter((entry) => entry.overtimeStatus === 'PENDING').length,
    [overtimeEntries]
  )

  // Os contadores acima sao derivados de `entries`, e `entries` pode ser um
  // pedaco do periodo. Enquanto for, eles sao um piso e nao um total — daí o
  // sufixo "+" e o aviso logo abaixo. Sem isso, "Pendentes 200" numa fila de
  // 640 e simplesmente um numero errado apresentado como final.
  const isPartialList = entries.length < serverTotal
  const partialSuffix = isPartialList ? '+' : ''

  const reviewOvertime = async (entryId: string, decision: 'APPROVE' | 'REJECT') => {
    if (!token) return

    const comment = (commentByEntry[entryId] || '').trim()
    if (decision === 'REJECT' && comment.length < 5) {
      setError(
        t(
          'To deny overtime, provide a comment with at least 5 characters.',
          'Para negar horas extras, informe comentario com pelo menos 5 caracteres.'
        )
      )
      return
    }

    setError('')
    setNotice('')
    setActionLoadingByEntry((prev) => ({ ...prev, [entryId]: true }))

    try {
      await apiFetch(`/supervisor/overtime/${entryId}/${decision === 'APPROVE' ? 'approve' : 'reject'}`, {
        token,
        method: 'PATCH',
        body: comment ? { comment } : {},
      })

      setNotice(
        decision === 'APPROVE'
          ? t('Overtime approved.', 'Horas extras aprovadas.')
          : t(
              'Overtime denied: the denied minutes left the recognized total.',
              'Horas extras negadas: os minutos negados sairam do total reconhecido.'
            )
      )
      setCommentByEntry((prev) => ({ ...prev, [entryId]: '' }))
      // Relê exatamente as paginas que estavam abertas. A decisao muda
      // workedMinutes e overtimeMinutes da linha no servidor, entao a lista tem
      // de vir do backend; mas encolhe-la para a pagina 1 obrigaria o revisor a
      // clicar "Carregar mais" outra vez depois de CADA decisao.
      await loadRange(1, pagesLoaded)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('Could not review overtime.', 'Erro ao revisar horas extras')
      )
    } finally {
      setActionLoadingByEntry((prev) => ({ ...prev, [entryId]: false }))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
          {t('Supervisor', 'Supervisor')}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{t('Overtime', 'Hora extra')}</h1>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'Decide overtime separately from the entry itself. Denied minutes leave the recognized total.',
            'Decida a hora extra separada do ponto em si. Os minutos negados saem do total reconhecido.'
          )}
        </p>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {t('Pending', 'Pendentes')} {pendingCount}
            {partialSuffix}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {t('Pending overtime', 'HE pendente')} {fmtHM(pendingMinutes)}
            {partialSuffix}
          </span>
        </div>

        {isPartialList ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-xs text-amber-700">
              {t(
                `Showing ${entries.length} of ${serverTotal} entries in this period — the counters above cover only what is loaded.`,
                `Mostrando ${entries.length} de ${serverTotal} marcacoes no periodo — os contadores acima cobrem so o que esta carregado.`
              )}
            </p>
            <button
              type="button"
              onClick={() => loadRange(pagesLoaded + 1, pagesLoaded + 1).catch(() => undefined)}
              disabled={loading}
              className="min-h-[44px] rounded-full border border-slate-200 bg-white px-4 text-xs font-medium text-slate-700 disabled:opacity-50 md:min-h-0 md:py-2"
            >
              {loading ? t('Loading...', 'Carregando...') : t('Load more', 'Carregar mais')}
            </button>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            aria-label={t('Filter overtime', 'Filtrar hora extra')}
            value={overtimeFilter}
            onChange={(event) => setOvertimeFilter(event.target.value as OvertimeFilter)}
            className="min-h-[44px] rounded-full border border-slate-200 bg-white px-3 text-xs md:min-h-0 md:py-2"
          >
            <option value="PENDING">{t('Pending', 'Pendentes')}</option>
            <option value="DECIDED">{t('Decided', 'Decididas')}</option>
            <option value="ALL">{t('All', 'Todas')}</option>
          </select>

          <select
            aria-label={t('Filter by member', 'Filtrar por colaborador')}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            className="min-h-[44px] rounded-full border border-slate-200 bg-white px-3 text-xs md:min-h-0 md:py-2"
          >
            <option value="">{t('All members', 'Todos os colaboradores')}</option>
            {subordinates.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name || member.email}
              </option>
            ))}
          </select>

          <input
            type="date"
            aria-label={t('Start date', 'Data inicial')}
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="min-h-[44px] rounded-full border border-slate-200 bg-white px-3 text-xs md:min-h-0 md:py-2"
          />
          <input
            type="date"
            aria-label={t('End date', 'Data final')}
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="min-h-[44px] rounded-full border border-slate-200 bg-white px-3 text-xs md:min-h-0 md:py-2"
          />
        </div>

        {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
        {notice ? <p className="mt-4 text-sm text-emerald-700">{notice}</p> : null}

        <div className="mt-5">
          {/* `entries.length === 0` no gate: com paginacao, `loading` tambem
              cobre o "carregar mais" e a releitura pos-decisao. Trocar a lista
              inteira por "Carregando..." nesses casos faria a fila piscar e
              tiraria da tela justamente a linha que acabou de ser decidida. */}
          {loading && entries.length === 0 ? (
            <p className="text-sm text-slate-500">{t('Loading...', 'Carregando...')}</p>
          ) : (
            <OvertimeReviewList
              entries={visibleEntries}
              comment={commentByEntry}
              onCommentChange={(entryId, value) =>
                setCommentByEntry((prev) => ({ ...prev, [entryId]: value }))
              }
              onDecision={reviewOvertime}
              loadingByEntry={actionLoadingByEntry}
              locale={locale}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default SupervisorOvertimePage
