import { describe, it, expect, vi } from 'vitest'
import { enqueue, readQueue, syncQueue, type OfflineClockAction } from './offlineQueue'

const memoryStorage = (seed: Record<string, string> = {}) => {
  const data = new Map(Object.entries(seed))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

const punch = (over: Partial<OfflineClockAction> = {}): OfflineClockAction => ({
  id: 'a1',
  path: '/time/clock-in',
  body: { notes: '' },
  occurredAt: '2026-08-28T08:00:00.000Z',
  attempts: 0,
  ...over,
})

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
    await syncQueue({ storage, send })
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
    await syncQueue({ storage, send: async (path) => void seen.push(path) })
    expect(seen).toEqual(['/time/clock-in', '/time/clock-out'])
  })

  it('stops at the first network error and keeps the rest queued', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'a1' }), punch({ id: 'a2' })]),
    })
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('Failed to fetch'), { status: undefined }))
    const result = await syncQueue({ storage, send })
    expect(send).toHaveBeenCalledTimes(1)
    expect(result.remaining.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(result.dropped).toEqual([])
  })

  it('drops a permanently failing punch after 3 attempts instead of jamming the queue', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ attempts: 2 })]),
    })
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('ja existe um registro aberto'), { status: 400 }))
    const result = await syncQueue({ storage, send })
    expect(result.remaining).toEqual([])
    expect(result.dropped).toHaveLength(1)
    expect(readQueue(storage)).toEqual([])
  })

  it('keeps syncing later punches after dropping a rejected one', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'bad', attempts: 2 }), punch({ id: 'good' })]),
    })
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('invalido'), { status: 400 }))
      .mockResolvedValueOnce(undefined)
    const result = await syncQueue({ storage, send })
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
})
