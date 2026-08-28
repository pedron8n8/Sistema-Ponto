const { resolvePunchTimestamp } = require('../../src/utils/offlinePunch');

const now = new Date('2026-08-28T12:00:00.000Z');

describe('resolvePunchTimestamp', () => {
  it('uses the server clock when no occurredAt is supplied', () => {
    const result = resolvePunchTimestamp({ now });
    expect(result.timestamp).toEqual(now);
    expect(result.offline).toBe(false);
    expect(result.skewMs).toBe(0);
  });

  it('accepts a past occurredAt inside the window and reports the skew', () => {
    const result = resolvePunchTimestamp({ occurredAt: '2026-08-28T08:00:00.000Z', now });
    expect(result.timestamp).toEqual(new Date('2026-08-28T08:00:00.000Z'));
    expect(result.offline).toBe(true);
    expect(result.skewMs).toBe(4 * 60 * 60 * 1000);
  });

  it('tolerates small forward device skew and keeps the skew sign', () => {
    const result = resolvePunchTimestamp({ occurredAt: '2026-08-28T12:00:30.000Z', now });
    expect(result.offline).toBe(true);
    // Negativo = relógio do aparelho adiantado. Zerar aqui apagaria a única
    // evidência de aparelho com hora errada.
    expect(result.skewMs).toBe(-30 * 1000);
  });

  it('accepts an explicit non-UTC offset', () => {
    const result = resolvePunchTimestamp({ occurredAt: '2026-08-28T05:00:00-03:00', now });
    expect(result.timestamp).toEqual(new Date('2026-08-28T08:00:00.000Z'));
    expect(result.offline).toBe(true);
  });

  it('accepts the boundary at exactly 48h back', () => {
    const result = resolvePunchTimestamp({ occurredAt: '2026-08-26T12:00:00.000Z', now });
    expect(result.offline).toBe(true);
    expect(result.skewMs).toBe(48 * 60 * 60 * 1000);
  });

  it('rejects one millisecond past the 48h boundary', () => {
    expect(() => resolvePunchTimestamp({ occurredAt: '2026-08-26T11:59:59.999Z', now }))
      .toThrow(RangeError);
  });

  it('accepts the boundary at exactly 60s in the future', () => {
    const result = resolvePunchTimestamp({ occurredAt: '2026-08-28T12:01:00.000Z', now });
    expect(result.offline).toBe(true);
    expect(result.skewMs).toBe(-60 * 1000);
  });

  it('rejects one millisecond past the 60s forward tolerance', () => {
    expect(() => resolvePunchTimestamp({ occurredAt: '2026-08-28T12:01:00.001Z', now }))
      .toThrow(RangeError);
  });

  it('rejects a future occurredAt beyond the skew tolerance', () => {
    expect(() => resolvePunchTimestamp({ occurredAt: '2026-08-28T12:05:00.000Z', now }))
      .toThrow(RangeError);
  });

  it('rejects an occurredAt older than the 48h window', () => {
    expect(() => resolvePunchTimestamp({ occurredAt: '2026-08-25T12:00:00.000Z', now }))
      .toThrow(RangeError);
  });

  it('rejects a malformed occurredAt instead of falling back to the server clock', () => {
    expect(() => resolvePunchTimestamp({ occurredAt: 'ontem de manha', now }))
      .toThrow(RangeError);
  });

  // new Date() aceita todas as formas abaixo; ISO-8601 não. Cada uma delas
  // vira um instante que o cliente não pediu — a de fuso implícito muda de
  // significado conforme o TZ da máquina que atendeu a requisição.
  describe('rejects anything that is not a full ISO-8601 instant', () => {
    const rejected = [
      ['a date with no time (would become UTC midnight)', '2026-08-28'],
      ['a date-time with no offset (would use the server timezone)', '2026-08-28T08:00:00'],
      ['a legacy JS date string parsed in the server timezone', 'Aug 28 2026 08:00:00'],
      ['an RFC-1123 date string', 'Fri, 28 Aug 2026 08:00:00 GMT'],
      ['an epoch number', 1756368000000],
      ['an array', [2026, 8, 28]],
      ['a Date object', new Date('2026-08-28T08:00:00.000Z')],
      ['a boolean', true],
      ['an object', { year: 2026 }],
      ['a year-month only', '2026-08'],
      ['a space separator instead of T', '2026-08-28 08:00:00Z'],
      ['an impossible calendar date', '2026-02-31T08:00:00.000Z'],
    ];

    it.each(rejected)('rejects %s', (_label, occurredAt) => {
      expect(() => resolvePunchTimestamp({ occurredAt, now })).toThrow(RangeError);
    });
  });
});
