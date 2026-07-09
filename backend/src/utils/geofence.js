const DEFAULT_RADIUS_METERS = 200;
const LOCATION_VALIDATION_SOURCES = {
  MOBILE: 'MOBILE',
  TERMINAL_QR: 'TERMINAL_QR',
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveLocationValidationSource = (value) => {
  const normalized = String(value || LOCATION_VALIDATION_SOURCES.MOBILE).trim().toUpperCase();
  return normalized === LOCATION_VALIDATION_SOURCES.TERMINAL_QR
    ? LOCATION_VALIDATION_SOURCES.TERMINAL_QR
    : LOCATION_VALIDATION_SOURCES.MOBILE;
};

const readEnvGeofenceConfig = () => {
  const geolocationEnabledEnv = String(process.env.GEOLOCATION_ENABLED || 'true').toLowerCase();
  const enabledEnv = String(process.env.GEOFENCE_ENABLED || 'true').toLowerCase();
  const requireLocationEnv = String(process.env.GEOFENCE_REQUIRE_LOCATION || 'false').toLowerCase();
  const modeEnv = String(process.env.GEOFENCE_MODE || 'ALERT').toUpperCase();

  const centerLat = toNumber(process.env.GEOFENCE_CENTER_LAT);
  const centerLng = toNumber(process.env.GEOFENCE_CENTER_LNG);
  const radiusMeters = toNumber(process.env.GEOFENCE_RADIUS_METERS) || DEFAULT_RADIUS_METERS;

  const hasCenter = centerLat !== null && centerLng !== null;
  const enabled = enabledEnv !== 'false' && hasCenter;
  const mode = modeEnv === 'REJECT' ? 'REJECT' : 'ALERT';
  const locationValidationSource = resolveLocationValidationSource(
    process.env.LOCATION_VALIDATION_SOURCE
  );

  return {
    geolocationEnabled: geolocationEnabledEnv !== 'false',
    enabled,
    requireLocation: requireLocationEnv === 'true',
    mode,
    locationValidationSource,
    center: hasCenter
      ? {
          lat: centerLat,
          lng: centerLng,
        }
      : null,
    radiusMeters,
  };
};

let runtimeGeofenceConfig = readEnvGeofenceConfig();

const getGeofenceConfig = () => ({
  ...runtimeGeofenceConfig,
  center: runtimeGeofenceConfig.center ? { ...runtimeGeofenceConfig.center } : null,
});

const updateGeofenceConfig = (partialConfig = {}) => {
  const current = getGeofenceConfig();
  const next = { ...current };

  if (partialConfig.locationValidationSource !== undefined) {
    next.locationValidationSource = resolveLocationValidationSource(partialConfig.locationValidationSource);
  }

  if (partialConfig.geolocationEnabled !== undefined) {
    next.geolocationEnabled = Boolean(partialConfig.geolocationEnabled);
  }

  if (partialConfig.enabled !== undefined) {
    next.enabled = Boolean(partialConfig.enabled);
  }

  if (partialConfig.requireLocation !== undefined) {
    next.requireLocation = Boolean(partialConfig.requireLocation);
  }

  if (partialConfig.mode !== undefined) {
    next.mode = String(partialConfig.mode).toUpperCase() === 'REJECT' ? 'REJECT' : 'ALERT';
  }

  if (partialConfig.radiusMeters !== undefined) {
    const parsedRadius = toNumber(partialConfig.radiusMeters);
    if (parsedRadius !== null && parsedRadius > 0) {
      next.radiusMeters = parsedRadius;
    }
  }

  const center = partialConfig.center || {};
  const latCandidate = center.lat !== undefined ? toNumber(center.lat) : null;
  const lngCandidate = center.lng !== undefined ? toNumber(center.lng) : null;

  if (latCandidate !== null && lngCandidate !== null) {
    next.center = { lat: latCandidate, lng: lngCandidate };
  }

  if (!next.center || !Number.isFinite(Number(next.center.lat)) || !Number.isFinite(Number(next.center.lng))) {
    next.enabled = false;
    next.center = null;
  }

  runtimeGeofenceConfig = next;
  return getGeofenceConfig();
};

const toRadians = (deg) => (deg * Math.PI) / 180;

const haversineDistanceMeters = (from, to) => {
  const earthRadius = 6371000;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);

  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadius * c;
};

