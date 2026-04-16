const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
};

const parsePositiveFloat = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const loadInitialConfig = () => ({
  liveness: {
    enabled: parseBoolean(process.env.FACIAL_LIVENESS_ENABLED, true),
    maxAgeMs: parsePositiveInt(process.env.FACIAL_LIVENESS_MAX_AGE_MS, 15000),
    minFrames: parsePositiveInt(process.env.FACIAL_LIVENESS_MIN_FRAMES, 8),
    minHeadMovementDelta: parsePositiveFloat(process.env.FACIAL_LIVENESS_MIN_HEAD_DELTA, 0.08),
  },
  publicApi: {
    enabled: parseBoolean(process.env.PRO_PUBLIC_API_ENABLED, true),
    defaultTokenTtlHours: parsePositiveInt(process.env.PRO_PUBLIC_API_DEFAULT_TOKEN_TTL_HOURS, 24),
    maxTokenTtlHours: parsePositiveInt(process.env.PRO_PUBLIC_API_MAX_TOKEN_TTL_HOURS, 168),
  },
});

let runtimeProFeatureConfig = loadInitialConfig();

const cloneConfig = () =>
  JSON.parse(JSON.stringify(runtimeProFeatureConfig));

const getProFeatureConfig = () => cloneConfig();

const updateProLivenessConfig = (partial = {}) => {
  const current = runtimeProFeatureConfig.liveness;
  const next = { ...current };

  if (partial.enabled !== undefined) {
    next.enabled = Boolean(partial.enabled);
  }

  if (partial.maxAgeMs !== undefined) {
    const parsed = Number(partial.maxAgeMs);
    if (Number.isFinite(parsed) && parsed > 1000) {
      next.maxAgeMs = Math.floor(parsed);
    }
  }

  if (partial.minFrames !== undefined) {
    const parsed = Number(partial.minFrames);
    if (Number.isFinite(parsed) && parsed >= 1) {
      next.minFrames = Math.floor(parsed);
    }
  }

  if (partial.minHeadMovementDelta !== undefined) {
    const parsed = Number(partial.minHeadMovementDelta);
    if (Number.isFinite(parsed) && parsed > 0) {
      next.minHeadMovementDelta = parsed;
    }
  }

  runtimeProFeatureConfig = {
    ...runtimeProFeatureConfig,
    liveness: next,
  };

  return cloneConfig();
};

const updateProPublicApiConfig = (partial = {}) => {
  const current = runtimeProFeatureConfig.publicApi;
  const next = { ...current };

  if (partial.enabled !== undefined) {
    next.enabled = Boolean(partial.enabled);
  }

  if (partial.defaultTokenTtlHours !== undefined) {
    const parsed = Number(partial.defaultTokenTtlHours);
    if (Number.isFinite(parsed) && parsed > 0) {
      next.defaultTokenTtlHours = Math.floor(parsed);
    }
  }

  if (partial.maxTokenTtlHours !== undefined) {
    const parsed = Number(partial.maxTokenTtlHours);
    if (Number.isFinite(parsed) && parsed > 0) {
      next.maxTokenTtlHours = Math.floor(parsed);
    }
  }

  if (next.defaultTokenTtlHours > next.maxTokenTtlHours) {
    next.defaultTokenTtlHours = next.maxTokenTtlHours;
  }

  runtimeProFeatureConfig = {
    ...runtimeProFeatureConfig,
    publicApi: next,
  };

  return cloneConfig();
};

const resolvePublicApiTokenTtlHours = (requestedHours) => {
  const config = runtimeProFeatureConfig.publicApi;
  const parsed = Number(requestedHours);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return config.defaultTokenTtlHours;
  }

  return Math.min(Math.floor(parsed), config.maxTokenTtlHours);
};

module.exports = {
  getProFeatureConfig,
  updateProLivenessConfig,
  updateProPublicApiConfig,
  resolvePublicApiTokenTtlHours,
};
