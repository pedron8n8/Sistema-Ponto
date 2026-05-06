const DEFAULT_DAILY_WORK_MINUTES = Number(process.env.DEFAULT_DAILY_WORK_MINUTES || 480);

const formatDateKey = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getHolidaySet = () => {
  const raw = String(process.env.OVERTIME_HOLIDAYS || '').trim();
  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
};

const resolveContractDailyMinutes = (userContractDailyMinutes) => {
  const parsed = Number(userContractDailyMinutes);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }

  return DEFAULT_DAILY_WORK_MINUTES;
};

const resolveBreakMinutes = (breakMinutes) => {
  const parsed = Number(breakMinutes);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
};

const resolveDayType = (date) => {
  const targetDate = new Date(date);
  const holidays = getHolidaySet();
  const dateKey = formatDateKey(targetDate);
  const isSunday = targetDate.getDay() === 0;
  const isHoliday = holidays.has(dateKey);

  return {
    isSpecialDay: isSunday || isHoliday,
    dayType: isHoliday ? 'HOLIDAY' : isSunday ? 'SUNDAY' : 'WEEKDAY',
  };
};

const calculateOvertimeSummary = ({ clockIn, clockOut, contractDailyMinutes, breakMinutes = 0 }) => {
  const start = new Date(clockIn);
  const end = new Date(clockOut);
  const diffMs = end.getTime() - start.getTime();

  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return {
      workedMinutes: 0,
      overtimeMinutes: 0,
      overtimeMinutes50: 0,
      overtimeMinutes100: 0,
      overtimePercent: 0,
      dayType: 'WEEKDAY',
    };
  }

  const workedMinutes = Math.max(
    0,
    Math.floor(diffMs / (1000 * 60)) - resolveBreakMinutes(breakMinutes)
  );
  const effectiveContractMinutes = resolveContractDailyMinutes(contractDailyMinutes);
  const overtimeMinutes = Math.max(0, workedMinutes - effectiveContractMinutes);
  const { isSpecialDay, dayType } = resolveDayType(start);

  return {
    workedMinutes,
    overtimeMinutes,
    overtimeMinutes50: isSpecialDay ? 0 : overtimeMinutes,
    overtimeMinutes100: isSpecialDay ? overtimeMinutes : 0,
    overtimePercent: overtimeMinutes > 0 ? (isSpecialDay ? 100 : 50) : 0,
    dayType,
  };
};

const calculateIncrementalOvertimeSummary = ({
  clockIn,
  clockOut,
  contractDailyMinutes,
  workedMinutesBeforeEntry,
  breakMinutes = 0,
}) => {
  const start = new Date(clockIn);
  const end = new Date(clockOut);
  const diffMs = end.getTime() - start.getTime();

  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return {
      workedMinutes: 0,
      overtimeMinutes: 0,
      overtimeMinutes50: 0,
      overtimeMinutes100: 0,
      overtimePercent: 0,
      dayType: 'WEEKDAY',
      workedMinutesBeforeEntry: Math.max(0, Math.floor(Number(workedMinutesBeforeEntry) || 0)),
      workedMinutesAfterEntry: Math.max(0, Math.floor(Number(workedMinutesBeforeEntry) || 0)),
      contractDailyMinutes: resolveContractDailyMinutes(contractDailyMinutes),
    };
  }

  const workedMinutes = Math.max(
    0,
    Math.floor(diffMs / (1000 * 60)) - resolveBreakMinutes(breakMinutes)
  );
  const effectiveContractMinutes = resolveContractDailyMinutes(contractDailyMinutes);
  const minutesBefore = Math.max(0, Math.floor(Number(workedMinutesBeforeEntry) || 0));
  const totalAfterEntry = minutesBefore + workedMinutes;
  const overtimeBefore = Math.max(0, minutesBefore - effectiveContractMinutes);
  const overtimeAfter = Math.max(0, totalAfterEntry - effectiveContractMinutes);
  const overtimeMinutes = Math.max(0, overtimeAfter - overtimeBefore);
  const { isSpecialDay, dayType } = resolveDayType(start);

  return {
    workedMinutes,
    overtimeMinutes,
    overtimeMinutes50: isSpecialDay ? 0 : overtimeMinutes,
    overtimeMinutes100: isSpecialDay ? overtimeMinutes : 0,
    overtimePercent: overtimeMinutes > 0 ? (isSpecialDay ? 100 : 50) : 0,
    dayType,
    workedMinutesBeforeEntry: minutesBefore,
    workedMinutesAfterEntry: totalAfterEntry,
    contractDailyMinutes: effectiveContractMinutes,
  };
};

const calculateCurrentDailyProgress = ({
  clockIn,
  now,
  contractDailyMinutes,
  workedMinutesBeforeEntry,
  breakMinutes = 0,
}) => {
  const start = new Date(clockIn);
  const end = new Date(now || new Date());
  const diffMs = end.getTime() - start.getTime();
  const currentEntryWorkedMinutes = Math.max(
    0,
    Math.floor(diffMs / (1000 * 60)) - resolveBreakMinutes(breakMinutes)
  );
  const effectiveContractMinutes = resolveContractDailyMinutes(contractDailyMinutes);
  const minutesBefore = Math.max(0, Math.floor(Number(workedMinutesBeforeEntry) || 0));
  const totalWorkedMinutes = minutesBefore + currentEntryWorkedMinutes;
  const hasReachedDailyTarget = totalWorkedMinutes >= effectiveContractMinutes;
  const overtimeMinutesSoFar = Math.max(0, totalWorkedMinutes - effectiveContractMinutes);

  let reachedDailyTargetAt = null;
  if (hasReachedDailyTarget) {
    if (minutesBefore >= effectiveContractMinutes) {
      reachedDailyTargetAt = new Date(start);
    } else {
      const remainingRegularMinutes = effectiveContractMinutes - minutesBefore;
      reachedDailyTargetAt = new Date(start.getTime() + remainingRegularMinutes * 60 * 1000);
    }
  }

  return {
    contractDailyMinutes: effectiveContractMinutes,
    workedMinutesBeforeEntry: minutesBefore,
    currentEntryWorkedMinutes,
    totalWorkedMinutes,
    hasReachedDailyTarget,
    reachedDailyTargetAt,
    overtimeMinutesSoFar,
    remainingRegularMinutes: Math.max(0, effectiveContractMinutes - totalWorkedMinutes),
  };
};

module.exports = {
  calculateOvertimeSummary,
  calculateIncrementalOvertimeSummary,
  calculateCurrentDailyProgress,
  resolveContractDailyMinutes,
};
