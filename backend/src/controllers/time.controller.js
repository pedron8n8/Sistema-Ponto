const { prisma } = require('../config/database');
const { captureRequestMetadata } = require('../utils/requestMetadata');
const { calculateDuration, getStartOfDay, getEndOfDay } = require('../utils/timeCalculations');
const {
  evaluateGeofence,
  getGeofencePublicConfig,
  getGeofenceConfig,
  LOCATION_VALIDATION_SOURCES,
} = require('../utils/geofence');
const { verifyFaceMatch } = require('../utils/faceRecognition');
const { validateLivenessEvidence } = require('../utils/liveness');
const {
  calculateIncrementalOvertimeSummary,
  calculateCurrentDailyProgress,
} = require('../utils/overtime');
const { accrueBankHours, expireBankHoursIfNeeded } = require('../utils/bankHours');
const {
  issueTerminalQrToken,
  consumeTerminalQrToken,
} = require('../utils/terminalQr');
const {
  verifyPin,
  isPinLocked,
  getPinLockExpiry,
  PIN_MAX_ATTEMPTS,
  PIN_LOCK_MINUTES,
} = require('../utils/pinAuth');
const { emitPunch } = require('../utils/presenceBus');
const { resolvePunchTimestamp } = require('../utils/offlinePunch');

// Justificativa do pedido de ajuste feito pelo colaborador.
const CORRECTION_REASON_MIN_LENGTH = 5;
const CORRECTION_REASON_MAX_LENGTH = 500;

const buildLocationPayload = ({ existingLocation, currentLocation, eventType, geofenceResult }) => {
  const isStructuredLocation =
    existingLocation &&
    typeof existingLocation === 'object' &&
    ('clockIn' in existingLocation || 'clockOut' in existingLocation || 'geofence' in existingLocation);

  const baseLocation = isStructuredLocation
    ? existingLocation
    : {
        clockIn: existingLocation || null,
        clockOut: null,
        geofence: {
          clockIn: null,
          clockOut: null,
        },
      };

  const nextLocation = {
    ...baseLocation,
    geofence: {
      ...(baseLocation.geofence || {}),
    },
  };

  if (eventType === 'clockIn') {
    nextLocation.clockIn = currentLocation || null;
    nextLocation.geofence.clockIn = geofenceResult;
  }

  if (eventType === 'clockOut') {
    nextLocation.clockOut = currentLocation || null;
    nextLocation.geofence.clockOut = geofenceResult;
  }

  return nextLocation;
};

const getGeofenceErrorMessage = (geofenceResult, eventName) => {
  if (geofenceResult.reason === 'LOCATION_REQUIRED') {
    return `Geolocalização obrigatória para ${eventName}. Ative o GPS e permita acesso à localização.`;
  }

  return `${eventName} fora da cerca virtual. Distância: ${geofenceResult.distanceMeters}m, limite: ${geofenceResult.radiusMeters}m.`;
};

const buildDefaultFaceAuth = () => ({
  required: false,
  verified: false,
  reason: 'FACIAL_NOT_CONFIGURED',
  distance: null,
  threshold: null,
  liveness: null,
});

const buildDefaultPinAuth = () => ({
  required: false,
  verified: false,
  reason: 'PIN_NOT_CONFIGURED',
  failedAttempts: 0,
  maxAttempts: PIN_MAX_ATTEMPTS,
  lockMinutes: PIN_LOCK_MINUTES,
  lockedUntil: null,
});

const resolveClockAuthFailureMessage = ({ pinAuth, faceAuth, actionLabel }) => {
  const pinReason = pinAuth?.reason || null;
  const faceReason = faceAuth?.reason || null;
  const pinRequired = Boolean(pinAuth?.required);
  const faceRequired = Boolean(faceAuth?.required);

  if (pinReason === 'PIN_LOCKED') {
    return 'PIN temporariamente bloqueado por excesso de tentativas incorretas.';
  }

  if (pinReason === 'PIN_NOT_PROVIDED' && faceReason === 'FACE_NOT_PROVIDED') {
    return 'Informe seu PIN ou valide seu rosto para registrar o ponto.';
  }

  if (pinReason === 'PIN_NOT_MATCHED' && faceReason === 'FACE_NOT_PROVIDED') {
    return 'PIN incorreto. Tente novamente ou use reconhecimento facial.';
  }

  if (pinReason === 'PIN_NOT_PROVIDED' && faceReason === 'FACE_NOT_MATCHED') {
    return 'Reconhecimento facial nao validado. Tente novamente ou informe seu PIN.';
  }

  if (pinReason === 'PIN_NOT_MATCHED' && faceReason === 'FACE_NOT_MATCHED') {
    return 'PIN e reconhecimento facial nao conferem. Tente novamente.';
  }

  if (pinReason === 'PIN_NOT_PROVIDED' && !faceRequired) {
    return 'Informe seu PIN para registrar o ponto.';
  }

  if (faceReason === 'FACE_NOT_PROVIDED' && !pinRequired) {
    return 'Realize o reconhecimento facial para registrar o ponto.';
  }

  if (pinReason === 'PIN_NOT_MATCHED' && !faceRequired) {
    return 'PIN incorreto. Tente novamente.';
  }

  if (faceReason === 'FACE_NOT_MATCHED' && !pinRequired) {
    return 'Reconhecimento facial nao conferiu. Tente novamente.';
  }

  return `Nao foi possivel validar PIN ou facial para ${actionLabel}.`;
};

