const crypto = require('crypto');
const redis = require('../config/redis');

const IDEMPOTENCY_TTL_SECONDS = 2 * 24 * 60 * 60;
const IDEMPOTENCY_MAX_AGE_MS = IDEMPOTENCY_TTL_SECONDS * 1000;
const IDEMPOTENCY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

const stableStringify = (value) => {
  if (value === null || value === undefined) return 'null';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return JSON.stringify('__NON_FINITE_NUMBER__');
    }
    return JSON.stringify(value);
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const serialized = keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',');
    return `{${serialized}}`;
  }

  return JSON.stringify(value);
};

const normalizeBodyForHash = (body) => {
  if (body === undefined) return null;

  try {
    const serialized = JSON.stringify(body);
    if (serialized === undefined) return null;
    return JSON.parse(serialized);
  } catch (error) {
    return null;
  }
};

const buildPayloadHash = ({ body, idempotencyDate }) => {
  const normalizedBody = normalizeBodyForHash(body);
  return crypto
    .createHash('sha256')
    .update(`${idempotencyDate}|${stableStringify(normalizedBody)}`)
    .digest('hex');
};

const parseRecord = (rawRecord) => {
  if (!rawRecord) return null;

  try {
    const parsed = JSON.parse(rawRecord);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (error) {
    return {
      hash: String(rawRecord),
      state: 'COMPLETED',
    };
  }

  return null;
};

const buildActorScope = (req) => {
  const authHeader = req.get('authorization') || '';
  const fallback = req.ip || 'anonymous';
  const rawScope = authHeader.trim() || fallback;

  return crypto.createHash('sha1').update(rawScope).digest('hex').slice(0, 20);
};

const buildStorageKey = (req, key) => {
  const routeScope = `${req.baseUrl || ''}${req.path || ''}` || req.originalUrl || '/';
  const actorScope = buildActorScope(req);

  return `idempotency:v1:${req.method}:${routeScope}:${actorScope}:${key}`;
};

const shouldProcessRequest = (req) => {
  if (!IDEMPOTENCY_METHODS.has(req.method)) {
    return false;
  }

  const hasKey = Boolean(req.get('x-idempotency-key'));
  const hasDate = Boolean(req.get('x-idempotency-date'));

  return hasKey || hasDate;
};

const attachFinalizeHandler = ({ res, storageKey, payloadHash }) => {
  res.on('finish', () => {
    const completedRecord = JSON.stringify({
      hash: payloadHash,
      state: 'COMPLETED',
      statusCode: res.statusCode,
      completedAt: new Date().toISOString(),
    });

    const finalizePromise =
      res.statusCode >= 400
        ? redis.del(storageKey)
        : redis.set(storageKey, completedRecord, 'EX', IDEMPOTENCY_TTL_SECONDS);

    Promise.resolve(finalizePromise).catch((error) => {
      console.error('Falha ao finalizar registro de idempotencia:', error?.message || error);
    });
  });
};

const idempotencyMiddleware = async (req, res, next) => {
  if (!shouldProcessRequest(req)) {
    return next();
  }

  const rawKey = req.get('x-idempotency-key');
  const rawDate = req.get('x-idempotency-date');

  if (!rawKey || !rawDate) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'x-idempotency-key e x-idempotency-date devem ser enviados juntos.',
    });
  }

  const idempotencyKey = String(rawKey).trim().toLowerCase();
  const idempotencyDate = String(rawDate).trim();

  if (!/^[a-f0-9]{64}$/.test(idempotencyKey)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'x-idempotency-key invalido. Formato esperado: hash SHA-256 em hexadecimal.',
    });
  }

  const parsedDateMs = Date.parse(idempotencyDate);
  if (!Number.isFinite(parsedDateMs)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'x-idempotency-date invalido. Envie uma data valida (ex: 2026-04-13).',
    });
  }

  if (Math.abs(Date.now() - parsedDateMs) > IDEMPOTENCY_MAX_AGE_MS) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'x-idempotency-date fora da janela permitida de 2 dias.',
    });
  }

  const payloadHash = buildPayloadHash({
    body: req.body,
    idempotencyDate,
  });

  if (idempotencyKey !== payloadHash) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'x-idempotency-key nao confere com o hash calculado para payload e data.',
    });
  }

  const storageKey = buildStorageKey(req, idempotencyKey);

  const processingRecord = JSON.stringify({
    hash: payloadHash,
    state: 'PROCESSING',
    receivedAt: new Date().toISOString(),
  });

  try {
    const reserved = await redis.set(
      storageKey,
      processingRecord,
      'EX',
      IDEMPOTENCY_TTL_SECONDS,
      'NX'
    );

    if (reserved === 'OK') {
      attachFinalizeHandler({ res, storageKey, payloadHash });
      return next();
    }

    let existingRawRecord = await redis.get(storageKey);

    if (!existingRawRecord) {
      const retryReserve = await redis.set(
        storageKey,
        processingRecord,
        'EX',
        IDEMPOTENCY_TTL_SECONDS,
        'NX'
      );

      if (retryReserve === 'OK') {
        attachFinalizeHandler({ res, storageKey, payloadHash });
        return next();
      }

      existingRawRecord = await redis.get(storageKey);
    }

    const existingRecord = parseRecord(existingRawRecord);
    const existingHash = existingRecord?.hash || null;

    if (!existingHash || existingHash !== payloadHash) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'x-idempotency-key ja foi usado com um payload diferente.',
      });
    }

    const isProcessing = existingRecord?.state === 'PROCESSING';

    return res.status(202).json({
      message: isProcessing
        ? 'Requisicao duplicada em processamento. Ultima tentativa foi ignorada.'
        : 'Requisicao duplicada ignorada.',
      idempotency: {
        ignored: true,
        duplicate: true,
        state: isProcessing ? 'PROCESSING' : 'COMPLETED',
      },
    });
  } catch (error) {
    // Fail-open: idempotencia nao deve derrubar a API em indisponibilidade temporaria do Redis.
    console.error('Falha ao validar idempotencia no Redis:', error?.message || error);
    return next();
  }
};

module.exports = idempotencyMiddleware;
