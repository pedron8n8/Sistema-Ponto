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

const calculateOvertimeSummary = ({ clockIn, clockOut, contractDailyMinutes }) => {
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

  const workedMinutes = Math.floor(diffMs / (1000 * 60));
  const effectiveContractMinutes = resolveContractDailyMinutes(contractDailyMinutes);
  const overtimeMinutes = Math.max(0, workedMinutes - effectiveContractMinutes);

  const holidays = getHolidaySet();
  const dateKey = formatDateKey(start);
  const isSunday = start.getDay() === 0;
  const isHoliday = holidays.has(dateKey);
  const isSpecialDay = isSunday || isHoliday;

  return {
    workedMinutes,
    overtimeMinutes,
    overtimeMinutes50: isSpecialDay ? 0 : overtimeMinutes,
    overtimeMinutes100: isSpecialDay ? overtimeMinutes : 0,
    overtimePercent: overtimeMinutes > 0 ? (isSpecialDay ? 100 : 50) : 0,
    dayType: isHoliday ? 'HOLIDAY' : isSunday ? 'SUNDAY' : 'WEEKDAY',
  };
};

module.exports = {
  calculateOvertimeSummary,
  resolveContractDailyMinutes,
};
