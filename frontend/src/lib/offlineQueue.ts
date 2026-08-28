export type OfflineClockAction = {
  id: string
  path: '/time/clock-in' | '/time/clock-out'
  body: Record<string, unknown>
  occurredAt: string
  attempts: number
}

export type QueueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const QUEUE_KEY = 'omnipunt.offlineClockQueue'
const LEGACY_QUEUE_KEY = 'systemaponto.offlineClockQueue'
const MAX_ATTEMPTS = 3

export const readQueue = (storage: QueueStorage): OfflineClockAction[] => {
  try {
    const current = storage.getItem(QUEUE_KEY)
    const legacy = current ? null : storage.getItem(LEGACY_QUEUE_KEY)
    const raw = current || legacy
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const sanitized: OfflineClockAction[] = parsed
      .filter((item) => item?.id && item?.path && item?.body)
      .map((item) => ({
        ...item,
        // filas gravadas antes desta versao nao tem occurredAt: cai no relogio do servidor
        occurredAt: typeof item.occurredAt === 'string' ? item.occurredAt : item.createdAt,
        attempts: typeof item.attempts === 'number' ? item.attempts : 0,
      }))

    if (!current && legacy) {
      storage.setItem(QUEUE_KEY, JSON.stringify(sanitized))
      storage.removeItem(LEGACY_QUEUE_KEY)
    }
    return sanitized
  } catch {
    return []
  }
}

export const writeQueue = (storage: QueueStorage, queue: OfflineClockAction[]) => {
  storage.setItem(QUEUE_KEY, JSON.stringify(queue))
  storage.removeItem(LEGACY_QUEUE_KEY)
}

export const enqueue = (
  storage: QueueStorage,
  action: Pick<OfflineClockAction, 'path' | 'body'>,
  now: Date = new Date(),
) => {
  const next = [
    ...readQueue(storage),
    {
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      occurredAt: now.toISOString(),
      attempts: 0,
      ...action,
    },
  ]
  writeQueue(storage, next)
  return next
}

// Erro de rede = tentar de novo depois. Erro 4xx = a batida esta errada e nunca
// vai passar; conta a tentativa e descarta em MAX_ATTEMPTS para nao travar a fila.
const isNetworkError = (error: unknown) => {
  const status = (error as { status?: number })?.status
  if (typeof status === 'number') return status >= 500
  const message = error instanceof Error ? error.message : String(error)
  return /failed to fetch|network|tempo de resposta excedido|networkerror|abort/i.test(message)
}

export const syncQueue = async ({
  storage,
  send,
}: {
  storage: QueueStorage
  send: (path: string, body: Record<string, unknown>) => Promise<unknown>
}) => {
  const queue = readQueue(storage)
  const remaining: OfflineClockAction[] = []
  const dropped: OfflineClockAction[] = []
  let synced = 0

  for (let i = 0; i < queue.length; i += 1) {
    const action = queue[i]
    try {
      await send(action.path, { ...action.body, occurredAt: action.occurredAt })
      synced += 1
    } catch (error) {
      if (isNetworkError(error)) {
        // ainda sem rede: preserva esta e todas as seguintes, na ordem
        remaining.push(...queue.slice(i))
        break
      }
      const attempts = action.attempts + 1
      if (attempts >= MAX_ATTEMPTS) dropped.push(action)
      else remaining.push({ ...action, attempts })
    }
  }

  writeQueue(storage, remaining)
  return { synced, remaining, dropped }
}
