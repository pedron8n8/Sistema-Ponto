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

// Limiar de HE curta, configurado por tenant (User.overtimeMinMinutes do dono da
// organizacao). Ausente, nulo ou zero significa desligado — o comportamento
// volta a ser o de antes, sem limiar nenhum.
const resolveMinOvertimeMinutes = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
};

// Corte seco, nao franquia: abaixo do limiar nao ha hora extra; a partir dele a
// hora extra vale CHEIA (11min continuam 11, nao 1).
//
// Recebe sempre o total do DIA, nunca o pedaco de uma marcacao. A HE e um
// conceito diario aqui, e cortar por marcacao deixaria acumular hora extra em
// fatias abaixo do limiar, perdendo minutos realmente trabalhados.
const applyOvertimeThreshold = (dayOvertimeMinutes, minOvertimeMinutes) =>
  dayOvertimeMinutes < minOvertimeMinutes ? 0 : dayOvertimeMinutes;

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

const calculateOvertimeSummary = ({
  clockIn,
  clockOut,
  contractDailyMinutes,
  breakMinutes = 0,
  minOvertimeMinutes,
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
    };
  }

  const workedMinutes = Math.max(
    0,
    Math.floor(diffMs / (1000 * 60)) - resolveBreakMinutes(breakMinutes)
  );
  const effectiveContractMinutes = resolveContractDailyMinutes(contractDailyMinutes);
  // Marcacao unica: o total do dia e o dela mesma, entao o limiar se aplica direto.
  const overtimeMinutes = applyOvertimeThreshold(
    Math.max(0, workedMinutes - effectiveContractMinutes),
    resolveMinOvertimeMinutes(minOvertimeMinutes)
  );
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
  minOvertimeMinutes,
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
  // O limiar corta os TOTAIS do dia (antes e depois da entrada), nunca o pedaco
  // da marcacao. E o que faz duas marcacoes de 6min somarem 12min de HE em vez
  // de virarem zero cada uma: ao cruzar o limiar, os minutos antes suprimidos
  // voltam na entrada que cruzou.
  const threshold = resolveMinOvertimeMinutes(minOvertimeMinutes);
  const overtimeBefore = applyOvertimeThreshold(
    Math.max(0, minutesBefore - effectiveContractMinutes),
    threshold
  );
  const overtimeAfter = applyOvertimeThreshold(
    Math.max(0, totalAfterEntry - effectiveContractMinutes),
    threshold
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
  minOvertimeMinutes,
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
  // O limiar so decide o que e HE. A meta diaria (bateu o contrato) e o tempo
  // trabalhado sao fato e nao se alteram — do contrario o painel diria que a
  // pessoa nao cumpriu a jornada por causa de uma regra sobre hora extra.
  const overtimeMinutesSoFar = applyOvertimeThreshold(
    Math.max(0, totalWorkedMinutes - effectiveContractMinutes),
    resolveMinOvertimeMinutes(minOvertimeMinutes)
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

/**
 * Aplica o limiar de HE curta a um total de hora extra JA calculado do dia.
 *
 * Existe exportada porque a HE nao nasce so aqui: o KPI do supervisor e o worker
 * de alerta proativo calculam `totalDoDia - contrato` por conta propria, ao
 * vivo. Sem um ponto unico, a regra viraria quatro copias e uma delas ficaria
 * para tras — o colaborador veria HE no painel que nao existe no fechamento.
 */
const applyMinOvertimeMinutes = (dayOvertimeMinutes, minOvertimeMinutes) =>
  applyOvertimeThreshold(
    Math.max(0, Math.floor(Number(dayOvertimeMinutes) || 0)),
    resolveMinOvertimeMinutes(minOvertimeMinutes)
  );

module.exports = {
  calculateOvertimeSummary,
  calculateIncrementalOvertimeSummary,
  calculateCurrentDailyProgress,
  resolveContractDailyMinutes,
  applyMinOvertimeMinutes,
};
