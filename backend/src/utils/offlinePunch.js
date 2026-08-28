'use strict';

// Um cliente offline pode propor QUANDO bateu o ponto, mas nao pode ser
// acreditado sem validacao: timestamp de cliente e fronteira de confianca.
const MAX_PUNCH_AGE_MS = 48 * 60 * 60 * 1000; // 48h
const FUTURE_SKEW_TOLERANCE_MS = 60 * 1000;   // relogio do aparelho adiantado

const resolvePunchTimestamp = ({ occurredAt, now = new Date(), maxAgeMs = MAX_PUNCH_AGE_MS } = {}) => {
  if (occurredAt === undefined || occurredAt === null || occurredAt === '') {
    return { timestamp: now, offline: false, skewMs: 0 };
  }

  const parsed = new Date(occurredAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError('occurredAt inválido: informe uma data ISO-8601.');
  }

  const skewMs = now.getTime() - parsed.getTime();

  if (skewMs < -FUTURE_SKEW_TOLERANCE_MS) {
    throw new RangeError('occurredAt no futuro não é aceito.');
  }
  if (skewMs > maxAgeMs) {
    throw new RangeError('occurredAt muito antigo para sincronização offline.');
  }

  return { timestamp: parsed, offline: true, skewMs: Math.max(skewMs, 0) };
};

module.exports = { resolvePunchTimestamp, MAX_PUNCH_AGE_MS, FUTURE_SKEW_TOLERANCE_MS };
