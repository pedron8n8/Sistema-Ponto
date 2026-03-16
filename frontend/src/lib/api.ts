export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000/api/v1'

type RequestOptions = {
  token?: string
  method?: string
  body?: unknown
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
