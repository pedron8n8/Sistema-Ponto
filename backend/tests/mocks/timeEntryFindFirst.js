// clockIn/clockOut fazem mais de uma consulta timeEntry.findFirst agora: o
// registro aberto (clockOut: null) e as checagens de sobreposição do guard de
// batida offline. Sequenciar mockResolvedValueOnce faria cada guard novo
// quebrar todos os testes existentes, então o stub roteia pela cláusula where,
// como o banco faria.

const matchesCondition = (value, condition) => {
  if (condition === null) return value === null || value === undefined;

  if (condition instanceof Date) {
    return Boolean(value) && new Date(value).getTime() === condition.getTime();
  }

  if (condition && typeof condition === 'object') {
    if ('not' in condition) return value !== condition.not;

    if (value === null || value === undefined) return false;
    const time = new Date(value).getTime();

    if (condition.gt !== undefined && !(time > new Date(condition.gt).getTime())) return false;
    if (condition.gte !== undefined && !(time >= new Date(condition.gte).getTime())) return false;
    if (condition.lt !== undefined && !(time < new Date(condition.lt).getTime())) return false;
    if (condition.lte !== undefined && !(time <= new Date(condition.lte).getTime())) return false;
    return true;
  }

  return value === condition;
};

const matchesWhere = (entry, where) =>
  Object.entries(where || {}).every(([field, condition]) =>
    field === 'userId' ? true : matchesCondition(entry[field], condition)
  );

/**
 * Instala o stub de timeEntry.findFirst.
 *
 * @param {object} mockPrisma
 * @param {{ open?: object|null, others?: object[] }} state
 *   open   - registro aberto devolvido para a consulta { clockOut: null }
 *   others - registros já existentes que as checagens de sobreposição enxergam
 */
const stubTimeEntryFindFirst = (mockPrisma, { open = null, others = [] } = {}) => {
  mockPrisma.timeEntry.findFirst.mockImplementation(async (args = {}) => {
    const where = args.where || {};

    if (where.clockOut === null) return open;

    return others.find((entry) => matchesWhere(entry, where)) || null;
  });
};

module.exports = { stubTimeEntryFindFirst };
