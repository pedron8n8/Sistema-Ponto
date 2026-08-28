import { describe, it, expect, vi } from 'vitest'
import {
  clearDroppedPunches,
  enqueue,
  isOfflineFailure,
  readDroppedPunches,
  readQueue,
  syncQueue,
  writeQueue,
  type OfflineClockAction,
} from './offlineQueue'

const memoryStorage = (seed: Record<string, string> = {}) => {
  const data = new Map(Object.entries(seed))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

const readOnlyStorage = (seed: Record<string, string> = {}) => ({
  ...memoryStorage(seed),
  setItem: () => {
    throw new DOMException('QuotaExceededError', 'QuotaExceededError')
  },
})

const punch = (over: Partial<OfflineClockAction> = {}): OfflineClockAction => ({
  id: 'a1',
  path: '/time/clock-in',
  body: { notes: '' },
  occurredAt: '2026-08-28T08:00:00.000Z',
  attempts: 0,
  ...over,
})

const httpError = (message: string, status: number) =>
  Object.assign(new Error(message), { status })

// Referencia de "agora" logo depois das batidas de exemplo, para os testes nao
// dependerem do relogio da maquina (48h de janela no servidor).
const NOW = new Date('2026-08-28T18:00:00.000Z')

describe('offlineQueue', () => {
  it('stamps occurredAt when a punch is enqueued', () => {
    const storage = memoryStorage()
    enqueue(storage, { path: '/time/clock-in', body: { notes: 'obra' } }, new Date('2026-08-28T08:00:00.000Z'))
    const [queued] = readQueue(storage)
    expect(queued.occurredAt).toBe('2026-08-28T08:00:00.000Z')
    expect(queued.attempts).toBe(0)
  })

  it('sends occurredAt in the request body on sync', async () => {
    const storage = memoryStorage()
    enqueue(storage, { path: '/time/clock-in', body: { notes: 'obra' } }, new Date('2026-08-28T08:00:00.000Z'))
    const send = vi.fn().mockResolvedValue(undefined)
    await syncQueue({ storage, send, now: NOW })
    expect(send).toHaveBeenCalledWith('/time/clock-in', expect.objectContaining({
      notes: 'obra',
      occurredAt: '2026-08-28T08:00:00.000Z',
    }))
  })

  it('preserves punch order when syncing', async () => {
    const storage = memoryStorage()
    enqueue(storage, { path: '/time/clock-in', body: {} }, new Date('2026-08-28T08:00:00.000Z'))
    enqueue(storage, { path: '/time/clock-out', body: {} }, new Date('2026-08-28T17:00:00.000Z'))
    const seen: string[] = []
    await syncQueue({ storage, send: async (path) => void seen.push(path), now: NOW })
    expect(seen).toEqual(['/time/clock-in', '/time/clock-out'])
  })

  it('stops at the first network error and keeps the rest queued', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'a1' }), punch({ id: 'a2' })]),
    })
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('Failed to fetch'), { status: undefined }))
    const result = await syncQueue({ storage, send, now: NOW })
    expect(send).toHaveBeenCalledTimes(1)
    expect(result.remaining.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(result.dropped).toEqual([])
  })

  it('drops a permanently failing punch after 3 attempts instead of jamming the queue', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ attempts: 2 })]),
    })
    const send = vi.fn().mockRejectedValue(httpError('ja existe um registro aberto', 400))
    const result = await syncQueue({ storage, send, now: NOW })
    expect(result.remaining).toEqual([])
    expect(result.dropped).toHaveLength(1)
    expect(readQueue(storage)).toEqual([])
  })

  it('keeps syncing later punches after dropping a rejected one', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'bad', attempts: 2 }), punch({ id: 'good' })]),
    })
    const send = vi.fn()
      .mockRejectedValueOnce(httpError('invalido', 400))
      .mockResolvedValueOnce(undefined)
    const result = await syncQueue({ storage, send, now: NOW })
    expect(result.synced).toBe(1)
    expect(result.dropped.map((a) => a.id)).toEqual(['bad'])
    expect(result.remaining).toEqual([])
  })

  it('migrates a queue stored under the legacy key', () => {
    const storage = memoryStorage({
      'systemaponto.offlineClockQueue': JSON.stringify([punch()]),
    })
    expect(readQueue(storage)).toHaveLength(1)
    expect(storage.getItem('omnipunt.offlineClockQueue')).not.toBeNull()
    expect(storage.getItem('systemaponto.offlineClockQueue')).toBeNull()
  })

  it('returns an empty queue for corrupted storage instead of throwing', () => {
    expect(readQueue(memoryStorage({ 'omnipunt.offlineClockQueue': '{not json' }))).toEqual([])
  })

  // --- classificacao de erro: por transporte, nunca por mensagem ---

  it('treats the Safari/WKWebView "Load failed" error as a network failure', async () => {
    // Sem isto, um iPhone sem sinal nao enfileira a batida: ela some.
    expect(isOfflineFailure(new TypeError('Load failed'))).toBe(true)

    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ attempts: 2 })]),
    })
    const result = await syncQueue({
      storage,
      send: vi.fn().mockRejectedValue(new TypeError('Load failed')),
      now: NOW,
    })
    expect(result.dropped).toEqual([])
    expect(result.remaining).toHaveLength(1)
    expect(result.remaining[0].attempts).toBe(2)
  })

  it('treats an English-locale timeout message as a network failure', () => {
    // apiFetch traduz o AbortError; a frase em ingles nao casava com nenhum regex.
    expect(isOfflineFailure(new Error('Request timed out. Please check your internet connection.'))).toBe(true)
    expect(isOfflineFailure(new Error('Tempo de resposta excedido. Verifique sua conexão com a internet.'))).toBe(true)
  })

  it('only lets a real HTTP response decide: 5xx retries, 4xx is a verdict', async () => {
    expect(isOfflineFailure(httpError('boom', 503))).toBe(true)
    expect(isOfflineFailure(httpError('invalido', 400))).toBe(false)
    expect(isOfflineFailure(httpError('nao autorizado', 401))).toBe(false)

    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'a1', attempts: 2 }), punch({ id: 'a2' })]),
    })
    const send = vi.fn().mockRejectedValue(httpError('Internal Server Error', 500))
    const result = await syncQueue({ storage, send, now: NOW })
    expect(send).toHaveBeenCalledTimes(1)
    expect(result.dropped).toEqual([])
    // 5xx nao gasta tentativa: o servidor falhou, a batida continua valida.
    expect(result.remaining.map((a) => a.attempts)).toEqual([2, 0])
  })

  // --- politica de descarte e ordem ---

  it('keeps a punch that fails its first non-network attempt, with attempts = 1', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'a1' })]),
    })
    const result = await syncQueue({
      storage,
      send: vi.fn().mockRejectedValue(httpError('invalido', 400)),
      now: NOW,
    })
    expect(result.dropped).toEqual([])
    expect(result.remaining).toHaveLength(1)
    expect(result.remaining[0].attempts).toBe(1)
    expect(readQueue(storage)[0].attempts).toBe(1)
  })

  it('stops the loop when a punch fails but is not dropped, so nothing later jumps ahead', async () => {
    // Um clock-out aplicado antes do clock-in atrasado fecharia o registro errado.
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([
        punch({ id: 'in', path: '/time/clock-in' }),
        punch({ id: 'out', path: '/time/clock-out', occurredAt: '2026-08-28T17:00:00.000Z' }),
      ]),
    })
    const send = vi.fn().mockRejectedValue(httpError('invalido', 400))
    const result = await syncQueue({ storage, send, now: NOW })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('/time/clock-in', expect.anything())
    expect(result.remaining.map((a) => a.id)).toEqual(['in', 'out'])
    expect(result.remaining[0].attempts).toBe(1)
    expect(result.remaining[1].attempts).toBe(0)
  })

  // --- persistencia ---

  it('persists exactly what the result claims is remaining', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'a1' }), punch({ id: 'a2' })]),
    })
    const send = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TypeError('Load failed'))
    const result = await syncQueue({ storage, send, now: NOW })
    expect(result.synced).toBe(1)
    expect(readQueue(storage)).toEqual(result.remaining)
    expect(readQueue(storage).map((a) => a.id)).toEqual(['a2'])
  })

  it('persists progress inside the loop, not only at the end', async () => {
    // Se o SO matar a WebView entre os POSTs e a gravacao, a batida ja enviada
    // nao pode voltar na proxima abertura: seria turno pago duas vezes.
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'a1' }), punch({ id: 'a2' })]),
    })
    let queueSeenBySecondSend: string[] = []
    const send = vi.fn().mockImplementation(async () => {
      if (send.mock.calls.length === 2) {
        queueSeenBySecondSend = readQueue(storage).map((a) => a.id)
      }
    })
    await syncQueue({ storage, send, now: NOW })
    expect(queueSeenBySecondSend).toEqual(['a2'])
  })

  it('does not touch storage when the queue is empty', async () => {
    const storage = memoryStorage()
    const setItem = vi.spyOn(storage, 'setItem')
    const removeItem = vi.spyOn(storage, 'removeItem')
    const result = await syncQueue({ storage, send: vi.fn(), now: NOW })
    expect(result).toEqual({ synced: 0, remaining: [], dropped: [], persisted: true })
    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
  })

  it('reports failure instead of throwing when storage rejects the write', () => {
    const storage = readOnlyStorage()
    expect(writeQueue(storage, [punch()])).toBe(false)
    const enqueued = enqueue(storage, { path: '/time/clock-in', body: {} }, new Date('2026-08-28T08:00:00.000Z'))
    expect(enqueued.persisted).toBe(false)
    expect(enqueued.queue).toHaveLength(1)
  })

  // --- fila legada e fila corrompida ---

  it('maps the legacy createdAt into occurredAt', () => {
    const storage = memoryStorage({
      'systemaponto.offlineClockQueue': JSON.stringify([
        { id: 'legacy', path: '/time/clock-in', body: { notes: '' }, createdAt: '2026-08-28T08:00:00.000Z' },
      ]),
    })
    const [migrated] = readQueue(storage)
    expect(migrated.occurredAt).toBe('2026-08-28T08:00:00.000Z')
    expect(migrated.attempts).toBe(0)
  })

  it('leaves occurredAt undefined for a legacy punch with no timestamp at all', () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([
        { id: 'legacy', path: '/time/clock-out', body: {} },
      ]),
    })
    const [item] = readQueue(storage)
    expect(item.occurredAt).toBeUndefined()
  })

  it('does not send occurredAt when the queued punch has none', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([{ id: 'legacy', path: '/time/clock-in', body: { notes: 'x' } }]),
    })
    const send = vi.fn().mockResolvedValue(undefined)
    await syncQueue({ storage, send, now: NOW })
    expect(send).toHaveBeenCalledWith('/time/clock-in', { notes: 'x' })
  })

  it('keeps the corrupted payload instead of erasing it', () => {
    const storage = memoryStorage({ 'omnipunt.offlineClockQueue': '{not json' })
    expect(readQueue(storage)).toEqual([])
    const preserved = storage.getItem('omnipunt.offlineClockQueue.corrupt')
    expect(preserved).not.toBeNull()
    expect(JSON.parse(String(preserved)).raw).toBe('{not json')
  })

  it('keeps the legacy key when the migrated copy cannot be written', () => {
    const storage = readOnlyStorage({
      'systemaponto.offlineClockQueue': JSON.stringify([punch()]),
    })
    expect(readQueue(storage)).toHaveLength(1)
    expect(storage.getItem('systemaponto.offlineClockQueue')).not.toBeNull()
  })

  it('rejects an item whose path is not a clock endpoint', () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([
        punch({ id: 'ok' }),
        { id: 'evil', path: '/users/me/face', body: {}, attempts: 0 },
      ]),
    })
    expect(readQueue(storage).map((a) => a.id)).toEqual(['ok'])
    // e o payload rejeitado nao some sem deixar rastro
    expect(storage.getItem('omnipunt.offlineClockQueue.corrupt')).not.toBeNull()
  })

  // --- batidas descartadas ficam gravadas ---

  it('persists a dropped punch so the employee can still report it', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'bad', attempts: 2 })]),
    })
    await syncQueue({
      storage,
      send: vi.fn().mockRejectedValue(httpError('ja existe um registro aberto', 400)),
      now: NOW,
    })

    const droppedRecords = readDroppedPunches(storage)
    expect(droppedRecords).toHaveLength(1)
    expect(droppedRecords[0].id).toBe('bad')
    expect(droppedRecords[0].reason).toBe('REJECTED')
    expect(droppedRecords[0].occurredAt).toBe('2026-08-28T08:00:00.000Z')
    expect(storage.getItem('omnipunt.droppedPunches')).not.toBeNull()

    clearDroppedPunches(storage)
    expect(readDroppedPunches(storage)).toEqual([])
  })

  it('records a punch older than 48h instead of burning attempts on it', async () => {
    // O servidor recusa occurredAt > 48h (backend/src/utils/offlinePunch.js).
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([
        punch({ id: 'old', occurredAt: '2026-08-20T08:00:00.000Z' }),
        punch({ id: 'fresh' }),
      ]),
    })
    const send = vi.fn().mockResolvedValue(undefined)
    const result = await syncQueue({ storage, send, now: NOW })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('/time/clock-in', expect.objectContaining({ occurredAt: '2026-08-28T08:00:00.000Z' }))
    expect(result.dropped.map((a) => a.id)).toEqual(['old'])
    expect(result.dropped[0].reason).toBe('TOO_OLD')
    expect(readDroppedPunches(storage).map((a) => a.id)).toEqual(['old'])
    expect(readQueue(storage)).toEqual([])
  })
})
