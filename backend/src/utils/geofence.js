const DEFAULT_RADIUS_METERS = 200;

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getGeofenceConfig = () => {
  const enabledEnv = String(process.env.GEOFENCE_ENABLED || 'true').toLowerCase();
  const requireLocationEnv = String(process.env.GEOFENCE_REQUIRE_LOCATION || 'false').toLowerCase();
  const modeEnv = String(process.env.GEOFENCE_MODE || 'ALERT').toUpperCase();

  const centerLat = toNumber(process.env.GEOFENCE_CENTER_LAT);
  const centerLng = toNumber(process.env.GEOFENCE_CENTER_LNG);
  const radiusMeters = toNumber(process.env.GEOFENCE_RADIUS_METERS) || DEFAULT_RADIUS_METERS;

  const hasCenter = centerLat !== null && centerLng !== null;
  const enabled = enabledEnv !== 'false' && hasCenter;
  const mode = modeEnv === 'REJECT' ? 'REJECT' : 'ALERT';

  return {
    enabled,
    requireLocation: requireLocationEnv === 'true',
    mode,
    center: hasCenter
      ? {
          lat: centerLat,
          lng: centerLng,
        }
      : null,
    radiusMeters,
  };
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

  if (!config.enabled || !config.center) {
    return {
      enabled: false,
      allowed: true,
      reason: 'GEOFENCE_DISABLED',
      mode: config.mode,
      requireLocation: config.requireLocation,
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
    center: config.center,
    radiusMeters: config.radiusMeters,
  };
};

const getGeofencePublicConfig = () => {
  const config = getGeofenceConfig();

  return {
    enabled: config.enabled,
    mode: config.mode,
    requireLocation: config.requireLocation,
    center: config.center,
    radiusMeters: config.radiusMeters,
  };
};

module.exports = {
  evaluateGeofence,
  getGeofencePublicConfig,
  getGeofenceConfig,
};
