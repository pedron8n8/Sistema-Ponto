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

  it('tolerates small forward device skew', () => {
    const result = resolvePunchTimestamp({ occurredAt: '2026-08-28T12:00:30.000Z', now });
    expect(result.offline).toBe(true);
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
});
