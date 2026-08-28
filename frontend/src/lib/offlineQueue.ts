export const OFFLINE_CLOCK_PATHS = ['/time/clock-in', '/time/clock-out'] as const

export type OfflineClockPath = (typeof OFFLINE_CLOCK_PATHS)[number]

export type OfflineClockAction = {
  id: string
  path: OfflineClockPath
  // filas gravadas antes desta versao nao tem occurredAt: o tipo precisa ser honesto
  occurredAt?: string
  body: Record<string, unknown>
  attempts: number
}

export type DropReason = 'REJECTED' | 'TOO_OLD'

export type DroppedPunch = OfflineClockAction & {
  reason: DropReason
  droppedAt: string
  message?: string
}

export type QueueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const QUEUE_KEY = 'omnipunt.offlineClockQueue'
const LEGACY_QUEUE_KEY = 'systemaponto.offlineClockQueue'
const CORRUPT_QUEUE_KEY = 'omnipunt.offlineClockQueue.corrupt'
const DROPPED_KEY = 'omnipunt.droppedPunches'
const MAX_ATTEMPTS = 3
const MAX_DROPPED_RECORDS = 50
// Espelha backend/src/utils/offlinePunch.js: acima disso o servidor responde 400
// INVALID_OCCURRED_AT e a batida nunca vai passar, por mais que se tente.
const MAX_PUNCH_AGE_MS = 48 * 60 * 60 * 1000

// Uma batida so pode ser considerada "recusada" se um servidor respondeu. Erro
// sem status HTTP (fetch que estourou, DNS, TLS, WebView suspensa, timeout do
// AbortController) nunca chegou a um veredito: a batida continua valida e tem
// de ser retentada. Classificar por transporte, e nao pela mensagem, e o unico
// criterio independente de engine — Chrome diz "Failed to fetch", Firefox
// "NetworkError...", Safari/WKWebView "Load failed" e o timeout do apiFetch e
// uma frase localizada. Nenhum deles carrega status.
export const isOfflineFailure = (error: unknown): boolean => {
  const status = (error as { status?: number } | null | undefined)?.status
  if (typeof status === 'number') return status >= 500
  return true
}

// Sinal corroborante, so onde existe DOM: se o proprio aparelho ja se declara
// offline, nao ha duvida nenhuma sobre a classificacao.
export const isDeviceOffline = (): boolean => {
  if (typeof navigator === 'undefined' || navigator === null) return false
  return navigator.onLine === false
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]'

const isOfflineClockPath = (value: unknown): value is OfflineClockPath =>
  OFFLINE_CLOCK_PATHS.includes(value as OfflineClockPath)

const isQueueItem = (item: unknown): item is Record<string, unknown> => {
  if (!isPlainObject(item)) return false
  return typeof item.id === 'string' && item.id.length > 0 && isOfflineClockPath(item.path) && isPlainObject(item.body)
}

const normalizeItem = (item: Record<string, unknown>): OfflineClockAction => {
  // Fila legada gravava createdAt; o servidor le occurredAt.
  const occurredAt =
    typeof item.occurredAt === 'string'
      ? item.occurredAt
      : typeof item.createdAt === 'string'
        ? item.createdAt
        : undefined

  return {
    id: item.id as string,
    path: item.path as OfflineClockPath,
    body: item.body as Record<string, unknown>,
    attempts: typeof item.attempts === 'number' && item.attempts >= 0 ? item.attempts : 0,
    ...(occurredAt ? { occurredAt } : {}),
  }
}

// Nunca sobrescrever uma fila ilegivel sem antes guardar o original: o conteudo
// bruto e a unica prova de que houve batida.
const preserveCorruptQueue = (storage: QueueStorage, sourceKey: string, raw: string) => {
  try {
    storage.setItem(
      CORRUPT_QUEUE_KEY,
      JSON.stringify({ sourceKey, raw, detectedAt: new Date().toISOString() })
    )
  } catch {
    // storage cheio/indisponivel: nada mais a fazer aqui.
  }
}

export const readQueue = (storage: QueueStorage): OfflineClockAction[] => {
  let raw: string | null = null
  let sourceKey: string = QUEUE_KEY

  try {
    const current = storage.getItem(QUEUE_KEY)
    if (current) {
      raw = current
    } else {
      const legacy = storage.getItem(LEGACY_QUEUE_KEY)
      if (legacy) {
        raw = legacy
        sourceKey = LEGACY_QUEUE_KEY
      }
    }
  } catch {
    return []
  }

  if (!raw) return []

  let sanitized: OfflineClockAction[]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('offline queue is not an array')
    sanitized = parsed.filter(isQueueItem).map(normalizeItem)
    if (sanitized.length !== parsed.length) preserveCorruptQueue(storage, sourceKey, raw)
  } catch {
    preserveCorruptQueue(storage, sourceKey, raw)
    return []
  }

  if (sourceKey === LEGACY_QUEUE_KEY) {
    try {
      storage.setItem(QUEUE_KEY, JSON.stringify(sanitized))
      // So apaga a chave legada depois de confirmar que a copia migrada volta legivel.
      const migrated = storage.getItem(QUEUE_KEY)
      if (migrated && Array.isArray(JSON.parse(migrated))) {
        storage.removeItem(LEGACY_QUEUE_KEY)
      }
    } catch {
      // migracao falhou: a chave legada permanece como fonte da verdade.
    }
  }

  return sanitized
}