const validateClockAuthFactors = async ({ userId, faceDescriptor, livenessData, pin, actionLabel }) => {
  let faceAuth = buildDefaultFaceAuth();
  let pinAuth = buildDefaultPinAuth();

  const userAuthData = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      facialEmbedding: true,
      facialThreshold: true,
      pinHash: true,
      pinSalt: true,
      pinFailedAttempts: true,
      pinLockedUntil: true,
    },
  });

  const hasFaceEnrolled = Boolean(userAuthData?.facialEmbedding);
  const hasPinConfigured = Boolean(userAuthData?.pinHash && userAuthData?.pinSalt);

  if (!hasFaceEnrolled && !hasPinConfigured) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        error: 'Forbidden',
        message:
          'Para registrar ponto, é obrigatório ter PIN ou facial previamente cadastrado. Procure o administrador.',
      },
      faceAuth,
      pinAuth,
    };
  }

  if (hasFaceEnrolled) {
    faceAuth.required = true;
    faceAuth.threshold = userAuthData.facialThreshold;

    if (faceDescriptor) {
      const liveness = validateLivenessEvidence(livenessData);

      if (!liveness.valid) {
        return {
          ok: false,
          statusCode: 401,
          payload: {
            error: 'Unauthorized',
            message: 'Prova de vida facial inválida. Pisque e mova a cabeça para validar o rosto.',
            liveness,
          },
          faceAuth: {
            ...faceAuth,
            reason: 'LIVENESS_FAILED',
            liveness,
          },
          pinAuth,
        };
      }

      const verification = verifyFaceMatch({
        storedEmbedding: userAuthData.facialEmbedding,
        candidateEmbedding: faceDescriptor,
        threshold: userAuthData.facialThreshold,
      });

      if (!verification.valid) {
        return {
          ok: false,
          statusCode: 400,
          payload: {
            error: 'Bad Request',
            message: 'Dados faciais inválidos. Tente capturar novamente.',
            faceAuth: verification,
          },
          faceAuth,
          pinAuth,
        };
      }

      faceAuth = {
        required: true,
        verified: verification.matched,
        reason: verification.reason,
        distance: verification.distance,
        threshold: verification.threshold,
        liveness,
      };
    } else {
      faceAuth.reason = 'FACE_NOT_PROVIDED';
    }
  }

  if (hasPinConfigured) {
    pinAuth.required = true;
    pinAuth.failedAttempts = userAuthData.pinFailedAttempts || 0;
    pinAuth.lockedUntil = userAuthData.pinLockedUntil;

    const pinCurrentlyLocked = isPinLocked(userAuthData.pinLockedUntil);

    if (pin && !pinCurrentlyLocked) {
      const pinMatched = await verifyPin({
        pin,
        hash: userAuthData.pinHash,
        salt: userAuthData.pinSalt,
      });

      if (pinMatched) {
        pinAuth.verified = true;
        pinAuth.reason = 'PIN_MATCHED';
        pinAuth.failedAttempts = 0;

        await prisma.user.update({
          where: { id: userId },
          data: {
            pinFailedAttempts: 0,
            pinLockedUntil: null,
          },
        });
      } else {
        const failedAttempts = (userAuthData.pinFailedAttempts || 0) + 1;
        const shouldLock = failedAttempts >= PIN_MAX_ATTEMPTS;
        const pinLockedUntil = shouldLock ? getPinLockExpiry() : null;

        await prisma.user.update({
          where: { id: userId },
          data: {
            pinFailedAttempts: failedAttempts,
            pinLockedUntil,
          },
        });

        pinAuth = {
          ...pinAuth,
          verified: false,
          reason: shouldLock ? 'PIN_LOCKED' : 'PIN_NOT_MATCHED',
          failedAttempts,
          lockedUntil: pinLockedUntil,
        };
      }
    } else if (pinCurrentlyLocked) {
      pinAuth.reason = 'PIN_LOCKED';
    } else {
      pinAuth.reason = 'PIN_NOT_PROVIDED';
    }
  }

  const hasAnySuccessfulAuth = faceAuth.verified || pinAuth.verified;

  if (!hasAnySuccessfulAuth) {
    if (pinAuth.reason === 'PIN_LOCKED' && !faceAuth.verified) {
      return {
        ok: false,
        statusCode: 429,
        payload: {
          error: 'Too Many Requests',
          message: 'PIN temporariamente bloqueado por excesso de tentativas incorretas.',
          pinAuth,
          faceAuth,
        },
        faceAuth,
        pinAuth,
      };
    }

    return {
      ok: false,
      statusCode: 401,
      payload: {
        error: 'Unauthorized',
        message: resolveClockAuthFailureMessage({
          pinAuth,
          faceAuth,
          actionLabel,
        }),
        pinAuth,
        faceAuth,
      },
      faceAuth,
      pinAuth,
    };
  }

  return {
    ok: true,
    faceAuth,
    pinAuth,
  };
};

const calculateFinancialSummary = ({ workedMinutes, overtimeMinutes50, overtimeMinutes100, hourlyRate }) => {
  const rate = Number(hourlyRate || 0);
  if (!Number.isFinite(rate) || rate <= 0) {
    return {
      hourlyRate: 0,
      regularAmount: 0,
      overtime50Amount: 0,
      overtime100Amount: 0,
      overtimeTotalAmount: 0,
      totalAmount: 0,
    };
  }

  const regularMinutes = Math.max(0, workedMinutes - overtimeMinutes50 - overtimeMinutes100);
  const regularAmount = (regularMinutes / 60) * rate;
  const overtime50Amount = (overtimeMinutes50 / 60) * rate * 1.5;
  const overtime100Amount = (overtimeMinutes100 / 60) * rate * 2;
  const overtimeTotalAmount = overtime50Amount + overtime100Amount;
  const totalAmount = regularAmount + overtimeTotalAmount;

  return {
    hourlyRate: Number(rate.toFixed(2)),
    regularAmount: Number(regularAmount.toFixed(2)),
    overtime50Amount: Number(overtime50Amount.toFixed(2)),
    overtime100Amount: Number(overtime100Amount.toFixed(2)),
    overtimeTotalAmount: Number(overtimeTotalAmount.toFixed(2)),
    totalAmount: Number(totalAmount.toFixed(2)),
  };
};

const resolveStoredBreakMinutes = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
};

const resolveBreakMinutes = (entry, now = new Date()) => {
  if (!entry) {
    return {
      storedMinutes: 0,
      totalMinutes: 0,
      isOnBreak: false,
      startedAt: null,
    };
  }

  const storedMinutes = resolveStoredBreakMinutes(entry.breakMinutes);
  const startedAt = entry.breakStartedAt ? new Date(entry.breakStartedAt) : null;
  const isOnBreak = Boolean(startedAt && Number.isFinite(startedAt.getTime()));
  const additionalMinutes = isOnBreak
    ? Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60000))
    : 0;

  return {
    storedMinutes,
    totalMinutes: storedMinutes + additionalMinutes,
    isOnBreak,
    startedAt: isOnBreak ? startedAt : null,
  };
};

/**
 * Instante mais recente já gravado na linha do tempo de pausas do registro:
 * o início da pausa em aberto ou o fim da última pausa fechada, o que for maior.
 * Um clock-out anterior a isso produziria intervalo de pausa negativo.
 */
