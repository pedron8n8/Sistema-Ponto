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

// O buffer chega como parametro e nao lido de configuracao: este modulo e puro
// e nao conhece Prisma. Quem le a empresa e utils/overtimeBuffer.js.
const resolveBufferMinutes = (bufferMinutes) => {
  const parsed = Number(bufferMinutes);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
};

// GATILHO, NAO DESCONTO: dentro do buffer, zero; acima, o excedente inteiro.
// Com buffer 10, 25 minutos extras valem 25, nao 15.
const applyOvertimeBuffer = (overtimeMinutes, bufferMinutes) =>
  overtimeMinutes <= bufferMinutes ? 0 : overtimeMinutes;

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
  bufferMinutes = 0,
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
  // O buffer se aplica ao TOTAL acumulado do dia, nunca ao registro isolado:
  // por registro, dois pontos de 6 minutos passariam cada um por baixo de uma
  // tolerancia de 10 e o dia somaria 12 minutos de hora extra invisivel.
  const buffer = resolveBufferMinutes(bufferMinutes);
  const overtimeBefore = applyOvertimeBuffer(
    Math.max(0, minutesBefore - effectiveContractMinutes),
    buffer
  );
  const overtimeAfter = applyOvertimeBuffer(
    Math.max(0, totalAfterEntry - effectiveContractMinutes),
    buffer
  );
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
  bufferMinutes = 0,
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
  // Mesmo buffer do fechamento: sem isto a tela mostra hora extra acumulando
  // durante o dia e o clock-out entrega zero. hasReachedDailyTarget e
  // reachedDailyTargetAt nao mudam — sao jornada, nao hora extra.
  const overtimeMinutesSoFar = applyOvertimeBuffer(
    Math.max(0, totalWorkedMinutes - effectiveContractMinutes),
    resolveBufferMinutes(bufferMinutes)
  );

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
