jest.mock('bullmq', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
}));
jest.mock('../../src/config/redis', () => ({}));
// mockPrisma (prefixo exigido pelo Jest para poder referenciar fora do factory,
// mesmo padrão de tests/controllers/report.controller.test.js) — controlável o
// bastante para exercitar report.controller.js de verdade neste arquivo, sem
// mockar reportWorker.js (é o módulo sob teste aqui, então não há o conflito de
// mock que existe em report.controller.test.js).
const mockPrisma = require('../mocks/prisma.mock');
jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const { buildDailyLogs, buildSummary, computeEntryPayments } = require('../../src/workers/reportWorker');
const reportController = require('../../src/controllers/report.controller');

const makeEntry = ({
  status,
  workedMinutes,
  rate,
  overtime50 = 0,
  overtime100 = 0,
  overtimeStatus = overtime50 + overtime100 > 0 ? 'APPROVED' : null,
  day = '2026-08-10',
  userId = 'user-1',
  contractDailyMinutes,
  clockInHour = '13:00:00',
}) => ({
  id: `entry-${userId}-${day}-${status}-${workedMinutes}-${overtimeStatus}-${clockInHour}`,
  userId,
  status,
  clockIn: new Date(`${day}T${clockInHour}Z`),
  clockOut: new Date(`${day}T21:00:00Z`),
  workedMinutes,
  breakMinutes: 0,
  overtimeMinutes50: overtime50,
  overtimeMinutes100: overtime100,
  overtimeStatus,
  bankHoursAccruedMinutes: 0,
  logs: [],
  bankHoursEntries: [],
  user: { id: userId, name: 'Ana', email: 'ana@test.com', hourlyRate: rate, timeZone: 'UTC', contractDailyMinutes },
});

const columnOf = (headers, rows, name) => rows.map((row) => row[headers.indexOf(name)]);

