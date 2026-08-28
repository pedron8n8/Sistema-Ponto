// clockIn/clockOut fazem mais de uma consulta timeEntry.findFirst agora: o
// registro aberto (clockOut: null) e as checagens de sobreposição. Sequenciar
// mockResolvedValueOnce faria cada guard novo quebrar todos os testes
// existentes, então o stub roteia pela cláusula where, como o banco faria.

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

// `userId` é comparado como qualquer outro campo, de propósito. Enquanto ele era
// tratado como "sempre casa", dava para APAGAR a cláusula userId de qualquer um
// dos dois guards de sobreposição e a suíte inteira continuava verde — enquanto
// no banco a consulta passaria a enxergar registro de OUTRO colaborador e a
// devolver 409 em batida legítima. O stub tem que mentir menos justamente na
// cláusula que separa os dados de um colaborador dos de outro.
const matchesWhere = (entry, where) =>
  Object.entries(where || {}).every(([field, condition]) =>
    matchesCondition(entry[field], condition)
  );

// Ordena como o Postgres ordenaria, para que o `conflictingEntry` ecoado no 409
// seja a linha que o banco escolheria e não a primeira do array do teste.
const applyOrderBy = (entries, orderBy) => {
  const clauses = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean);
  if (!clauses.length) return entries;

  return [...entries].sort((a, b) => {
    for (const clause of clauses) {
      for (const [field, direction] of Object.entries(clause)) {
        const left = a[field] == null ? null : new Date(a[field]).getTime();
        const right = b[field] == null ? null : new Date(b[field]).getTime();
        if (left === right) continue;
        // NULL vai por último no ASC do Postgres.
        if (left === null) return 1;
        if (right === null) return -1;
        return direction === 'desc' ? right - left : left - right;
      }
    }
    return 0;
  });
};

/**
 * Instala o stub de timeEntry.findFirst.
 *
 * @param {object} mockPrisma
 * @param {{ open?: object|null, others?: object[] }} state
 *   open   - registro aberto devolvido para a consulta { clockOut: null }
 *   others - registros já existentes que as checagens de sobreposição enxergam.
 *            Precisam trazer `userId`: é ele que o where filtra.
 */
const stubTimeEntryFindFirst = (mockPrisma, { open = null, others = [] } = {}) => {
  mockPrisma.timeEntry.findFirst.mockImplementation(async (args = {}) => {
    const where = args.where || {};

    if (where.clockOut === null) return open;

    const matches = others.filter((entry) => matchesWhere(entry, where));
    return applyOrderBy(matches, args.orderBy)[0] || null;
  });
};

module.exports = { stubTimeEntryFindFirst };
