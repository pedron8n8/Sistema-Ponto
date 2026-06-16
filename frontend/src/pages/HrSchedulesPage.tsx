import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { TIME_ZONE_OPTIONS } from '../lib/timezone'
import { useTranslation } from 'react-i18next'

type HrMember = {
  id: string
  name: string
  email: string
  role: string
  contractDailyMinutes?: number
  workdayStartTime?: string | null
  workdayEndTime?: string | null
  timeZone?: string
  hourlyRate?: number | null
}

type ScheduleForm = {
  contractDailyHours: string
  workdayStartTime: string
  workdayEndTime: string
  timeZone: string
  hourlyRate: string
}

const formatMinutesToHours = (minutes?: number) => {
  if (!minutes || minutes <= 0) return ''
  const hours = Math.floor(minutes / 60)
  const mins = Math.max(0, minutes % 60)
  return `${hours}:${String(mins).padStart(2, '0')}`
}

const parseHoursToMinutes = (value: string) => {
  const normalized = value.trim()
  if (!normalized) return null
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (minutes < 0 || minutes > 59) return null
  const total = hours * 60 + minutes
  if (total < 60 || total > 1440) return null
  return total
}

const emptyForm: ScheduleForm = {
  contractDailyHours: '',
  workdayStartTime: '',
  workdayEndTime: '',
  timeZone: 'America/Chicago',
  hourlyRate: '',
}

