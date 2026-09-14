jest.mock('bullmq', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
}));
jest.mock('../../src/config/redis', () => ({}));
jest.mock('../../src/config/database', () => ({ prisma: {} }));

const { buildDailyLogs, buildSummary } = require('../../src/workers/reportWorker');

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
}) => ({
  id: `entry-${userId}-${day}-${status}-${workedMinutes}-${overtimeStatus}`,
  status,
  clockIn: new Date(`${day}T13:00:00Z`),
  clockOut: new Date(`${day}T21:00:00Z`),
  workedMinutes,
  breakMinutes: 0,
  overtimeMinutes50: overtime50,
  overtimeMinutes100: overtime100,
  overtimeStatus,
  logs: [],
  bankHoursEntries: [],
  user: { id: userId, name: 'Ana', email: 'ana@test.com', hourlyRate: rate, timeZone: 'UTC', contractDailyMinutes },
});

const columnOf = (headers, rows, name) => rows.map((row) => row[headers.indexOf(name)]);

describe('reportWorker payment columns', () => {
  it('preenche pagamento pendente e aprovado nas linhas diárias', () => {
    const { headers, rows } = buildDailyLogs([
      makeEntry({ status: 'PENDING', workedMinutes: 480, rate: 10 }),
      makeEntry({ status: 'APPROVED', workedMinutes: 300, rate: 10 }),
      makeEntry({ status: 'REJECTED', workedMinutes: 120, rate: 10 }),
    ]);

    expect(columnOf(headers, rows, 'Pending Payment')).toEqual([80, 0, 0]);
    expect(columnOf(headers, rows, 'Approved Payment')).toEqual([0, 50, 0]);
    expect(columnOf(headers, rows, 'Total Payment')).toEqual([80, 50, 0]);
    expect(columnOf(headers, rows, 'Hourly Rate')).toEqual([10, 10, 10]);
  });

  it('aplica adicional de 50% e 100% nas horas extras aprovadas', () => {
    // 240min normais + 60min a 1.5x + 60min a 2x, a $10/h => 40 + 15 + 20
    const { headers, rows } = buildDailyLogs([
      makeEntry({ status: 'APPROVED', workedMinutes: 360, rate: 10, overtime50: 60, overtime100: 60 }),
    ]);

    expect(columnOf(headers, rows, 'Approved Payment')).toEqual([75]);
  });

  it('não paga adicional de HE ainda pendente de decisão', () => {
    // Mesma jornada do teste anterior, mas com a HE aguardando decisão:
    // só os 240min normais entram => 40. Nada de 1.5x/2x.
    const { headers, rows } = buildDailyLogs([
      makeEntry({
        status: 'APPROVED',
        workedMinutes: 360,
        rate: 10,
        overtime50: 60,
        overtime100: 60,
        overtimeStatus: 'PENDING',
      }),
    ]);

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
});
