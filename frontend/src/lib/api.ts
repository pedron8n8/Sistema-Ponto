export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000/api/v1'

const IDEMPOTENCY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const IDEMPOTENCY_KEY_HEADER = 'X-Idempotency-Key'
const IDEMPOTENCY_DATE_HEADER = 'X-Idempotency-Date'

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

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Object.prototype.toString.call(value) === '[object Object]'
}

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return 'null'

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return JSON.stringify('__NON_FINITE_NUMBER__')
    return JSON.stringify(value)
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort()
    const serialized = keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')
    return `{${serialized}}`
  }

  return JSON.stringify(value)
}

const normalizeBodyForHash = (body: unknown): unknown => {
  if (body === undefined) return null

  try {
    const serialized = JSON.stringify(body)
    if (serialized === undefined) return null
    return JSON.parse(serialized)
  } catch (error) {
    return null
  }
}

const toHex = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const sha256Hex = async (rawValue: string): Promise<string> => {
  const encoded = new TextEncoder().encode(rawValue)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  return toHex(hashBuffer)
}

export const buildIdempotencyHeaders = async (body: unknown): Promise<Record<string, string>> => {
  const idempotencyDate = new Date().toISOString().slice(0, 10)
  const normalizedBody = normalizeBodyForHash(body)
  const hashInput = `${idempotencyDate}|${stableStringify(normalizedBody)}`
  const idempotencyKey = await sha256Hex(hashInput)

  return {
    [IDEMPOTENCY_DATE_HEADER]: idempotencyDate,
    [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
  }
}

export const apiFetch = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15000
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const method = (options.method ?? 'GET').toUpperCase()
  const idempotencyHeaders =
    IDEMPOTENCY_METHODS.has(method) && options.body !== undefined
      ? await buildIdempotencyHeaders(options.body)
      : {}

  let res: Response

  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...idempotencyHeaders,
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
