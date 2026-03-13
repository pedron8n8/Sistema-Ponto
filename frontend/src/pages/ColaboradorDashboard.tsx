import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTimeZone } from '../context/TimezoneContext'
import { Circle, CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import * as faceapi from 'face-api.js'
import { formatDateTimeWithTimeZone, formatDateWithTimeZone, formatTimeWithTimeZone } from '../lib/timezone'

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
  } | null
}

type GeofenceConfig = {
  enabled: boolean
  mode: 'ALERT' | 'REJECT' | string
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

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

const ColaboradorDashboard = () => {
  const { session } = useAuth()
  const { viewTimeZone } = useTimeZone()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [currentEntry, setCurrentEntry] = useState<CurrentEntryResponse['entry'] | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
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
  const [enrollInstruction, setEnrollInstruction] = useState('Centralize seu rosto no quadro')
  const [enrollProgress, setEnrollProgress] = useState(0)
  const [enrollStep, setEnrollStep] = useState<'CENTER' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'>('CENTER')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const token = session?.access_token

  const activeEntry = useMemo(() => entries.find((entry) => !entry.clockOut) ?? null, [entries])
  const mapCenter: [number, number] = useMemo(() => {
    if (currentPosition) return [currentPosition.lat, currentPosition.lng]
    if (geofence?.center) return [geofence.center.lat, geofence.center.lng]
    return [-23.55052, -46.63331]
  }, [currentPosition, geofence])

  const getBrowserLocation = async () => {
    if (!navigator.geolocation) {
      throw new Error('Geolocalizacao nao suportada neste navegador')
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
          reject(new Error(geoErr.message || 'Nao foi possivel obter localizacao'))
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
      const message = err instanceof Error ? err.message : 'Falha ao obter localizacao'
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

  const loadCurrentEntry = async () => {
    if (!token) return
    const response = await apiFetch<CurrentEntryResponse>('/time/current', { token })
    setCurrentEntry(response.entry)
    if (response.entry?.clockIn) {
      const startedAt = new Date(response.entry.clockIn).getTime()
      setElapsedMs(Date.now() - startedAt)
    } else {
      setElapsedMs(null)
    }
  }

  const loadGeofence = async () => {
    if (!token) return
    const response = await apiFetch<GeofenceResponse>('/time/geofence', { token })
    setGeofence(response.geofence)
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
      throw lastError || new Error('Falha ao carregar modelos faciais')
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
      throw new Error('Camera nao suportada neste navegador')
    }

    if (!faceModelsReady) {
      throw new Error('Modelos faciais ainda nao carregados. Aguarde alguns segundos.')
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
      throw new Error('Camera nao inicializada')
    }

    const result = await faceapi
      .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor()

    if (!result) {
      throw new Error('Nenhum rosto detectado. Centralize seu rosto e tente novamente.')
    }

    return Array.from(result.descriptor)
  }

  const collectLivenessData = async (): Promise<LivenessData> => {
    if (!videoRef.current) {
      throw new Error('Camera nao inicializada')
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
      throw new Error('Rosto nao detectado por tempo suficiente. Ajuste iluminacao e enquadramento.')
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
      throw new Error('Camera nao inicializada')
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
    setEnrollInstruction('Centralize seu rosto e fique olhando para frente')
    setEnrollProgress(8)

    const startedAt = Date.now()

    while (Date.now() - startedAt <= FACE_ENROLL_GUIDED_TIMEOUT_MS) {
      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()

      if (!detection) {
        setEnrollInstruction('Rosto nao detectado. Ajuste iluminacao e enquadramento')
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
          setEnrollInstruction('Centralize seu rosto e fique olhando para frente')

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
            setEnrollInstruction('Agora vire levemente a cabeca para um lado')
          }
        } else if (!leftDone && centerBaseline !== null) {
          setEnrollStep('LEFT')
          if (normalizedNoseX <= centerBaseline - FACE_TURN_DELTA) {
            leftDone = true
            setEnrollProgress(55)
            setEnrollStep('RIGHT')
            setEnrollInstruction('Perfeito. Agora vire levemente para o outro lado')
          }
        } else if (!rightDone && centerBaseline !== null) {
          setEnrollStep('RIGHT')
          if (normalizedNoseX >= centerBaseline + FACE_TURN_DELTA) {
            rightDone = true
            setEnrollProgress(70)
            setEnrollStep('UP')
            setEnrollInstruction('Agora mova levemente a cabeca para cima')
          }
        } else if (!upDone && centerBaselineY !== null) {
          setEnrollStep('UP')
          if (normalizedNoseY <= centerBaselineY - FACE_VERTICAL_TURN_DELTA) {
            upDone = true
            setEnrollProgress(85)
            setEnrollStep('DOWN')
            setEnrollInstruction('Perfeito. Agora mova levemente a cabeca para baixo')
          }
        } else if (!downDone && centerBaselineY !== null) {
          setEnrollStep('DOWN')
          if (normalizedNoseY >= centerBaselineY + FACE_VERTICAL_TURN_DELTA) {
            downDone = true
            setEnrollProgress(100)
            setEnrollInstruction('Movimentos validados. Finalizando cadastro...')
          }
        }
      }

      if (centerDone && leftDone && rightDone && upDone && downDone && frameCount >= LIVENESS_MIN_VALID_FRAMES) {
        const descriptorResult = await faceapi
          .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor()

        if (!descriptorResult) {
          throw new Error('Nao foi possivel extrair descriptor facial no final da validacao.')
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

    throw new Error('Tempo esgotado na verificacao facial. Tente novamente e siga as instrucoes na tela.')
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
      const message = err instanceof Error ? err.message : 'Falha ao capturar rosto'
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
    setEnrollInstruction('Preparando camera...')
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
      setSuccess('Cadastro facial atualizado com sucesso.')
      setFaceError('')
      setEnrollModalOpen(false)
      stopCamera()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao cadastrar facial'
      setFaceError(message)
      setEnrollInstruction('Nao foi possivel concluir. Tente novamente.')
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
      setSuccess('Cadastro facial removido com sucesso.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao remover facial'
      setFaceError(message)
    } finally {
      setFaceLoading(false)
    }
  }

  useEffect(() => {
    loadEntries().catch(() => undefined)
    loadCurrentEntry().catch(() => undefined)
    loadGeofence().catch(() => undefined)
    loadFaceStatus().catch(() => undefined)
    loadFaceModels().catch(() => {
      setFaceModelsReady(false)
      setFaceError(
        'Nao foi possivel carregar modelos faciais localmente nem por CDN. Verifique sua internet ou /public/models.'
      )
    })
    refreshLocation().catch(() => undefined)
  }, [token])

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [])

  useEffect(() => {
    if (!token) return
    const interval = window.setInterval(() => {
      loadEntries().catch(() => undefined)
      loadCurrentEntry().catch(() => undefined)
    }, 15000)

    return () => window.clearInterval(interval)
  }, [token])

  useEffect(() => {
    if (!currentEntry?.clockIn) return
    const startedAt = new Date(currentEntry.clockIn).getTime()
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt)
    }, 1000)
    return () => window.clearInterval(interval)
  }, [currentEntry?.clockIn])

  const formatElapsed = (value: number | null) => {
    if (value === null) return '--:--:--'
    const totalSeconds = Math.max(0, Math.floor(value / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  const handleClockIn = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const location = await refreshLocation()

      let faceDescriptor: number[] | undefined
      let livenessData: LivenessData | undefined
      const pinValue = pin.trim()
      if (!pinValue && faceStatus?.enrolled) {
        const faceVerification = await ensureFaceVerification()
        faceDescriptor = faceVerification.descriptor
        livenessData = faceVerification.livenessData
      }

      await apiFetch('/time/clock-in', {
        token,
        method: 'POST',
        body: {
          notes,
          latitude: location.lat,
          longitude: location.lng,
          ...(pinValue ? { pin: pinValue } : {}),
          ...(faceDescriptor ? { faceDescriptor } : {}),
          ...(livenessData ? { livenessData } : {}),
        },
      })
      setNotes('')
      setPin('')
      await loadEntries()
      await loadCurrentEntry()
      setSuccess('Clock-in registrado com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar entrada')
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
      const location = await refreshLocation()

      let faceDescriptor: number[] | undefined
      let livenessData: LivenessData | undefined
      const pinValue = pin.trim()
      if (!pinValue && faceStatus?.enrolled) {
        const faceVerification = await ensureFaceVerification()
        faceDescriptor = faceVerification.descriptor
        livenessData = faceVerification.livenessData
      }

      await apiFetch('/time/clock-out', {
        token,
        method: 'POST',
        body: {
          notes,
          latitude: location.lat,
          longitude: location.lng,
          ...(pinValue ? { pin: pinValue } : {}),
          ...(faceDescriptor ? { faceDescriptor } : {}),
          ...(livenessData ? { livenessData } : {}),
        },
      })
      setNotes('')
      setPin('')
      await loadEntries()
      await loadCurrentEntry()
      setSuccess('Clock-out registrado com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar saida')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-8 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.55)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.35em] text-teal-700">Colaborador</p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-900">Sua jornada em um toque.</h2>
        <p className="mt-4 text-sm text-slate-600">
          Registre a entrada e a saida com rapidez. O sistema salva automaticamente o contexto.
        </p>

        <div className="mt-8 rounded-2xl border border-slate-100 bg-slate-50/70 p-5">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Notas da jornada
          </label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Opcional: reuniao, foco, home office..."
            className="mt-3 h-24 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
          />

          <div className="mt-3">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              PIN (alternativa ao facial)
            </label>
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="Informe seu PIN numerico"
              type="password"
              inputMode="numeric"
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Se o PIN for informado, clock-in e clock-out usam PIN sem exigir captura facial.
            </p>
          </div>

          {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
          {success ? <p className="mt-3 text-xs text-emerald-600">{success}</p> : null}

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button
              onClick={handleClockIn}
              disabled={loading || Boolean(activeEntry)}
              className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50"
            >
              Clock in
            </button>
            <button
              onClick={handleClockOut}
              disabled={loading || !activeEntry}
              className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
            >
              Clock out
            </button>
          </div>
        </div>
      </div>

      <aside className="space-y-5">
        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Reconhecimento facial</h3>
          <p className="mt-2 text-xs text-slate-600">
            {faceStatus?.enrolled
              ? `Cadastro ativo${faceStatus.updatedAt ? ` desde ${formatDateTimeWithTimeZone(faceStatus.updatedAt, viewTimeZone)}` : ''}`
              : 'Sem cadastro facial'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {faceModelsReady
              ? `Modelos faciais carregados (${faceModelSource === '/models' ? 'local' : 'cdn'}).`
              : 'Carregando modelos faciais...'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Prova de vida: mova a cabeca para os lados, para cima e para baixo durante a validacao facial.
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
              {faceLoading ? 'Validando...' : 'Cadastrar rosto'}
            </button>
            <button
              onClick={handleRemoveFace}
              disabled={faceLoading || !faceStatus?.enrolled}
              className="rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
            >
              Remover facial
            </button>
          </div>
        </div>

        {enrollModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 px-4">
            <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
              <div className="border-b border-slate-700 p-5">
                <p className="text-xs uppercase tracking-[0.25em] text-teal-300">Cadastro facial guiado</p>
                <h4 className="mt-2 text-xl font-semibold text-slate-100">Verificacao estilo Face ID</h4>
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
                    <span>Etapa: {enrollStep}</span>
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
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Status atual</h3>
          <p className="mt-2 text-sm text-slate-600">
            {activeEntry ? 'Jornada em andamento' : 'Nenhuma jornada aberta'}
          </p>
          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Tempo ativo</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatElapsed(elapsedMs)}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {currentEntry?.clockIn
                ? `Inicio: ${formatTimeWithTimeZone(currentEntry.clockIn, viewTimeZone)}`
                : 'Sem jornada em andamento'}
            </p>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Ultimo registro: {entries[0]?.clockIn ? formatDateTimeWithTimeZone(entries[0].clockIn, viewTimeZone) : '--'}
          </p>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">Geolocalizacao</h3>
            <button
              onClick={() => {
                refreshLocation().catch(() => undefined)
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600"
              disabled={geoLoading}
            >
              {geoLoading ? 'Atualizando...' : 'Atualizar GPS'}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-600">
            {currentPosition
              ? `Posicao atual: ${currentPosition.lat.toFixed(6)}, ${currentPosition.lng.toFixed(6)}`
              : 'Posicao ainda nao capturada'}
          </p>
          {geofence?.enabled ? (
            <p className="mt-1 text-xs text-slate-500">
              Cerca ativa em modo {geofence.mode} com raio de {Math.round(geofence.radiusMeters)}m
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Cerca virtual desativada no backend</p>
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
                    <Popup>Centro da cerca virtual</Popup>
                  </CircleMarker>
                </>
              ) : null}

              {currentPosition ? (
                <CircleMarker
                  center={[currentPosition.lat, currentPosition.lng]}
                  radius={7}
                  pathOptions={{ color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 1 }}
                >
                  <Popup>Sua posicao atual</Popup>
                </CircleMarker>
              ) : null}
            </MapContainer>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Historico de pontos</h3>
            <button
              onClick={() => {
                loadEntries().catch(() => undefined)
                loadCurrentEntry().catch(() => undefined)
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600"
            >
              Atualizar
            </button>
          </div>
          <div className="mt-4 space-y-3 text-xs text-slate-600">
            {entries.length === 0 ? (
              <p>Sem registros ainda.</p>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between">
                    <span>{formatDateWithTimeZone(entry.clockIn, viewTimeZone)}</span>
                    <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-600">
                      {entry.status}
                    </span>
                  </div>
                  <p className="mt-2">
                    {entry.clockIn ? formatTimeWithTimeZone(entry.clockIn, viewTimeZone) : '--'} -{' '}
                    {entry.clockOut ? formatTimeWithTimeZone(entry.clockOut, viewTimeZone) : 'Em aberto'}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </section>
  )
}

export default ColaboradorDashboard