const resolveLatestBreakBoundary = (entry) => {
  if (!entry) return null;

  const candidates = [entry.breakStartedAt];

  if (Array.isArray(entry.breaks)) {
    for (const item of entry.breaks) {
      if (item && item.end) candidates.push(item.end);
    }
  }

  return candidates.reduce((latest, value) => {
    if (!value) return latest;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return latest;
    return !latest || parsed.getTime() > latest.getTime() ? parsed : latest;
  }, null);
};

const resolveWorkedMinutes = (entry) => {
  if (!entry || !entry.clockIn || !entry.clockOut) {
    return 0;
  }

  const storedWorkedMinutes = Number(entry.workedMinutes);
  if (Number.isFinite(storedWorkedMinutes) && storedWorkedMinutes > 0) {
    return Math.floor(storedWorkedMinutes);
  }

  const calculatedDuration = calculateDuration(
    entry.clockIn,
    entry.clockOut,
    resolveStoredBreakMinutes(entry.breakMinutes)
  );
  return Math.max(0, Math.floor(Number(calculatedDuration?.totalMinutes) || 0));
};

const LOCATION_SOURCE_TERMINAL_QR =
  LOCATION_VALIDATION_SOURCES?.TERMINAL_QR || 'TERMINAL_QR';

const resolveLocationValidationSource = () => {
  if (typeof getGeofenceConfig !== 'function') {
    return 'MOBILE';
  }

  const geofencePolicy = getGeofenceConfig();
  const source = String(geofencePolicy?.locationValidationSource || 'MOBILE').toUpperCase();
  return source;
};

const getQrErrorMessage = (reason) => {
  const reasonMap = {
    MISSING_QR_TOKEN: 'Token QR não informado.',
    INVALID_QR_TOKEN: 'Token QR inválido.',
    INVALID_QR_SIGNATURE: 'Assinatura do QR inválida.',
    INVALID_QR_PAYLOAD: 'Payload do QR inválido.',
    INVALID_QR_CLAIMS: 'Campos obrigatórios do QR ausentes.',
    QR_TOKEN_EXPIRED: 'QR expirado. Gere um novo código.',
    QR_TOKEN_ALREADY_USED: 'QR já utilizado. Gere um novo código.',
  };

  return reasonMap[reason] || 'Falha ao validar QR Code.';
};

/**
 * POST /time/terminal/qr
 * Emite QR de curta duração para terminal físico
 */
