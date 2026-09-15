// Task 2 corta na ORIGEM (recalcDay/clock-out), nao na camada de relatorio: os
// dois formatos do relatorio (.xlsx e o report ao vivo) tem que HERDAR o
// mesmo numero sem nenhuma mudanca de codigo aqui. Este arquivo confirma isso
// para o export, no mesmo espirito de reportRejectedOvertime.test.js para a HE
// negada — resolveWorkedMinutes so precisa aceitar o valor gravado.
//
// reportWorker instancia a Queue e cria o diretório de exports já no require,
// então bullmq, o Redis e o Prisma têm que estar mockados antes do import. Os
// externos vão como `virtual` para o teste rodar sem depender de node_modules
// instalado; com as dependências presentes o factory continua valendo.
jest.mock(
  'bullmq',
  () => ({
    Queue: jest.fn(() => ({ add: jest.fn(), getJob: jest.fn() })),
    Worker: jest.fn(),
  }),
  { virtual: true }
);
jest.mock('xlsx', () => ({ utils: {}, write: jest.fn(), writeFile: jest.fn() }), {
  virtual: true,
});
jest.mock('../../src/config/redis', () => ({}));
jest.mock('../../src/config/database', () => ({ prisma: {} }));

const { buildDailyLogs } = require('../../src/workers/reportWorker');

const WORKED_MINUTES = 'Worked Minutes';
const WORKED_HOURS = 'Worked Hours';

const entry = (over = {}) => ({
  id: 'entry-threshold',
  clockIn: new Date('2026-08-28T11:00:00.000Z'),
  clockOut: new Date('2026-08-28T19:20:00.000Z'), // 500min brutos
  breakMinutes: 0,
  status: 'PENDING',
  notes: null,
  logs: [],
  user: { name: 'Member', email: 'm@test.com' },
  ...over,
});

const cellOf = (rowsResult, column) => {
  const index = rowsResult.headers.indexOf(column);
  return rowsResult.rows[0][index];
};

describe('export diario com o minuto engolido pelo limiar', () => {
  it('paga pelo reconhecido ja gravado pela origem, nao pelo bruto do turno', () => {
    // Contrato 480, limiar 30: a origem (recalcDay/clock-out) ja gravou
    // workedMinutes 480, com overtimeStatus null (sem HE, nao negada). O
    // export so precisa ler o valor gravado.
    const result = buildDailyLogs([entry({ workedMinutes: 480, overtimeStatus: null })]);

    expect(cellOf(result, WORKED_MINUTES)).toBe(480);
    expect(cellOf(result, WORKED_HOURS)).toBe('8.00');
  });
});
