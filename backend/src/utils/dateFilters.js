const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

const isValidTimeZone = (timeZone) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

const resolveTimeZone = (timeZone) => {
  const normalized = String(timeZone || '').trim();
  return normalized && isValidTimeZone(normalized) ? normalized : DEFAULT_TIME_ZONE;
};

const getTimeZoneOffsetMs = (date, timeZone) => {
  const wholeSecondDate = new Date(date.getTime());
  wholeSecondDate.setUTCMilliseconds(0);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(wholeSecondDate);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );

  const asUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour === 24 ? 0 : values.hour,
    values.minute,
    values.second
  );

  return asUtc - wholeSecondDate.getTime();
};

const zonedDateTimeToUtc = ({ year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0, timeZone }) => {
  const zone = resolveTimeZone(timeZone);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const firstPass = utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), zone);
  const secondPass = utcGuess - getTimeZoneOffsetMs(new Date(firstPass), zone);
  return new Date(secondPass);
};

const parseDateOnlyParts = (value) => {
  if (typeof value !== 'string' || !DATE_ONLY_REGEX.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
};

const parseDateFilter = (value, endOfDay = false, timeZone = DEFAULT_TIME_ZONE) => {
  if (!value) return null;

  const dateOnlyParts = parseDateOnlyParts(value);
  if (dateOnlyParts) {
    return zonedDateTimeToUtc({
      ...dateOnlyParts,
      hour: endOfDay ? 23 : 0,
      minute: endOfDay ? 59 : 0,
      second: endOfDay ? 59 : 0,
      millisecond: endOfDay ? 999 : 0,
      timeZone,
    });
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getUtcDateRangeForDateOnly = (value, timeZone = DEFAULT_TIME_ZONE) => {
  const dateOnlyParts = parseDateOnlyParts(value);
  if (!dateOnlyParts) return null;

  const start = zonedDateTimeToUtc({ ...dateOnlyParts, timeZone });
  const end = zonedDateTimeToUtc({
    ...dateOnlyParts,
    day: dateOnlyParts.day + 1,
    timeZone,
  });

  return { start, end };
};

module.exports = {
  DATE_ONLY_REGEX,
  DEFAULT_TIME_ZONE,
  getUtcDateRangeForDateOnly,
  isValidTimeZone,
  parseDateFilter,
  resolveTimeZone,
};
