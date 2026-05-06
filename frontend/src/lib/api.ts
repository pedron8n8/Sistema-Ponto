import i18next from 'i18next'
import { toast } from 'sonner'

export const API_BASE = import.meta.env.DEV
  ? '/api/v1'
  : (import.meta.env.VITE_API_URL as string | undefined) || 'https://api.omnipunt.com/api/v1'

const IDEMPOTENCY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const IDEMPOTENCY_KEY_HEADER = 'X-Idempotency-Key'
const IDEMPOTENCY_DATE_HEADER = 'X-Idempotency-Date'

const isPortugueseLanguage = () => {
  const language = String(i18next.resolvedLanguage || i18next.language || '').toLowerCase()
  return language.startsWith('pt')
}

const localizeMessage = (en: string, pt: string) => (isPortugueseLanguage() ? pt : en)

const PT_TO_EN_ERROR_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /token de autentica(?:c|ç)[aã]o n[aã]o fornecido/i,
    replacement: 'Authentication token was not provided.',
  },
  {
    pattern: /token inv[aá]lido ou expirado/i,
    replacement: 'Invalid or expired authentication token.',
  },
  {
    pattern: /usu[aá]rio n[aã]o encontrado/i,
    replacement: 'User not found.',
  },
  {
    pattern: /usu[aá]rio desativado/i,
    replacement: 'User account is disabled. Please contact your team administrator.',
  },
  {
    pattern: /email inv[aá]lido/i,
    replacement: 'Invalid email address.',
  },
  {
    pattern: /senha deve ter pelo menos/i,
    replacement: 'Password must have at least 6 characters.',
  },
  {
    pattern: /nome deve ter pelo menos/i,
    replacement: 'Name must have at least 2 characters.',
  },
  {
    pattern: /muitas requisi(?:c|ç)[oõ]es/i,
    replacement: 'Too many requests. Try again shortly.',
  },
  {
    pattern: /j[aá] existe solicita(?:c|ç)[aã]o.*sobreposta/i,
    replacement: 'There is already an overlapping vacation/day-off request for this period.',
  },
  {
    pattern: /solicita(?:c|ç)[aã]o de folga deve ser para um [uú]nico dia/i,
    replacement: 'Day-off request must be for a single day.',
  },
  {
    pattern: /você n[aã]o possui supervisor associado/i,
    replacement: 'You do not have an assigned supervisor to review this request.',
  },
  {
    pattern: /erro ao carregar/i,
    replacement: 'Failed to load data.',
  },
  {
    pattern: /erro ao atualizar/i,
    replacement: 'Failed to update data.',
  },
  {
    pattern: /erro ao revisar/i,
    replacement: 'Failed to review the request.',
  },
  {
    pattern: /erro ao (criar|salvar|remover|resetar|definir)/i,
    replacement: 'Operation failed. Please try again.',
  },
  {
    pattern: /requisi(?:c|ç)[aã]o inv[aá]lida/i,
    replacement: 'Invalid request.',
  },
  {
    pattern: /coment[aá]rio obrigat[óo]rio/i,
    replacement: 'Comment is required for this action.',
  },
  {
    pattern: /(apenas|somente)\s+admin/i,
    replacement: 'Only ADMIN can perform this action.',
  },
  {
    pattern: /(apenas|somente)\s+superadmin/i,
    replacement: 'Only SUPERADMIN can perform this action.',
  },
  {
    pattern: /voc[eê]\s+n[aã]o\s+pode\s+desativar\s+sua\s+pr[oó]pria\s+conta/i,
    replacement: 'You cannot deactivate your own account.',
  },
  {
    pattern: /supervisor\s+(n[aã]o\s+encontrado|inv[aá]lido)/i,
    replacement: 'Supervisor not found.',
  },
  {
    pattern: /supervisor\s+deve\s+pertencer\s+ao\s+seu\s+time\s+de\s+administra(?:c|ç)[aã]o/i,
    replacement: 'Supervisor must belong to your administration team.',
  },
  {
    pattern: /n[aã]o\s+h[aá]\s+mais\s+assentos\s+dispon[ií]veis/i,
    replacement: 'No seats are available for this action.',
  },
  {
    pattern: /limite\s+de\s+cadeiras\s+excedido/i,
    replacement: 'Seat limit exceeded.',
  },
  {
    pattern: /(sem\s+plano\s+vinculado|plano\s+atual\s+inativo|plano\s+vinculado\s+necess[aá]rio)/i,
    replacement: 'An active admin plan is required to continue.',
  },
  {
    pattern: /(checkout\s+stripe\s+.*n[aã]o\s+configurado|stripe\s+n[aã]o\s+configurado)/i,
    replacement: 'Stripe checkout is not configured on the backend.',
  },
  {
    pattern: /sess[aã]o\s+de\s+checkout\s+n[aã]o\s+pertence/i,
    replacement: 'Checkout session does not belong to the authenticated admin.',
  },
  {
    pattern: /sess[aã]o\s+stripe\s+ainda\s+n[aã]o\s+foi\s+conclu[ií]da\/paga/i,
    replacement: 'Stripe session is not paid/completed yet.',
  },
  {
    pattern: /sess[aã]o\s+stripe\s+inv[aá]lida/i,
    replacement: 'Invalid Stripe session.',
  },
  {
    pattern: /token\s+da\s+api\s+p[úu]blica\s+n[aã]o\s+informado/i,
    replacement: 'Public API token was not provided.',
  },
  {
    pattern: /api\s+p[úu]blica\s+est[aá]\s+desativada/i,
    replacement: 'Public API is disabled in PRO settings.',
  },
  {
    pattern: /somente\s+administradores\s+podem\s+emitir\s+token/i,
    replacement: 'Only administrators can issue public API tokens.',
  },
  {
    pattern: /registro\s+aprovado\s+com\s+sucesso|registro\s+aprovado/i,
    replacement: 'Entry approved successfully.',
  },
  {
    pattern: /registro\s+rejeitado\s+com\s+sucesso|registro\s+rejeitado/i,
    replacement: 'Entry rejected successfully.',
  },
  {
    pattern: /solicita(?:c|ç)[aã]o\s+de\s+edi(?:c|ç)[aã]o\s+enviada/i,
    replacement: 'Edit request sent to collaborator.',
  },
  {
    pattern: /baixa\s+(realizada|de\s+banco\s+de\s+horas\s+registrada)\s+com\s+sucesso/i,
    replacement: 'Payment posted successfully.',
  },
  {
    pattern: /pin\s+definido\s+com\s+sucesso/i,
    replacement: 'PIN set successfully.',
  },
  {
    pattern: /pin\s+resetado\s+com\s+sucesso/i,
    replacement: 'PIN reset successfully.',
  },
  {
    pattern: /configura(?:c|ç)[aã]o\s+.*atualizada\s+com\s+sucesso/i,
    replacement: 'Configuration updated successfully.',
  },
  {
    pattern: /checkout\s+de\s+cadeiras\s+adicionais\s+iniciado\s+com\s+sucesso/i,
    replacement: 'Additional seats checkout started successfully.',
  },
  {
    pattern: /cadeiras\s+adicionais\s+confirmadas\s+e\s+salvas\s+no\s+banco\s+com\s+sucesso/i,
    replacement: 'Additional seats confirmed and saved successfully.',
  },
  {
    pattern: /(reconhecimento|cadastro)\s+facial\s+(cadastrado|removido)\s+com\s+sucesso/i,
    replacement: 'Facial enrollment updated successfully.',
  },
  {
    pattern: /com\s+sucesso/i,
    replacement: 'Operation completed successfully.',
  },
]