// Retorna false em vez de estourar: e chamado de dentro de catch de batida, e
// uma excecao aqui viraria unhandled rejection com a batida perdida em silencio.
export const writeQueue = (storage: QueueStorage, queue: OfflineClockAction[]): boolean => {
  try {
    storage.setItem(QUEUE_KEY, JSON.stringify(queue))
    return true
  } catch {
    return false
  }
}

export const readDroppedPunches = (storage: QueueStorage): DroppedPunch[] => {
  try {
    const raw = storage.getItem(DROPPED_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DroppedPunch[]) : []
  } catch {
    return []
  }
}

export const clearDroppedPunches = (storage: QueueStorage) => {
  try {
    storage.removeItem(DROPPED_KEY)
  } catch {
    // nada a fazer: o aviso volta a aparecer no proximo ciclo.
  }
}

// Batida descartada nao pode sumir: fica gravada ate o colaborador dar ciencia,
// com occurredAt, para ele saber exatamente o que pedir ao supervisor.
const recordDroppedPunch = (
  storage: QueueStorage,
  action: OfflineClockAction,
  reason: DropReason,
  message: string | undefined,
  now: Date
): DroppedPunch => {
  const entry: DroppedPunch = {
    ...action,
    reason,
    droppedAt: now.toISOString(),
    ...(message ? { message } : {}),
  }

  try {
    const next = [...readDroppedPunches(storage), entry].slice(-MAX_DROPPED_RECORDS)
    storage.setItem(DROPPED_KEY, JSON.stringify(next))
  } catch {
    // storage cheio: o retorno de syncQueue ainda leva o item para a UI.
  }

  return entry
}

export const enqueue = (
  storage: QueueStorage,
  action: Pick<OfflineClockAction, 'path' | 'body'>,
  now: Date = new Date(),
) => {
  const queue: OfflineClockAction[] = [
    ...readQueue(storage),
    {
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      occurredAt: now.toISOString(),
      attempts: 0,
      ...action,
    },
  ]

  return { persisted: writeQueue(storage, queue), queue }
}

const isTooOld = (action: OfflineClockAction, now: Date) => {
  if (!action.occurredAt) return false
  const occurredAtMs = new Date(action.occurredAt).getTime()
  if (Number.isNaN(occurredAtMs)) return false
  return now.getTime() - occurredAtMs > MAX_PUNCH_AGE_MS
}

export const syncQueue = async ({
  storage,
  send,
  now = new Date(),
}: {
  storage: QueueStorage
  send: (path: string, body: Record<string, unknown>) => Promise<unknown>
  now?: Date
}) => {
  const queue = readQueue(storage)
  // Sem pendencia nao se toca no storage: syncQueue roda a cada 15s.
  if (queue.length === 0) {
    return { synced: 0, remaining: [] as OfflineClockAction[], dropped: [] as DroppedPunch[], persisted: true }
  }

  const dropped: DroppedPunch[] = []
  let remaining: OfflineClockAction[] = []
  let synced = 0

  for (let i = 0; i < queue.length; i += 1) {
    const action = queue[i]

    if (isTooOld(action, now)) {
      dropped.push(
        recordDroppedPunch(
          storage,
          action,
          'TOO_OLD',
          'A batida ficou mais de 48h sem sincronizar e o servidor nao aceita mais esse horario.',
          now
        )
      )
      // Progresso gravado item a item: um crash aqui nao reenvia o que ja saiu.
      writeQueue(storage, queue.slice(i + 1))
      continue
    }

    try {
      await send(action.path, {
        ...action.body,
        ...(action.occurredAt ? { occurredAt: action.occurredAt } : {}),
      })
      synced += 1
      writeQueue(storage, queue.slice(i + 1))
    } catch (error) {
      if (isOfflineFailure(error)) {
        // ainda sem rede: preserva esta e todas as seguintes, na ordem
        remaining = queue.slice(i)
        break
      }

      const attempts = action.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        dropped.push(
          recordDroppedPunch(
            storage,
            action,
            'REJECTED',
            error instanceof Error ? error.message : undefined,
            now
          )
        )
        // Item efetivamente descartado: a fila pode seguir sem quebrar a ordem.
        writeQueue(storage, queue.slice(i + 1))
        continue
      }

      // Falha nao definitiva: a batida i continua pendente, entao nada depois
      // dela pode ser aplicado antes — um clock-out aplicado antes do clock-in
      // atrasado fecharia o registro errado.
      remaining = [{ ...action, attempts }, ...queue.slice(i + 1)]
      break
    }
  }

  const persisted = writeQueue(storage, remaining)
  return { synced, remaining, dropped, persisted }
}
