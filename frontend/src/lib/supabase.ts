import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const supabaseGoogleCallbackUrl = supabaseUrl
  ? new URL('/auth/v1/callback', supabaseUrl).toString()
  : ''

const PROVIDER_STATE_CACHE_TTL_MS = 60 * 1000

let cachedGoogleProviderEnabled: boolean | null = null
let cachedGoogleProviderCheckedAt = 0

export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseKey)
export const googleOAuthRedirectTo = supabaseGoogleCallbackUrl

export const supabase = hasSupabaseEnv
  ? createClient(supabaseUrl as string, supabaseKey as string)
  : null

const resolveProviderEnabled = (providerConfig: unknown): boolean | null => {
  if (typeof providerConfig === 'boolean') {
    return providerConfig
  }

  if (
    providerConfig &&
    typeof providerConfig === 'object' &&
    'enabled' in providerConfig &&
    typeof (providerConfig as { enabled?: unknown }).enabled === 'boolean'
  ) {
    return Boolean((providerConfig as { enabled: boolean }).enabled)
  }

  return null
}

export const isGoogleProviderEnabled = async () => {
  if (!hasSupabaseEnv || !supabaseUrl || !supabaseKey) {
    return false
  }

  const now = Date.now()
  const hasFreshCache =
    cachedGoogleProviderEnabled !== null && now - cachedGoogleProviderCheckedAt < PROVIDER_STATE_CACHE_TTL_MS

  if (hasFreshCache) {
    return cachedGoogleProviderEnabled
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    })

    if (!response.ok) {
      return true
    }

    const settings = (await response.json()) as {
      external?: {
        google?: boolean | { enabled?: boolean }
      }
    }

    const resolved = resolveProviderEnabled(settings?.external?.google)

    if (resolved === null) {
      return true
    }

    cachedGoogleProviderEnabled = resolved
    cachedGoogleProviderCheckedAt = now

    return resolved
  } catch {
    return true
  }
}
