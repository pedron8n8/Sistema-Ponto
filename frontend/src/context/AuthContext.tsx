import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import i18next from 'i18next'
import {
  supabase,
  hasSupabaseEnv,
  isGoogleProviderEnabled,
  googleOAuthRedirectTo,
} from '../lib/supabase'
import { apiFetch, resolveApiAssetUrl } from '../lib/api'

type Role = 'SUPERADMIN' | 'ADMIN' | 'HR' | 'SUPERVISOR' | 'MEMBER'

type UserProfile = {
  id: string
  email: string
  name: string
  phone?: string | null
  role: Role
  photoUrl?: string | null
  photoUpdatedAt?: string | null
  supervisor?: {
    id: string
    email: string
    name: string
    role: Role
  } | null
  createdAt?: string
  currentPlan?: 'BASE' | 'STARTER' | 'GROWTH' | 'PRO' | string
  currentPlanStatus?: 'ACTIVE' | 'INACTIVE' | string
}

type SignUpPayload = {
  name: string
  email: string
  password: string
  phone?: string
  inviteToken?: string
}

type AuthState = {
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  profileError: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (payload: SignUpPayload) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

const isPortugueseLanguage = () => {
  const language = String(i18next.resolvedLanguage || i18next.language || '').toLowerCase()
  return language.startsWith('pt')
}

const localizeMessage = (en: string, pt: string) => (isPortugueseLanguage() ? pt : en)

const validateStrongPassword = (password: string) => {
  const normalized = String(password || '')
  if (normalized.length < 12) {
    return localizeMessage(
      'Password must have at least 12 characters.',
      'Senha deve ter pelo menos 12 caracteres.'
    )
  }

  const hasUppercase = /[A-Z]/.test(normalized)
  const hasLowercase = /[a-z]/.test(normalized)
  const hasDigit = /\d/.test(normalized)
  const hasSpecial = /[^A-Za-z0-9]/.test(normalized)

  if (!hasUppercase || !hasLowercase || !hasDigit || !hasSpecial) {
    return localizeMessage(
      'Password must include uppercase, lowercase, number and special character.',
      'Senha deve conter letra maiuscula, minuscula, numero e caractere especial.'
    )
  }

  return null
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = async (activeSession: Session | null) => {
    if (!activeSession?.access_token) {
      setProfile(null)
      setProfileError(null)
      return
    }

    try {
      const response = await apiFetch<{ user: UserProfile }>('/auth/me', {
        token: activeSession.access_token,
        timeoutMs: 8000,
      })

      setProfile({
        ...response.user,
        photoUrl: resolveApiAssetUrl(response.user.photoUrl),
      })
      setProfileError(null)
    } catch (err) {
      setProfile(null)
      setProfileError(
        err instanceof Error
          ? err.message
          : localizeMessage('Could not load profile.', 'Nao foi possivel carregar o perfil')
      )
    }
  }

  useEffect(() => {
    if (!hasSupabaseEnv || !supabase) {
      setLoading(false)
      setProfile(null)
      setProfileError(
        localizeMessage(
          'Supabase variables are not configured in the frontend.',
          'Variaveis do Supabase nao configuradas no frontend.'
        )
      )
      return
    }

    const supabaseClient = supabase

    const init = async () => {
      const { data } = await supabaseClient.auth.getSession()
      setSession(data.session ?? null)
      setLoading(false)
      fetchProfile(data.session ?? null).catch(() => undefined)
    }

    init()

    const { data: subscription } = supabaseClient.auth.onAuthStateChange(
      async (_event, nextSession) => {
        setSession(nextSession)
        await fetchProfile(nextSession)
      }
    )

    return () => subscription.subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    if (!supabase) {
      throw new Error(
        localizeMessage(
          'Supabase is not configured in the frontend.',
          'Supabase nao configurado no frontend'
        )
      )
    }
    console.log('Signing in with email:', email)
    console.log('Supabase client:', supabase)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      console.log('Mensagem:', error.message)
      throw new Error(error.message)
    }

    setSession(data.session)
    await fetchProfile(data.session)
  }

  const signUp = async ({ name, email, password, phone, inviteToken }: SignUpPayload) => {
    if (!supabase) {
      throw new Error(
        localizeMessage(
          'Supabase is not configured in the frontend.',
          'Supabase nao configurado no frontend'
        )
      )
    }

    const normalizedName = String(name || '').trim()
    const normalizedEmail = String(email || '').trim().toLowerCase()
    const normalizedPassword = String(password || '')
    const normalizedPhone = String(phone || '').trim()
    const normalizedInviteToken = String(inviteToken || '').trim()

    if (normalizedName.length < 2) {
      throw new Error(localizeMessage('Name must have at least 2 characters.', 'Nome deve ter pelo menos 2 caracteres'))
    }

    if (!normalizedEmail.includes('@')) {
      throw new Error(localizeMessage('Invalid email address.', 'Email invalido'))
    }

    const passwordValidationError = validateStrongPassword(normalizedPassword)
    if (passwordValidationError) {
      throw new Error(passwordValidationError)
    }

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: normalizedPassword,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: {
          name: normalizedName,
          ...(normalizedPhone ? { phone: normalizedPhone } : {}),
          ...(normalizedInviteToken ? { teamInviteToken: normalizedInviteToken } : {}),
        },
      },
    })

    if (error) {
      throw new Error(error.message)
    }

    if (data.session) {
      setSession(data.session)
      await fetchProfile(data.session)
    }
  }

  const signInWithGoogle = async () => {
    if (!supabase) {
      throw new Error(
        localizeMessage(
          'Supabase is not configured in the frontend.',
          'Supabase nao configurado no frontend'
        )
      )
    }

    const googleProviderEnabled = await isGoogleProviderEnabled()
    if (!googleProviderEnabled) {
      throw new Error('GOOGLE_PROVIDER_DISABLED')
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: googleOAuthRedirectTo,
        skipBrowserRedirect: true,
      },
    })

    if (error) {
      throw new Error(error.message)
    }

    if (!data?.url) {
      throw new Error(
        localizeMessage(
          'Could not start Google sign-in flow.',
          'Nao foi possivel iniciar o login com Google'
        )
      )
    }

    window.location.assign(data.url)
  }

  const signOut = async () => {
    if (!supabase) {
      setSession(null)
      setProfile(null)
      setProfileError(
        localizeMessage(
          'Supabase is not configured in the frontend.',
          'Supabase nao configurado no frontend'
        )
      )
      return
    }

    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    setProfileError(null)
  }

  const refreshProfile = async () => {
    await fetchProfile(session)
  }

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      profileError,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, profileError]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return ctx
}