const HrSchedulesPage = () => {
  const { session } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token

  const [members, setMembers] = useState<HrMember[]>([])
  const [formByUser, setFormByUser] = useState<Record<string, ScheduleForm>>({})
  const [savingByUser, setSavingByUser] = useState<Record<string, boolean>>({})
  const [errorByUser, setErrorByUser] = useState<Record<string, string>>({})
  const [noticeByUser, setNoticeByUser] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const hydrate = (list: HrMember[]) => {
    setFormByUser((prev) => {
      const next: Record<string, ScheduleForm> = { ...prev }
      for (const m of list) {
        next[m.id] = {
          contractDailyHours: formatMinutesToHours(m.contractDailyMinutes),
          workdayStartTime: m.workdayStartTime || '',
          workdayEndTime: m.workdayEndTime || '',
          timeZone: m.timeZone || 'America/Chicago',
          hourlyRate: m.hourlyRate != null ? String(m.hourlyRate) : '',
        }
      }
      return next
    })
  }

  const loadMembers = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch<{ members: HrMember[] }>('/hr/team', { token })
      const list = response.members || []
      setMembers(list)
      hydrate(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to load team.', 'Erro ao carregar a equipe.'))
      setMembers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMembers().catch(() => undefined)
  }, [token])

  const updateField = (userId: string, field: keyof ScheduleForm, value: string) => {
    setFormByUser((prev) => ({
      ...prev,
      [userId]: { ...(prev[userId] || emptyForm), [field]: value },
    }))
  }

  const handleSave = async (userId: string) => {
    if (!token) return
    const current = formByUser[userId]
    if (!current) return

    setErrorByUser((prev) => ({ ...prev, [userId]: '' }))
    setNoticeByUser((prev) => ({ ...prev, [userId]: '' }))
    setSavingByUser((prev) => ({ ...prev, [userId]: true }))

    try {
      const body: Record<string, unknown> = {}

      if (current.contractDailyHours.trim() !== '') {
        const parsed = parseHoursToMinutes(current.contractDailyHours)
        if (parsed === null) {
          setErrorByUser((prev) => ({
            ...prev,
            [userId]: t('Invalid workday. Use hh:mm (e.g. 8:20).', 'Jornada inválida. Use hh:mm (ex.: 8:20).'),
          }))
          return
        }
        body.contractDailyMinutes = parsed
      }
      if (current.workdayStartTime.trim() !== '') body.workdayStartTime = current.workdayStartTime.trim()
      if (current.workdayEndTime.trim() !== '') body.workdayEndTime = current.workdayEndTime.trim()
      if (current.timeZone.trim() !== '') body.timeZone = current.timeZone.trim()
      if (current.hourlyRate.trim() !== '') {
        const rate = Number(current.hourlyRate.replace(',', '.'))
        if (!Number.isFinite(rate) || rate < 0) {
          setErrorByUser((prev) => ({
            ...prev,
            [userId]: t('Invalid hourly rate.', 'Valor/hora inválido.'),
          }))
          return
        }
        body.hourlyRate = rate
      }

      if (Object.keys(body).length === 0) {
        setErrorByUser((prev) => ({
          ...prev,
          [userId]: t('Fill at least one field before saving.', 'Preencha ao menos um campo para salvar.'),
        }))
        return
      }

      await apiFetch(`/hr/users/${userId}/work-settings`, { token, method: 'PATCH', body })
      setNoticeByUser((prev) => ({
        ...prev,
        [userId]: t('Schedule updated successfully.', 'Jornada atualizada com sucesso.'),
      }))
      await loadMembers()
    } catch (err) {
      setErrorByUser((prev) => ({
        ...prev,
        [userId]: err instanceof Error ? err.message : t('Failed to update schedule.', 'Erro ao atualizar a jornada.'),
      }))
    } finally {
      setSavingByUser((prev) => ({ ...prev, [userId]: false }))
    }
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('HR', 'RH')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{t('Employee schedules', 'Jornadas dos colaboradores')}</h2>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'Set contracted workday, start/end time, timezone and hourly rate for each employee.',
            'Defina jornada contratual, horário de início/fim, fuso e valor/hora de cada colaborador.'
          )}
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div>
      ) : null}

      <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">{t('Schedules', 'Jornadas')}</h3>
          <button
            onClick={() => loadMembers().catch(() => undefined)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
          >
            {t('Refresh', 'Atualizar')}
          </button>
        </div>

        {loading && members.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t('Loading team...', 'Carregando equipe...')}</p>
        ) : null}

        <div className="mt-5 space-y-3">
          {members.length === 0 && !loading ? (
            <p className="text-sm text-slate-500">{t('No employees available.', 'Nenhum colaborador disponível.')}</p>
          ) : (
            members.map((member) => (
              <div key={member.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{member.name}</p>
                    <p className="text-xs text-slate-500">{member.email}</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-[10px] uppercase tracking-wide text-slate-500">
                    {member.role}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-6 md:items-center">
                  <input
                    type="text"
                    value={formByUser[member.id]?.contractDailyHours || ''}
                    onChange={(e) => updateField(member.id, 'contractDailyHours', e.target.value)}
                    placeholder={t('Workday hh:mm', 'Jornada hh:mm')}
                    className="w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                  />
                  <input
                    type="time"
                    value={formByUser[member.id]?.workdayStartTime || ''}
                    onChange={(e) => updateField(member.id, 'workdayStartTime', e.target.value)}
                    className="w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                  />
                  <input
                    type="time"
                    value={formByUser[member.id]?.workdayEndTime || ''}
                    onChange={(e) => updateField(member.id, 'workdayEndTime', e.target.value)}
                    className="w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                  />
                  <select
                    value={formByUser[member.id]?.timeZone || 'America/Chicago'}
                    onChange={(e) => updateField(member.id, 'timeZone', e.target.value)}
                    className="w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                  >
                    {TIME_ZONE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formByUser[member.id]?.hourlyRate || ''}
                    onChange={(e) => updateField(member.id, 'hourlyRate', e.target.value)}
                    placeholder={t('Hourly rate', 'Valor/hora')}
                    className="w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                  />
                  <button
                    onClick={() => handleSave(member.id)}
                    disabled={Boolean(savingByUser[member.id])}
                    className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {savingByUser[member.id] ? t('Saving...', 'Salvando...') : t('Save', 'Salvar')}
                  </button>
                </div>

                {errorByUser[member.id] ? (
                  <p className="mt-2 text-xs text-rose-600">{errorByUser[member.id]}</p>
                ) : null}
                {noticeByUser[member.id] ? (
                  <p className="mt-2 text-xs text-emerald-600">{noticeByUser[member.id]}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

export default HrSchedulesPage