const probablyPortugueseMessage = (message: string) => {
  return /[ãõáéíóúç]|\b(nao|n[aã]o|erro|usu[aá]rio|solicita(?:c|ç)[aã]o|rejei(?:c|ç)[aã]o|f[eé]rias|folga|jornada|equipe|colaborador|pendente|inv[aá]lido|superadmin|admin|plano|cadeira|assento|checkout|sess[aã]o|configura(?:c|ç)[aã]o|coment[aá]rio|obrigat[óo]rio|sucesso)\b/i.test(
    message
  )
}

const probablySuccessMessage = (message: string) => {
  return /\b(sucesso|atualizad[ao]|aprovad[ao]|confirmad[ao]|enviad[ao]|registrad[ao]|sincronizad[ao]|salv[ao]|emitid[ao]|gerad[ao]|removid[ao])\b/i.test(
    message
  )
}

export const translateApiMessage = (rawMessage: unknown) => {
  const message = String(rawMessage || '').trim()

  if (!message) {
    return localizeMessage('Request failed.', 'Erro na requisicao')
  }

  if (isPortugueseLanguage()) {
    return message
  }

  for (const rule of PT_TO_EN_ERROR_RULES) {
    if (rule.pattern.test(message)) {
      return rule.replacement
    }
  }

  if (probablyPortugueseMessage(message)) {
    if (probablySuccessMessage(message)) {
      return 'Operation completed successfully.'
    }

    return 'Request failed. Please check the input and try again.'
  }

  return message
}

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

const readJsonResponse = async (res: Response) => {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.toLowerCase().includes('application/json')) {
    return res.json()
  }

  const bodyText = await res.text().catch(() => '')
  const looksLikeHtml = /^\s*<!doctype html|^\s*<html[\s>]/i.test(bodyText)

  if (looksLikeHtml) {
    throw new Error(
      localizeMessage(
        'Service temporarily unavailable. Please try again later.',
        'Serviço temporariamente indisponível. Tente novamente mais tarde.'
      )
    )
  }

  throw new Error(
    localizeMessage(
      'An unexpected error occurred. Please try again.',
      'Ocorreu um erro inesperado. Tente novamente.'
    )
  )
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
      const msg = localizeMessage(
        'Request timed out. Please check your internet connection.',
        'Tempo de resposta excedido. Verifique sua conexão com a internet.'
      )
      toast.error(msg)
      throw new Error(msg)
    }
    throw error
  }

  clearTimeout(timeoutId)

  if (!res.ok) {
    const payload = await readJsonResponse(res).catch(() => ({}))
    const errorMessage = translateApiMessage(payload?.message || localizeMessage('Request failed.', 'Erro na requisicao'))
    toast.error(errorMessage)
    throw new Error(errorMessage)
  }

  return readJsonResponse(res) as Promise<T>
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
      const msg = localizeMessage(
        'Request timed out. Please check your internet connection.',
        'Tempo de resposta excedido. Verifique sua conexão com a internet.'
      )
      toast.error(msg)
      throw new Error(msg)
    }
    throw error
  }

  clearTimeout(timeoutId)

  if (!res.ok) {
    const payload = await readJsonResponse(res).catch(() => ({}))
    const errorMessage = translateApiMessage(payload?.message || localizeMessage('Request failed.', 'Erro na requisicao'))
    toast.error(errorMessage)
    throw new Error(errorMessage)
  }

  return readJsonResponse(res) as Promise<T>
}

export const resolveApiAssetUrl = (rawUrl?: string | null) => {
  if (!rawUrl) return null
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl

  const apiRoot = new URL(API_BASE, window.location.origin)
  const origin = `${apiRoot.protocol}//${apiRoot.host}`
  const normalizedPath = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
  return `${origin}${normalizedPath}`
}