const issueTerminalQr = async (req, res) => {
  try {
    const { terminalId } = req.body || {};

    if (!String(terminalId || '').trim()) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Informe terminalId para gerar o QR.',
      });
    }

    const qrPayload = issueTerminalQrToken({ terminalId: String(terminalId).trim() });
    if (!qrPayload.ok) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Não foi possível gerar QR para o terminal informado.',
        reason: qrPayload.reason,
      });
    }

    res.json({
      message: 'QR dinâmico gerado com sucesso.',
      issuedBy: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
      },
      terminal: qrPayload.terminal,
      qr: {
        token: qrPayload.token,
        expiresAt: qrPayload.expiresAt,
        ttlSeconds: qrPayload.ttlSeconds,
        singleUse: Boolean(qrPayload.singleUse),
        reusable: !Boolean(qrPayload.singleUse),
      },
    });
  } catch (error) {
    console.error('❌ Erro ao emitir QR de terminal:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao emitir QR de terminal',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * Controller para gerenciamento de registros de ponto
 */

/**
 * POST /time/clock-in
 * Registra início do ponto
 */
const clockIn = async (req, res) => {
  try {
    const userId = req.user.id;
    const { notes, faceDescriptor, livenessData, pin, qrToken } = req.body;
    const requiresTerminalQr = resolveLocationValidationSource() === LOCATION_SOURCE_TERMINAL_QR;

    // Verifica se já existe um ponto aberto (sem clock-out) para o usuário
    const openEntry = await prisma.timeEntry.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    if (openEntry) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Você já possui um ponto aberto. Faça clock-out antes de iniciar um novo registro.',
        openEntry: {
          id: openEntry.id,
          clockIn: openEntry.clockIn,
          notes: openEntry.notes,
        },
      });
    }

    // Captura metadados da requisição
    const metadata = captureRequestMetadata(req);

    // Batida offline: o cliente propõe QUANDO aconteceu, o servidor decide se
    // acredita. Sem isso a fila offline gravaria a hora da sincronização.
    let punch;
    try {
      punch = resolvePunchTimestamp({ occurredAt: req.body.occurredAt });
    } catch (error) {
      return res.status(400).json({
        error: 'Bad Request',
        message: error.message,
        code: 'INVALID_OCCURRED_AT',
      });
    }

    // resolvePunchTimestamp limita só o intervalo absoluto (48h atrás / 60s à
    // frente); ele é puro e não enxerga o histórico. Sem esta checagem uma
    // entrada retroativa cai DENTRO ou ANTES de um turno já fechado, e o
    // clock-out seguinte gera minutos trabalhados e hora extra em cima de tempo
    // já contabilizado — folha de pagamento dobrada a partir de horário
    // escolhido pelo cliente. Rejeita em vez de sobrepor, mesmo motivo do guard
    // de ordem no clock-out. Não há registro aberto neste ponto (barrado acima),
    // então basta procurar turno fechado que termine depois do instante pedido.
    if (punch.offline) {
      const conflictingEntry = await prisma.timeEntry.findFirst({
        where: {
          userId,
          clockOut: { gt: punch.timestamp },
        },
        orderBy: { clockOut: 'desc' },
        select: { id: true, clockIn: true, clockOut: true },
      });

      if (conflictingEntry) {
        return res.status(409).json({
          error: 'Conflict',
          message:
            'Já existe registro de ponto cobrindo este horário. Peça ajuste ao seu supervisor.',
          code: 'PUNCH_OVERLAPS_EXISTING_ENTRY',
          conflictingEntry,
        });
      }
    }

    const authResult = await validateClockAuthFactors({
      userId,
      faceDescriptor,
      livenessData,
      pin,
      actionLabel: 'clock-in',
    });

    if (!authResult.ok) {
      return res.status(authResult.statusCode).json(authResult.payload);
    }

    const { faceAuth, pinAuth } = authResult;

    let terminalAuth = null;
    if (requiresTerminalQr) {
      terminalAuth = await consumeTerminalQrToken({ token: qrToken });
      if (!terminalAuth.ok) {
        return res.status(400).json({
          error: 'Bad Request',
          message:
            terminalAuth.reason === 'MISSING_QR_TOKEN'
              ? 'Neste estabelecimento o registro exige QR Code do terminal.'
              : getQrErrorMessage(terminalAuth.reason),
          reason: terminalAuth.reason,
        });
      }
    }

    const geofenceResult = evaluateGeofence(metadata.location);

    if (!geofenceResult.allowed) {
      console.warn(`🚫 Clock-in bloqueado por geofence: ${req.user.email}`, geofenceResult);
      return res.status(400).json({
        error: 'Bad Request',
        message: getGeofenceErrorMessage(geofenceResult, 'clock-in'),
        geofence: geofenceResult,
      });
    }

    if (geofenceResult.enabled && geofenceResult.reason === 'OUTSIDE_GEOFENCE_ALERT') {
      console.warn(`⚠️ Clock-in fora da cerca (modo alerta): ${req.user.email}`, geofenceResult);
    }

    const locationPayload = buildLocationPayload({
      existingLocation: null,
      currentLocation: metadata.location,
      eventType: 'clockIn',
      geofenceResult,
    });

    if (punch.offline) {
      // Origem da batida fica auditável para sempre, sem migration.
      locationPayload.offline = {
        event: 'clockIn',
        occurredAt: punch.timestamp.toISOString(),
        syncedAt: new Date().toISOString(),
        skewMs: punch.skewMs,
        // Marca lida por accrueBankHours: o intervalo deste registro depende de
        // horário informado pelo cliente, então o crédito de banco de horas só
        // sai quando o supervisor aprovar a hora extra. buildLocationPayload
        // preserva este bloco no clock-out, inclusive quando a saída é online.
        bankHoursDeferred: true,
      };
    }

    if (!requiresTerminalQr && qrToken) {
      terminalAuth = await consumeTerminalQrToken({ token: qrToken });
      if (!terminalAuth.ok) {
        return res.status(400).json({
          error: 'Bad Request',
          message: getQrErrorMessage(terminalAuth.reason),
          reason: terminalAuth.reason,
        });
      }

      locationPayload.terminal = {
        id: terminalAuth.terminal.id,
        name: terminalAuth.terminal.name,
        branch: terminalAuth.terminal.branch,
        qrTokenId: terminalAuth.tokenId,
        validatedAt: new Date().toISOString(),
      };
    }

    if (requiresTerminalQr && terminalAuth?.ok) {
      locationPayload.terminal = {
        id: terminalAuth.terminal.id,
        name: terminalAuth.terminal.name,
        branch: terminalAuth.terminal.branch,
        qrTokenId: terminalAuth.tokenId,
        validatedAt: new Date().toISOString(),
      };
    }

    // Cria novo registro de ponto
    const timeEntry = await prisma.timeEntry.create({
      data: {
        userId,
        clockIn: punch.timestamp,
        notes: notes || null,
        ipAddress: metadata.ip,
        device: metadata.device,
        location: locationPayload,
        status: 'PENDING',
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    console.log(`✅ Clock-in registrado: ${req.user.email} às ${timeEntry.clockIn}`);

    emitPunch(userId);

    res.status(201).json({
      message: 'Clock-in registrado com sucesso',
      timeEntry: {
        id: timeEntry.id,
        userId: timeEntry.userId,
        clockIn: timeEntry.clockIn,
        notes: timeEntry.notes,
        ipAddress: timeEntry.ipAddress,
        device: timeEntry.device,
        location: timeEntry.location,
        terminal: terminalAuth?.terminal || null,
        geofence: geofenceResult,
        faceAuth,
        pinAuth,
        status: timeEntry.status,
        user: timeEntry.user,
      },
      ...(geofenceResult.reason === 'OUTSIDE_GEOFENCE_ALERT' && {
        warning: 'Registro fora da cerca virtual. Evidência salva para auditoria.',
      }),
    });
  } catch (error) {
    console.error('❌ Erro ao registrar clock-in:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao registrar entrada',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * POST /time/clock-out
 * Registra fim do ponto
 */
const clockOut = async (req, res) => {
  try {
    const userId = req.user.id;
    const { notes, faceDescriptor, livenessData, pin, qrToken } = req.body;
    const requiresTerminalQr = resolveLocationValidationSource() === LOCATION_SOURCE_TERMINAL_QR;

    const authResult = await validateClockAuthFactors({
      userId,
      faceDescriptor,
      livenessData,
      pin,
      actionLabel: 'clock-out',
    });

    if (!authResult.ok) {
      return res.status(authResult.statusCode).json(authResult.payload);
    }

    const { faceAuth, pinAuth } = authResult;

    // Captura metadados da requisição
    const metadata = captureRequestMetadata(req);

    // Mesma fronteira de confiança do clock-in: workedMinutes e hora extra saem
    // de clockOut - clockIn, então a hora real da batida é o que importa aqui.
    let punch;
    try {
      punch = resolvePunchTimestamp({ occurredAt: req.body.occurredAt });
    } catch (error) {
      return res.status(400).json({
        error: 'Bad Request',
        message: error.message,
        code: 'INVALID_OCCURRED_AT',
      });
    }

    // Busca o último registro aberto (sem clock-out). Toda a validação de
    // horário roda AQUI, antes do bloco de QR: consumeTerminalQrToken queima o
    // token (uso único, chave de replay no Redis), então validar depois faria
    // uma batida rejeitada custar ao colaborador uma volta ao terminal para
    // pegar outro QR. Mesma posição que o parse de INVALID_OCCURRED_AT.
    const openEntry = await prisma.timeEntry.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    if (!openEntry) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Não há registro de ponto aberto. Faça clock-in primeiro.',
      });
    }

    // resolvePunchTimestamp é puro e não conhece o registro aberto, então
    // sozinho ele aceitaria uma saída ANTERIOR à entrada — intervalo negativo
    // descendo para workedMinutes, hora extra 50/100 e banco de horas. Rejeita
    // em vez de arredondar: o estado ruim do cliente precisa aparecer, não ser
    // lavado em número plausível. Roda antes de qualquer consumidor do horário.
    if (punch.timestamp.getTime() < new Date(openEntry.clockIn).getTime()) {
      return res.status(400).json({
        error: 'Bad Request',
        message:
          'A saída não pode ser anterior à entrada do registro aberto. Verifique o relógio do aparelho.',
        code: 'OCCURRED_AT_BEFORE_CLOCK_IN',
      });
    }

    // O guard acima não enxerga a pausa. Uma saída posterior ao clockIn mas
    // ANTERIOR ao início da pausa (ou ao fim de uma pausa já fechada) grava
    // breaks: [{ start, end }] com end < start — intervalo impossível, para
    // sempre, numa coluna de auditoria de folha — enquanto resolveBreakMinutes
    // clampa o delta negativo em 0 e a pausa silenciosamente deixa de ser
    // descontada. Rejeita, não conserta: mesmo raciocínio do guard de ordem.
    const breakBoundary = resolveLatestBreakBoundary(openEntry);

    if (breakBoundary && punch.timestamp.getTime() < breakBoundary.getTime()) {
      return res.status(400).json({
        error: 'Bad Request',
        message:
          'A saída não pode ser anterior à pausa registrada neste ponto. Verifique o relógio do aparelho.',
        code: 'OCCURRED_AT_BEFORE_BREAK',
      });
    }

    // Simétrico ao guard de sobreposição do clock-in: fechar o registro aberto
    // num instante que passa por cima de um registro posterior faria dois
    // turnos contarem o mesmo tempo.
    if (punch.offline) {
      const conflictingEntry = await prisma.timeEntry.findFirst({
        where: {
          userId,
          id: { not: openEntry.id },
          clockIn: {
            gt: openEntry.clockIn,
            lt: punch.timestamp,
          },
        },
        orderBy: { clockIn: 'asc' },
        select: { id: true, clockIn: true, clockOut: true },
      });

      if (conflictingEntry) {
        return res.status(409).json({
          error: 'Conflict',
          message:
            'Já existe registro de ponto cobrindo este horário. Peça ajuste ao seu supervisor.',
          code: 'PUNCH_OVERLAPS_EXISTING_ENTRY',
          conflictingEntry,
        });
      }
    }

    let terminalAuth = null;
    if (requiresTerminalQr) {
      terminalAuth = await consumeTerminalQrToken({ token: qrToken });
      if (!terminalAuth.ok) {
        return res.status(400).json({
          error: 'Bad Request',
          message:
            terminalAuth.reason === 'MISSING_QR_TOKEN'
              ? 'Neste estabelecimento o registro exige QR Code do terminal.'
              : getQrErrorMessage(terminalAuth.reason),
          reason: terminalAuth.reason,
        });
      }
    }

    const geofenceResult = evaluateGeofence(metadata.location);

    if (!geofenceResult.allowed) {
      console.warn(`🚫 Clock-out bloqueado por geofence: ${req.user.email}`, geofenceResult);
      return res.status(400).json({
        error: 'Bad Request',
        message: getGeofenceErrorMessage(geofenceResult, 'clock-out'),
        geofence: geofenceResult,
      });
    }

    if (geofenceResult.enabled && geofenceResult.reason === 'OUTSIDE_GEOFENCE_ALERT') {
      console.warn(`⚠️ Clock-out fora da cerca (modo alerta): ${req.user.email}`, geofenceResult);
    }

    const clockOutTime = punch.timestamp;
    const breakSummary = resolveBreakMinutes(openEntry, clockOutTime);

    const locationPayload = buildLocationPayload({
      existingLocation: openEntry.location,
      currentLocation: metadata.location,
      eventType: 'clockOut',
      geofenceResult,
    });

    if (punch.offline) {
      // Origem da batida fica auditável para sempre, sem migration. O bloco da
      // entrada é preservado quando as duas batidas vieram da fila offline.
      const offlineClockIn = locationPayload.offline;
      locationPayload.offline = {
        event: 'clockOut',
        occurredAt: punch.timestamp.toISOString(),
        syncedAt: new Date().toISOString(),
        skewMs: punch.skewMs,
        // Ver accrueBankHours: crédito represado até a aprovação da hora extra.
        bankHoursDeferred: true,
        ...(offlineClockIn && { clockIn: offlineClockIn }),
      };
    }

    if (!requiresTerminalQr && qrToken) {
      terminalAuth = await consumeTerminalQrToken({ token: qrToken });
      if (!terminalAuth.ok) {
        return res.status(400).json({
          error: 'Bad Request',
          message: getQrErrorMessage(terminalAuth.reason),
          reason: terminalAuth.reason,
        });
      }
    }

    if (terminalAuth?.ok) {
      locationPayload.terminal = {
        ...(locationPayload.terminal || {}),
        id: terminalAuth.terminal.id,
        name: terminalAuth.terminal.name,
        branch: terminalAuth.terminal.branch,
        qrTokenId: terminalAuth.tokenId,
        validatedAt: new Date().toISOString(),
      };
    }

    // Tudo abaixo depende só de openEntry + clockOutTime, então é calculado
    // ANTES de gravar: o clock-out vira um único update completo. Antes eram
    // dois updates e uma falha no meio deixava o ponto fechado sem hora extra,
    // fazendo o retry do usuário responder "não há ponto aberto".
    const duration = calculateDuration(
      openEntry.clockIn,
      clockOutTime,
      breakSummary.totalMinutes
    );

    const userConfig = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        contractDailyMinutes: true,
        hourlyRate: true,
      },
    });

    const dayStart = getStartOfDay(clockOutTime);
    const dayEnd = getEndOfDay(clockOutTime);

    const priorEntriesToday = await prisma.timeEntry.findMany({
      where: {
        userId,
        clockIn: {
          gte: dayStart,
          lte: dayEnd,
          lt: openEntry.clockIn,
        },
        clockOut: {
          not: null,
        },
      },
      select: {
        clockIn: true,
        clockOut: true,
        workedMinutes: true,
      },
    });

    const normalizedPriorEntriesToday = Array.isArray(priorEntriesToday) ? priorEntriesToday : [];

    const workedMinutesBeforeEntry = normalizedPriorEntriesToday.reduce(
      (sum, entry) => sum + resolveWorkedMinutes(entry),
      0
    );

    const overtime = calculateIncrementalOvertimeSummary({
      clockIn: openEntry.clockIn,
      clockOut: clockOutTime,
      contractDailyMinutes: userConfig?.contractDailyMinutes,
      workedMinutesBeforeEntry,
      breakMinutes: breakSummary.totalMinutes,
    });

    const financial = calculateFinancialSummary({
      workedMinutes: overtime.workedMinutes,
      overtimeMinutes50: overtime.overtimeMinutes50,
      overtimeMinutes100: overtime.overtimeMinutes100,
      hourlyRate: userConfig?.hourlyRate,
    });

    // Único write que fecha o ponto — atômico e já com hora extra calculada.
    let enrichedEntry = await prisma.timeEntry.update({
      where: { id: openEntry.id },
      data: {
        clockOut: clockOutTime,
        notes: notes || openEntry.notes,
        location: locationPayload,
        breakMinutes: breakSummary.totalMinutes,
        breakStartedAt: null,
        // Fecha a pausa que estava aberta no clock-out (se houver).
        ...(openEntry.breakStartedAt && {
          breaks: [...(Array.isArray(openEntry.breaks) ? openEntry.breaks : []), { start: openEntry.breakStartedAt, end: clockOutTime }],
        }),
        workedMinutes: overtime.workedMinutes,
        overtimeMinutes: overtime.overtimeMinutes,
        overtimeMinutes50: overtime.overtimeMinutes50,
        overtimeMinutes100: overtime.overtimeMinutes100,
        overtimePercent: overtime.overtimePercent,
        overtimeStatus: overtime.overtimeMinutes > 0 ? 'PENDING' : null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    // Banco de horas depois do ponto já estar fechado: crédito de HE é
    // recalculável, um clock-out perdido não. Falha aqui não derruba o registro.
    // Registro nascido de batida offline não credita nada agora —
    // accrueBankHours lê a marca `location.offline.bankHoursDeferred` que
    // acabou de ser gravada e segura o crédito até a aprovação do supervisor.
    let bankHoursResult = {
      accruedMinutes: 0,
      discardedMinutes: 0,
      balanceMinutes: null,
      expiredMinutes: 0,
    };

    try {
      bankHoursResult = await accrueBankHours({
        userId,
        overtimeMinutes: overtime.overtimeMinutes,
        timeEntryId: enrichedEntry.id,
      });

      if (bankHoursResult.accruedMinutes > 0) {
        enrichedEntry = await prisma.timeEntry.update({
          where: { id: enrichedEntry.id },
          data: { bankHoursAccruedMinutes: bankHoursResult.accruedMinutes },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        });
      }
    } catch (bankHoursError) {
      console.error(
        `⚠️ Clock-out gravado mas banco de horas falhou (entry ${enrichedEntry.id}):`,
        bankHoursError
      );
    }

    console.log(
      `✅ Clock-out registrado: ${req.user.email} às ${clockOutTime} (Duração: ${duration?.formatted || '—'})`
    );

    emitPunch(userId);

    res.json({
      message: 'Clock-out registrado com sucesso',
      timeEntry: {
        id: enrichedEntry.id,
        userId: enrichedEntry.userId,
        clockIn: enrichedEntry.clockIn,
        clockOut: enrichedEntry.clockOut,
        breakMinutes: breakSummary.totalMinutes,
        notes: enrichedEntry.notes,
        ipAddress: enrichedEntry.ipAddress,
        device: enrichedEntry.device,
        location: enrichedEntry.location,
        geofence: geofenceResult,
        faceAuth,
        pinAuth,
        status: enrichedEntry.status,
        duration,
        overtime,
        bankHours: {
          accruedMinutes: bankHoursResult.accruedMinutes,
          // > 0 quando a batida veio da fila offline: o crédito existe mas só
          // entra no saldo quando o supervisor aprovar a hora extra.
          deferredMinutes: bankHoursResult.deferredMinutes || 0,
          discardedMinutes: bankHoursResult.discardedMinutes,
          expiredMinutes: bankHoursResult.expiredMinutes,
          balanceMinutes: bankHoursResult.balanceMinutes,
          limitMinutes: bankHoursResult.limitMinutes,
          policyCode: bankHoursResult.policyCode,
        },
        financial,
        user: enrichedEntry.user,
      },
      ...(geofenceResult.reason === 'OUTSIDE_GEOFENCE_ALERT' && {
        warning: 'Registro fora da cerca virtual. Evidência salva para auditoria.',
      }),
    });
  } catch (error) {
    console.error('❌ Erro ao registrar clock-out:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao registrar saída',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * POST /time/break
 * Inicia pausa no ponto aberto
 */
const startBreak = async (req, res) => {
  try {
    const userId = req.user.id;

    const openEntry = await prisma.timeEntry.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    if (!openEntry) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Não há registro de ponto aberto. Faça clock-in primeiro.',
      });
    }

    if (openEntry.breakStartedAt) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Já existe uma pausa em andamento.',
      });
    }

    const now = new Date();

    const updatedEntry = await prisma.timeEntry.update({
      where: { id: openEntry.id },
      data: {
        breakStartedAt: now,
      },
    });

    emitPunch(userId);

    res.json({
      message: 'Pausa iniciada com sucesso',
      entry: {
        id: updatedEntry.id,
        clockIn: updatedEntry.clockIn,
        breakMinutes: resolveStoredBreakMinutes(updatedEntry.breakMinutes),
        breakStartedAt: updatedEntry.breakStartedAt,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar pausa:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao iniciar pausa',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * POST /time/resume
 * Encerra pausa no ponto aberto
 */
const resumeBreak = async (req, res) => {
  try {
    const userId = req.user.id;

    const openEntry = await prisma.timeEntry.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    if (!openEntry) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Não há registro de ponto aberto. Faça clock-in primeiro.',
      });
    }

    if (!openEntry.breakStartedAt) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Nenhuma pausa ativa para retomar.',
      });
    }

    const now = new Date();
    const breakSummary = resolveBreakMinutes(openEntry, now);

    const updatedEntry = await prisma.timeEntry.update({
      where: { id: openEntry.id },
      data: {
        breakMinutes: breakSummary.totalMinutes,
        breakStartedAt: null,
        breaks: [...(Array.isArray(openEntry.breaks) ? openEntry.breaks : []), { start: openEntry.breakStartedAt, end: now }],
      },
    });

    emitPunch(userId);

    res.json({
      message: 'Pausa encerrada com sucesso',
      entry: {
        id: updatedEntry.id,
        clockIn: updatedEntry.clockIn,
        breakMinutes: resolveStoredBreakMinutes(updatedEntry.breakMinutes),
        breakStartedAt: updatedEntry.breakStartedAt,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao encerrar pausa:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao encerrar pausa',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /time/geofence
 * Retorna configuração pública da cerca virtual
 */
const getGeofenceSettings = async (req, res) => {
  try {
    const config = getGeofencePublicConfig();
    res.json({ geofence: config });
  } catch (error) {
    console.error('❌ Erro ao buscar configuração de geofence:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar configuração de geofence',
    });
  }
};

/**
 * GET /time/bank-hours/me
 * Retorna saldo e histórico recente de banco de horas do usuário logado
 */
const getMyBankHours = async (req, res) => {
  try {
    const userId = req.user.id;

    const { expiredMinutes } = await expireBankHoursIfNeeded(userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        bankHoursBalanceMinutes: true,
        bankHoursLimitMinutes: true,
        bankHoursExpiryMonths: true,
        bankHoursPolicyCode: true,
      },
    });

    const entries = await prisma.bankHoursEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        timeEntry: {
          select: {
            id: true,
            clockIn: true,
            clockOut: true,
          },
        },
      },
    });

    res.json({
      bankHours: {
        balanceMinutes: user?.bankHoursBalanceMinutes || 0,
        limitMinutes: user?.bankHoursLimitMinutes ?? null,
        expiryMonths: user?.bankHoursExpiryMonths ?? 6,
        policyCode: user?.bankHoursPolicyCode || null,
        expiredMinutes,
      },
      entries,
    });
  } catch (error) {
    console.error('❌ Erro ao buscar banco de horas do usuário:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar banco de horas',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /time/me
 * Retorna histórico de pontos do usuário logado
 */
const getMyTimeEntries = async (req, res) => {
  try {
    const userId = req.user.id;
    const allowedStatus = ['PENDING', 'APPROVED', 'REJECTED'];
    const { 
      page = 1, 
      limit = 20, 
      status,
      startDate,
      endDate,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Constrói filtros
    const where = { userId };

    // Filtro por status
    if (status && !allowedStatus.includes(status)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Status inválido. Use um dos valores: ${allowedStatus.join(', ')}`,
      });
    }

    if (status && allowedStatus.includes(status)) {
      where.status = status;
    }

    // Filtro por período
    if (startDate || endDate) {
      where.clockIn = {};
      if (startDate) {
        where.clockIn.gte = new Date(startDate);
      }
      if (endDate) {
        where.clockIn.lte = new Date(endDate);
      }
    }

    // Busca registros e contagem total
    const [entries, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { clockIn: 'desc' },
        include: {
          logs: {
            include: {
              reviewer: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                },
              },
            },
            orderBy: { timestamp: 'desc' },
          },
        },
      }),
      prisma.timeEntry.count({ where }),
    ]);

    // Adiciona duração calculada a cada entrada
    const entriesWithDuration = entries.map((entry) => ({
      ...entry,
      duration: entry.clockOut
        ? calculateDuration(entry.clockIn, entry.clockOut, resolveStoredBreakMinutes(entry.breakMinutes))
        : null,
    }));

    // Calcula estatísticas do período
    const stats = {
      total: total,
      pending: await prisma.timeEntry.count({ where: { userId, status: 'PENDING' } }),
      approved: await prisma.timeEntry.count({ where: { userId, status: 'APPROVED' } }),
      rejected: await prisma.timeEntry.count({ where: { userId, status: 'REJECTED' } }),
    };

    res.json({
      entries: entriesWithDuration,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
      stats,
    });
  } catch (error) {
    console.error('❌ Erro ao buscar histórico:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar histórico de pontos',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /time/current
 * Retorna o registro de ponto aberto (se existir)
 */
const getCurrentEntry = async (req, res) => {
  try {
    const userId = req.user.id;

    const openEntry = await prisma.timeEntry.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!openEntry) {
      return res.json({
        hasOpenEntry: false,
        entry: null,
      });
    }

    const [userConfig, priorEntriesToday] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          contractDailyMinutes: true,
        },
      }),
      prisma.timeEntry.findMany({
        where: {
          userId,
          clockIn: {
            gte: getStartOfDay(openEntry.clockIn),
            lte: getEndOfDay(openEntry.clockIn),
            lt: openEntry.clockIn,
          },
          clockOut: {
            not: null,
          },
        },
        select: {
          clockIn: true,
          clockOut: true,
          workedMinutes: true,
        },
      }),
    ]);

    const normalizedPriorEntriesToday = Array.isArray(priorEntriesToday) ? priorEntriesToday : [];

    const workedMinutesBeforeEntry = normalizedPriorEntriesToday.reduce(
      (sum, entry) => sum + resolveWorkedMinutes(entry),
      0
    );

    const now = new Date();
    const breakSummary = resolveBreakMinutes(openEntry, now);

    const dailyProgress = calculateCurrentDailyProgress({
      clockIn: openEntry.clockIn,
      now,
      contractDailyMinutes: userConfig?.contractDailyMinutes,
      workedMinutesBeforeEntry,
      breakMinutes: breakSummary.totalMinutes,
    });

    // Calcula quanto tempo já passou desde o clock-in
    const elapsed = calculateDuration(openEntry.clockIn, now, breakSummary.totalMinutes);

    res.json({
      hasOpenEntry: true,
      entry: {
        ...openEntry,
        // Coluna crua: quem consome soma a pausa em andamento a partir de breakStartedAt.
        // Mesma convenção de getTodayEntries, supervisor.controller e proactiveAlertWorker.
        breakMinutes: breakSummary.storedMinutes,
        breakStartedAt: breakSummary.startedAt,
        isOnBreak: breakSummary.isOnBreak,
        elapsed,
        dailyProgress,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar registro atual:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar registro atual',
    });
  }
};

/**
 * GET /time/today
 * Retorna todos os registros do dia atual
 */
const getTodayEntries = async (req, res) => {
  try {
    const userId = req.user.id;
    const startOfDay = getStartOfDay();
    const endOfDay = getEndOfDay();

    const entries = await prisma.timeEntry.findMany({
      where: {
        userId,
        clockIn: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      orderBy: { clockIn: 'asc' },
    });

    // Calcula total de horas trabalhadas hoje
    let totalMinutes = 0;
    entries.forEach((entry) => {
      if (entry.clockOut) {
        const duration = calculateDuration(
          entry.clockIn,
          entry.clockOut,
          resolveStoredBreakMinutes(entry.breakMinutes)
        );
        totalMinutes += duration.totalMinutes;
      }
    });

    const totalHours = (totalMinutes / 60).toFixed(2);

    res.json({
      entries: entries.map((entry) => ({
        ...entry,
        duration: entry.clockOut
          ? calculateDuration(entry.clockIn, entry.clockOut, resolveStoredBreakMinutes(entry.breakMinutes))
          : null,
      })),
      summary: {
        totalEntries: entries.length,
        totalMinutes,
        totalHours,
        date: new Date().toISOString().split('T')[0],
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar registros do dia:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar registros do dia',
    });
  }
};

/**
 * GET /time/:id
 * Retorna detalhes de um registro específico
 */
const getTimeEntryById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        logs: {
          include: {
            reviewer: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    if (!entry) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Registro de ponto não encontrado',
      });
    }

    // Verifica se o usuário tem permissão para ver este registro
    if (entry.userId !== userId && !['SUPERADMIN', 'ADMIN', 'SUPERVISOR'].includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você não tem permissão para visualizar este registro',
      });
    }

    // Se for supervisor, verifica se é subordinado
    if (req.user.role === 'SUPERVISOR' && entry.userId !== userId) {
      const subordinate = await prisma.user.findFirst({
        where: {
          id: entry.userId,
          supervisorId: userId,
        },
      });

      if (!subordinate) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Você não tem permissão para visualizar este registro',
        });
      }
    }

    res.json({
      entry: {
        ...entry,
        duration: entry.clockOut
          ? calculateDuration(entry.clockIn, entry.clockOut, resolveStoredBreakMinutes(entry.breakMinutes))
          : null,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar registro:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar registro',
    });
  }
};

/**
 * PATCH /time/:id/notes
 * Permite ao colaborador ajustar apenas as notas quando houver solicitação de edição
 */
const updateMyEntryNotes = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const notes = String(req.body?.notes || '').trim();

    if (!notes) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Informe as notas ajustadas.',
      });
    }

    const entry = await prisma.timeEntry.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        logs: {
          // Só a conversa de edição. Olhar o último log de QUALQUER tipo era um
          // acoplamento entre as duas funcionalidades: o colaborador que
          // clicasse em "Pedir ajuste" gravava MEMBER_CORRECTION_REQUESTED por
          // cima e trancava para sempre a resposta ao EDIT_REQUESTED do
          // supervisor. O que importa é se ainda há solicitação sem resposta.
          where: { action: { in: ['EDIT_REQUESTED', 'EDIT_RESPONSE'] } },
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });

    if (!entry) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Registro de ponto não encontrado.',
      });
    }

    const latestAction = entry.logs?.[0]?.action || null;
    if (latestAction !== 'EDIT_REQUESTED') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Este registro não está com solicitação de ajuste pendente.',
      });
    }

    const [updatedEntry] = await prisma.$transaction([
      prisma.timeEntry.update({
        where: { id: entry.id },
        data: {
          notes,
          status: 'PENDING',
        },
      }),
      prisma.approvalLog.create({
        data: {
          timeEntryId: entry.id,
          reviewerId: userId,
          action: 'EDIT_RESPONSE',
          comment: 'Colaborador ajustou as notas após solicitação de edição.',
        },
      }),
    ]);

    res.json({
      message: 'Notas ajustadas com sucesso. Registro enviado para nova revisão.',
      entry: updatedEntry,
    });
  } catch (error) {
    console.error('❌ Erro ao ajustar notas do registro:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao ajustar notas do registro',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * POST /time/:id/request-correction
 * Colaborador pede ajuste no próprio registro, sem depender de o supervisor
 * abrir a edição antes (o caminho contrário já existe em PATCH /time/:id/notes)
 */
const requestCorrection = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

    if (reason.length < CORRECTION_REASON_MIN_LENGTH || reason.length > CORRECTION_REASON_MAX_LENGTH) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Descreva o ajuste em ${CORRECTION_REASON_MIN_LENGTH} a ${CORRECTION_REASON_MAX_LENGTH} caracteres.`,
      });
    }

    // Escopo na própria consulta, como em updateMyEntryNotes: com findUnique +
    // 403 separado o 403 confirmava para um enumerador que o UUID existe, só
    // não é dele. Resposta uniforme: id inexistente e id alheio dão 404 igual.
    const entry = await prisma.timeEntry.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!entry) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Registro de ponto não encontrado.',
      });
    }

    if (entry.status === 'APPROVED') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Registro já aprovado. Fale com seu supervisor para alterá-lo.',
        code: 'ENTRY_ALREADY_APPROVED',
      });
    }

    // Sem dedupe o colaborador repete o pedido à vontade, e como as telas de
    // pendências do supervisor leem só o último log (take: 1), cada repetição
    // esconde dele a própria última ação. "Sem resposta" = o pedido ainda é o
    // log mais recente; qualquer ação posterior do supervisor conta como
    // resposta e libera um novo pedido.
    const latestLog = await prisma.approvalLog.findFirst({
      where: { timeEntryId: entry.id },
      orderBy: { timestamp: 'desc' },
      select: { action: true },
    });

    if (latestLog?.action === 'MEMBER_CORRECTION_REQUESTED') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Já existe um pedido de ajuste aguardando resposta neste registro.',
        code: 'CORRECTION_ALREADY_REQUESTED',
      });
    }

    // O status do registro NÃO muda: o colaborador registra o pedido, o
    // supervisor continua sendo quem tira o ponto de PENDING.
    const log = await prisma.approvalLog.create({
      data: {
        timeEntryId: entry.id,
        reviewerId: userId,
        action: 'MEMBER_CORRECTION_REQUESTED',
        comment: reason,
      },
    });

    return res.status(201).json({
      // Nada notifica ninguém aqui, e não existe caminho de notificação de
      // aprovação neste sistema: o pedido aparece para o supervisor quando ele
      // abre a revisão do ponto. A mensagem diz só isso.
      message: 'Pedido de ajuste registrado. Ele aparecerá para o supervisor na revisão deste ponto.',
      log,
    });
  } catch (error) {
    console.error('❌ Erro ao registrar pedido de ajuste:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao registrar pedido de ajuste',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

module.exports = {
  issueTerminalQr,
  clockIn,
  clockOut,
  startBreak,
  resumeBreak,
  getMyTimeEntries,
  getCurrentEntry,
  getGeofenceSettings,
  getMyBankHours,
  getTodayEntries,
  getTimeEntryById,
  updateMyEntryNotes,
  requestCorrection,
};
