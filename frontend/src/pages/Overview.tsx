import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { useTimeZone } from '../context/TimezoneContext'
import { formatDateTimeWithTimeZone } from '../lib/timezone'

type ApprovalLog = {
  id: string
  action: string
  comment?: string | null
  timestamp: string
}

type TimeEntry = {
  id: string
  clockIn: string
  clockOut: string | null
  notes?: string | null
  logs: ApprovalLog[]
}

const Overview = () => {
  const { profile, session } = useAuth()
  const { viewTimeZone } = useTimeZone()
  const token = session?.access_token

  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [notesDraftByEntry, setNotesDraftByEntry] = useState<Record<string, string>>({})
  const [loadingAdjustments, setLoadingAdjustments] = useState(false)
  const [savingByEntry, setSavingByEntry] = useState<Record<string, boolean>>({})
  const [adjustmentNotice, setAdjustmentNotice] = useState('')
  const [adjustmentError, setAdjustmentError] = useState('')

  const loadAdjustmentRequests = async () => {
    if (!token || profile?.role !== 'MEMBER') return

    setLoadingAdjustments(true)
    setAdjustmentError('')
    try {
      const response = await apiFetch<{ entries: TimeEntry[] }>('/time/me?limit=50', { token })
      const nextEntries = response.entries || []
      setEntries(nextEntries)
      setNotesDraftByEntry((prev) => {
        const next = { ...prev }
        for (const entry of nextEntries) {
          if (next[entry.id] === undefined) {
            next[entry.id] = entry.notes || ''
          }
        }
        return next
      })
    } catch (err) {
      setAdjustmentError(err instanceof Error ? err.message : 'Erro ao carregar solicitações de ajuste')
    } finally {
      setLoadingAdjustments(false)
    }
  }

  useEffect(() => {
    loadAdjustmentRequests().catch(() => undefined)
  }, [token, profile?.role])

  const pendingAdjustments = useMemo(() => {
    return entries.filter((entry) => entry.logs?.[0]?.action === 'EDIT_REQUESTED')
  }, [entries])

  const handleSaveNotes = async (entryId: string) => {
    if (!token) return

    const notes = (notesDraftByEntry[entryId] || '').trim()
    if (!notes) {
      setAdjustmentError('Preencha as notas antes de salvar o ajuste.')
      return
    }

    setAdjustmentError('')
    setAdjustmentNotice('')
    setSavingByEntry((prev) => ({ ...prev, [entryId]: true }))
    try {
      const response = await apiFetch<{ message: string }>(`/time/${entryId}/notes`, {
        token,
        method: 'PATCH',
        body: { notes },
      })
      setAdjustmentNotice(response.message || 'Notas ajustadas com sucesso.')
      await loadAdjustmentRequests()
    } catch (err) {
      setAdjustmentError(err instanceof Error ? err.message : 'Erro ao salvar ajuste de notas')
    } finally {
      setSavingByEntry((prev) => ({ ...prev, [entryId]: false }))
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">Visao geral</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">Oi {profile?.name || 'time'}.</h2>
        <p className="mt-4 text-sm text-slate-600">
          Selecione a area que voce precisa hoje. Mantemos o foco no essencial para reduzir atrito no dia a dia.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[
            { title: 'Colaborador', desc: 'Clock in/out e historico de jornadas.', to: '/app/colaborador' },
            { title: 'Supervisor', desc: 'Aprovacoes pendentes e revisoes.', to: '/app/supervisor' },
            { title: 'Admin', desc: 'Usuarios, roles e supervisores.', to: '/app/admin' },
            { title: 'Relatorios', desc: 'Exportacoes semanais e timesheets.', to: '/app/relatorios' },
          ].map((item) => (
            <Link
              key={item.title}
              to={item.to}
              className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 transition hover:border-slate-200"
            >
              <h3 className="text-sm font-semibold text-slate-800">{item.title}</h3>
              <p className="mt-2 text-xs text-slate-600">{item.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      <aside className="space-y-5">
        {profile?.role === 'MEMBER' ? (
          <div className="rounded-3xl border border-amber-300 bg-amber-50/90 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-amber-900">Solicitacoes de ajuste</h3>
              <span className="rounded-full bg-amber-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-900">
                {pendingAdjustments.length}
              </span>
            </div>
            <p className="mt-2 text-xs text-amber-800">
              Quando houver ajuste solicitado por supervisor/admin, voce pode editar somente as notas.
            </p>

            {loadingAdjustments ? <p className="mt-3 text-xs text-amber-800">Carregando...</p> : null}
            {adjustmentError ? <p className="mt-3 text-xs text-rose-700">{adjustmentError}</p> : null}
            {adjustmentNotice ? <p className="mt-3 text-xs text-emerald-700">{adjustmentNotice}</p> : null}

            <div className="mt-4 space-y-3">
              {pendingAdjustments.length === 0 ? (
                <p className="text-xs text-amber-800">Nenhuma solicitacao de ajuste pendente.</p>
              ) : (
                pendingAdjustments.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-amber-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-800">
                      Registro: {formatDateTimeWithTimeZone(entry.clockIn, viewTimeZone)}
                    </p>
                    <p className="mt-1 text-xs text-amber-900">
                      Motivo: {entry.logs?.[0]?.comment || 'Sem comentario informado'}
                    </p>
                    <label className="mt-3 block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Ajustar notas
                    </label>
                    <textarea
                      value={notesDraftByEntry[entry.id] || ''}
                      onChange={(event) =>
                        setNotesDraftByEntry((prev) => ({
                          ...prev,
                          [entry.id]: event.target.value,
                        }))
                      }
                      className="mt-2 h-20 w-full resize-none rounded-2xl border border-amber-200 px-3 py-2 text-xs outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
                    />
                    <button
                      onClick={() => handleSaveNotes(entry.id)}
                      disabled={Boolean(savingByEntry[entry.id])}
                      className="mt-3 rounded-full bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {savingByEntry[entry.id] ? 'Salvando...' : 'Enviar ajuste'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Seu perfil</h3>
          <p className="mt-2 text-sm text-slate-600">Role ativa: {profile?.role || '---'}</p>
          <div className="mt-5 grid gap-2 text-xs text-slate-500">
            <span>Email: {profile?.email || '-'}</span>
            <span>Supervisor: {profile?.supervisor?.name || 'Nao informado'}</span>
          </div>
        </div>
        <div className="rounded-3xl border border-slate-100 bg-slate-900 p-6 text-white shadow-sm">
          <p className="text-xs uppercase tracking-[0.3em] text-teal-200">Experiencia</p>
          <p className="mt-3 text-sm text-slate-100">
            Interfaces leves, com contraste suave e foco na acao principal.
          </p>
        </div>
      </aside>
    </section>
  )
}

export default Overview
