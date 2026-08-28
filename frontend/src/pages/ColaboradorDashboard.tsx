import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { usePlan } from '../hooks/usePlan'
import { useTimeZone } from '../context/TimezoneContext'
import { useTranslation } from 'react-i18next'
import { Circle, CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import * as faceapi from 'face-api.js'
import { formatDateTimeWithTimeZone, formatTimeWithTimeZone } from '../lib/timezone'
import {
  clearDroppedPunches,
  createPunchNonce,
  enqueue,
  isDeviceOffline,
  mergeDroppedPunches,
  readDroppedPunches,
  readOfflinePunchPolicy,
  readQueue,
  rememberOfflinePunchPolicy,
  requiresTerminalQr,
  shouldQueueOfflinePunch,
  syncNeedsStorageWarning,
  syncQueue,
  type DroppedPunch,
  type OfflineClockPath,
} from '../lib/offlineQueue'
import DualClock from '../components/DualClock'

type TimeEntry = {
  id: string
  clockIn: string
  clockOut: string | null
  notes?: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
}

type CurrentEntryResponse = {
  hasOpenEntry: boolean
  entry: {
    id: string
    clockIn: string
    breakMinutes?: number
    breakStartedAt?: string | null
    isOnBreak?: boolean
    dailyProgress?: {
      contractDailyMinutes: number
      workedMinutesBeforeEntry: number
      currentEntryWorkedMinutes: number
      totalWorkedMinutes: number
      hasReachedDailyTarget: boolean
      reachedDailyTargetAt: string | null
      overtimeMinutesSoFar: number
      remainingRegularMinutes: number
    }
  } | null
}

type GeofenceConfig = {
  geolocationEnabled?: boolean
  enabled: boolean
  mode: 'ALERT' | 'REJECT' | string
  locationValidationSource?: 'MOBILE' | 'TERMINAL_QR' | string
  requireLocation: boolean
  center: {
    lat: number
    lng: number
  } | null
  radiusMeters: number
}

type GeofenceResponse = {
  geofence: GeofenceConfig
}

type FaceStatusResponse = {
  face: {
    enrolled: boolean
    updatedAt: string | null
    threshold: number
  }
}

type LivenessData = {
  blinkDetected: boolean
  headMovementDetected: boolean
  blinkCount: number
  lookLeftDetected?: boolean
  lookRightDetected?: boolean
  lookUpDetected?: boolean
  lookDownDetected?: boolean
  headMovementDelta: number
  frameCount: number
  capturedAt: string
}

type BarcodeDetectorCode = {
  rawValue?: string
}

type BarcodeDetectorInstance = {
  detect: (source: ImageBitmapSource) => Promise<BarcodeDetectorCode[]>
}

type BarcodeDetectorStatic = {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance
  getSupportedFormats?: () => Promise<string[]>
}

const FACE_MODEL_SOURCES = [
  '/models',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model',
]

const LIVENESS_CAPTURE_TIMEOUT_MS = 7000
const LIVENESS_FRAME_INTERVAL_MS = 120
const LIVENESS_MIN_VALID_FRAMES = 8
const LIVENESS_HEAD_DELTA_THRESHOLD = 0.08
const FACE_ENROLL_GUIDED_TIMEOUT_MS = 22000
const FACE_CENTER_MIN = 0.43
const FACE_CENTER_MAX = 0.57
const FACE_TURN_DELTA = 0.08
const FACE_VERTICAL_CENTER_MIN = 0.44
const FACE_VERTICAL_CENTER_MAX = 0.56
const FACE_VERTICAL_TURN_DELTA = 0.06
const getBarcodeDetector = () =>
  (window as Window & { BarcodeDetector?: BarcodeDetectorStatic }).BarcodeDetector

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

const ColaboradorDashboard = () => {
  const { session } = useAuth()
  const { isPro } = usePlan()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const { viewTimeZone } = useTimeZone()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [currentEntry, setCurrentEntry] = useState<CurrentEntryResponse['entry'] | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [currentBreakMs, setCurrentBreakMs] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [pin, setPin] = useState('')
  const [scannedQrToken, setScannedQrToken] = useState('')
  const [scannedQrSummary, setScannedQrSummary] = useState('')
  const [qrScannerOpen, setQrScannerOpen] = useState(false)
  const [qrScanLoading, setQrScanLoading] = useState(false)
  const [qrScanError, setQrScanError] = useState('')
  const [loading, setLoading] = useState(false)
  const [breakLoading, setBreakLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)
  const [syncingOfflineQueue, setSyncingOfflineQueue] = useState(false)
  const [droppedPunches, setDroppedPunches] = useState<DroppedPunch[]>([])
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState('')
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null)
  const [geofence, setGeofence] = useState<GeofenceConfig | null>(null)
  const [faceLoading, setFaceLoading] = useState(false)
  const [faceError, setFaceError] = useState('')
  const [faceModelsReady, setFaceModelsReady] = useState(false)
  const [faceModelSource, setFaceModelSource] = useState<string | null>(null)
  const [faceStatus, setFaceStatus] = useState<FaceStatusResponse['face'] | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [enrollModalOpen, setEnrollModalOpen] = useState(false)
  const [enrollInstruction, setEnrollInstruction] = useState(
    t('Center your face in frame', 'Centralize seu rosto no quadro')
  )
  const [enrollProgress, setEnrollProgress] = useState(0)
  const [enrollStep, setEnrollStep] = useState<'CENTER' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'>('CENTER')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const qrVideoRef = useRef<HTMLVideoElement | null>(null)
  const qrStreamRef = useRef<MediaStream | null>(null)
  const qrScanAnimationRef = useRef<number | null>(null)
  const qrScannerActiveRef = useRef(false)
  const dailyTargetNotifiedRef = useRef(false)
  const syncingQueueRef = useRef(false)
  // Nonce da tentativa de batida em curso. Sobrevive ao erro (retentar a MESMA
  // tentativa continua deduplicado) e e descartado no sucesso (a proxima batida
  // e outra batida). Ver startPunchAttempt.
  const punchAttemptRef = useRef<{ path: OfflineClockPath; nonce: string } | null>(null)

  const token = session?.access_token
  const userId = session?.user?.id ?? null

  const resolveBreakMs = (entry: CurrentEntryResponse['entry'] | null, nowMs: number) => {
    if (!entry?.clockIn) return 0
    const storedBreakMinutes = Math.max(0, Math.floor(Number(entry.breakMinutes || 0)))
    const breakStartedAt = entry.breakStartedAt ? new Date(entry.breakStartedAt).getTime() : null
    const ongoingBreakMs = breakStartedAt ? Math.max(0, nowMs - breakStartedAt) : 0
    return storedBreakMinutes * 60 * 1000 + ongoingBreakMs
  }

  const resolveElapsedMs = (entry: CurrentEntryResponse['entry'] | null, nowMs: number) => {
    if (!entry?.clockIn) return null
    const startedAt = new Date(entry.clockIn).getTime()
    const elapsed = Math.max(0, nowMs - startedAt - resolveBreakMs(entry, nowMs))
    return elapsed
  }

  const activeEntry = useMemo(() => entries.find((entry) => !entry.clockOut) ?? null, [entries])
  const geolocationEnabled = geofence?.geolocationEnabled !== false
  const mapCenter: [number, number] = useMemo(() => {
    if (currentPosition) return [currentPosition.lat, currentPosition.lng]
    if (geofence?.center) return [geofence.center.lat, geofence.center.lng]
    return [-23.55052, -46.63331]
  }, [currentPosition, geofence])

  const getBrowserLocation = async () => {
    if (!navigator.geolocation) {
      throw new Error(t('Geolocation is not supported in this browser', 'Geolocalizacao nao suportada neste navegador'))
    }

    return new Promise<{ lat: number; lng: number }>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          })
        },
        (geoErr) => {
          reject(new Error(geoErr.message || t('Could not get location', 'Nao foi possivel obter localizacao')))
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      )
    })
  }

  const refreshLocation = async () => {
    setGeoLoading(true)
    setGeoError('')
    try {
      const location = await getBrowserLocation()
      setCurrentPosition(location)
      return location
    } catch (err) {
      const message = err instanceof Error ? err.message : t('Failed to get location', 'Falha ao obter localizacao')
      setGeoError(message)
      throw err
    } finally {
      setGeoLoading(false)
    }
  }

  const loadEntries = async () => {
    if (!token) return
    const response = await apiFetch<{ entries: TimeEntry[] }>('/time/me', { token })
    setEntries(response.entries)
  }

  const syncOfflineClockQueue = async () => {
    // O ref fecha a janela entre duas chamadas concorrentes (intervalo + evento
    // online) que o estado, assincrono, deixaria passar: reenviar batida e pagar duas vezes.
    if (!token || syncingQueueRef.current) return
    syncingQueueRef.current = true
    setSyncingOfflineQueue(true)

    try {
      // Idempotencia LIGADA no replay: buildIdempotencyHeaders faz hash de
      // `data | body`, e o body de uma batida enfileirada carrega occurredAt
      // (unico por batida) alem do clientNonce da tentativa. Se o app morrer
      // depois do POST e antes de gravar a fila, o reenvio volta 202 duplicado
      // em vez de abrir um segundo registro. A colisao de chave continua
      // existindo no caminho ONLINE direto, que nunca teve occurredAt: e o
      // clientNonce, e so ele, que separa a batida da manha da batida da tarde
      // quando o corpo e identico (PIN, sem GPS, sem notas).
      const { synced, dropped, persisted } = await syncQueue({
        storage: window.localStorage,
        send: (path, body) => apiFetch(path, { token, method: 'POST', body }),
      })
      // O storage e a fonte da verdade, sempre: se a gravacao falhou (Safari
      // privado recusa todo setItem) ele ainda guarda o que ja foi enviado, e
      // mostrar "0 pendentes" seria mentira; se deu certo, ele ja inclui a
      // batida que o colaborador enfileirou DURANTE este ciclo, que o
      // `remaining` do snapshot nao conhece.
      setPendingSyncCount(readQueue(window.localStorage).length)

      if (dropped.length > 0) {
        // Descarte nao pode viver so num <p> transitorio: fica gravado ate ter
        // ciencia. Se o storage estava cheio o registro de descarte nao coube, e
        // o array devolvido por syncQueue e a UNICA copia que sobrou — reler so
        // o storage faria a batida sumir sem rastro nenhum.
        setDroppedPunches(mergeDroppedPunches(readDroppedPunches(window.localStorage), dropped))
      }
      // So avisa "enviadas mas nao limpas" se algo REALMENTE saiu. Com synced
      // === 0 (o loop parou no item 0) o aviso era falso, reaparecia a cada 15s
      // e apagava da tela o erro de verdade.
      if (syncNeedsStorageWarning({ synced, persisted })) {
        setError(
          t(
            'Pending punches were sent but could not be cleared from this device (storage unavailable or full). They may be re-sent; check your history with your supervisor.',
            'As pendencias foram enviadas mas nao puderam ser limpas deste aparelho (armazenamento indisponivel ou cheio). Elas podem ser reenviadas; confira seu historico com o supervisor.'
          )
        )
      }
      if (synced > 0) {
        if (persisted) {
          setSuccess(t('Offline pending items synced successfully.', 'Pendencias offline sincronizadas com sucesso.'))
        }
        await loadEntries()
        await loadCurrentEntry()
      }
    } finally {
      // Sem isto, um throw (QuotaExceededError no Safari privado, por exemplo)
      // travaria a flag e nenhuma sincronizacao rodaria de novo ate remontar.
      syncingQueueRef.current = false
      setSyncingOfflineQueue(false)
    }
  }

  // A chave de idempotencia do servidor e sha256(data | corpo) por rota+ator. Um
  // usuario de PIN com GPS negado e sem notas manda `{notes:"",pin:"1234"}` de
  // manha e o MESMO byte a byte a tarde: mesma chave, e a segunda batida volta
  // 202 "duplicada ignorada" com res.ok true — o turno da tarde nunca e gravado.
  // O nonce nasce com a tentativa e SOBREVIVE ao erro (clicar de novo depois de
  // uma falha de rede e a mesma tentativa e precisa continuar deduplicada); so o
  // sucesso encerra a tentativa, e a batida seguinte ganha nonce novo.
  const startPunchAttempt = (path: OfflineClockPath) => {
    const current = punchAttemptRef.current
    if (current?.path === path) return current.nonce

    const nonce = createPunchNonce()
    punchAttemptRef.current = { path, nonce }
    return nonce
  }

  const finishPunchAttempt = () => {
    punchAttemptRef.current = null
  }

  // Uma batida enfileirada so consegue ser reenviada com PIN. O descriptor facial
  // nao ajuda: a prova de vida exige capturedAt com menos de 15s (backend/src/utils/liveness.js),
  // entao qualquer replay chega vencido. O QR do terminal e de uso unico e curta
  // duracao (consumeTerminalQrToken), entao tambem chega vencido. Decisao de
  // produto: bater ponto sem sinal exige PIN.
  const offlinePunchBlocker = () => {
    // Em partida a frio sem rede o GET /time/geofence nunca respondeu e
    // `geofence` e null: a comparacao direta curto-circuitava e a recusa
    // abaixo — feita exatamente para o caso offline — nunca disparava. A ultima
    // config conhecida deste usuario decide quando a viva nao existe; sem
    // nenhuma das duas segue liberado, porque recusar batida offline em tenant
    // que nunca usou QR seria pior.
    if (requiresTerminalQr(geofence?.locationValidationSource, readOfflinePunchPolicy(window.localStorage, userId))) {
      return t(
        'This site validates punches by terminal QR, which cannot be revalidated later. Punching here requires a connection.',
        'Este local valida o ponto pelo QR do terminal, que nao pode ser revalidado depois. Aqui o registro exige conexao.'
      )
    }

    if (!pin.trim()) {
      return t(
        'Without a connection, punching requires your PIN: face recognition cannot be validated later. Enter your PIN and try again. If you have no PIN, ask your administrator.',
        'Sem conexao, o registro de ponto exige seu PIN: o reconhecimento facial nao pode ser validado depois. Informe seu PIN e tente novamente. Se voce nao tem PIN, procure o administrador.'
      )
    }

    return null
  }

  const queueOfflinePunch = (path: OfflineClockPath) => {
    const blocker = offlinePunchBlocker()
    if (blocker) {
      // Melhor recusar na cara do colaborador do que aceitar uma batida que
      // seria descartada em silencio no replay.
      setError(blocker)
      return
    }

    const { persisted } = enqueue(window.localStorage, {
      path,
      body: {
        notes,
        ...(currentPosition ? { latitude: currentPosition.lat, longitude: currentPosition.lng } : {}),
        pin: pin.trim(),
        clientNonce: startPunchAttempt(path),
      },
    })

    if (!persisted) {
      setError(
        t(
          'Could not save the punch on this device (storage unavailable or full). Write down the time and tell your supervisor.',
          'Nao foi possivel salvar a batida neste aparelho (armazenamento indisponivel ou cheio). Anote o horario e avise seu supervisor.'
        )
      )
      return
    }

    // Batida guardada: a tentativa terminou aqui. O replay reusa o corpo
    // gravado, entao continua carregando este mesmo nonce.
    finishPunchAttempt()
    setPendingSyncCount(readQueue(window.localStorage).length)
    setSuccess(
      path === '/time/clock-in'
        ? t('No connection. Clock-in saved locally and pending sync.', 'Sem conexão. Clock-in salvo localmente e pendente de sincronização.')
        : t('No connection. Clock-out saved locally and pending sync.', 'Sem conexão. Clock-out salvo localmente e pendente de sincronização.')
    )
  }

  const acknowledgeDroppedPunches = () => {
    clearDroppedPunches(window.localStorage)
    setDroppedPunches([])
  }

  const loadCurrentEntry = async () => {
    if (!token) return
    const response = await apiFetch<CurrentEntryResponse>('/time/current', { token })
    setCurrentEntry(response.entry)

    const reachedDailyTarget = Boolean(response.entry?.dailyProgress?.hasReachedDailyTarget)
    if (reachedDailyTarget && !dailyTargetNotifiedRef.current) {
      setSuccess(
        t(
          'You reached your daily workload. From now on, time will be counted as overtime.',
          'Voce atingiu a carga horaria do dia. A partir de agora o tempo sera contabilizado como hora extra.'
        )
      )
      dailyTargetNotifiedRef.current = true
    }

    if (!response.entry || !reachedDailyTarget) {
      dailyTargetNotifiedRef.current = false
    }

    setElapsedMs(resolveElapsedMs(response.entry, Date.now()))
    setCurrentBreakMs(resolveBreakMs(response.entry, Date.now()))
  }

  const loadGeofence = async () => {
    if (!token) return null
    const response = await apiFetch<GeofenceResponse>('/time/geofence', { token })
    setGeofence(response.geofence)
    // Config publica e minuscula, sem segredo: guardada para a proxima abertura
    // do app sem rede saber se este local exige QR do terminal.
    rememberOfflinePunchPolicy(window.localStorage, {
      userId,
      locationValidationSource: response.geofence?.locationValidationSource,
    })
    return response.geofence
  }

  const loadFaceStatus = async () => {
    if (!token) return
    const response = await apiFetch<FaceStatusResponse>('/users/me/face', { token })
    setFaceStatus(response.face)
  }

  const loadFaceModels = async () => {
    let loaded = false
    let lastError: unknown = null

    for (const source of FACE_MODEL_SOURCES) {
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(source),
          faceapi.nets.faceLandmark68Net.loadFromUri(source),
          faceapi.nets.faceRecognitionNet.loadFromUri(source),
        ])

        setFaceModelsReady(true)
        setFaceModelSource(source)
        setFaceError('')
        loaded = true
        break
      } catch (error) {
        lastError = error
      }
    }

    if (!loaded) {
      throw lastError || new Error(t('Failed to load face models', 'Falha ao carregar modelos faciais'))
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setCameraActive(false)
  }

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(t('Camera is not supported in this browser', 'Camera nao suportada neste navegador'))
    }

    if (!faceModelsReady) {
      throw new Error(
        t(
          'Face models are not loaded yet. Please wait a few seconds.',
          'Modelos faciais ainda nao carregados. Aguarde alguns segundos.'
        )
      )
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    })

    streamRef.current = stream

    if (videoRef.current) {
      videoRef.current.srcObject = stream
      await videoRef.current.play()
    }

    setCameraActive(true)
  }

  const extractFaceDescriptor = async () => {
    if (!videoRef.current) {
      throw new Error(t('Camera is not initialized', 'Camera nao inicializada'))
    }

    const result = await faceapi
      .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor()

    if (!result) {
      throw new Error(t('No face detected. Center your face and try again.', 'Nenhum rosto detectado. Centralize seu rosto e tente novamente.'))
    }

    return Array.from(result.descriptor)
  }

  const collectLivenessData = async (): Promise<LivenessData> => {
    if (!videoRef.current) {
      throw new Error(t('Camera is not initialized', 'Camera nao inicializada'))
    }

    let frameCount = 0
    let minNoseRatio = Number.POSITIVE_INFINITY
    let maxNoseRatio = Number.NEGATIVE_INFINITY
    let minNoseYRatio = Number.POSITIVE_INFINITY
    let maxNoseYRatio = Number.NEGATIVE_INFINITY

    const startedAt = Date.now()

    while (Date.now() - startedAt <= LIVENESS_CAPTURE_TIMEOUT_MS) {
      const result = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()

      if (result) {
        frameCount += 1

        const jaw = result.landmarks.getJawOutline()
        const nose = result.landmarks.getNose()
        const jawLeft = jaw[0]
        const jawRight = jaw[jaw.length - 1]
        const leftBrow = result.landmarks.getLeftEyeBrow()
        const rightBrow = result.landmarks.getRightEyeBrow()
        const browAnchor =
          leftBrow[Math.floor(leftBrow.length / 2)] || rightBrow[Math.floor(rightBrow.length / 2)]
        const jawBottom = jaw[Math.floor(jaw.length / 2)]
        const noseTip = nose[3] || nose[Math.floor(nose.length / 2)]

        if (jawLeft && jawRight && browAnchor && jawBottom && noseTip) {
          const jawWidth = Math.max(1, jawRight.x - jawLeft.x)
          const jawHeight = Math.max(1, Math.abs(jawBottom.y - browAnchor.y))
          const normalizedNoseX = (noseTip.x - jawLeft.x) / jawWidth
          const normalizedNoseY = (noseTip.y - browAnchor.y) / jawHeight
          minNoseRatio = Math.min(minNoseRatio, normalizedNoseX)
          maxNoseRatio = Math.max(maxNoseRatio, normalizedNoseX)
          minNoseYRatio = Math.min(minNoseYRatio, normalizedNoseY)
          maxNoseYRatio = Math.max(maxNoseYRatio, normalizedNoseY)
        }

        if (frameCount >= 20) {
          break
        }
      }

      await sleep(LIVENESS_FRAME_INTERVAL_MS)
    }

    if (frameCount < LIVENESS_MIN_VALID_FRAMES) {
      throw new Error(
        t(
          'Face was not detected long enough. Adjust lighting and framing.',
          'Rosto nao detectado por tempo suficiente. Ajuste iluminacao e enquadramento.'
        )
      )
    }

    const headMovementDelta =
      Number.isFinite(minNoseRatio) && Number.isFinite(maxNoseRatio)
        ? Number((maxNoseRatio - minNoseRatio).toFixed(4))
        : 0

    const verticalMovementDelta =
      Number.isFinite(minNoseYRatio) && Number.isFinite(maxNoseYRatio)
        ? Number((maxNoseYRatio - minNoseYRatio).toFixed(4))
        : 0

    return {
      blinkDetected: false,
      headMovementDetected:
        headMovementDelta >= LIVENESS_HEAD_DELTA_THRESHOLD ||
        verticalMovementDelta >= LIVENESS_HEAD_DELTA_THRESHOLD,
      blinkCount: 0,
      lookLeftDetected: headMovementDelta >= LIVENESS_HEAD_DELTA_THRESHOLD,
      lookRightDetected: headMovementDelta >= LIVENESS_HEAD_DELTA_THRESHOLD,
      lookUpDetected: verticalMovementDelta >= LIVENESS_HEAD_DELTA_THRESHOLD,
      lookDownDetected: verticalMovementDelta >= LIVENESS_HEAD_DELTA_THRESHOLD,
      headMovementDelta,
      frameCount,
      capturedAt: new Date().toISOString(),
    }
  }

  const runGuidedFaceEnrollment = async () => {
    if (!videoRef.current) {
      throw new Error(t('Camera is not initialized', 'Camera nao inicializada'))
    }

    let frameCount = 0
    let minNoseRatio = Number.POSITIVE_INFINITY
    let maxNoseRatio = Number.NEGATIVE_INFINITY
    let minNoseYRatio = Number.POSITIVE_INFINITY
    let maxNoseYRatio = Number.NEGATIVE_INFINITY
    let centerBaseline: number | null = null
    let centerBaselineY: number | null = null

    let centerDone = false
    let leftDone = false
    let rightDone = false
    let upDone = false
    let downDone = false

    setEnrollStep('CENTER')
  setEnrollInstruction(t('Center your face and keep looking forward', 'Centralize seu rosto e fique olhando para frente'))
    setEnrollProgress(8)

    const startedAt = Date.now()

    while (Date.now() - startedAt <= FACE_ENROLL_GUIDED_TIMEOUT_MS) {
      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()

      if (!detection) {
        setEnrollInstruction(t('Face not detected. Adjust lighting and framing', 'Rosto nao detectado. Ajuste iluminacao e enquadramento'))
        await sleep(LIVENESS_FRAME_INTERVAL_MS)
        continue
      }

      frameCount += 1
      const jaw = detection.landmarks.getJawOutline()
      const nose = detection.landmarks.getNose()
      const jawLeft = jaw[0]
      const jawRight = jaw[jaw.length - 1]
      const leftBrow = detection.landmarks.getLeftEyeBrow()
      const rightBrow = detection.landmarks.getRightEyeBrow()
      const browAnchor =
        leftBrow[Math.floor(leftBrow.length / 2)] || rightBrow[Math.floor(rightBrow.length / 2)]
      const jawBottom = jaw[Math.floor(jaw.length / 2)]
      const noseTip = nose[3] || nose[Math.floor(nose.length / 2)]

      if (jawLeft && jawRight && browAnchor && jawBottom && noseTip) {
        const jawWidth = Math.max(1, jawRight.x - jawLeft.x)
        const jawHeight = Math.max(1, Math.abs(jawBottom.y - browAnchor.y))
        const normalizedNoseX = (noseTip.x - jawLeft.x) / jawWidth
        const normalizedNoseY = (noseTip.y - browAnchor.y) / jawHeight

        minNoseRatio = Math.min(minNoseRatio, normalizedNoseX)
        maxNoseRatio = Math.max(maxNoseRatio, normalizedNoseX)
        minNoseYRatio = Math.min(minNoseYRatio, normalizedNoseY)
        maxNoseYRatio = Math.max(maxNoseYRatio, normalizedNoseY)

        if (!centerDone) {
          setEnrollStep('CENTER')
          setEnrollInstruction(t('Center your face and keep looking forward', 'Centralize seu rosto e fique olhando para frente'))

          if (normalizedNoseX >= FACE_CENTER_MIN && normalizedNoseX <= FACE_CENTER_MAX) {
            if (normalizedNoseY < FACE_VERTICAL_CENTER_MIN || normalizedNoseY > FACE_VERTICAL_CENTER_MAX) {
              await sleep(LIVENESS_FRAME_INTERVAL_MS)
              continue
            }

            centerBaseline = normalizedNoseX
            centerBaselineY = normalizedNoseY
            centerDone = true
            setEnrollProgress(30)
            setEnrollStep('LEFT')
            setEnrollInstruction(t('Now turn your head slightly to one side', 'Agora vire levemente a cabeca para um lado'))
          }
        } else if (!leftDone && centerBaseline !== null) {
          setEnrollStep('LEFT')
          if (normalizedNoseX <= centerBaseline - FACE_TURN_DELTA) {
            leftDone = true
            setEnrollProgress(55)
            setEnrollStep('RIGHT')
            setEnrollInstruction(t('Great. Now turn slightly to the other side', 'Perfeito. Agora vire levemente para o outro lado'))
          }
        } else if (!rightDone && centerBaseline !== null) {
          setEnrollStep('RIGHT')
          if (normalizedNoseX >= centerBaseline + FACE_TURN_DELTA) {
            rightDone = true
            setEnrollProgress(70)
            setEnrollStep('UP')
            setEnrollInstruction(t('Now move your head slightly upward', 'Agora mova levemente a cabeca para cima'))
          }
        } else if (!upDone && centerBaselineY !== null) {
          setEnrollStep('UP')
          if (normalizedNoseY <= centerBaselineY - FACE_VERTICAL_TURN_DELTA) {
            upDone = true
            setEnrollProgress(85)
            setEnrollStep('DOWN')
            setEnrollInstruction(t('Great. Now move your head slightly downward', 'Perfeito. Agora mova levemente a cabeca para baixo'))
          }
        } else if (!downDone && centerBaselineY !== null) {
          setEnrollStep('DOWN')
          if (normalizedNoseY >= centerBaselineY + FACE_VERTICAL_TURN_DELTA) {
            downDone = true
            setEnrollProgress(100)
            setEnrollInstruction(t('Movement validated. Finishing enrollment...', 'Movimentos validados. Finalizando cadastro...'))
          }
        }
      }

      if (centerDone && leftDone && rightDone && upDone && downDone && frameCount >= LIVENESS_MIN_VALID_FRAMES) {
        const descriptorResult = await faceapi
          .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor()

        if (!descriptorResult) {
          throw new Error(
            t(
              'Could not extract face descriptor at the end of validation.',
              'Nao foi possivel extrair descriptor facial no final da validacao.'
            )
          )
        }

        const headMovementDelta =
          Number.isFinite(minNoseRatio) && Number.isFinite(maxNoseRatio)
            ? Number((maxNoseRatio - minNoseRatio).toFixed(4))
            : 0
        const verticalMovementDelta =
          Number.isFinite(minNoseYRatio) && Number.isFinite(maxNoseYRatio)
            ? Number((maxNoseYRatio - minNoseYRatio).toFixed(4))
            : 0

        return {
          descriptor: Array.from(descriptorResult.descriptor),
          livenessData: {
            blinkDetected: false,
            headMovementDetected:
              headMovementDelta >= LIVENESS_HEAD_DELTA_THRESHOLD ||
              verticalMovementDelta >= LIVENESS_HEAD_DELTA_THRESHOLD,
            blinkCount: 0,
            lookLeftDetected: leftDone,
            lookRightDetected: rightDone,
            lookUpDetected: upDone,
            lookDownDetected: downDone,
            headMovementDelta,
            frameCount,
            capturedAt: new Date().toISOString(),
          },
        }
      }

      await sleep(LIVENESS_FRAME_INTERVAL_MS)
    }

    throw new Error(
      t(
        'Face verification timed out. Try again and follow the on-screen instructions.',
        'Tempo esgotado na verificacao facial. Tente novamente e siga as instrucoes na tela.'
      )
    )
  }

  const ensureFaceVerification = async () => {
    setFaceError('')
    setFaceLoading(true)

    try {
      if (!cameraActive) {
        await startCamera()
      }

      const livenessData = await collectLivenessData()
      const descriptor = await extractFaceDescriptor()

      return {
        descriptor,
        livenessData,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('Failed to capture face', 'Falha ao capturar rosto')
      setFaceError(message)
      throw err
    } finally {
      setFaceLoading(false)
    }
  }

  const handleEnrollFace = async () => {
    if (!token) return

    setEnrollModalOpen(true)
    setEnrollProgress(0)
    setEnrollStep('CENTER')
  setEnrollInstruction(t('Preparing camera...', 'Preparando camera...'))
    setFaceError('')
    setSuccess('')
    setFaceLoading(true)

    try {
      if (!cameraActive) {
        await startCamera()
      }

      const { descriptor, livenessData } = await runGuidedFaceEnrollment()

      await apiFetch('/users/me/face/enroll', {
        token,
        method: 'POST',
        body: {
          faceDescriptor: descriptor,
          livenessData,
        },
      })

      await loadFaceStatus()
      setSuccess(t('Face enrollment updated successfully.', 'Cadastro facial atualizado com sucesso.'))
      setFaceError('')
      setEnrollModalOpen(false)
      stopCamera()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('Error enrolling face', 'Erro ao cadastrar facial')
      setFaceError(message)
      setEnrollInstruction(t('Could not complete. Please try again.', 'Nao foi possivel concluir. Tente novamente.'))
    } finally {
      setFaceLoading(false)
    }
  }

  const handleRemoveFace = async () => {
    if (!token) return
    setFaceLoading(true)
    setFaceError('')
    try {
      await apiFetch('/users/me/face', {
        token,
        method: 'DELETE',
      })
      await loadFaceStatus()
      setSuccess(t('Face enrollment removed successfully.', 'Cadastro facial removido com sucesso.'))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('Error removing face enrollment', 'Erro ao remover facial')
      setFaceError(message)
    } finally {
      setFaceLoading(false)
    }
  }

  useEffect(() => {
    loadEntries().catch(() => undefined)
    loadCurrentEntry().catch(() => undefined)
    loadGeofence()
      .then((config) => {
        if (config?.geolocationEnabled !== false) {
          refreshLocation().catch(() => undefined)
        }
      })
      .catch(() => undefined)
    loadFaceStatus().catch(() => undefined)
    loadFaceModels().catch(() => {
      setFaceModelsReady(false)
      setFaceError(
        t(
          'Could not load face models locally or from CDN. Check your internet connection or /public/models.',
          'Nao foi possivel carregar modelos faciais localmente nem por CDN. Verifique sua internet ou /public/models.'
        )
      )
    })
    setPendingSyncCount(readQueue(window.localStorage).length)
    setDroppedPunches(readDroppedPunches(window.localStorage))
  }, [token])

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      syncOfflineClockQueue().catch(() => undefined)
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [token, syncingOfflineQueue])

  useEffect(() => {
    return () => {
      stopCamera()
      stopQrScanner()
    }
  }, [])

  useEffect(() => {
    if (!token) return
    const interval = window.setInterval(() => {
      loadEntries().catch(() => undefined)
      loadCurrentEntry().catch(() => undefined)
      syncOfflineClockQueue().catch(() => undefined)
    }, 15000)

    return () => window.clearInterval(interval)
  }, [token])

  useEffect(() => {
    if (!currentEntry?.clockIn) return
    const interval = window.setInterval(() => {
      const nowMs = Date.now()
      setElapsedMs(resolveElapsedMs(currentEntry, nowMs))
      setCurrentBreakMs(resolveBreakMs(currentEntry, nowMs))
    }, 1000)
    return () => window.clearInterval(interval)
  }, [currentEntry?.clockIn, currentEntry?.breakMinutes, currentEntry?.breakStartedAt])

  const formatElapsed = (value: number | null) => {
    if (value === null) return '--:--:--'
    const totalSeconds = Math.max(0, Math.floor(value / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  const formatMinutesLabel = (minutes: number) => {
    const safeMinutes = Math.max(0, Math.floor(minutes))
    const hoursPart = Math.floor(safeMinutes / 60)
    const minutesPart = safeMinutes % 60
    return `${String(hoursPart).padStart(2, '0')}h ${String(minutesPart).padStart(2, '0')}m`
  }

  const decodeTokenSummary = (token: string) => {
    const [encodedPayload] = String(token || '').split('.')
    if (!encodedPayload) return ''

    try {
      const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
      const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
      const payload = JSON.parse(window.atob(`${normalized}${padding}`)) as {
        terminalName?: string | null
        terminalId?: string | null
        branch?: string | null
      }

      const terminalLabel = payload.terminalName || payload.terminalId || 'Terminal'
      const branchLabel = payload.branch || 'N/A'
      return `${terminalLabel} (${branchLabel})`
    } catch (_error) {
      return ''
    }
  }

  const stopQrScanner = () => {
    qrScannerActiveRef.current = false

    if (qrScanAnimationRef.current) {
      window.cancelAnimationFrame(qrScanAnimationRef.current)
      qrScanAnimationRef.current = null
    }

    if (qrStreamRef.current) {
      qrStreamRef.current.getTracks().forEach((track) => track.stop())
      qrStreamRef.current = null
    }

    if (qrVideoRef.current) {
      qrVideoRef.current.srcObject = null
    }
  }

  const startQrScanner = async () => {
    const BarcodeDetectorCtor = getBarcodeDetector()
    if (!BarcodeDetectorCtor) {
      setQrScanError(
        t(
          'QR reading through camera is not supported in this browser. Use recent Chrome/Edge.',
          'Leitura de QR por câmera não suportada neste navegador. Use Chrome/Edge recente.'
        )
      )
      return
    }

    setQrScanLoading(true)
    setQrScanError('')
    setQrScannerOpen(true)
    qrScannerActiveRef.current = true

    try {
      if (cameraActive) {
        stopCamera()
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })

      qrStreamRef.current = stream
      if (!qrVideoRef.current) {
        throw new Error(t('Failed to initialize camera for QR', 'Falha ao inicializar câmera para QR'))
      }

      qrVideoRef.current.srcObject = stream
      await qrVideoRef.current.play()

      const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] })

      const loop = async () => {
        if (!qrVideoRef.current || !qrScannerActiveRef.current) return

        try {
          const detections = await detector.detect(qrVideoRef.current)
          const rawValue = detections.find((item) => item?.rawValue)?.rawValue

          if (rawValue) {
            setScannedQrToken(rawValue)
            const summary = decodeTokenSummary(rawValue)
            setScannedQrSummary(summary)
            setQrScannerOpen(false)
            stopQrScanner()
            setSuccess(
              summary
                ? t(`QR read: ${summary}`, `QR lido: ${summary}`)
                : t('QR read successfully.', 'QR lido com sucesso.')
            )
            setQrScanLoading(false)
            return
          }
        } catch (_error) {
          // Ignora frames inválidos e continua o loop.
        }

        qrScanAnimationRef.current = window.requestAnimationFrame(() => {
          loop().catch(() => undefined)
        })
      }

      loop().catch(() => undefined)
    } catch (err) {
      setQrScanError(
        err instanceof Error
          ? err.message
          : t('Could not open camera for QR reading', 'Não foi possível abrir a câmera para leitura do QR')
      )
      setQrScannerOpen(false)
      stopQrScanner()
      setQrScanLoading(false)
    }
  }

  const handleClockIn = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      // Aparelho ja se declara offline: avisa antes de capturar rosto e antes de
      // deixar o colaborador acreditar que a batida foi guardada.
      if (isDeviceOffline()) {
        const blocker = offlinePunchBlocker()
        if (blocker) throw new Error(blocker)
      }

      if (geofence?.locationValidationSource === 'TERMINAL_QR' && !scannedQrToken.trim()) {
        throw new Error(
          t(
            'Read the terminal QR with camera before registering time.',
            'Leia o QR do terminal pela câmera antes de registrar o ponto.'
          )
        )
      }

      let location: { lat: number; lng: number } | null = null
      if (geolocationEnabled) {
        try {
          location = await refreshLocation()
        } catch {
          if (geofence?.enabled && geofence?.requireLocation) {
            throw new Error(
              t(
                'Location is required to register time. Enable GPS and allow location access.',
                'Localização é obrigatória para registrar o ponto. Ative o GPS e permita o acesso à localização.'
              )
            )
          }
        }
      }

      let faceDescriptor: number[] | undefined
      let livenessData: LivenessData | undefined
      const pinValue = pin.trim()
      if (!pinValue && faceStatus?.enrolled) {
        const faceVerification = await ensureFaceVerification()
        faceDescriptor = faceVerification.descriptor
        livenessData = faceVerification.livenessData
      }

      const payload = {
        notes,
        ...(location ? { latitude: location.lat, longitude: location.lng } : {}),
        ...(pinValue ? { pin: pinValue } : {}),
        ...(faceDescriptor ? { faceDescriptor } : {}),
        ...(livenessData ? { livenessData } : {}),
        ...(scannedQrToken.trim() ? { qrToken: scannedQrToken.trim() } : {}),
        clientNonce: startPunchAttempt('/time/clock-in'),
      }

      // So o erro da requisicao decide fila offline. Falha local (QR ausente,
      // GPS negado, rosto nao detectado) nao carrega status e viraria "batida
      // salva localmente" se caisse no mesmo catch.
      try {
        await apiFetch('/time/clock-in', {
          token,
          method: 'POST',
          body: payload,
        })
      } catch (err) {
        // shouldQueueOfflinePunch, NAO o classificador da fila: 429 (PIN_LOCKED,
        // rate limit) e 408 sao veredito sobre esta tentativa e tem de chegar na
        // cara do colaborador. Enfileirar aqui diria "salvo localmente" com
        // sinal cheio, guardaria o PIN errado e terminaria pedindo lancamento
        // manual de um turno que ele ja registrou.
        if (!shouldQueueOfflinePunch(err)) throw err
        queueOfflinePunch('/time/clock-in')
        return
      }

      // Tentativa concluida: a proxima batida e outra batida e leva outro nonce.
      finishPunchAttempt()
      setNotes('')
      setPin('')
      setScannedQrToken('')
      setScannedQrSummary('')
      await loadEntries()
      await loadCurrentEntry()
      setSuccess(t('Clock-in recorded successfully.', 'Clock-in registrado com sucesso.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Error recording clock-in', 'Erro ao registrar entrada'))
    } finally {
      setLoading(false)
    }
  }

  const handleClockOut = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      if (isDeviceOffline()) {
        const blocker = offlinePunchBlocker()
        if (blocker) throw new Error(blocker)
      }

      if (geofence?.locationValidationSource === 'TERMINAL_QR' && !scannedQrToken.trim()) {
        throw new Error(
          t(
            'Read the terminal QR with camera before registering time.',
            'Leia o QR do terminal pela câmera antes de registrar o ponto.'
          )
        )
      }

      let location: { lat: number; lng: number } | null = null
      if (geolocationEnabled) {
        try {
          location = await refreshLocation()
        } catch {
          if (geofence?.enabled && geofence?.requireLocation) {
            throw new Error(
              t(
                'Location is required to register time. Enable GPS and allow location access.',
                'Localização é obrigatória para registrar o ponto. Ative o GPS e permita o acesso à localização.'
              )
            )
          }
        }
      }

      let faceDescriptor: number[] | undefined
      let livenessData: LivenessData | undefined
      const pinValue = pin.trim()
      if (!pinValue && faceStatus?.enrolled) {
        const faceVerification = await ensureFaceVerification()
        faceDescriptor = faceVerification.descriptor
        livenessData = faceVerification.livenessData
      }

      const payload = {
        notes,
        ...(location ? { latitude: location.lat, longitude: location.lng } : {}),
        ...(pinValue ? { pin: pinValue } : {}),
        ...(faceDescriptor ? { faceDescriptor } : {}),
        ...(livenessData ? { livenessData } : {}),
        ...(scannedQrToken.trim() ? { qrToken: scannedQrToken.trim() } : {}),
        clientNonce: startPunchAttempt('/time/clock-out'),
      }

      try {
        await apiFetch('/time/clock-out', {
          token,
          method: 'POST',
          body: payload,
        })
      } catch (err) {
        // Mesma regra do clock-in: so ausencia de veredito (sem status) ou
        // falha do proprio servidor (5xx) viram pendencia offline.
        if (!shouldQueueOfflinePunch(err)) throw err
        queueOfflinePunch('/time/clock-out')
        return
      }

      finishPunchAttempt()
      setNotes('')
      setPin('')
      setScannedQrToken('')
      setScannedQrSummary('')
      await loadEntries()
      await loadCurrentEntry()
      setSuccess(t('Clock-out recorded successfully.', 'Clock-out registrado com sucesso.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Error recording clock-out', 'Erro ao registrar saida'))
    } finally {
      setLoading(false)
    }
  }

  const handleStartBreak = async () => {
    if (!token || !activeEntry) return
    if (!isOnline) {
      setError(t('Break requires an online connection.', 'A pausa requer conexão com a internet.'))
      return
    }

    setBreakLoading(true)
    setError('')
    setSuccess('')

    try {
      await apiFetch('/time/break', {
        token,
        method: 'POST',
      })
      await loadCurrentEntry()
      await loadEntries()
      setSuccess(t('Break started.', 'Pausa iniciada.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to start break.', 'Erro ao iniciar pausa.'))
    } finally {
      setBreakLoading(false)
    }
  }

  const handleResumeBreak = async () => {
    if (!token || !activeEntry) return
    if (!isOnline) {
      setError(t('Resume requires an online connection.', 'Retomar requer conexão com a internet.'))
      return
    }

    setBreakLoading(true)
    setError('')
    setSuccess('')

    try {
      await apiFetch('/time/resume', {
        token,
        method: 'POST',
      })
      await loadCurrentEntry()
      await loadEntries()
      setSuccess(t('Break finished. Back to work.', 'Pausa encerrada.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to resume work.', 'Erro ao retomar.'))
    } finally {
      setBreakLoading(false)
    }
  }

  const isOnBreak = Boolean(currentEntry?.breakStartedAt)
  const liveCurrentEntryMinutes = currentEntry?.clockIn
    ? Math.max(0, Math.floor((elapsedMs || 0) / 60000))
    : 0
  const dailyProgress = currentEntry?.dailyProgress
  const workedBeforeMinutes = dailyProgress?.workedMinutesBeforeEntry || 0
  const liveTotalWorkedMinutes = dailyProgress
    ? workedBeforeMinutes + liveCurrentEntryMinutes
    : liveCurrentEntryMinutes
  const contractDailyMinutes = dailyProgress?.contractDailyMinutes || 0
  const liveRegularMinutes = contractDailyMinutes > 0
    ? Math.min(liveTotalWorkedMinutes, contractDailyMinutes)
    : liveTotalWorkedMinutes
  const liveOvertimeMinutes = Math.max(0, liveTotalWorkedMinutes - Math.max(contractDailyMinutes, 0))
  const statusChartMax = Math.max(contractDailyMinutes, liveTotalWorkedMinutes, 1)

  return (
    <div className="space-y-6">
      <DualClock variant="card" />
    <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">{t('Member', 'Colaborador')}</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">{t('Your workday in one tap.', 'Sua jornada em um toque.')}</h2>
        <p className="mt-4 text-sm text-slate-600">
          {t(
            'Register clock-in and clock-out quickly. The system saves context automatically.',
            'Registre a entrada e a saida com rapidez. O sistema salva automaticamente o contexto.'
          )}
        </p>

        <div className="mt-8 rounded-2xl border border-slate-100 bg-slate-50/70 p-5">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('Workday notes', 'Notas da jornada')}
          </label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t('Optional: meeting, focus, home office...', 'Opcional: reuniao, foco, home office...')}
            className="mt-3 h-24 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
          />

          <div className="mt-3">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('PIN (alternative to face)', 'PIN (alternativa ao facial)')}
            </label>
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder={t('Enter your numeric PIN', 'Informe seu PIN numerico')}
              type="password"
              inputMode="numeric"
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              {t(
                'If PIN is provided, clock-in and clock-out use PIN without requiring face capture.',
                'Se o PIN for informado, clock-in e clock-out usam PIN sem exigir captura facial.'
              )}
            </p>
          </div>

          <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {t('Terminal QR (camera read)', 'QR do terminal (leitura por câmera)')}
              </label>
              <button
                onClick={() => {
                  setError('')
                  setSuccess('')
                  startQrScanner().catch(() => undefined)
                }}
                disabled={qrScanLoading}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                {qrScanLoading ? t('Opening camera...', 'Abrindo câmera...') : t('Read QR', 'Ler QR')}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {scannedQrToken
                ? t(
                    `QR validated${scannedQrSummary ? `: ${scannedQrSummary}` : ''}`,
                    `QR validado${scannedQrSummary ? `: ${scannedQrSummary}` : ''}`
                  )
                : t('No QR read yet.', 'Nenhum QR lido ainda.')}
            </p>
            {qrScanError ? <p className="mt-2 text-xs text-rose-600">{qrScanError}</p> : null}
          </div>

          {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
          {success ? <p className="mt-3 text-xs text-emerald-600">{success}</p> : null}

          {droppedPunches.length > 0 ? (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-xs font-semibold text-rose-800">
                {t(
                  'Offline punches that could not be synced. Ask your supervisor to enter them:',
                  'Batidas offline que nao puderam ser sincronizadas. Peca ao seu supervisor para lancar:'
                )}
              </p>
              <ul className="mt-2 space-y-1 text-[11px] text-rose-700">
                {droppedPunches.map((punch) => (
                  <li key={punch.id}>
                    {punch.path === '/time/clock-in' ? t('Clock in', 'Registrar entrada') : t('Clock out', 'Registrar saida')}
                    {' - '}
                    {punch.occurredAt
                      ? formatDateTimeWithTimeZone(punch.occurredAt, viewTimeZone)
                      : t('time not recorded', 'horario nao registrado')}
                    {punch.message ? ` (${punch.message})` : ''}
                  </li>
                ))}
              </ul>
              <button
                onClick={acknowledgeDroppedPunches}
                className="mt-3 rounded-full border border-rose-300 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-rose-700"
              >
                {t('I wrote it down', 'Ja anotei')}
              </button>
            </div>
          ) : null}

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <button
              onClick={handleClockIn}
              disabled={loading || Boolean(activeEntry)}
              className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50"
            >
              {t('Clock in', 'Registrar entrada')}
            </button>
            <button
              onClick={handleClockOut}
              disabled={loading || !activeEntry}
              className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
            >
              {t('Clock out', 'Registrar saida')}
            </button>
            {activeEntry ? (
              <button
                onClick={isOnBreak ? handleResumeBreak : handleStartBreak}
                disabled={loading || breakLoading}
                className={`rounded-full px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 ${
                  isOnBreak ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-500 hover:bg-amber-600'
                }`}
              >
                {breakLoading
                  ? t('Processing...', 'Processando...')
                  : isOnBreak
                    ? t('Resume', 'Retomar')
                    : t('Break', 'Pausa')}
              </button>
            ) : null}
          </div>

          <div className="mt-6 rounded-2xl border border-slate-100 bg-white px-4 py-4">
            <h3 className="text-base font-semibold text-slate-900">{t('Current status', 'Status atual')}</h3>
            <p className="mt-1 text-sm text-slate-600">
              {activeEntry
                ? isOnBreak
                  ? t('On break', 'Em pausa')
                  : t('Workday in progress', 'Jornada em andamento')
                : t('No open workday', 'Nenhuma jornada aberta')}
            </p>

            <div className="mt-3 flex items-center gap-2 text-xs">
              <span
                className={`rounded-full px-3 py-1 ${
                  isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {isOnline ? t('Online', 'Online') : t('Offline', 'Offline')}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                {t('Pending:', 'Pendentes:')} {pendingSyncCount}
              </span>
              <button
                onClick={() => {
                  syncOfflineClockQueue().catch(() => undefined)
                }}
                disabled={!isOnline || pendingSyncCount === 0 || syncingOfflineQueue}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-600 disabled:opacity-50"
              >
                {syncingOfflineQueue
                  ? t('Syncing...', 'Sincronizando...')
                  : t('Sync pending items', 'Sincronizar pendências')}
              </button>
            </div>

            {dailyProgress?.hasReachedDailyTarget ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {t('Daily workday completed. Current time is marked as overtime', 'Jornada diaria concluida. Tempo atual marcado como hora extra')}{' '}
                ({formatMinutesLabel(liveOvertimeMinutes)}).
              </div>
            ) : dailyProgress ? (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {t('Remaining', 'Faltam')} {formatMinutesLabel(Math.max(0, contractDailyMinutes - liveRegularMinutes))}{' '}
                {t('to reach daily workload.', 'para atingir a carga diaria.')}
              </div>
            ) : null}

            <div className="mt-4 grid gap-2">
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  <span>{t('Regular', 'Regular')}</span>
                  <span>{formatMinutesLabel(liveRegularMinutes)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.max((liveRegularMinutes / statusChartMax) * 100, liveRegularMinutes > 0 ? 6 : 0)}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  <span>{t('Overtime', 'Hora extra')}</span>
                  <span>{formatMinutesLabel(liveOvertimeMinutes)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-rose-500 transition-all"
                    style={{ width: `${Math.max((liveOvertimeMinutes / statusChartMax) * 100, liveOvertimeMinutes > 0 ? 6 : 0)}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  <span>{t('Daily target', 'Meta diária')}</span>
                  <span>{formatMinutesLabel(contractDailyMinutes)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-slate-700 transition-all"
                    style={{ width: `${Math.max((contractDailyMinutes / statusChartMax) * 100, contractDailyMinutes > 0 ? 6 : 0)}%` }}
                  />
                </div>
              </div>
              {activeEntry && ((currentBreakMs || 0) > 0 || isOnBreak) && (
                <div>
                  <div className={`mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] font-medium ${isOnBreak ? 'text-amber-600' : 'text-amber-500'}`}>
                    <span className="flex items-center gap-1">
                      {isOnBreak ? '☕ ' : ''}{t('Break time', 'Tempo de pausa')}
                      {isOnBreak ? ` (${t('active', 'ativa')})` : ''}
                    </span>
                    <span>{isOnBreak ? formatElapsed(currentBreakMs) : formatMinutesLabel(Math.max(0, Math.floor((currentBreakMs || 0) / 60000)))}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all ${isOnBreak ? 'bg-amber-400 animate-pulse' : 'bg-amber-400'}`}
                      style={{ width: `${Math.min(100, Math.max((Math.max(0, Math.floor((currentBreakMs || 0) / 60000)) / Math.max(statusChartMax, 60)) * 100, 6))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('Active time', 'Tempo ativo')}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{formatElapsed(elapsedMs)}</p>
              <p className="mt-2 text-xs text-slate-500">
                {currentEntry?.clockIn
                  ? `${t('Started', 'Inicio')}: ${formatTimeWithTimeZone(currentEntry.clockIn, viewTimeZone)}`
                  : t('No workday in progress', 'Sem jornada em andamento')}
              </p>
              {activeEntry && isOnBreak ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-amber-600 font-semibold">{t('Break time', 'Tempo de pausa')}</p>
                  <p className="mt-1 text-xl font-semibold text-amber-700">{formatElapsed(currentBreakMs)}</p>
                </div>
              ) : activeEntry && currentEntry?.breakMinutes ? (
                <p className="mt-1 text-xs text-slate-500">
                  {t('Breaks:', 'Pausas:')} {formatMinutesLabel(Math.max(0, Math.floor(currentEntry?.breakMinutes || 0)))}
                </p>
              ) : null}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {t('Last record', 'Ultimo registro')}: {entries[0]?.clockIn ? formatDateTimeWithTimeZone(entries[0].clockIn, viewTimeZone) : '--'}
            </p>
          </div>
        </div>
      </div>

      <aside className="space-y-5">
        {isPro && (
        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">{t('Facial recognition', 'Reconhecimento facial')}</h3>
          <p className="mt-2 text-xs text-slate-600">
            {faceStatus?.enrolled
              ? `${t('Enrollment active', 'Cadastro ativo')}${
                  faceStatus.updatedAt
                    ? ` ${t('since', 'desde')} ${formatDateTimeWithTimeZone(faceStatus.updatedAt, viewTimeZone)}`
                    : ''
                }`
              : t('No facial enrollment', 'Sem cadastro facial')}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {faceModelsReady
              ? `${t('Face models loaded', 'Modelos faciais carregados')} (${faceModelSource === '/models' ? t('local', 'local') : 'cdn'}).`
              : t('Loading face models...', 'Carregando modelos faciais...')}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {t(
              'Liveness check: move your head to the sides, up, and down during facial validation.',
              'Prova de vida: mova a cabeca para os lados, para cima e para baixo durante a validacao facial.'
            )}
          </p>

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100 bg-slate-100">
            <video ref={videoRef} autoPlay muted playsInline className="h-44 w-full object-cover [transform:scaleX(-1)]" />
          </div>

          {faceError ? <p className="mt-2 text-xs text-rose-600">{faceError}</p> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={handleEnrollFace}
              disabled={faceLoading || !faceModelsReady}
              className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {faceLoading ? t('Validating...', 'Validando...') : t('Enroll face', 'Cadastrar rosto')}
            </button>
            <button
              onClick={handleRemoveFace}
              disabled={faceLoading || !faceStatus?.enrolled}
              className="rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
            >
              {t('Remove facial enrollment', 'Remover facial')}
            </button>
          </div>
        </div>
        )}

        {enrollModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 px-4">
            <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
              <div className="border-b border-slate-700 p-5">
                <p className="text-xs uppercase tracking-[0.25em] text-teal-300">{t('Guided facial enrollment', 'Cadastro facial guiado')}</p>
                <h4 className="mt-2 text-xl font-semibold text-slate-100">{t('Face ID-style verification', 'Verificacao estilo Face ID')}</h4>
                <p className="mt-2 text-sm text-slate-300">{enrollInstruction}</p>
              </div>

              <div className="p-5">
                <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-black">
                  <video ref={videoRef} autoPlay muted playsInline className="h-[360px] w-full object-cover [transform:scaleX(-1)]" />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="h-64 w-64 rounded-full border-2 border-teal-300/80" />
                  </div>
                </div>

                <div className="mt-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
                    <div
                      className="h-full bg-teal-400 transition-all duration-300"
                      style={{ width: `${Math.max(0, Math.min(100, enrollProgress))}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-slate-400">
                    <span>{t('Step:', 'Etapa:')} {enrollStep}</span>
                    <span>{Math.round(enrollProgress)}%</span>
                  </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setEnrollModalOpen(false)
                      stopCamera()
                      setFaceLoading(false)
                    }}
                    disabled={faceLoading && enrollProgress > 0 && enrollProgress < 100}
                    className="rounded-full border border-slate-600 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 disabled:opacity-60"
                  >
                    {t('Close', 'Fechar')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {qrScannerOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 px-4">
            <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
              <div className="border-b border-slate-700 p-5">
                <p className="text-xs uppercase tracking-[0.25em] text-teal-300">{t('QR reading', 'Leitura de QR')}</p>
                <h4 className="mt-2 text-xl font-semibold text-slate-100">{t('Point the camera to the terminal QR', 'Aponte a câmera para o QR do terminal')}</h4>
                <p className="mt-2 text-sm text-slate-300">
                  {t('Keep the code centered until validation.', 'Mantenha o código centralizado até a validação.')}
                </p>
              </div>

              <div className="p-5">
                <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-black">
                  <video ref={qrVideoRef} autoPlay muted playsInline className="h-[360px] w-full object-cover" />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="h-64 w-64 rounded-2xl border-2 border-teal-300/80" />
                  </div>
                </div>

                {qrScanError ? <p className="mt-3 text-xs text-rose-300">{qrScanError}</p> : null}

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setQrScannerOpen(false)
                      setQrScanLoading(false)
                      stopQrScanner()
                    }}
                    className="rounded-full border border-slate-600 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200"
                  >
                    {t('Close', 'Fechar')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}


        {geolocationEnabled ? (
        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">{t('Geolocation', 'Geolocalizacao')}</h3>
            <button
              onClick={() => {
                refreshLocation().catch(() => undefined)
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600"
              disabled={geoLoading}
            >
              {geoLoading ? t('Updating...', 'Atualizando...') : t('Refresh GPS', 'Atualizar GPS')}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-600">
            {currentPosition
              ? `${t('Current position:', 'Posicao atual:')} ${currentPosition.lat.toFixed(6)}, ${currentPosition.lng.toFixed(6)}`
              : t('Position not captured yet', 'Posicao ainda nao capturada')}
          </p>
          {geofence?.enabled ? (
            <p className="mt-1 text-xs text-slate-500">
              {t('Fence active in mode', 'Cerca ativa em modo')} {geofence.mode}{' '}
              {t('with radius of', 'com raio de')} {Math.round(geofence.radiusMeters)}m
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">{t('Virtual fence disabled on backend', 'Cerca virtual desativada no backend')}</p>
          )}
          {geoError ? <p className="mt-2 text-xs text-rose-600">{geoError}</p> : null}

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
            <MapContainer center={mapCenter} zoom={16} style={{ height: '240px', width: '100%' }}>
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {geofence?.center ? (
                <>
                  <Circle
                    center={[geofence.center.lat, geofence.center.lng]}
                    radius={geofence.radiusMeters}
                    pathOptions={{ color: '#0f766e', fillColor: '#14b8a6', fillOpacity: 0.18 }}
                  />
                  <CircleMarker
                    center={[geofence.center.lat, geofence.center.lng]}
                    radius={6}
                    pathOptions={{ color: '#0f766e', fillColor: '#0f766e', fillOpacity: 1 }}
                  >
                    <Popup>{t('Virtual fence center', 'Centro da cerca virtual')}</Popup>
                  </CircleMarker>
                </>
              ) : null}

              {currentPosition ? (
                <CircleMarker
                  center={[currentPosition.lat, currentPosition.lng]}
                  radius={7}
                  pathOptions={{ color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 1 }}
                >
                  <Popup>{t('Your current position', 'Sua posicao atual')}</Popup>
                </CircleMarker>
              ) : null}
            </MapContainer>
          </div>
        </div>
        ) : null}

      </aside>
    </section>
    </div>
  )
}

export default ColaboradorDashboard
