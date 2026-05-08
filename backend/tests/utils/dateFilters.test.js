const {
  getUtcDateRangeForDateOnly,
  parseDateFilter,
} = require('../../src/utils/dateFilters');

describe('dateFilters', () => {
  it('converts date-only report filters using the selected time zone', () => {
    const start = parseDateFilter('2026-05-08', false, 'America/Sao_Paulo');
    const end = parseDateFilter('2026-05-08', true, 'America/Sao_Paulo');

    expect(start.toISOString()).toBe('2026-05-08T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-09T02:59:59.999Z');
  });

  it('returns an exclusive UTC range for a local calendar day', () => {
    const range = getUtcDateRangeForDateOnly('2026-05-08', 'America/Sao_Paulo');

    expect(range.start.toISOString()).toBe('2026-05-08T03:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-05-09T03:00:00.000Z');
  });
});
