const prisma = require('../config/database');
const { captureRequestMetadata } = require('../utils/requestMetadata');
const { calculateDuration, getStartOfDay, getEndOfDay } = require('../utils/timeCalculations');
const { evaluateGeofence, getGeofencePublicConfig } = require('../utils/geofence');
const { verifyFaceMatch } = require('../utils/faceRecognition');
const { validateLivenessEvidence } = require('../utils/liveness');
const { calculateOvertimeSummary } = require('../utils/overtime');
const { accrueBankHours, expireBankHoursIfNeeded } = require('../utils/bankHours');
const {
  verifyPin,
  isPinLocked,
  getPinLockExpiry,
  PIN_MAX_ATTEMPTS,
  PIN_LOCK_MINUTES,
} = require('../utils/pinAuth');

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
      const pinMatched = verifyPin({
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
        message: `Nao foi possivel validar PIN ou facial para ${actionLabel}.`,
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
    const { notes, faceDescriptor, livenessData, pin } = req.body;

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

    // Cria novo registro de ponto
    const timeEntry = await prisma.timeEntry.create({
      data: {
        userId,
        clockIn: new Date(),
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
    const { notes, faceDescriptor, livenessData, pin } = req.body;

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

    // Busca o último registro aberto (sem clock-out)
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

    const clockOutTime = new Date();

    const locationPayload = buildLocationPayload({
      existingLocation: openEntry.location,
      currentLocation: metadata.location,
      eventType: 'clockOut',
      geofenceResult,
    });

    // Atualiza o registro com clock-out
    const updatedEntry = await prisma.timeEntry.update({
      where: { id: openEntry.id },
      data: {
        clockOut: clockOutTime,
        notes: notes || openEntry.notes,
        location: locationPayload,
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

    // Calcula duração
    const duration = calculateDuration(updatedEntry.clockIn, updatedEntry.clockOut);

    const userConfig = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        contractDailyMinutes: true,
        hourlyRate: true,
      },
    });

    const overtime = calculateOvertimeSummary({
      clockIn: updatedEntry.clockIn,
      clockOut: updatedEntry.clockOut,
      contractDailyMinutes: userConfig?.contractDailyMinutes,
    });

    const bankHoursResult = await accrueBankHours({
      userId,
      overtimeMinutes: overtime.overtimeMinutes,
      timeEntryId: updatedEntry.id,
    });

    const financial = calculateFinancialSummary({
      workedMinutes: overtime.workedMinutes,
      overtimeMinutes50: overtime.overtimeMinutes50,
      overtimeMinutes100: overtime.overtimeMinutes100,
      hourlyRate: userConfig?.hourlyRate,
    });

    const enrichedEntry = await prisma.timeEntry.update({
      where: { id: updatedEntry.id },
      data: {
        workedMinutes: overtime.workedMinutes,
        overtimeMinutes: overtime.overtimeMinutes,
        overtimeMinutes50: overtime.overtimeMinutes50,
        overtimeMinutes100: overtime.overtimeMinutes100,
        overtimePercent: overtime.overtimePercent,
        bankHoursAccruedMinutes: bankHoursResult.accruedMinutes,
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

    console.log(
      `✅ Clock-out registrado: ${req.user.email} às ${clockOutTime} (Duração: ${duration.formatted})`
    );

    res.json({
      message: 'Clock-out registrado com sucesso',
      timeEntry: {
        id: updatedEntry.id,
        userId: enrichedEntry.userId,
        clockIn: enrichedEntry.clockIn,
        clockOut: enrichedEntry.clockOut,
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
    if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
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
      duration: entry.clockOut ? calculateDuration(entry.clockIn, entry.clockOut) : null,
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

    // Calcula quanto tempo já passou desde o clock-in
    const elapsed = calculateDuration(openEntry.clockIn, new Date());

    res.json({
      hasOpenEntry: true,
      entry: {
        ...openEntry,
        elapsed,
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
        const duration = calculateDuration(entry.clockIn, entry.clockOut);
        totalMinutes += duration.totalMinutes;
      }
    });

    const totalHours = (totalMinutes / 60).toFixed(2);

    res.json({
      entries: entries.map((entry) => ({
        ...entry,
        duration: entry.clockOut ? calculateDuration(entry.clockIn, entry.clockOut) : null,
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
    if (entry.userId !== userId && !['ADMIN', 'SUPERVISOR'].includes(req.user.role)) {
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
        duration: entry.clockOut ? calculateDuration(entry.clockIn, entry.clockOut) : null,
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

module.exports = {
  clockIn,
  clockOut,
  getMyTimeEntries,
  getCurrentEntry,
  getGeofenceSettings,
  getMyBankHours,
  getTodayEntries,
  getTimeEntryById,
  updateMyEntryNotes,
};
