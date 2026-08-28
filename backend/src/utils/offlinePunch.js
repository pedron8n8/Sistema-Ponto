'use strict';

// Um cliente offline pode propor QUANDO bateu o ponto, mas nao pode ser
// acreditado sem validacao: timestamp de cliente e fronteira de confianca.
const MAX_PUNCH_AGE_MS = 48 * 60 * 60 * 1000; // 48h
const FUTURE_SKEW_TOLERANCE_MS = 60 * 1000;   // relogio do aparelho adiantado

// new Date() aceita muito mais coisa do que ISO-8601: '2026-08-28' vira meia-noite
// UTC, um número vira epoch, um array vira String(array), e 'Aug 28 2026 08:00:00'
// e derivados são interpretados no fuso LOCAL do servidor — o mesmo payload
// significaria instantes diferentes conforme o TZ da máquina que atendeu. Numa
// fronteira de folha de pagamento o cliente tem que dizer o instante sem
// ambiguidade: data, hora e deslocamento explícito (Z ou ±HH:MM).
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

const resolvePunchTimestamp = ({ occurredAt, now = new Date(), maxAgeMs = MAX_PUNCH_AGE_MS } = {}) => {
  if (occurredAt === undefined || occurredAt === null || occurredAt === '') {
    return { timestamp: now, offline: false, skewMs: 0 };
  }

  if (typeof occurredAt !== 'string' || !ISO_INSTANT_PATTERN.test(occurredAt)) {
    throw new RangeError(
      'occurredAt inválido: informe data e hora ISO-8601 com fuso explícito (ex.: 2026-08-28T08:00:00.000Z).'
    );
  }

  // O padrão acima não conhece calendário: '2026-02-31T00:00:00Z' passa no regex
  // e o parser ISO do V8 devolve Invalid Date. É esta checagem que barra.
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

  // Sinal preservado de propósito: skewMs negativo é relógio do aparelho
  // adiantado. Zerar isso apagaria a única evidência de aparelho com hora
  // errada, deixando-o igual a uma batida em hora exata.
  return { timestamp: parsed, offline: true, skewMs };
};

module.exports = { resolvePunchTimestamp, MAX_PUNCH_AGE_MS, FUTURE_SKEW_TOLERANCE_MS };
