import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, hasSupabaseEnv } from '../lib/supabase'
import { apiFetch, resolveApiAssetUrl } from '../lib/api'

type Role = 'SUPERADMIN' | 'ADMIN' | 'HR' | 'SUPERVISOR' | 'MEMBER'

type UserProfile = {
  id: string
  email: string
  name: string
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

type AuthState = {
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  profileError: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

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
      setProfileError(err instanceof Error ? err.message : 'Nao foi possivel carregar o perfil')
    }
  }

  useEffect(() => {
    if (!hasSupabaseEnv || !supabase) {
      setLoading(false)
      setProfile(null)
      setProfileError('Variaveis do Supabase nao configuradas no frontend.')
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
      throw new Error('Supabase nao configurado no frontend')
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      throw new Error(error.message)
    }

    setSession(data.session)
    await fetchProfile(data.session)
  }

  const signUp = async (email: string, password: string) => {
    if (!supabase) {
      throw new Error('Supabase nao configurado no frontend')
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
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
      throw new Error('Supabase nao configurado no frontend')
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/app`,
      },
    })

    if (error) {
      throw new Error(error.message)
    }
  }

  const signOut = async () => {
    if (!supabase) {
      setSession(null)
      setProfile(null)
      setProfileError('Supabase nao configurado no frontend')
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
