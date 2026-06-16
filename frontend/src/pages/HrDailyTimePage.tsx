import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'

type HrEntry = {
  id: string
  userId: string
  clockIn: string
  clockOut: string | null
  notes: string | null
  status: string
  breakMinutes: number
  workedMinutes: number
  overtimeMinutes: number
  overtimeMinutes50: number
  overtimeMinutes100: number
  bankHoursAccruedMinutes: number
}

type HrMember = { id: string; name: string; email: string; role: string }

type DateRow = {
  user: { id: string; name: string; email: string; role: string }
  entries: HrEntry[]
  totals: { workedMinutes: number; overtimeMinutes: number; workedLabel: string; overtimeLabel: string }
}

type UserDay = {
  date: string
  entries: HrEntry[]
  workedMinutes: number
  overtimeMinutes: number
  workedLabel: string
  overtimeLabel: string
}

const pad = (n: number) => String(n).padStart(2, '0')

const toLocalInput = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fromLocalInput = (value: string) => {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const formatMinutes = (minutes: number) => {
  const total = Math.max(0, Math.floor(minutes || 0))
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

/** Editor inline de um registro existente. */
const EntryEditor = ({
  entry,
  token,
  t,
  onChanged,
}: {
  entry: HrEntry
  token: string
  t: (en: string, pt: string) => string
  onChanged: () => void
}) => {
  const [clockIn, setClockIn] = useState(toLocalInput(entry.clockIn))
  const [clockOut, setClockOut] = useState(toLocalInput(entry.clockOut))
  const [breakMinutes, setBreakMinutes] = useState(String(entry.breakMinutes ?? 0))
  const [notes, setNotes] = useState(entry.notes || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const save = async () => {
    setBusy(true)
    setMsg('')
    try {
      const body: Record<string, unknown> = {
        clockIn: fromLocalInput(clockIn),
        clockOut: fromLocalInput(clockOut),
        breakMinutes: Number(breakMinutes) || 0,
        notes,
      }
      await apiFetch(`/hr/entries/${entry.id}`, { token, method: 'PATCH', body })
      setMsg(t('Saved.', 'Salvo.'))
      onChanged()
    } catch {
      /* apiFetch já exibe o erro via toast */
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(t('Delete this time entry?', 'Excluir este registro de ponto?'))) return
    setBusy(true)
    try {
      await apiFetch(`/hr/entries/${entry.id}`, { token, method: 'DELETE' })
      onChanged()
    } catch {
      /* idem */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3">
      <div className="grid gap-2 text-xs text-slate-500 md:grid-cols-4 md:items-center">
        <label className="flex flex-col gap-1">
          <span>{t('Clock in', 'Entrada')}</span>
          <input
            type="datetime-local"
            value={clockIn}
            onChange={(e) => setClockIn(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('Clock out', 'Saída')}</span>
          <input
            type="datetime-local"
            value={clockOut}
            onChange={(e) => setClockOut(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('Break (min)', 'Intervalo (min)')}</span>
          <input
            type="number"
            min="0"
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('Notes', 'Notas')}</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="rounded-full bg-slate-50 px-2 py-0.5">
          {t('Worked', 'Trabalhado')}: {formatMinutes(entry.workedMinutes)}
        </span>
        <span className="rounded-full bg-slate-50 px-2 py-0.5">
          {t('Overtime', 'Extra')}: {formatMinutes(entry.overtimeMinutes)}
        </span>
        <span className="rounded-full bg-slate-50 px-2 py-0.5">{entry.status}</span>
        <div className="ml-auto flex items-center gap-2">
          {msg ? <span className="text-emerald-600">{msg}</span> : null}
          <button
            onClick={save}
            disabled={busy}
            className="rounded-full bg-teal-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? t('Saving...', 'Salvando...') : t('Save', 'Salvar')}
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50"
          >
            {t('Delete', 'Excluir')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Formulário para adicionar um registro esquecido. */
const AddEntryForm = ({
  userId,
  token,
  t,
  defaultDate,
  onAdded,
}: {
  userId: string
  token: string
  t: (en: string, pt: string) => string
  defaultDate: string
  onAdded: () => void
}) => {
  const [open, setOpen] = useState(false)
  const [clockIn, setClockIn] = useState(`${defaultDate}T09:00`)
  const [clockOut, setClockOut] = useState(`${defaultDate}T17:00`)
  const [breakMinutes, setBreakMinutes] = useState('0')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await apiFetch(`/hr/users/${userId}/entries`, {
        token,
        method: 'POST',
        body: {
          clockIn: fromLocalInput(clockIn),
          clockOut: fromLocalInput(clockOut),
          breakMinutes: Number(breakMinutes) || 0,
          notes,
        },
      })
      setOpen(false)
      onAdded()
    } catch {
      /* apiFetch já exibe o erro */
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700"
      >
        + {t('Add entry', 'Adicionar registro')}
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-teal-100 bg-teal-50/40 p-3">
      <div className="grid gap-2 text-xs text-slate-500 md:grid-cols-4 md:items-end">
        <label className="flex flex-col gap-1">
          <span>{t('Clock in', 'Entrada')}</span>
          <input type="datetime-local" value={clockIn} onChange={(e) => setClockIn(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs" />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('Clock out', 'Saída')}</span>
          <input type="datetime-local" value={clockOut} onChange={(e) => setClockOut(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs" />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('Break (min)', 'Intervalo (min)')}</span>
          <input type="number" min="0" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs" />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('Notes', 'Notas')}</span>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs" />
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={submit} disabled={busy} className="rounded-full bg-teal-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? t('Adding...', 'Adicionando...') : t('Create', 'Criar')}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
          {t('Cancel', 'Cancelar')}
        </button>
      </div>
    </div>
  )
}

const HrDailyTimePage = () => {
  const { session } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token

  const [view, setView] = useState<'date' | 'employee'>('date')
  const [members, setMembers] = useState<HrMember[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Date-first view
  const [selectedDate, setSelectedDate] = useState(todayKey())
  const [dateRows, setDateRows] = useState<DateRow[]>([])

  // Employee-first view
  const [selectedUserId, setSelectedUserId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [userDays, setUserDays] = useState<UserDay[]>([])

  const loadMembers = async () => {
    if (!token) return
    try {
      const response = await apiFetch<{ members: HrMember[] }>('/hr/team', { token })
      const list = response.members || []
      setMembers(list)
      if (!selectedUserId && list.length) setSelectedUserId(list[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to load team.', 'Erro ao carregar a equipe.'))
    }
  }

  const loadDateView = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch<{ rows: DateRow[] }>(`/hr/daily?date=${selectedDate}`, { token })
      setDateRows(response.rows || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to load daily view.', 'Erro ao carregar a visão diária.'))
      setDateRows([])
    } finally {
      setLoading(false)
    }
  }

  const loadEmployeeView = async () => {
    if (!token || !selectedUserId) return
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      const qs = params.toString()
      const response = await apiFetch<{ days: UserDay[] }>(
        `/hr/users/${selectedUserId}/daily${qs ? `?${qs}` : ''}`,
        { token }
      )
      setUserDays(response.days || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to load employee entries.', 'Erro ao carregar registros.'))
      setUserDays([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMembers().catch(() => undefined)
  }, [token])

  useEffect(() => {
    if (view === 'date') loadDateView().catch(() => undefined)
  }, [token, view, selectedDate])

  useEffect(() => {
    if (view === 'employee') loadEmployeeView().catch(() => undefined)
  }, [token, view, selectedUserId, startDate, endDate])

  const refreshCurrent = () => {
    if (view === 'date') loadDateView().catch(() => undefined)
    else loadEmployeeView().catch(() => undefined)
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('HR', 'RH')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{t('Daily time', 'Tempo diário')}</h2>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'Review and, when needed, correct the time worked. Edits are applied and approved immediately.',
            'Confira e, se necessário, corrija o tempo trabalhado. As edições são aplicadas e aprovadas imediatamente.'
          )}
        </p>

        <div className="mt-5 inline-flex rounded-full border border-slate-200 bg-white p-1 text-xs">
          <button
            onClick={() => setView('date')}
            className={`rounded-full px-4 py-1.5 font-semibold ${view === 'date' ? 'bg-teal-700 text-white' : 'text-slate-600'}`}
          >
            {t('By date', 'Por data')}
          </button>
          <button
            onClick={() => setView('employee')}
            className={`rounded-full px-4 py-1.5 font-semibold ${view === 'employee' ? 'bg-teal-700 text-white' : 'text-slate-600'}`}
          >
            {t('By employee', 'Por colaborador')}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div>
      ) : null}

      {view === 'date' ? (
        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              {t('Date', 'Data')}
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
              />
            </label>
            <button
              onClick={refreshCurrent}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
            >
              {t('Refresh', 'Atualizar')}
            </button>
          </div>

          {loading ? <p className="mt-4 text-sm text-slate-500">{t('Loading...', 'Carregando...')}</p> : null}

          <div className="mt-5 space-y-4">
            {!loading && dateRows.length === 0 ? (
              <p className="text-sm text-slate-500">{t('No employees found.', 'Nenhum colaborador encontrado.')}</p>
            ) : null}
            {dateRows.map((row) => (
              <div key={row.user.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{row.user.name}</p>
                    <p className="text-xs text-slate-500">{row.user.email}</p>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-600">
                    <span className="rounded-full bg-white px-2 py-0.5">
                      {t('Worked', 'Trabalhado')}: {row.totals.workedLabel}
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5">
                      {t('Overtime', 'Extra')}: {row.totals.overtimeLabel}
                    </span>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {row.entries.length === 0 ? (
                    <p className="text-xs text-slate-400">{t('No entries this day.', 'Sem registros neste dia.')}</p>
                  ) : (
                    row.entries.map((entry) => (
                      <EntryEditor key={entry.id} entry={entry} token={token!} t={t} onChanged={refreshCurrent} />
                    ))
                  )}
                </div>

                <div className="mt-3">
                  <AddEntryForm userId={row.user.id} token={token!} t={t} defaultDate={selectedDate} onAdded={refreshCurrent} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              {t('Employee', 'Colaborador')}
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.email})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              {t('From', 'De')}
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs" />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              {t('To', 'Até')}
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs" />
            </label>
            <button
              onClick={refreshCurrent}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
            >
              {t('Refresh', 'Atualizar')}
            </button>
          </div>

          {loading ? <p className="mt-4 text-sm text-slate-500">{t('Loading...', 'Carregando...')}</p> : null}

          {selectedUserId ? (
            <div className="mt-3">
              <AddEntryForm userId={selectedUserId} token={token!} t={t} defaultDate={endDate || todayKey()} onAdded={refreshCurrent} />
            </div>
          ) : null}

          <div className="mt-5 space-y-4">
            {!loading && userDays.length === 0 ? (
              <p className="text-sm text-slate-500">{t('No entries in range.', 'Sem registros no período.')}</p>
            ) : null}
            {userDays.map((day) => (
              <div key={day.date} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">{day.date}</p>
                  <div className="flex items-center gap-2 text-[11px] text-slate-600">
                    <span className="rounded-full bg-white px-2 py-0.5">
                      {t('Worked', 'Trabalhado')}: {day.workedLabel}
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5">
                      {t('Overtime', 'Extra')}: {day.overtimeLabel}
                    </span>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {day.entries.map((entry) => (
                    <EntryEditor key={entry.id} entry={entry} token={token!} t={t} onChanged={refreshCurrent} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default HrDailyTimePage
