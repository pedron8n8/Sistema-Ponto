import { buildTimeline, type JourneyEntry } from '../lib/journey'

type ModalEntry = JourneyEntry & {
  user?: { name?: string }
  breakMinutes?: number | null
}

type Props = {
  entry: ModalEntry
  onClose: () => void
  t: (en: string, pt: string) => string
  locale: string
}

const fmtHM = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`

const JourneyModal = ({ entry, onClose, t, locale }: Props) => {
  const timeline = buildTimeline(entry)
  const fmtTime = (d: Date) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const workedMin = entry.clockOut
    ? Math.max(0, Math.round((new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()) / 60000) - (entry.breakMinutes || 0))
    : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            {entry.user?.name ? <p className="text-sm font-semibold text-slate-900">{entry.user.name}</p> : null}
            <p className="text-xs text-slate-500">
              {new Date(entry.clockIn).toLocaleDateString(locale, {
                weekday: 'short',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}{' '}
              · {t('Worked:', 'Trabalhado:')} {fmtHM(workedMin)}
              {(entry.overtimeMinutes ?? 0) > 0 ? ` · ${t('OT', 'HE')} ${fmtHM(entry.overtimeMinutes || 0)}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          {t('Journey', 'Jornada')}
        </p>
        {timeline.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {timeline.map((seg, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span
                  className={
                    seg.type === 'work'
                      ? 'w-16 rounded-full bg-teal-100 px-2 py-0.5 text-center font-semibold text-teal-700'
                      : seg.type === 'ot'
                        ? 'w-16 rounded-full bg-amber-100 px-2 py-0.5 text-center font-semibold text-amber-700'
                        : 'w-16 rounded-full bg-slate-100 px-2 py-0.5 text-center font-semibold text-slate-500'
                  }
                >
                  {seg.type === 'work' ? t('Work', 'Trabalho') : seg.type === 'ot' ? t('OT', 'HE') : t('Pause', 'Pausa')}
                </span>
                <span className="text-slate-600">
                  {fmtTime(seg.start)} – {fmtTime(seg.end)}
                </span>
                <span className="text-slate-400">
                  ({fmtHM(Math.round((seg.end.getTime() - seg.start.getTime()) / 60000))})
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-500">{t('No detail available.', 'Sem detalhe disponivel.')}</p>
        )}
        {/* ponytail: pontos manuais/legados não têm breaks — mostra só o agregado */}
        {(!entry.breaks || entry.breaks.length === 0) && (entry.breakMinutes ?? 0) > 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            {t('Total pause:', 'Pausa total:')} {fmtHM(entry.breakMinutes || 0)}{' '}
            {t('(exact times unavailable)', '(horarios exatos indisponiveis)')}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export default JourneyModal
