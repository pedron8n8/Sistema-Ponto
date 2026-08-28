import { describe, it, expect, vi } from 'vitest'
import {
  MAX_UNVERIFIED_OFFLINE_ATTEMPTS,
  clearDroppedPunches,
  createPunchNonce,
  enqueue,
  isRetryableReplayFailure,
  mergeDroppedPunches,
  readCorruptQueueRecords,
  readDroppedPunches,
  readOfflinePunchPolicy,
  readQueue,
  rememberOfflinePunchPolicy,
  requiresTerminalQr,
  shouldQueueOfflinePunch,
  syncNeedsStorageWarning,
  syncQueue,
  writeQueue,
  type DroppedPunch,
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

// Aparelho que se declara conectado: e o unico estado em que uma falha sem
// status nenhum conta contra o teto.
const deviceOnline = () => false
const deviceOffline = () => true

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
    expect(isRetryableReplayFailure(new TypeError('Load failed'))).toBe(true)

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
    expect(isRetryableReplayFailure(new Error('Request timed out. Please check your internet connection.'))).toBe(true)
    expect(isRetryableReplayFailure(new Error('Tempo de resposta excedido. Verifique sua conexão com a internet.'))).toBe(true)
  })

  it('only lets a real HTTP response decide: 5xx retries, 4xx is a verdict', async () => {
    expect(isRetryableReplayFailure(httpError('boom', 503))).toBe(true)
    expect(isRetryableReplayFailure(httpError('invalido', 400))).toBe(false)
    expect(isRetryableReplayFailure(httpError('nao autorizado', 401))).toBe(false)

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
    const preserved = readCorruptQueueRecords(storage)
    expect(preserved).toHaveLength(1)
    expect(preserved[0].raw).toBe('{not json')
  })

  it('still reads the single-object corrupt record written by the previous version', () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue.corrupt': JSON.stringify({
        sourceKey: 'omnipunt.offlineClockQueue',
        raw: '{old',
        detectedAt: '2026-08-01T00:00:00.000Z',
      }),
    })
    expect(readCorruptQueueRecords(storage).map((r) => r.raw)).toEqual(['{old'])
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

  // --- veredito HTTP transitorio: 429 e 408 nao sao definitivos ---

  it('treats 429 and 408 as retryable, not as a verdict', () => {
    expect(isRetryableReplayFailure(httpError('muitas requisicoes', 429))).toBe(true)
    expect(isRetryableReplayFailure(httpError('request timeout', 408))).toBe(true)
    expect(isRetryableReplayFailure(httpError('conflito', 409))).toBe(false)
  })

  it('does not destroy a punch after three PIN_LOCKED 429s', async () => {
    // backend/src/controllers/time.controller.js responde 429 para PIN_LOCKED, e
    // o rate limiter por cliente tambem. Antes, 3 ciclos (45s) apagavam de vez
    // uma batida que passaria assim que o bloqueio expirasse.
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'locked' })]),
    })
    const send = vi.fn().mockRejectedValue(httpError('PIN temporariamente bloqueado', 429))

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const result = await syncQueue({ storage, send, now: NOW, deviceOffline: deviceOnline })
      expect(result.dropped).toEqual([])
      expect(result.remaining.map((a) => a.id)).toEqual(['locked'])
      // 429 nao gasta tentativa: nao houve veredito definitivo nenhum.
      expect(result.remaining[0].attempts).toBe(0)
    }

    send.mockResolvedValueOnce(undefined)
    const finalResult = await syncQueue({ storage, send, now: NOW, deviceOffline: deviceOnline })
    expect(finalResult.synced).toBe(1)
    expect(readQueue(storage)).toEqual([])
  })

  it('does not count a 5xx against the status-less ceiling', async () => {
    // A versao anterior deste teste so afirmava `toBeUndefined()` depois de um
    // 5xx: um contador que NUNCA existisse passaria igual. Agora o mesmo teste
    // prova as duas metades — falha sem status INCREMENTA, 5xx ZERA — entao
    // some com o contador e ele quebra, deixe de zerar e ele quebra tambem.
    const legacy = { id: 'jam', path: '/time/clock-in', body: {} }
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([legacy]),
    })

    const statusless = await syncQueue({
      storage,
      send: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      now: NOW,
      deviceOffline: deviceOnline,
    })
    expect(statusless.remaining[0].offlineAttempts).toBe(1)
    expect(readQueue(storage)[0].offlineAttempts).toBe(1)

    const afterServerError = await syncQueue({
      storage,
      send: vi.fn().mockRejectedValue(httpError('Internal Server Error', 500)),
      now: NOW,
      deviceOffline: deviceOnline,
    })
    // Uma resposta com status prova que o transporte funciona: o contador de
    // falhas "sem veredito nenhum" volta a zero.
    expect(afterServerError.remaining[0].offlineAttempts).toBeUndefined()
    expect(readQueue(storage)[0].offlineAttempts).toBeUndefined()
  })

  it('never lets the ceiling destroy a punch that carries occurredAt', async () => {
    // `navigator.onLine === true` + zero status e a assinatura de toda queda de
    // transporte comum (nginx fora, deploy, cert vencido, DNS, portal cativo) e
    // de toda piscada de sinal numa WebView, onde onLine so diz "tenho
    // interface de rede". O contador e monotonico e persistido: com teto, vinte
    // piscadas ao longo de um dia apagavam de vez uma batida que sincronizaria
    // sozinha. Com occurredAt quem termina o item e o TOO_OLD de 48h.
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'flaky' })]),
    })
    const send = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    for (let cycle = 0; cycle < MAX_UNVERIFIED_OFFLINE_ATTEMPTS * 3; cycle += 1) {
      const result = await syncQueue({ storage, send, now: NOW, deviceOffline: deviceOnline })
      expect(result.dropped).toEqual([])
      expect(result.remaining.map((a) => a.id)).toEqual(['flaky'])
    }

    expect(readQueue(storage).map((a) => a.id)).toEqual(['flaky'])
    expect(readDroppedPunches(storage)).toEqual([])

    // E quando a rede volta, a batida que teria sido destruida sincroniza.
    send.mockResolvedValueOnce(undefined)
    const recovered = await syncQueue({ storage, send, now: NOW, deviceOffline: deviceOnline })
    expect(recovered.synced).toBe(1)
    expect(readQueue(storage)).toEqual([])
  })

  it('still ends a punch with occurredAt in a durable record, at the 48h line', async () => {
    // O teto sumiu para este item, mas ele nao pode ficar em loop silencioso
    // para sempre: quem o termina e o TOO_OLD, com registro visivel.
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'flaky' })]),
    })
    const send = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    for (let cycle = 0; cycle < MAX_UNVERIFIED_OFFLINE_ATTEMPTS + 5; cycle += 1) {
      await syncQueue({ storage, send, now: NOW, deviceOffline: deviceOnline })
    }
    expect(readQueue(storage).map((a) => a.id)).toEqual(['flaky'])

    const later = new Date('2026-08-31T08:00:00.000Z') // > 48h depois de occurredAt
    const result = await syncQueue({ storage, send, now: later, deviceOffline: deviceOnline })
    expect(result.dropped.map((a) => a.reason)).toEqual(['TOO_OLD'])
    expect(readDroppedPunches(storage).map((a) => a.id)).toEqual(['flaky'])
    expect(readQueue(storage)).toEqual([])
  })

  // --- erro permanente SEM status: retenta, mas nao para sempre ---

  it('keeps retrying forever while the device itself reports no connection', async () => {
    // Celular sem sinal: nao existe teto, a batida espera o tempo que precisar.
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'a1' })]),
    })
    const send = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    for (let cycle = 0; cycle < MAX_UNVERIFIED_OFFLINE_ATTEMPTS * 2; cycle += 1) {
      const result = await syncQueue({ storage, send, now: NOW, deviceOffline })
      expect(result.dropped).toEqual([])
      expect(result.remaining[0].offlineAttempts).toBeUndefined()
    }

    expect(readQueue(storage).map((a) => a.id)).toEqual(['a1'])
    expect(readDroppedPunches(storage)).toEqual([])
  })

  it('records a punch the client can never send instead of looping on it forever', async () => {
    // crypto.subtle e undefined em origem insegura: buildIdempotencyHeaders
    // estoura ANTES do fetch, sem status, a cada ciclo, para sempre. Este item
    // nem tem occurredAt, entao a varredura de 48h tambem nunca o alcancaria.
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([
        { id: 'jam', path: '/time/clock-in', body: { notes: '' } },
      ]),
    })
    const send = vi
      .fn()
      .mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'digest')"))

    for (let cycle = 0; cycle < MAX_UNVERIFIED_OFFLINE_ATTEMPTS - 1; cycle += 1) {
      const result = await syncQueue({ storage, send, now: NOW, deviceOffline: deviceOnline })
      expect(result.dropped).toEqual([])
      expect(result.remaining[0].offlineAttempts).toBe(cycle + 1)
    }

    const finalResult = await syncQueue({ storage, send, now: NOW, deviceOffline: deviceOnline })
    expect(finalResult.dropped).toHaveLength(1)
    expect(finalResult.dropped[0].reason).toBe('UNSENDABLE')
    expect(finalResult.remaining).toEqual([])
    expect(readQueue(storage)).toEqual([])
    // e continua existindo onde o colaborador consegue ver e reportar
    expect(readDroppedPunches(storage).map((a) => a.id)).toEqual(['jam'])
  })

  it('lets the queue move on after an unsendable punch is recorded', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([
        // Sem occurredAt: e o unico item em que o teto vale (o TOO_OLD de 48h
        // nunca o alcanca).
        {
          id: 'jam',
          path: '/time/clock-in',
          body: {},
          offlineAttempts: MAX_UNVERIFIED_OFFLINE_ATTEMPTS - 1,
        },
        punch({ id: 'good' }),
      ]),
    })
    const send = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(undefined)
    const result = await syncQueue({ storage, send, now: NOW, deviceOffline: deviceOnline })
    expect(result.dropped.map((a) => a.id)).toEqual(['jam'])
    expect(result.synced).toBe(1)
    expect(readQueue(storage)).toEqual([])
  })

  // --- sinal de persistencia na sincronizacao ---

  it('reports that the synced queue could not be cleared from storage', async () => {
    // Safari privado recusa todo setItem: sem este sinal a tela diz "0 pendentes"
    // enquanto o storage ainda guarda os itens, e o ciclo seguinte reenvia tudo.
    const storage = readOnlyStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'a1' })]),
    })
    const result = await syncQueue({
      storage,
      send: vi.fn().mockResolvedValue(undefined),
      now: NOW,
      deviceOffline: deviceOnline,
    })
    expect(result.synced).toBe(1)
    expect(result.remaining).toEqual([])
    expect(result.persisted).toBe(false)
    // a fila continua no storage, exatamente a divergencia que o sinal denuncia
    expect(readQueue(storage).map((a) => a.id)).toEqual(['a1'])
  })

  it('reports persisted when the queue really was written', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'a1' })]),
    })
    const result = await syncQueue({
      storage,
      send: vi.fn().mockResolvedValue(undefined),
      now: NOW,
      deviceOffline: deviceOnline,
    })
    expect(result.persisted).toBe(true)
    expect(readQueue(storage)).toEqual([])
  })

  // --- evidencia de corrupcao nao pode ser reescrita a cada 15s ---

  it('cleans a queue that sanitizes to empty instead of re-detecting it forever', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([{ id: 'evil', path: '/users/me/face', body: {} }]),
    })
    expect(readQueue(storage)).toEqual([])
    const firstDetection = readCorruptQueueRecords(storage)[0].detectedAt

    // Segunda leitura (proximo ciclo de 15s): nada de novo a preservar.
    expect(readQueue(storage)).toEqual([])
    const records = readCorruptQueueRecords(storage)
    expect(records).toHaveLength(1)
    expect(records[0].detectedAt).toBe(firstDetection)
    expect(storage.getItem('omnipunt.offlineClockQueue')).toBe('[]')
  })

  it('does not rewrite the corrupt record when the same payload is read again', () => {
    // A fila fica ilegivel e nao da para limpar: mesmo assim o detectedAt tem de
    // continuar sendo o instante em que o problema apareceu.
    const storage = memoryStorage({ 'omnipunt.offlineClockQueue': '{not json' })
    readQueue(storage)
    const firstDetection = readCorruptQueueRecords(storage)[0].detectedAt
    const setItem = vi.spyOn(storage, 'setItem')
    readQueue(storage)
    expect(setItem).not.toHaveBeenCalled()
    expect(readCorruptQueueRecords(storage)[0].detectedAt).toBe(firstDetection)
  })

  it('keeps the first corruption when a second, different one shows up', () => {
    const storage = memoryStorage({ 'omnipunt.offlineClockQueue': '{not json' })
    readQueue(storage)
    storage.setItem('omnipunt.offlineClockQueue', 'still not json')
    readQueue(storage)
    expect(readCorruptQueueRecords(storage).map((r) => r.raw)).toEqual(['{not json', 'still not json'])
  })

  // --- politica do local sobrevive ao fechamento do app ---

  it('answers TERMINAL_QR from the last known config when the live one never loaded', () => {
    // Partida a frio sem rede: geofence e null e a recusa nunca disparava.
    const storage = memoryStorage()
    rememberOfflinePunchPolicy(storage, { userId: 'u1', locationValidationSource: 'TERMINAL_QR' })
    const cached = readOfflinePunchPolicy(storage, 'u1')
    expect(cached?.locationValidationSource).toBe('TERMINAL_QR')
    expect(requiresTerminalQr(undefined, cached)).toBe(true)
  })

  it('lets the live config override a stale cached one, in both directions', () => {
    const storage = memoryStorage()
    rememberOfflinePunchPolicy(storage, { userId: 'u1', locationValidationSource: 'TERMINAL_QR' })
    const cached = readOfflinePunchPolicy(storage, 'u1')
    expect(requiresTerminalQr('MOBILE', cached)).toBe(false)
    expect(requiresTerminalQr('TERMINAL_QR', null)).toBe(true)
  })

  it('fails OPEN when neither a live nor a cached config exists', () => {
    // Recusar batida offline em todo tenant que nunca usou QR seria pior do que
    // aceitar uma batida a mais para o supervisor conferir.
    expect(requiresTerminalQr(undefined, null)).toBe(false)
    expect(requiresTerminalQr(null, readOfflinePunchPolicy(memoryStorage(), 'u1'))).toBe(false)
  })

  it('does not apply another user cached policy on a shared device', () => {
    const storage = memoryStorage()
    rememberOfflinePunchPolicy(storage, { userId: 'u1', locationValidationSource: 'TERMINAL_QR' })
    expect(readOfflinePunchPolicy(storage, 'u2')).toBeNull()
    expect(requiresTerminalQr(undefined, readOfflinePunchPolicy(storage, 'u2'))).toBe(false)
  })

  it('survives a storage that refuses to remember the policy', () => {
    const storage = readOnlyStorage()
    expect(rememberOfflinePunchPolicy(storage, { userId: 'u1', locationValidationSource: 'TERMINAL_QR' })).toBe(false)
    expect(readOfflinePunchPolicy(storage, 'u1')).toBeNull()
  })

  // --- caminho ONLINE direto: outra pergunta, outro predicado ---

  it('does not turn a 429 or 408 on the direct path into "saved offline"', () => {
    // 429 e PIN_LOCKED (backend/src/controllers/time.controller.js: 5 erros de
    // PIN, 15 min) e tambem o rate limiter. Enfileirar aqui dizia "Sem conexao.
    // Ponto salvo localmente" com sinal cheio, num erro de autenticacao, e
    // guardava o PIN errado: o replay morre e o colaborador acaba pedindo ao
    // supervisor um lancamento manual de um turno que ele ja registrou —
    // entrada duplicada, turno pago duas vezes.
    expect(shouldQueueOfflinePunch(httpError('PIN temporariamente bloqueado', 429))).toBe(false)
    expect(shouldQueueOfflinePunch(httpError('request timeout', 408))).toBe(false)
    expect(shouldQueueOfflinePunch(httpError('nao autorizado', 401))).toBe(false)
    expect(shouldQueueOfflinePunch(httpError('invalido', 400))).toBe(false)
  })

  it('still saves offline when there was no verdict at all, or the server broke', () => {
    expect(shouldQueueOfflinePunch(new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldQueueOfflinePunch(new TypeError('Load failed'))).toBe(true)
    expect(shouldQueueOfflinePunch(new Error('Tempo de resposta excedido.'))).toBe(true)
    expect(shouldQueueOfflinePunch(httpError('Bad Gateway', 502))).toBe(true)
    expect(shouldQueueOfflinePunch(httpError('Internal Server Error', 500))).toBe(true)
  })

  it('keeps the two predicates deliberately different on 429 and 408', () => {
    // Compartilhar UMA funcao entre a fila e a tela foi a causa do defeito: o
    // 429 tem de continuar retentavel DENTRO da fila e nao-enfileiravel FORA.
    for (const status of [429, 408]) {
      expect(isRetryableReplayFailure(httpError('x', status))).toBe(true)
      expect(shouldQueueOfflinePunch(httpError('x', status))).toBe(false)
    }
    // E onde as duas concordam, elas concordam.
    for (const error of [new TypeError('Failed to fetch'), httpError('boom', 503)]) {
      expect(isRetryableReplayFailure(error)).toBe(true)
      expect(shouldQueueOfflinePunch(error)).toBe(true)
    }
  })

  // --- enfileirar durante o sync nao pode apagar a batida nova ---

  it('does not erase a punch enqueued while a send is in flight', async () => {
    // syncQueue trabalha sobre um snapshot e o await de send dura ate 15s. Se a
    // gravacao do fim usasse a fatia do snapshot, a batida feita nesse intervalo
    // sumiria logo depois da tela dizer "salvo localmente".
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'a1' })]),
    })
    const send = vi.fn().mockImplementation(async () => {
      enqueue(storage, { path: '/time/clock-out', body: {} }, new Date('2026-08-28T17:00:00.000Z'))
    })

    const result = await syncQueue({ storage, send, now: NOW, deviceOffline: deviceOnline })
    expect(result.synced).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(readQueue(storage).map((a) => a.path)).toEqual(['/time/clock-out'])
  })

  it('does not erase a punch enqueued while a failing send is in flight', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'a1' })]),
    })
    const send = vi.fn().mockImplementation(async () => {
      enqueue(storage, { path: '/time/clock-out', body: {} }, new Date('2026-08-28T17:00:00.000Z'))
      throw httpError('Internal Server Error', 500)
    })

    await syncQueue({ storage, send, now: NOW, deviceOffline: deviceOnline })
    // A pendente antiga continua na frente e a nova sobreviveu atras dela.
    expect(readQueue(storage).map((a) => a.path)).toEqual(['/time/clock-in', '/time/clock-out'])
  })

  it('does not erase a punch enqueued while a dropped item is being discarded', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'bad', attempts: 2 })]),
    })
    const send = vi.fn().mockImplementation(async () => {
      enqueue(storage, { path: '/time/clock-out', body: {} }, new Date('2026-08-28T17:00:00.000Z'))
      throw httpError('invalido', 400)
    })

    const result = await syncQueue({ storage, send, now: NOW, deviceOffline: deviceOnline })
    expect(result.dropped.map((a) => a.id)).toEqual(['bad'])
    expect(readQueue(storage).map((a) => a.path)).toEqual(['/time/clock-out'])
  })

  // --- decisoes que a tela toma, testadas fora da tela ---

  it('only warns about an uncleared queue when something was actually sent', async () => {
    // O componente ignorava `synced`: com o loop parando no item 0 e a gravacao
    // final falhando, ele dizia "as pendencias foram enviadas mas nao puderam
    // ser limpas" sem NADA ter sido enviado — a cada 15s, por cima do erro real.
    expect(syncNeedsStorageWarning({ synced: 0, persisted: false })).toBe(false)
    expect(syncNeedsStorageWarning({ synced: 1, persisted: false })).toBe(true)
    expect(syncNeedsStorageWarning({ synced: 0, persisted: true })).toBe(false)
    expect(syncNeedsStorageWarning({ synced: 2, persisted: true })).toBe(false)

    // E o cenario de ponta a ponta: storage que recusa toda escrita, item 0
    // falhando. Nada saiu, entao nao ha aviso de "enviadas mas nao limpas".
    const storage = readOnlyStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'a1' })]),
    })
    const result = await syncQueue({
      storage,
      send: vi.fn().mockRejectedValue(httpError('Internal Server Error', 500)),
      now: NOW,
      deviceOffline: deviceOnline,
    })
    expect(result.synced).toBe(0)
    expect(result.persisted).toBe(false)
    expect(syncNeedsStorageWarning(result)).toBe(false)
  })

  it('keeps a dropped punch visible even when the drop record itself could not be stored', async () => {
    // Sob pressao de cota o item sai da fila e o registro de descarte nao cabe.
    // Se a tela so relesse o storage, a batida sumiria sem rastro nenhum.
    const storage = readOnlyStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'bad', attempts: 2 })]),
    })
    const result = await syncQueue({
      storage,
      send: vi.fn().mockRejectedValue(httpError('ja existe um registro aberto', 400)),
      now: NOW,
      deviceOffline: deviceOnline,
    })
    expect(readDroppedPunches(storage)).toEqual([])
    expect(result.dropped.map((a) => a.id)).toEqual(['bad'])

    const shown = mergeDroppedPunches(readDroppedPunches(storage), result.dropped)
    expect(shown.map((a) => a.id)).toEqual(['bad'])
    expect(shown[0].occurredAt).toBe('2026-08-28T08:00:00.000Z')
  })

  it('merges the stored drop history with this cycle without duplicating it', async () => {
    const storage = memoryStorage({
      'omnipunt.offlineClockQueue': JSON.stringify([punch({ id: 'bad', attempts: 2 })]),
    })
    const older: DroppedPunch = {
      ...punch({ id: 'ontem' }),
      reason: 'TOO_OLD',
      droppedAt: '2026-08-27T10:00:00.000Z',
    }
    storage.setItem('omnipunt.droppedPunches', JSON.stringify([older]))

    const result = await syncQueue({
      storage,
      send: vi.fn().mockRejectedValue(httpError('invalido', 400)),
      now: NOW,
      deviceOffline: deviceOnline,
    })
    // O storage aceitou a gravacao, entao 'bad' esta nos dois lados: merge nao
    // pode mostrar a mesma batida duas vezes.
    const shown = mergeDroppedPunches(readDroppedPunches(storage), result.dropped)
    expect(shown.map((a) => a.id)).toEqual(['ontem', 'bad'])
  })

  // --- nonce por tentativa de batida ---

  it('gives every punch attempt a different nonce without needing a secure context', () => {
    // crypto.randomUUID exige contexto seguro, exatamente como crypto.subtle: o
    // nonce nao pode depender dele.
    const nonces = new Set(Array.from({ length: 500 }, () => createPunchNonce()))
    expect(nonces.size).toBe(500)
  })
})
