const parseBoolean = (value, defaultValue) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return String(value).toLowerCase() === 'true';
};

const parseNumber = (value, defaultValue) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const isLivenessValidationEnabled = () => parseBoolean(process.env.FACIAL_LIVENESS_ENABLED, true);

const livenessConfig = () => ({
  maxAgeMs: parseNumber(process.env.FACIAL_LIVENESS_MAX_AGE_MS, 15000),
  minFrames: parseNumber(process.env.FACIAL_LIVENESS_MIN_FRAMES, 8),
  minHeadMovementDelta: parseNumber(process.env.FACIAL_LIVENESS_MIN_HEAD_DELTA, 0.08),
});

const validateLivenessEvidence = (evidence) => {
  if (!isLivenessValidationEnabled()) {
    return {
      enabled: false,
      valid: true,
      reason: 'LIVENESS_DISABLED',
    };
  }

  if (!evidence || typeof evidence !== 'object') {
    return {
      enabled: true,
      valid: false,
      reason: 'LIVENESS_NOT_PROVIDED',
    };
  }

  const config = livenessConfig();
  const capturedAtMs = Date.parse(evidence.capturedAt || '');

  if (!Number.isFinite(capturedAtMs)) {
    return {
      enabled: true,
      valid: false,
      reason: 'LIVENESS_INVALID_TIMESTAMP',
    };
  }

  const ageMs = Date.now() - capturedAtMs;
  const frameCount = Number(evidence.frameCount || 0);
  const headMovementDelta = Number(evidence.headMovementDelta || 0);
  const headMovementDetected = Boolean(evidence.headMovementDetected);

  if (ageMs < 0 || ageMs > config.maxAgeMs) {
    return {
      enabled: true,
      valid: false,
      reason: 'LIVENESS_STALE',
      ageMs,
      ...config,
    };
  }

  if (frameCount < config.minFrames) {
    return {
      enabled: true,
      valid: false,
      reason: 'LIVENESS_INSUFFICIENT_FRAMES',
      frameCount,
      ...config,
    };
  }

  if (!headMovementDetected && headMovementDelta < config.minHeadMovementDelta) {
    return {
      enabled: true,
      valid: false,
      reason: 'LIVENESS_HEAD_MOVEMENT_REQUIRED',
      ...config,
    };
  }

  if (!headMovementDetected || headMovementDelta < config.minHeadMovementDelta) {
    return {
      enabled: true,
      valid: false,
      reason: 'LIVENESS_HEAD_MOVEMENT_REQUIRED',
      headMovementDelta,
      ...config,
    };
  }

  return {
    enabled: true,
    valid: true,
    reason: 'LIVENESS_OK',
    ageMs,
    frameCount,
    headMovementDelta,
    ...config,
  };
};

module.exports = {
  isLivenessValidationEnabled,
  validateLivenessEvidence,
};
