export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000/api/v1'

type RequestOptions = {
  token?: string
  method?: string
  body?: unknown
  timeoutMs?: number
}

type FormDataRequestOptions = {
  token?: string
  method?: string
  body: FormData
  timeoutMs?: number
}

export const apiFetch = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15000
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response

  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Tempo de resposta excedido. Verifique se o backend está ativo.')
    }
    throw error
  }

  clearTimeout(timeoutId)

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(payload?.message || 'Erro na requisicao')
  }

  return res.json() as Promise<T>
}

export const apiFetchFormData = async <T>(
  path: string,
  options: FormDataRequestOptions
): Promise<T> => {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15000
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response

  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'POST',
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body,
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Tempo de resposta excedido. Verifique se o backend está ativo.')
    }
    throw error
  }

  clearTimeout(timeoutId)

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(payload?.message || 'Erro na requisicao')
  }

  return res.json() as Promise<T>
}

export const resolveApiAssetUrl = (rawUrl?: string | null) => {
  if (!rawUrl) return null
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl

  const apiRoot = new URL(API_BASE)
  const origin = `${apiRoot.protocol}//${apiRoot.host}`
  const normalizedPath = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
  return `${origin}${normalizedPath}`
}
