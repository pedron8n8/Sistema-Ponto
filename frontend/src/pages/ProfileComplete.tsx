import { useEffect, useState, type ChangeEvent } from 'react'
import { apiFetch, apiFetchFormData, resolveApiAssetUrl } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import UserAvatar from '../components/UserAvatar'
import { useTranslation } from 'react-i18next'

type Role = 'SUPERADMIN' | 'ADMIN' | 'HR' | 'SUPERVISOR' | 'MEMBER'

type CompleteProfile = {
  id: string
  email: string
  name: string
  role: Role
  photoUrl?: string | null
  photoUpdatedAt?: string | null
  supervisorId?: string | null
  supervisor?: {
    id: string
    name: string
    email: string
    role: Role
  } | null
  contractDailyMinutes?: number
  workdayStartTime?: string | null
  workdayEndTime?: string | null
  timeZone?: string
  createdAt?: string
}

const formatDateTime = (iso: string | null | undefined, locale: string, notInformedLabel: string) => {
  if (!iso) return notInformedLabel
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return notInformedLabel
  return date.toLocaleString(locale)
}

const ProfileComplete = () => {
  const { session, refreshProfile } = useAuth()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const locale = isPt ? 'pt-BR' : 'en-US'
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const token = session?.access_token

  const [profile, setProfile] = useState<CompleteProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [savingAccount, setSavingAccount] = useState(false)
  const [isEditingAccount, setIsEditingAccount] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [accountError, setAccountError] = useState('')
  const [accountNotice, setAccountNotice] = useState('')
  const [accountForm, setAccountForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })

  const loadProfile = async () => {
    if (!token) return

    setLoading(true)
    setError('')
    try {
      const response = await apiFetch<{ user: CompleteProfile }>('/users/me/profile-complete', {
        token,
      })
      setProfile({
        ...response.user,
        photoUrl: resolveApiAssetUrl(response.user.photoUrl),
      })
      setAccountForm((previous) => ({
        ...previous,
        name: response.user.name || '',
        email: response.user.email || '',
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not load profile.', 'Erro ao carregar perfil'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfile().catch(() => undefined)
  }, [token])

  const handleUploadPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !token) return

    setError('')
    setNotice('')

    const maxBytes = 5 * 1024 * 1024
    if (file.size > maxBytes) {
      setError(t('File larger than 5MB. Choose a smaller image.', 'Arquivo maior que 5MB. Escolha uma imagem menor.'))
      return
    }

    const payload = new FormData()
    payload.append('photo', file)

    setUploading(true)
    try {
      await apiFetchFormData<{ message: string }>('/users/me/photo', {
        token,
        method: 'POST',
        body: payload,
      })

      await loadProfile()
      await refreshProfile()
      setNotice(t('Photo updated successfully.', 'Foto atualizada com sucesso.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not upload photo.', 'Erro ao enviar foto'))
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const handleDeletePhoto = async () => {
    if (!token) return

    setError('')
    setNotice('')
    setUploading(true)

    try {
      await apiFetch<{ message: string }>('/users/me/photo', {
        token,
        method: 'DELETE',
      })
      await loadProfile()
      await refreshProfile()
      setNotice(t('Photo removed successfully.', 'Foto removida com sucesso.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not remove photo.', 'Erro ao remover foto'))
    } finally {
      setUploading(false)
    }
  }

  const handleAccountInput = (field: 'name' | 'email' | 'password' | 'confirmPassword', value: string) => {
    setAccountForm((previous) => ({
      ...previous,
      [field]: value,
    }))
  }

  const handleSaveAccount = async () => {
    if (!token || !profile) return

    setAccountError('')
    setAccountNotice('')

    const nextName = accountForm.name.trim()
    const nextEmail = accountForm.email.trim().toLowerCase()
    const nextPassword = accountForm.password
    const confirmPassword = accountForm.confirmPassword

    if (nextName.length < 2) {
      setAccountError(t('Name must have at least 2 characters.', 'Nome deve ter pelo menos 2 caracteres.'))
      return
    }

    if (!nextEmail.includes('@')) {
      setAccountError(t('Provide a valid email.', 'Informe um email valido.'))
      return
    }

    if (nextPassword.length > 0 && nextPassword.length < 6) {
      setAccountError(t('Password must have at least 6 characters.', 'Senha deve ter pelo menos 6 caracteres.'))
      return
    }

    if (nextPassword.length > 0 && nextPassword !== confirmPassword) {
      setAccountError(t('Password confirmation does not match.', 'A confirmacao de senha nao confere.'))
      return
    }

    const payload: { name?: string; email?: string; password?: string } = {}

    if (nextName !== profile.name) payload.name = nextName
    if (nextEmail !== profile.email) payload.email = nextEmail
    if (nextPassword.length > 0) payload.password = nextPassword

    if (Object.keys(payload).length === 0) {
      setAccountNotice(t('No changes to save.', 'Nenhuma alteracao para salvar.'))
      return
    }

    setSavingAccount(true)
    try {
      await apiFetch<{ message: string; user: CompleteProfile }>('/users/me/account', {
        token,
        method: 'PATCH',
        body: payload,
      })

      await loadProfile()
      await refreshProfile()

      setAccountForm((previous) => ({
        ...previous,
        password: '',
        confirmPassword: '',
      }))
      setIsEditingAccount(false)
      setAccountNotice(t('Account data updated successfully.', 'Dados da conta atualizados com sucesso.'))
    } catch (err) {
      setAccountError(
        err instanceof Error
          ? err.message
          : t('Could not update account data.', 'Erro ao atualizar dados da conta')
      )
    } finally {
      setSavingAccount(false)
    }
  }

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Profile', 'Perfil')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{t('Complete profile', 'Perfil completo')}</h2>
        <p className="mt-3 text-sm text-slate-600">
          {t(
            'Manage your photo and view complete account details.',
            'Gerencie sua foto e visualize os dados completos da sua conta.'
          )}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">{t('User photo', 'Foto do usuario')}</h3>
          <div className="mt-4 flex items-center gap-4">
            <UserAvatar name={profile?.name} photoUrl={profile?.photoUrl} size="lg" />
            <div>
              <p className="text-sm font-semibold text-slate-800">{profile?.name || '-'}</p>
              <p className="text-xs text-slate-500">{profile?.email || '-'}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {t('Last update:', 'Ultima atualizacao:')}{' '}
                {formatDateTime(profile?.photoUpdatedAt, locale, t('Not informed', 'Nao informado'))}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <label className="cursor-pointer rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800">
              {uploading ? t('Uploading...', 'Enviando...') : t('Upload photo', 'Enviar foto')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleUploadPhoto}
                disabled={uploading}
                className="hidden"
              />
            </label>
            <button
              onClick={handleDeletePhoto}
              disabled={uploading || !profile?.photoUrl}
              className="rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
            >
              {t('Remove photo', 'Remover foto')}
            </button>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            {t('Accepted formats: JPG, PNG, WEBP. Max size: 5MB.', 'Formatos aceitos: JPG, PNG, WEBP. Tamanho maximo: 5MB.')}
          </p>

          {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
          {notice ? <p className="mt-3 text-xs text-emerald-600">{notice}</p> : null}
        </div>

        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-900">{t('Account data', 'Dados da conta')}</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setIsEditingAccount((prev) => {
                    const next = !prev
                    if (!next && profile) {
                      setAccountForm((previous) => ({
                        ...previous,
                        name: profile.name,
                        email: profile.email,
                        password: '',
                        confirmPassword: '',
                      }))
                      setAccountError('')
                    }
                    return next
                  })
                }}
                className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700"
              >
                {isEditingAccount ? t('Cancel', 'Cancelar') : t('Edit', 'Editar')}
              </button>
              <button
                onClick={() => loadProfile().catch(() => undefined)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
              >
                {t('Refresh', 'Atualizar')}
              </button>
            </div>
          </div>

          {loading ? <p className="mt-3 text-sm text-slate-500">{t('Loading profile...', 'Carregando perfil...')}</p> : null}

          <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Name', 'Nome')}</p>
              <p className="mt-1 font-semibold text-slate-900">{profile?.name || '-'}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Email', 'Email')}</p>
              <p className="mt-1 font-semibold text-slate-900">{profile?.email || '-'}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Role', 'Cargo')}</p>
              <p className="mt-1 font-semibold text-slate-900">{profile?.role || '-'}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Supervisor', 'Supervisor')}</p>
              <p className="mt-1 font-semibold text-slate-900">
                {profile?.supervisor?.name || t('Not informed', 'Nao informado')}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Daily workload', 'Jornada diaria')}</p>
              <p className="mt-1 font-semibold text-slate-900">{profile?.contractDailyMinutes || 0} min</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Time zone', 'Fuso horario')}</p>
              <p className="mt-1 font-semibold text-slate-900">{profile?.timeZone || t('Not informed', 'Nao informado')}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Default start', 'Entrada padrao')}</p>
              <p className="mt-1 font-semibold text-slate-900">
                {profile?.workdayStartTime || t('Not informed', 'Nao informado')}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Default end', 'Saida padrao')}</p>
              <p className="mt-1 font-semibold text-slate-900">
                {profile?.workdayEndTime || t('Not informed', 'Nao informado')}
              </p>
            </div>
          </div>

          {isEditingAccount ? (
            <div className="mt-5 rounded-2xl border border-teal-100 bg-teal-50/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">
                {t('Edit data', 'Editar dados')}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs text-slate-600">
                  {t('Name', 'Nome')}
                  <input
                    type="text"
                    value={accountForm.name}
                    onChange={(event) => handleAccountInput('name', event.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                  />
                </label>

                <label className="grid gap-1 text-xs text-slate-600">
                  {t('Email', 'Email')}
                  <input
                    type="email"
                    value={accountForm.email}
                    onChange={(event) => handleAccountInput('email', event.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                  />
                </label>

                <label className="grid gap-1 text-xs text-slate-600">
                  {t('New password', 'Nova senha')}
                  <input
                    type="password"
                    value={accountForm.password}
                    onChange={(event) => handleAccountInput('password', event.target.value)}
                    placeholder={t('Optional', 'Opcional')}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                  />
                </label>

                <label className="grid gap-1 text-xs text-slate-600">
                  {t('Confirm password', 'Confirmar senha')}
                  <input
                    type="password"
                    value={accountForm.confirmPassword}
                    onChange={(event) => handleAccountInput('confirmPassword', event.target.value)}
                    placeholder={t('Repeat password', 'Repita a senha')}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                  />
                </label>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleSaveAccount}
                  disabled={savingAccount}
                  className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {savingAccount ? t('Saving...', 'Salvando...') : t('Save changes', 'Salvar alteracoes')}
                </button>
              </div>

              {accountError ? <p className="mt-3 text-xs text-rose-600">{accountError}</p> : null}
              {accountNotice ? <p className="mt-3 text-xs text-emerald-600">{accountNotice}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default ProfileComplete