describe('reportWorker payment columns', () => {
  it('preenche pagamento pendente e aprovado nas linhas diárias', () => {
    // Cada entry num dia diferente: buildDailyLogs agora precisa do mapa de
    // pagamento pré-computado (computeEntryPayments), que capa por (usuário,
    // dia). Com os três no mesmo dia (como antes desta mudança), o PENDING de
    // 480min (primeiro no enchimento cronológico, mesmo clockIn) esgotaria
    // sozinho o contrato de 480min e o APPROVED de 300min pagaria 0 — o que
    // testaria o teto, não o roteamento por status que este teste quer provar.
    // Om dias distintos nenhum dia isolado passa do contrato e os valores
    // originais (80/50/0) continuam valendo.
    const entries = [
      makeEntry({ status: 'PENDING', workedMinutes: 480, rate: 10, day: '2026-08-10' }),
      makeEntry({ status: 'APPROVED', workedMinutes: 300, rate: 10, day: '2026-08-11' }),
      makeEntry({ status: 'REJECTED', workedMinutes: 120, rate: 10, day: '2026-08-12' }),
    ];
    const { headers, rows } = buildDailyLogs(entries, computeEntryPayments(entries));

    expect(columnOf(headers, rows, 'Pending Payment')).toEqual([80, 0, 0]);
    expect(columnOf(headers, rows, 'Approved Payment')).toEqual([0, 50, 0]);
    expect(columnOf(headers, rows, 'Total Payment')).toEqual([80, 50, 0]);
    expect(columnOf(headers, rows, 'Hourly Rate')).toEqual([10, 10, 10]);
  });

  it('aplica adicional de 50% e 100% nas horas extras aprovadas', () => {
    // 240min normais + 60min a 1.5x + 60min a 2x, a $10/h => 40 + 15 + 20
    const entries = [
      makeEntry({ status: 'APPROVED', workedMinutes: 360, rate: 10, overtime50: 60, overtime100: 60 }),
    ];
    const { headers, rows } = buildDailyLogs(entries, computeEntryPayments(entries));

    expect(columnOf(headers, rows, 'Approved Payment')).toEqual([75]);
  });

  it('não paga adicional de HE ainda pendente de decisão', () => {
    // Mesma jornada do teste anterior, mas com a HE aguardando decisão:
    // só os 240min normais entram => 40. Nada de 1.5x/2x.
    const entries = [
      makeEntry({
        status: 'APPROVED',
        workedMinutes: 360,
        rate: 10,
        overtime50: 60,
        overtime100: 60,
        overtimeStatus: 'PENDING',
      }),
    ];
    const { headers, rows } = buildDailyLogs(entries, computeEntryPayments(entries));

    expect(columnOf(headers, rows, 'Approved Payment')).toEqual([40]);
  });

  it('soma por usuário separando pendente, aprovado e total (rejeitado fora)', () => {
    // Cada entry num dia diferente: o teto agora é por (usuário, dia civil), e as
    // três contagens (480+120+240=840min) num único dia estourariam o contrato
    // padrão de 480min só por coincidirem no mesmo carimbo de data usado pelo
    // fixture — o que não é o que este teste quer provar (soma por usuário ao
    // longo de um período, com pendente/aprovado/rejeitado bem separados). Com
    // um dia por entry, nenhum dia isolado passa do contrato e os valores
    // continuam os mesmos de antes desta mudança.
    const { headers, rows } = buildSummary([
      makeEntry({ status: 'PENDING', workedMinutes: 480, rate: 25, day: '2026-08-10' }),
      makeEntry({ status: 'PENDING', workedMinutes: 120, rate: 25, day: '2026-08-11' }),
      makeEntry({ status: 'APPROVED', workedMinutes: 240, rate: 25, day: '2026-08-12' }),
      makeEntry({ status: 'REJECTED', workedMinutes: 600, rate: 25, day: '2026-08-13' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(columnOf(headers, rows, 'Pending Payment')).toEqual([250]);
    expect(columnOf(headers, rows, 'Approved Payment')).toEqual([100]);
    expect(columnOf(headers, rows, 'Total Payment')).toEqual([350]);
    expect(columnOf(headers, rows, 'Pending Entries')).toEqual([2]);
    expect(columnOf(headers, rows, 'Approved Entries')).toEqual([1]);
    expect(columnOf(headers, rows, 'Total Hours')).toEqual(['14.00']);
  });

  it('no resumo mostra só tempo normal e HE aprovada', () => {
    const { headers, rows } = buildSummary([
      // 360min: 240 normais + 120 de HE aprovada
      makeEntry({ status: 'APPROVED', workedMinutes: 360, rate: 10, overtime50: 60, overtime100: 60 }),
      // 360min: 240 normais + 120 de HE pendente (fica fora do resumo)
      makeEntry({
        status: 'PENDING',
        workedMinutes: 360,
        rate: 10,
        overtime50: 120,
        overtimeStatus: 'PENDING',
      }),
    ]);

    expect(columnOf(headers, rows, 'Normal Hours')).toEqual(['8.00']);
    expect(columnOf(headers, rows, 'Approved OT Hours')).toEqual(['2.00']);
    // Normais + HE aprovada = total; a HE pendente não aparece em lugar nenhum.
    expect(columnOf(headers, rows, 'Total Hours')).toEqual(['10.00']);
    expect(columnOf(headers, rows, 'Approved Hours')).toEqual(['6.00']);
    expect(columnOf(headers, rows, 'Pending Hours')).toEqual(['4.00']);
    expect(columnOf(headers, rows, 'Approved Payment')).toEqual([75]);
    expect(columnOf(headers, rows, 'Pending Payment')).toEqual([40]);
  });

  it('mantém zero quando o usuário não tem valor/hora configurado', () => {
    const { headers, rows } = buildSummary([
      makeEntry({ status: 'PENDING', workedMinutes: 480, rate: null }),
    ]);

    expect(columnOf(headers, rows, 'Total Payment')).toEqual([0]);
  });

  // Tabela de verificação do brief, no buildSummary: contrato 480min (padrão,
  // sem contractDailyMinutes no usuário), R$30/h, entry já aprovado (status
  // APPROVED) para cair direto na coluna "Approved Payment".
  describe('teto contratual do dia (Approved Payment)', () => {
    it('linha 1: worked 490, tolerância engoliu o excesso (OT 0) -> paga 240, não 245', () => {
      const { headers, rows } = buildSummary([
        makeEntry({ status: 'APPROVED', workedMinutes: 490, rate: 30 }),
      ]);

      expect(columnOf(headers, rows, 'Approved Payment')).toEqual([240]);
    });

    it('linha 2: worked 495, mesma tolerância -> paga 240, não 247.50', () => {
      const { headers, rows } = buildSummary([
        makeEntry({ status: 'APPROVED', workedMinutes: 495, rate: 30 }),
      ]);

      expect(columnOf(headers, rows, 'Approved Payment')).toEqual([240]);
    });

    it('linha 3: worked 540, HE 60min APROVADA -> inalterado (285)', () => {
      const { headers, rows } = buildSummary([
        makeEntry({ status: 'APPROVED', workedMinutes: 540, rate: 30, overtime50: 60 }),
      ]);

      expect(columnOf(headers, rows, 'Approved Payment')).toEqual([285]);
    });

    it('linha 4: worked 540, HE 60min NEGADA (colunas zeradas) -> não vira hora normal (240, não 270)', () => {
      const { headers, rows } = buildSummary([
        // rejectOvertime zera as colunas e marca overtimeStatus REJECTED.
        makeEntry({ status: 'APPROVED', workedMinutes: 540, rate: 30, overtime50: 0, overtimeStatus: 'REJECTED' }),
      ]);

      expect(columnOf(headers, rows, 'Approved Payment')).toEqual([240]);
    });

    it('teto por dia, não por entry: dois entries de 300 e 240min pagam min(540,480), não 300+240', () => {
      const { headers, rows } = buildSummary([
        makeEntry({ status: 'APPROVED', workedMinutes: 300, rate: 30 }),
        makeEntry({ status: 'APPROVED', workedMinutes: 240, rate: 30 }),
      ]);

      expect(rows).toHaveLength(1);
      // min(540, 480) = 480min a R$30/h = 240, não 300+240=540min (270).
      expect(columnOf(headers, rows, 'Approved Payment')).toEqual([240]);
    });

    it('dia abaixo do contrato fica inalterado: 400 trabalhado paga 400min (200)', () => {
      const { headers, rows } = buildSummary([
        makeEntry({ status: 'APPROVED', workedMinutes: 400, rate: 30 }),
      ]);

      expect(columnOf(headers, rows, 'Approved Payment')).toEqual([200]);
    });
  });

  // Round 1 do fix: buildDailyLogs pagava o valor pré-teto (por entry, sem cap) e
  // buildSummary já pagava o valor capado — as duas abas do MESMO workbook
  // discordavam para o mesmo dia. A partir de agora as duas consultam o mesmo
  // computeEntryPayments (enchimento cronológico), então isto tem que valer
  // sempre que o teto é atingido — é essa invariante que ninguém testava antes.
  describe('reconciliação entre Daily Logs e Summary (mesmo total, sempre)', () => {
    const sumTotalPayment = ({ headers, rows }) => {
      const col = headers.indexOf('Total Payment');
      return rows.reduce((sum, row) => sum + row[col], 0);
    };

    const expectSheetsReconcile = (entries) => {
      const paymentByEntryId = computeEntryPayments(entries);
      const daily = buildDailyLogs(entries, paymentByEntryId);
      const summary = buildSummary(entries);

      const dailyTotal = sumTotalPayment(daily);
      const summaryTotal = sumTotalPayment(summary);
      expect(dailyTotal).toBe(summaryTotal);

      return dailyTotal;
    };

    it('tolerância engoliu o excesso (worked 490, OT 0): mesmo total nas duas abas (240)', () => {
      const total = expectSheetsReconcile([
        makeEntry({ status: 'APPROVED', workedMinutes: 490, rate: 30 }),
      ]);
      expect(total).toBe(240);
    });

    it('HE negada (worked 540, colunas zeradas): mesmo total nas duas abas (240, não 270)', () => {
      const total = expectSheetsReconcile([
        makeEntry({ status: 'APPROVED', workedMinutes: 540, rate: 30, overtime50: 0, overtimeStatus: 'REJECTED' }),
      ]);
      expect(total).toBe(240);
    });

    it('dia partido em 300+240min: mesmo total nas duas abas (240, não 270)', () => {
      const total = expectSheetsReconcile([
        makeEntry({ status: 'APPROVED', workedMinutes: 300, rate: 30 }),
        makeEntry({ status: 'APPROVED', workedMinutes: 240, rate: 30 }),
      ]);
      expect(total).toBe(240);
    });
  });

  // Round 2 do fix: report.controller.js (página de custo) tinha o MESMO defeito
  // um nível abaixo — row.totalCost já vinha capado, mas entries[].totalCost (o
  // drill-down que Reports.tsx expande) ainda usava o valor pré-teto. As duas
  // telas (página de custo e export) agora chamam a MESMA alocação
  // (entryPayment.allocateDayNormalMinutes) — isto encadeia as três pontas num
  // único número: drill-down soma para a linha, e a linha bate com o que o
  // export paga para os mesmos entries.
  describe('reconciliação de ponta a ponta: drill-down -> linha -> export', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1', isActive: true }]);
    });

    const exportTotalPayment = (entries) => {
      const { headers, rows } = buildSummary(entries);
      return rows[0][headers.indexOf('Total Payment')];
    };

    const expectFullChainReconciles = async (entries) => {
      mockPrisma.timeEntry.findMany.mockResolvedValue(entries);

      const req = { user: { id: 'admin-1', role: 'ADMIN', timeZone: 'UTC' }, query: { date: '2026-05-08' }, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await reportController.getDailyBreakdown(req, res);

      const row = res.json.mock.calls[0][0].rows[0];
      const drillDownSum = Number(row.entries.reduce((sum, e) => sum + e.totalCost, 0).toFixed(2));

      // 1. Drill-down soma exatamente à linha (o defeito que esta rodada corrige).
      expect(drillDownSum).toBe(row.totalCost);
      // 2. A linha bate com o que o export pagaria para os MESMOS entries.
      expect(row.totalCost).toBe(exportTotalPayment(entries));

      return row.totalCost;
    };

    it('tolerância engoliu o excesso (worked 490): drill-down, linha e export batem em 240 (não 245)', async () => {
      const total = await expectFullChainReconciles([
        makeEntry({ status: 'APPROVED', workedMinutes: 490, rate: 30, userId: 'u-tolerancia' }),
      ]);
      expect(total).toBe(240);
    });

    it('HE negada (worked 540, colunas zeradas): drill-down, linha e export batem em 240 (não 270)', async () => {
      const total = await expectFullChainReconciles([
        makeEntry({
          status: 'APPROVED',
          workedMinutes: 540,
          rate: 30,
          overtime50: 0,
          overtimeStatus: 'REJECTED',
          userId: 'u-negada',
        }),
      ]);
      expect(total).toBe(240);
    });

    it('dia partido em 300+240min: drill-down, linha e export batem em 240 (não 270)', async () => {
      const total = await expectFullChainReconciles([
        makeEntry({ status: 'APPROVED', workedMinutes: 300, rate: 30, userId: 'u-split', clockInHour: '08:00:00' }),
        makeEntry({ status: 'APPROVED', workedMinutes: 240, rate: 30, userId: 'u-split', clockInHour: '14:00:00' }),
      ]);
      expect(total).toBe(240);
    });
  });
});
