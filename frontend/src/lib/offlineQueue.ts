export const OFFLINE_CLOCK_PATHS = ['/time/clock-in', '/time/clock-out'] as const

export type OfflineClockPath = (typeof OFFLINE_CLOCK_PATHS)[number]

export type OfflineClockAction = {
  id: string
  path: OfflineClockPath
  // filas gravadas antes desta versao nao tem occurredAt: o tipo precisa ser honesto
  occurredAt?: string
  body: Record<string, unknown>
  attempts: number
  // Falhas seguidas SEM resposta HTTP nenhuma, com o aparelho se declarando
  // online. Contador separado de `attempts` (que so conta veredito do servidor).
  offlineAttempts?: number
}

export type DropReason = 'REJECTED' | 'TOO_OLD' | 'UNSENDABLE'

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
const POLICY_KEY = 'omnipunt.offlinePunchPolicy'
const MAX_ATTEMPTS = 3
const MAX_DROPPED_RECORDS = 50
const MAX_CORRUPT_RECORDS = 5
const TERMINAL_QR = 'TERMINAL_QR'
// Teto de falhas seguidas sem NENHUMA resposta HTTP tendo o aparelho se
// declarado online. Vale SO para item legado sem occurredAt — ver o gate em
// syncQueue. Nesse item o TOO_OLD de 48h nunca dispara, entao sem teto a fila
// trava para sempre e a batida some sem nunca virar registro visivel. Em item
// com occurredAt o teto e proibido: `navigator.onLine === true` + zero status e
// a assinatura de QUALQUER queda de transporte (nginx fora, backend
// reiniciando, deploy, cert TLS vencido, DNS, firewall corporativo, portal
// cativo respondendo cross-origin), e o contador e monotonico e persistido —
// vinte piscadas de sinal ao longo de um dia destruiriam uma batida que
// sincronizaria sozinha. Em WKWebView/Android WebView `navigator.onLine` diz
// "tem interface de rede", nao "alcanco a API", entao o sinal e ainda mais
// fraco no alvo real.
export const MAX_UNVERIFIED_OFFLINE_ATTEMPTS = 20
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
export const errorStatus = (error: unknown): number | undefined => {
  const status = (error as { status?: number } | null | undefined)?.status
  return typeof status === 'number' ? status : undefined
}

// 429 e 408 sao veredito do servidor, mas veredito TEMPORARIO: 429 sai do rate
// limiter por cliente e tambem do PIN_LOCKED (backend/src/controllers/time.controller.js),
// 408 e timeout de gateway. Tratar como definitivo apagaria em 45s (3 ciclos)
// uma batida que passaria assim que o bloqueio/limite expirasse.
const RETRYABLE_STATUSES = new Set([408, 429])

// PERGUNTA 1 — "esta batida JA ENFILEIRADA merece outra tentativa?".
// So syncQueue usa. Aqui 429/408 sao retentaveis: o item ja esta guardado, o
// colaborador ja foi avisado, e o replay so precisa esperar o bloqueio expirar.
export const isRetryableReplayFailure = (error: unknown): boolean => {
  const status = errorStatus(error)
  if (typeof status === 'number') return status >= 500 || RETRYABLE_STATUSES.has(status)
  return true
}

// PERGUNTA 2 — "a batida que o colaborador ACABOU de fazer, olhando a tela,
// deve virar pendencia offline em vez de erro?". So os dois catch do caminho
// online direto usam. A resposta e DIFERENTE da pergunta 1 e por isso tem nome
// proprio: as duas dividiam uma funcao so, e foi exatamente isso que fez
// 429/408 vazarem para ca.
//
// Enfileirar so quando NAO houve veredito nenhum (sem status: fetch estourou,
// DNS, TLS, WebView suspensa, timeout) ou quando o proprio servidor quebrou
// (5xx). 429 PIN_LOCKED e 408 sao veredito sobre ESTA tentativa e o colaborador
// precisa ler o motivo: dizer "salvo localmente" com sinal cheio manda ele
// embora, e o corpo enfileirado ainda carrega o PIN errado que gerou o
// bloqueio — ele morre no replay e vira um pedido de lancamento manual para um
// turno que ja foi registrado (entrada duplicada, turno pago duas vezes).
export const shouldQueueOfflinePunch = (error: unknown): boolean => {
  const status = errorStatus(error)
  return status === undefined || status >= 500
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

  const offlineAttempts =
    typeof item.offlineAttempts === 'number' && item.offlineAttempts > 0 ? item.offlineAttempts : 0

  return {
    id: item.id as string,
    path: item.path as OfflineClockPath,
    body: item.body as Record<string, unknown>,
    attempts: typeof item.attempts === 'number' && item.attempts >= 0 ? item.attempts : 0,
    ...(occurredAt ? { occurredAt } : {}),
    ...(offlineAttempts > 0 ? { offlineAttempts } : {}),
  }
}

