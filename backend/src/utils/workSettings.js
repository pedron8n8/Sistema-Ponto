const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const normalizeMinutes = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Math.floor(parsed);
  if (rounded < 60 || rounded > 24 * 60) {
    return null;
  }

  return rounded;
};

const normalizeTime = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = String(value).trim();
  if (!TIME_REGEX.test(normalized)) {
    return null;
  }

  return normalized;
};

const normalizeHourlyRate = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
};

const normalizeTimeZone = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized });
    return normalized;
  } catch {
    return null;
  }
};

module.exports = {
  normalizeMinutes,
  normalizeTime,
  normalizeHourlyRate,
  normalizeTimeZone,
};
