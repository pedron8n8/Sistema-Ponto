// A METADE QUE O DESCONTO DE HE NEGADA QUEBRARIA EM SILÊNCIO.
//
// Negar hora extra passou a descontar os minutos negados do tempo reconhecido
// da entrada. Quando a entrada era hora extra de ponta a ponta — turno extra
// colado num dia que já bateu o contrato — o reconhecido cai para 0.
//
// resolveWorkedMinutes tratava 0 como "nunca calculado" e recalculava a duração
// de clockIn/clockOut, então o relatório exportado voltava a mostrar exatamente
// os minutos que o supervisor acabou de negar. O supervisor nega a hora extra,
// abre o XLSX e ela está lá.
//
// O fallback não pode simplesmente aceitar todo 0: ele existe para curar
// registro legado que nunca passou por recalcDay, e por valor os dois zeros são
// idênticos. O discriminador é overtimeStatus REJECTED. Os dois lados estão
// cobertos aqui.

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

// Turno de 1h: 60min de duração bruta entre clockIn e clockOut.
const entry = (over = {}) => ({
  id: 'entry-ot',
  clockIn: new Date('2026-08-28T22:00:00.000Z'),
  clockOut: new Date('2026-08-28T23:00:00.000Z'),
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

describe('relatório diário com hora extra negada', () => {
  it('não ressuscita o tempo negado quando o reconhecido é zero', () => {
    const result = buildDailyLogs([entry({ workedMinutes: 0, overtimeStatus: 'REJECTED' })]);

    // O ponto da regressão: não pode ser 60.
    expect(cellOf(result, WORKED_MINUTES)).not.toBe(60);
    expect(cellOf(result, WORKED_HOURS)).not.toBe('1.00');
  });

  it('mantém o valor reconhecido quando a HE negada deixou tempo normal', () => {
    const result = buildDailyLogs([
      entry({
        clockIn: new Date('2026-08-28T11:00:00.000Z'),
        clockOut: new Date('2026-08-28T20:30:00.000Z'), // 570min brutos
        workedMinutes: 480, // 570 menos os 90 de HE negada
        overtimeStatus: 'REJECTED',
      }),
    ]);

    expect(cellOf(result, WORKED_MINUTES)).toBe(480);
    expect(cellOf(result, WORKED_HOURS)).toBe('8.00');
  });

  // O outro lado: o fallback não pode virar letra morta. Registro legado sem
  // decisão de HE e sem cálculo continua sendo curado pela duração bruta.
  it('ainda cura registro legado sem decisão de hora extra', () => {
    const result = buildDailyLogs([entry({ workedMinutes: 0, overtimeStatus: null })]);

    expect(cellOf(result, WORKED_MINUTES)).toBe(60);
  });

  it('ainda cura registro legado com hora extra aprovada e sem cálculo', () => {
    const result = buildDailyLogs([entry({ workedMinutes: 0, overtimeStatus: 'APPROVED' })]);

    expect(cellOf(result, WORKED_MINUTES)).toBe(60);
  });
});
