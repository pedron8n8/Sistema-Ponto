/**
 * Utilitários para cálculos de tempo e data
 */

/**
 * Calcula a duração entre duas datas em formato legível
 */
const calculateDuration = (clockIn, clockOut, breakMinutes = 0) => {
  if (!clockIn || !clockOut) return null;

  const start = new Date(clockIn);
  const end = new Date(clockOut);
  
  const diffMs = end - start;
  
  if (diffMs < 0) return null;

  const safeBreakMinutes = Math.max(0, Math.floor(Number(breakMinutes) || 0));
  const adjustedMs = Math.max(0, diffMs - safeBreakMinutes * 60 * 1000);

  const hours = Math.floor(adjustedMs / (1000 * 60 * 60));
  const minutes = Math.floor((adjustedMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((adjustedMs % (1000 * 60)) / 1000);

  return {
    totalMs: adjustedMs,
    totalMinutes: Math.floor(adjustedMs / (1000 * 60)),
    totalHours: (adjustedMs / (1000 * 60 * 60)).toFixed(2),
    formatted: `${hours}h ${minutes}m ${seconds}s`,
    hours,
    minutes,
    seconds,
  };
};

/**
 * Verifica se uma data está no mesmo dia que outra
 */
const isSameDay = (date1, date2) => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
};

/**
 * Converte 'YYYY-MM-DD' em Date à meia-noite LOCAL.
 * new Date('YYYY-MM-DD') interpreta como UTC e desloca o dia em fusos negativos,
 * o que quebra filtros de data combinados com setHours() local.
 */
const parseLocalDate = (value) => {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Obtém o início e fim do dia
 */
const getStartOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const getEndOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

/**
 * Obtém o início e fim da semana
 */
const getStartOfWeek = (date = new Date()) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Ajusta para segunda-feira
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

const getEndOfWeek = (date = new Date()) => {
  const d = getStartOfWeek(date);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
};

/**
 * Obtém o início e fim do mês
 */
const getStartOfMonth = (date = new Date()) => {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const getEndOfMonth = (date = new Date()) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  d.setHours(23, 59, 59, 999);
  return d;
};

/**
 * Formata data para exibição
 */
const formatDate = (date, locale = 'pt-BR') => {
  return new Date(date).toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

const formatDateTime = (date, locale = 'pt-BR') => {
  return new Date(date).toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

module.exports = {
  calculateDuration,
  isSameDay,
  parseLocalDate,
  getStartOfDay,
  getEndOfDay,
  getStartOfWeek,
  getEndOfWeek,
  getStartOfMonth,
  getEndOfMonth,
  formatDate,
  formatDateTime,
};