// Mantem a forma do objeto identica a que normalizeItem devolve: contador zerado
// e campo ausente, e nao `offlineAttempts: 0`. Sem isso o item em memoria deixa
// de ser igual ao item relido do storage.
const withOfflineAttempts = (action: OfflineClockAction, value: number): OfflineClockAction => {
  const { offlineAttempts: _previous, ...rest } = action
  return value > 0 ? { ...rest, offlineAttempts: value } : rest
}

export type CorruptQueueRecord = {
  sourceKey: string
  raw: string
  detectedAt: string
}

const isCorruptRecord = (value: unknown): value is CorruptQueueRecord =>
  isPlainObject(value) && typeof value.raw === 'string' && typeof value.sourceKey === 'string'

export const readCorruptQueueRecords = (storage: QueueStorage): CorruptQueueRecord[] => {
  try {
    const raw = storage.getItem(CORRUPT_QUEUE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    // Formato antigo gravava um objeto unico; ele continua sendo prova.
    if (Array.isArray(parsed)) return parsed.filter(isCorruptRecord)
    return isCorruptRecord(parsed) ? [parsed] : []
  } catch {
    return []
  }
}

// Nunca sobrescrever uma fila ilegivel sem antes guardar o original: o conteudo
// bruto e a unica prova de que houve batida. Guarda uma LISTA: uma segunda
// corrupcao nao pode apagar a evidencia da primeira.
const preserveCorruptQueue = (storage: QueueStorage, sourceKey: string, raw: string) => {
  try {
    const existing = readCorruptQueueRecords(storage)
    // Mesma carga ja registrada: nao reescreve nada. Reescrever a cada leitura
    // (uma a cada 15s) trocaria o detectedAt original pelo instante atual e
    // destruiria justamente o horario em que o problema apareceu.
    if (existing.some((record) => record.raw === raw && record.sourceKey === sourceKey)) return

    const next = [...existing, { sourceKey, raw, detectedAt: new Date().toISOString() }].slice(
      -MAX_CORRUPT_RECORDS
    )
    storage.setItem(CORRUPT_QUEUE_KEY, JSON.stringify(next))
  } catch {
    // storage cheio/indisponivel: nada mais a fazer aqui.
  }
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
    if (sanitized.length !== parsed.length) {
      preserveCorruptQueue(storage, sourceKey, raw)
      // Grava a fila ja limpa. Sem isto os itens invalidos ficam no storage e
      // cada leitura (uma a cada 15s) redetecta a mesma corrupcao — e uma fila
      // que sobra vazia nunca era limpa, porque syncQueue sai antes de gravar.
      if (sourceKey === QUEUE_KEY) writeQueue(storage, sanitized)
    }
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

// A config de geofence chega por GET /time/geofence e vive so em estado React.
// Em partida a frio sem rede ela e null, e `geofence?.locationValidationSource
// === 'TERMINAL_QR'` curto-circuita: a recusa que existe justamente para o caso
// offline nunca dispara, a batida entra na fila sem qrToken e morre no replay
// com MISSING_QR_TOKEN. Guardar a ultima config conhecida (publica, minuscula,
// sem segredo) e o que faz a recusa acontecer. Escopo por usuario: aparelho
// compartilhado nao pode aplicar a politica de um tenant no outro.
export type OfflinePunchPolicy = {
  userId?: string
  locationValidationSource?: string
  cachedAt: string
}

export const rememberOfflinePunchPolicy = (
  storage: QueueStorage,
  policy: { userId?: string | null; locationValidationSource?: string | null },
  now: Date = new Date()
): boolean => {
  try {
    storage.setItem(
      POLICY_KEY,
      JSON.stringify({
        ...(policy.userId ? { userId: policy.userId } : {}),
        ...(policy.locationValidationSource
          ? { locationValidationSource: policy.locationValidationSource }
          : {}),
        cachedAt: now.toISOString(),
      })
    )
    return true
  } catch {
    return false
  }
}

export const readOfflinePunchPolicy = (
  storage: QueueStorage,
  userId?: string | null
): OfflinePunchPolicy | null => {
  try {
    const raw = storage.getItem(POLICY_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainObject(parsed) || typeof parsed.cachedAt !== 'string') return null
    if (typeof parsed.userId === 'string' && parsed.userId !== (userId || '')) return null
    return parsed as OfflinePunchPolicy
  } catch {
    return null
  }
}

// Config viva manda sempre. Sem ela vale a ultima conhecida — stale, mas
// conhecida. Sem nenhuma das duas devolve false DE PROPOSITO: falhar fechado no
// desconhecido recusaria batida offline em todo tenant que nunca usou QR, o que
// e pior que aceitar uma batida a mais para o supervisor conferir.
export const requiresTerminalQr = (
  liveSource: string | null | undefined,
  cached: OfflinePunchPolicy | null
): boolean => {
  if (typeof liveSource === 'string' && liveSource.length > 0) return liveSource === TERMINAL_QR
  return cached?.locationValidationSource === TERMINAL_QR
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
    // storage cheio: a gravacao falhou e o item ja saiu da fila. A unica copia
    // que sobra e a que vai no retorno de syncQueue — a UI TEM de usar esse
    // array (mergeDroppedPunches), nunca so reler o storage, ou a batida some
    // sem deixar rastro nenhum.
  }

  return entry
}

// Fonte da verdade da UI: o que o storage guarda MAIS o que syncQueue acabou de
// devolver. Reler so o storage perde exatamente o caso em que o registro de
// descarte nao coube; usar so o retorno perde os descartes de ciclos passados.
export const mergeDroppedPunches = (
  stored: DroppedPunch[],
  justDropped: DroppedPunch[]
): DroppedPunch[] => {
  const known = new Set(stored.map((item) => item.id))
  return [...stored, ...justDropped.filter((item) => !known.has(item.id))].slice(-MAX_DROPPED_RECORDS)
}

// A UI so pode falar em "pendencias enviadas mas nao limpas" se ALGO saiu. Com
// synced === 0 a gravacao que falhou e a da propria fila intacta: o aviso seria
// falso, reapareceria a cada 15s e apagaria o erro real da tela.
export const syncNeedsStorageWarning = (result: { synced: number; persisted: boolean }): boolean =>
  !result.persisted && result.synced > 0

// Identificador de UMA tentativa de batida, carregado no corpo da requisicao.
// A chave de idempotencia do servidor e sha256(data | body) por rota+ator: com
// PIN, sem GPS e sem notas o corpo da entrada da manha e byte a byte igual ao da
// tarde, mesma chave, e a segunda batida volta 202 "duplicada ignorada" — turno
// da tarde nunca registrado. Nao usa crypto.randomUUID de proposito: ela exige
// contexto seguro e some exatamente nas mesmas origens em que crypto.subtle some.
export const createPunchNonce = (now: Date = new Date()): string =>
  `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

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

// syncQueue trabalha sobre um SNAPSHOT, mas cada await de `send` dura ate 15s e
// o colaborador pode bater ponto nesse meio-tempo. Gravar uma fatia do snapshot
// (`queue.slice(i + 1)`) apagaria em silencio a batida recem-enfileirada, logo
// depois da tela ter dito "salvo localmente". Toda escrita do loop passa por
// aqui: rele o storage vivo e mexe SO no id em questao.
const removeFromQueue = (storage: QueueStorage, id: string): boolean =>
  writeQueue(storage, readQueue(storage).filter((item) => item.id !== id))

const patchInQueue = (storage: QueueStorage, updated: OfflineClockAction): boolean => {
  const live = readQueue(storage)
  // Sumiu do storage entre a leitura e agora: nao ressuscita nada.
  if (!live.some((item) => item.id === updated.id)) return true
  return writeQueue(storage, live.map((item) => (item.id === updated.id ? updated : item)))
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
  deviceOffline = isDeviceOffline,
}: {
  storage: QueueStorage
  send: (path: string, body: Record<string, unknown>) => Promise<unknown>
  now?: Date
  deviceOffline?: () => boolean
}) => {
  const queue = readQueue(storage)
  // Sem pendencia nao se toca no storage: syncQueue roda a cada 15s.
  if (queue.length === 0) {
    return { synced: 0, remaining: [] as OfflineClockAction[], dropped: [] as DroppedPunch[], persisted: true }
  }

  const dropped: DroppedPunch[] = []
  let remaining: OfflineClockAction[] = []
  let synced = 0
  // Agrega TODAS as escritas do ciclo, e nao so a ultima: com o storage
  // recusando setItem (Safari privado, cota estourada) a divergencia comeca na
  // primeira remocao, nao no fim.
  let persisted = true
  const record = (written: boolean) => {
    persisted = written && persisted
  }

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
      record(removeFromQueue(storage, action.id))
      continue
    }

    try {
      await send(action.path, {
        ...action.body,
        ...(action.occurredAt ? { occurredAt: action.occurredAt } : {}),
      })
      synced += 1
      record(removeFromQueue(storage, action.id))
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined

      if (isRetryableReplayFailure(error)) {
        if (typeof errorStatus(error) === 'number') {
          // Alguem respondeu (5xx/429/408): transitorio, nao gasta tentativa e
          // prova que o transporte funciona — zera o contador sem veredito.
          const head = withOfflineAttempts(action, 0)
          remaining = [head, ...queue.slice(i + 1)]
          record(patchInQueue(storage, head))
          break
        }

        // Sem status: ninguem respondeu. Se o proprio aparelho ja se declara
        // offline nao ha duvida, e retentar para sempre e o comportamento certo.
        if (deviceOffline()) {
          remaining = queue.slice(i)
          // Nada mudou neste item: nao se escreve no storage a cada 15s.
          break
        }

        // Aparelho diz estar online e mesmo assim nada volta com status.
        const offlineAttempts = (action.offlineAttempts ?? 0) + 1

        // O teto SO vale onde nada mais limita o item. Com occurredAt, o
        // isTooOld la em cima ja termina a batida em 48h com registro duravel
        // TOO_OLD — o teto nao acrescentaria nada e so adiantaria a destruicao
        // de uma batida valida em qualquer queda de transporte corriqueira, que
        // tem exatamente esta assinatura (online, sem status). Sem occurredAt
        // (fila legada) o TOO_OLD nunca dispara: aqui, e so aqui, o teto e o
        // unico jeito de a batida virar registro visivel em vez de travar a
        // fila para sempre.
        if (!action.occurredAt && offlineAttempts >= MAX_UNVERIFIED_OFFLINE_ATTEMPTS) {
          dropped.push(
            recordDroppedPunch(
              storage,
              action,
              'UNSENDABLE',
              message ||
                'O aplicativo nao conseguiu enviar esta batida mesmo com o aparelho conectado.',
              now
            )
          )
          record(removeFromQueue(storage, action.id))
          continue
        }

        const head = withOfflineAttempts(action, offlineAttempts)
        remaining = [head, ...queue.slice(i + 1)]
        record(patchInQueue(storage, head))
        break
      }

      const attempts = action.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        dropped.push(recordDroppedPunch(storage, action, 'REJECTED', message, now))
        // Item efetivamente descartado: a fila pode seguir sem quebrar a ordem.
        record(removeFromQueue(storage, action.id))
        continue
      }

      // Falha nao definitiva: a batida i continua pendente, entao nada depois
      // dela pode ser aplicado antes — um clock-out aplicado antes do clock-in
      // atrasado fecharia o registro errado.
      const head = withOfflineAttempts({ ...action, attempts }, 0)
      remaining = [head, ...queue.slice(i + 1)]
      record(patchInQueue(storage, head))
      break
    }
  }

  // CUIDADO: `remaining` e a cauda nao processada do SNAPSHOT, util para
  // assertiva de ordem e de contador. Nao e a fila viva — ela nao conhece a
  // batida enfileirada durante este ciclo. Quem precisa do numero de pendentes
  // le o storage (readQueue), que e a fonte da verdade.
  return { synced, remaining, dropped, persisted }
}
