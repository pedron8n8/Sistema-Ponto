export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000/api/v1'

type RequestOptions = {
  token?: string
  method?: string
  body?: unknown
}

export const apiFetch = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(payload?.message || 'Erro na requisicao')
  }

  return res.json() as Promise<T>
}