const evaluateGeofence = (location) => {
  const config = getGeofenceConfig();

  if (config.locationValidationSource === LOCATION_VALIDATION_SOURCES.TERMINAL_QR) {
    return {
      enabled: config.enabled,
      allowed: true,
      reason: 'TERMINAL_QR_MODE',
      mode: config.mode,
      requireLocation: false,
      locationValidationSource: config.locationValidationSource,
      center: config.center,
      radiusMeters: config.radiusMeters,
    };
  }

  if (!config.geolocationEnabled) {
    return {
      enabled: false,
      allowed: true,
      reason: 'GEOLOCATION_DISABLED',
      mode: config.mode,
      requireLocation: false,
      locationValidationSource: config.locationValidationSource,
    };
  }

  if (!config.enabled || !config.center) {
    return {
      enabled: false,
      allowed: true,
      reason: 'GEOFENCE_DISABLED',
      mode: config.mode,
      requireLocation: config.requireLocation,
      locationValidationSource: config.locationValidationSource,
    };
  }

  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    const allowed = !config.requireLocation;
    return {
      enabled: true,
      allowed,
      inside: false,
      hasCoordinates: false,
      distanceMeters: null,
      exceededByMeters: null,
      mode: config.mode,
      reason: allowed ? 'LOCATION_MISSING_BUT_OPTIONAL' : 'LOCATION_REQUIRED',
      locationValidationSource: config.locationValidationSource,
      center: config.center,
      radiusMeters: config.radiusMeters,
    };
  }

  const distanceMeters = haversineDistanceMeters(location, config.center);
  const inside = distanceMeters <= config.radiusMeters;
  const exceededByMeters = inside ? 0 : Number((distanceMeters - config.radiusMeters).toFixed(2));

  let allowed = inside;
  if (!inside && config.mode === 'ALERT') {
    allowed = true;
  }

  return {
    enabled: true,
    allowed,
    inside,
    hasCoordinates: true,
    distanceMeters: Number(distanceMeters.toFixed(2)),
    exceededByMeters,
    mode: config.mode,
    reason: inside ? 'INSIDE_GEOFENCE' : config.mode === 'REJECT' ? 'OUTSIDE_GEOFENCE_REJECTED' : 'OUTSIDE_GEOFENCE_ALERT',
    locationValidationSource: config.locationValidationSource,
    center: config.center,
    radiusMeters: config.radiusMeters,
  };
};

const getGeofencePublicConfig = () => {
  const config = getGeofenceConfig();

  return {
    geolocationEnabled: config.geolocationEnabled,
    enabled: config.enabled,
    mode: config.mode,
    requireLocation: config.requireLocation,
    locationValidationSource: config.locationValidationSource,
    center: config.center,
    radiusMeters: config.radiusMeters,
  };
};

const GEOFENCE_SETTING_KEY = 'geofence';

const initGeofenceConfig = async () => {
  try {
    const { prisma } = require('../config/database');
    const row = await prisma.appSetting.findUnique({ where: { key: GEOFENCE_SETTING_KEY } });
    if (row?.value) {
      updateGeofenceConfig(row.value);
    }
  } catch (error) {
    console.warn('[geofence] Nao foi possivel carregar configuracao persistida:', error.message);
  }
};

module.exports = {
  LOCATION_VALIDATION_SOURCES,
  GEOFENCE_SETTING_KEY,
  evaluateGeofence,
  getGeofencePublicConfig,
  getGeofenceConfig,
  updateGeofenceConfig,
  initGeofenceConfig,
};
