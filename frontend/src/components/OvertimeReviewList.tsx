import { useTranslation } from 'react-i18next'

// Superficie unica de revisao de hora extra, usada pela aba "Hora extra" da tela
// de pendencias e pela pagina dedicada /app/supervisor/overtime. Ficou como
// componente porque as duas telas mostram a MESMA decisao: duplicar a lista
// deixaria as regras (comentario minimo, ordem HE-antes-do-ponto) divergindo
// entre elas.
//
// A decisao de HE e por registro de proposito. Nao existe endpoint de HE em
// lote: a aprovacao do periodo inteiro, que decide a HE junto, continua vivendo
// na aba de trabalho normal.

export type OvertimeEntry = {
  id: string
  user: { id?: string; name: string; email: string }
  clockIn: string
  clockOut: string | null
  workedMinutes?: number | null
  overtimeMinutes?: number | null
  overtimeMinutes50?: number | null
  overtimeMinutes100?: number | null
  overtimeStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null
}

type Props = {
  entries: OvertimeEntry[]
  comment: Record<string, string>
  onCommentChange: (entryId: string, value: string) => void
  onDecision: (entryId: string, decision: 'APPROVE' | 'REJECT') => void
  loadingByEntry: Record<string, boolean>
  locale: string
  emptyLabel?: string
}

const fmtHM = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`

const MIN_DENY_COMMENT = 5

const OvertimeReviewList = ({
  entries,
  comment,
  onCommentChange,
  onDecision,
  loadingByEntry,
  locale,
  emptyLabel,
}: Props) => {
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)

  const fmtDateTime = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '--'

  const statusTone = (entry: OvertimeEntry) =>
    entry.overtimeStatus === 'APPROVED'
      ? 'bg-emerald-50 text-emerald-700'
      : entry.overtimeStatus === 'REJECTED'
        ? 'bg-rose-50 text-rose-700'
        : 'bg-amber-50 text-amber-700'

  const statusLabel = (entry: OvertimeEntry) =>
    entry.overtimeStatus === 'APPROVED'
      ? t('Overtime approved', 'HE aprovada')
      : entry.overtimeStatus === 'REJECTED'
        ? t('Overtime denied', 'HE negada')
        : t('Overtime pending', 'HE pendente')

  if (entries.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        {emptyLabel || t('No overtime to review in this period.', 'Nenhuma hora extra para revisar neste periodo.')}
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {entries.map((entry) => {
        const otMinutes = entry.overtimeMinutes ?? 0
        const ot50 = entry.overtimeMinutes50 ?? 0
        const ot100 = entry.overtimeMinutes100 ?? 0
        const isPending = entry.overtimeStatus === 'PENDING'
        const busy = Boolean(loadingByEntry[entry.id])
        const denyComment = (comment[entry.id] || '').trim()

        return (
          <li
            key={entry.id}
            className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm backdrop-blur"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{entry.user.name || entry.user.email}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {fmtDateTime(entry.clockIn)} &rarr; {fmtDateTime(entry.clockOut)}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${statusTone(entry)}`}>
                {statusLabel(entry)}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-slate-100 px-3 py-1">
                {t('Overtime', 'Hora extra')} {fmtHM(otMinutes)}
              </span>
              {ot50 > 0 ? <span className="rounded-full bg-slate-100 px-3 py-1">50% {fmtHM(ot50)}</span> : null}
              {ot100 > 0 ? <span className="rounded-full bg-slate-100 px-3 py-1">100% {fmtHM(ot100)}</span> : null}
              <span className="rounded-full bg-slate-100 px-3 py-1">
                {t('Recognized', 'Reconhecido')} {fmtHM(entry.workedMinutes ?? 0)}
              </span>
            </div>

            {isPending ? (
              <div className="mt-4 space-y-2">
                {/* Negar exige justificativa de 5 caracteres (o backend devolve 400
                    sem ela); o mesmo campo serve de comentario opcional do aprovar. */}
                <input
                  type="text"
                  value={comment[entry.id] || ''}
                  onChange={(event) => onCommentChange(entry.id, event.target.value)}
                  placeholder={t('Reason (required to deny)', 'Justificativa (obrigatoria para negar)')}
                  aria-label={t('Overtime decision reason', 'Justificativa da decisao de hora extra')}
                  className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm md:min-h-0"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onDecision(entry.id, 'APPROVE')}
                    disabled={busy}
                    className="min-h-[44px] flex-1 rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50 md:min-h-0 md:flex-none md:py-2"
                  >
                    {t('Approve overtime', 'Aprovar HE')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDecision(entry.id, 'REJECT')}
                    disabled={busy || denyComment.length < MIN_DENY_COMMENT}
                    title={
                      denyComment.length < MIN_DENY_COMMENT
                        ? t('A reason of at least 5 characters is required.', 'Informe justificativa de pelo menos 5 caracteres.')
                        : undefined
                    }
                    className="min-h-[44px] flex-1 rounded-xl border border-rose-200 px-4 text-sm font-medium text-rose-700 disabled:opacity-50 md:min-h-0 md:flex-none md:py-2"
                  >
                    {t('Deny overtime', 'Negar HE')}
                  </button>
                </div>
                {/* O efeito da negacao mudou: alem de nao pagar, o tempo negado sai
                    do total reconhecido. Dizer isso antes da decisao evita a
                    surpresa de ver o total do periodo encolher depois. */}
                <p className="text-xs text-slate-500">
                  {t(
                    'Denying removes these minutes from the recognized total.',
                    'Negar remove estes minutos do total reconhecido.'
                  )}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                {entry.overtimeStatus === 'REJECTED'
                  ? t(
                      'Denied: these minutes are out of the recognized total.',
                      'Negada: estes minutos estao fora do total reconhecido.'
                    )
                  : t('Already decided.', 'Ja decidida.')}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default OvertimeReviewList
