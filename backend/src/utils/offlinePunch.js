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
const ISO_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * O regex acima não conhece calendário, e o parser do V8 NÃO devolve Invalid Date
 * para um dia que não existe: ele TRANSBORDA em silêncio. '2026-02-31T08:00:00Z'
 * vira 3 de março; '2026-09-31T08:00:00Z' enviado em 1º de outubro vira exatamente
 * "agora" e passa por batida plausível. Num timestamp escolhido pelo cliente, um
 * dia inexistente é estado ruim do cliente e tem que aparecer, não ser corrigido.
 *
 * A checagem: montar a data a partir dos componentes do PRÓPRIO texto e exigir que
 * eles voltem iguais. Comparar o instante final não serviria — Date.UTC normaliza
 * do mesmo jeito que o parser, e o transbordo bateria com ele mesmo.
 *
 * A hora 24 (fim de dia legal em ISO-8601, mas que também vira o dia seguinte)
 * cai fora aqui: nenhum cliente que usa toISOString() a produz, e nesta fronteira
 * a data escrita no texto tem que ser a data gravada na folha.
 */
const hasCalendarRollover = ([, year, month, day, hour]) => {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  if (Number(hour) > 23) return true;

  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d
  );
};

const resolvePunchTimestamp = ({ occurredAt, now = new Date(), maxAgeMs = MAX_PUNCH_AGE_MS } = {}) => {
  if (occurredAt === undefined || occurredAt === null || occurredAt === '') {
    return { timestamp: now, offline: false, skewMs: 0 };
  }

  const parts = typeof occurredAt === 'string' ? ISO_INSTANT_PATTERN.exec(occurredAt) : null;

  if (!parts) {
    throw new RangeError(
      'occurredAt inválido: informe data e hora ISO-8601 com fuso explícito (ex.: 2026-08-28T08:00:00.000Z).'
    );
  }

  const parsed = new Date(occurredAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError('occurredAt inválido: informe uma data ISO-8601.');
  }

  if (hasCalendarRollover(parts)) {
    throw new RangeError('occurredAt inválido: data inexistente no calendário.');
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
