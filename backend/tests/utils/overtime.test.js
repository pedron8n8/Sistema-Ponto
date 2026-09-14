// Este modulo decide folha de pagamento e nunca teve teste unitario — nem do
// split 50/100, nem de feriado, nem do contrato default. Como ele passa a ter
// mais um parametro, o arquivo cobre o que ja existia junto com o buffer.
//
// A regra do buffer e GATILHO, NAO DESCONTO: dentro do buffer, zero; acima, o
// excedente inteiro. Com buffer 10, 25 minutos extras valem 25, nao 15.

const {
  calculateOvertimeSummary,
  calculateIncrementalOvertimeSummary,
  calculateCurrentDailyProgress,
  resolveContractDailyMinutes,
} = require('../../src/utils/overtime');

const MINUTE = 60 * 1000;
// Uma quarta-feira: dia util, para o split cair em 50%.
const WEEKDAY_START = new Date('2026-08-26T08:00:00.000Z');

const entryOf = (workedMinutes, over = {}) => ({
  clockIn: WEEKDAY_START,
  clockOut: new Date(WEEKDAY_START.getTime() + workedMinutes * MINUTE),
  contractDailyMinutes: 480,
  workedMinutesBeforeEntry: 0,
  ...over,
});

// calculateOvertimeSummary nao tem chamador em src/ hoje, mas e exportado e
// precisa concordar com a irma incremental: um futuro chamador que nao passe
// bufferMinutes nao pode silenciosamente ignorar a tolerancia da empresa.
describe('calculateOvertimeSummary com buffer', () => {
  it('buffer zera a hora extra do dia, mesmo gatilho da versao incremental', () => {
    const result = calculateOvertimeSummary({
      clockIn: WEEKDAY_START,
      clockOut: new Date(WEEKDAY_START.getTime() + 490 * MINUTE),
      contractDailyMinutes: 480,
      bufferMinutes: 10,
    });

    expect(result.overtimeMinutes).toBe(0);
    expect(result.overtimeMinutes50).toBe(0);
    expect(result.overtimeMinutes100).toBe(0);
    expect(result.overtimePercent).toBe(0);
  });

  it('buffer 0 reproduz exatamente o comportamento de hoje', () => {
    const semParametro = calculateOvertimeSummary({
      clockIn: WEEKDAY_START,
      clockOut: new Date(WEEKDAY_START.getTime() + 505 * MINUTE),
      contractDailyMinutes: 480,
    });
    const comZero = calculateOvertimeSummary({
      clockIn: WEEKDAY_START,
      clockOut: new Date(WEEKDAY_START.getTime() + 505 * MINUTE),
      contractDailyMinutes: 480,
      bufferMinutes: 0,
    });

    expect(semParametro.overtimeMinutes).toBe(25);
    expect(comZero.overtimeMinutes).toBe(25);
  });
});

describe('calculateIncrementalOvertimeSummary com buffer', () => {
  // Tabela normativa da spec: contrato 480, buffer 10.
  it.each([
    ['exatamente o contrato', 480, 0],
    ['exatamente no buffer', 490, 0],
    ['um minuto acima do buffer', 491, 11],
    ['bem acima do buffer', 505, 25],
  ])('%s: %i minutos trabalhados geram %i de hora extra', (_label, worked, expected) => {
    const result = calculateIncrementalOvertimeSummary(entryOf(worked, { bufferMinutes: 10 }));

    expect(result.overtimeMinutes).toBe(expected);
  });

  // Por que ao total do dia e nao por registro: dois registros de 6 minutos
  // acima passariam CADA UM por baixo de uma tolerancia de 10, e o dia fecharia
  // com 12 minutos de hora extra que nunca foram registrados.
  it('aplica o buffer ao total acumulado do dia, nao ao registro isolado', () => {
    const first = calculateIncrementalOvertimeSummary(entryOf(486, { bufferMinutes: 10 }));
    expect(first.overtimeMinutes).toBe(0);

    const second = calculateIncrementalOvertimeSummary(
      entryOf(6, { bufferMinutes: 10, workedMinutesBeforeEntry: 486 })
    );
    expect(second.overtimeMinutes).toBe(12);
  });

  it('com buffer 0 reproduz exatamente o comportamento de hoje', () => {
    const semParametro = calculateIncrementalOvertimeSummary(entryOf(481));
    const comZero = calculateIncrementalOvertimeSummary(entryOf(481, { bufferMinutes: 0 }));

    expect(semParametro.overtimeMinutes).toBe(1);
    expect(comZero.overtimeMinutes).toBe(1);
  });

  it('ignora buffer invalido em vez de quebrar o calculo', () => {
    expect(calculateIncrementalOvertimeSummary(entryOf(505, { bufferMinutes: -10 })).overtimeMinutes).toBe(25);
    expect(calculateIncrementalOvertimeSummary(entryOf(505, { bufferMinutes: NaN })).overtimeMinutes).toBe(25);
  });

  it('zera overtimePercent quando o buffer engole a hora extra', () => {
    const result = calculateIncrementalOvertimeSummary(entryOf(490, { bufferMinutes: 10 }));

    expect(result.overtimeMinutes).toBe(0);
    expect(result.overtimeMinutes50).toBe(0);
    expect(result.overtimeMinutes100).toBe(0);
    // Sem hora extra, o clock-out grava overtimeStatus null e o gate
    // OVERTIME_PENDING nao dispara. Os guards de aprovacao somem sozinhos.
    expect(result.overtimePercent).toBe(0);
  });
});

describe('calculateIncrementalOvertimeSummary: split e dia especial', () => {
  it('manda a hora extra de dia util para 50%', () => {
    const result = calculateIncrementalOvertimeSummary(entryOf(540));

    expect(result.dayType).toBe('WEEKDAY');
    expect(result.overtimeMinutes50).toBe(60);
    expect(result.overtimeMinutes100).toBe(0);
    expect(result.overtimePercent).toBe(50);
  });

  it('manda a hora extra de domingo para 100%', () => {
    // 2026-08-30 e domingo no fuso local do processo.
    const sunday = new Date('2026-08-30T12:00:00.000Z');
    const result = calculateIncrementalOvertimeSummary(
      entryOf(540, { clockIn: sunday, clockOut: new Date(sunday.getTime() + 540 * MINUTE) })
    );

    expect(result.dayType).toBe('SUNDAY');
    expect(result.overtimeMinutes100).toBe(60);
    expect(result.overtimeMinutes50).toBe(0);
    expect(result.overtimePercent).toBe(100);
  });

  // O split atua sobre o valor JA filtrado pelo buffer.
  it('nao gera split quando o buffer ja zerou a hora extra num domingo', () => {
    const sunday = new Date('2026-08-30T12:00:00.000Z');
    const result = calculateIncrementalOvertimeSummary(
      entryOf(485, {
        clockIn: sunday,
        clockOut: new Date(sunday.getTime() + 485 * MINUTE),
        bufferMinutes: 10,
      })
    );

    expect(result.overtimeMinutes).toBe(0);
    expect(result.overtimeMinutes100).toBe(0);
    expect(result.overtimePercent).toBe(0);
  });

  it('trata feriado configurado como dia de 100%', () => {
    const original = process.env.OVERTIME_HOLIDAYS;
    const holiday = new Date('2026-09-07T12:00:00.000Z');
    const year = holiday.getFullYear();
    const month = String(holiday.getMonth() + 1).padStart(2, '0');
    const day = String(holiday.getDate()).padStart(2, '0');
    process.env.OVERTIME_HOLIDAYS = `${year}-${month}-${day}`;

    try {
      const result = calculateIncrementalOvertimeSummary(
        entryOf(540, { clockIn: holiday, clockOut: new Date(holiday.getTime() + 540 * MINUTE) })
      );

      expect(result.dayType).toBe('HOLIDAY');
      expect(result.overtimeMinutes100).toBe(60);
    } finally {
      process.env.OVERTIME_HOLIDAYS = original;
    }
  });

  it('desconta o intervalo antes de comparar com o contrato', () => {
    const result = calculateIncrementalOvertimeSummary(entryOf(540, { breakMinutes: 60 }));

    expect(result.workedMinutes).toBe(480);
    expect(result.overtimeMinutes).toBe(0);
  });

  it('devolve tudo zerado quando a saida nao e posterior a entrada', () => {
    const result = calculateIncrementalOvertimeSummary(
      entryOf(0, { clockOut: WEEKDAY_START, workedMinutesBeforeEntry: 100 })
    );

    expect(result.workedMinutes).toBe(0);
    expect(result.overtimeMinutes).toBe(0);
    expect(result.workedMinutesAfterEntry).toBe(100);
  });
});

describe('resolveContractDailyMinutes', () => {
  it('usa o contrato do colaborador quando ele e valido', () => {
    expect(resolveContractDailyMinutes(360)).toBe(360);
    expect(resolveContractDailyMinutes(360.9)).toBe(360);
  });

  it('cai no default de 480 quando ausente, zero ou invalido', () => {
    expect(resolveContractDailyMinutes(undefined)).toBe(480);
    expect(resolveContractDailyMinutes(null)).toBe(480);
    expect(resolveContractDailyMinutes(0)).toBe(480);
    expect(resolveContractDailyMinutes(-30)).toBe(480);
    expect(resolveContractDailyMinutes('abc')).toBe(480);
  });
});

describe('calculateCurrentDailyProgress com buffer', () => {
  // Sem o buffer aqui, a tela mostra hora extra acumulando durante o dia e o
  // fechamento entrega zero.
  it('nao mostra hora extra enquanto o dia esta dentro do buffer', () => {
    const result = calculateCurrentDailyProgress({
      clockIn: WEEKDAY_START,
      now: new Date(WEEKDAY_START.getTime() + 488 * MINUTE),
      contractDailyMinutes: 480,
      workedMinutesBeforeEntry: 0,
      bufferMinutes: 10,
    });

    expect(result.totalWorkedMinutes).toBe(488);
    expect(result.hasReachedDailyTarget).toBe(true);
    expect(result.overtimeMinutesSoFar).toBe(0);
  });

  it('mostra o excedente inteiro assim que o dia passa do buffer', () => {
    const result = calculateCurrentDailyProgress({
      clockIn: WEEKDAY_START,
      now: new Date(WEEKDAY_START.getTime() + 505 * MINUTE),
      contractDailyMinutes: 480,
      workedMinutesBeforeEntry: 0,
      bufferMinutes: 10,
    });

    expect(result.overtimeMinutesSoFar).toBe(25);
  });

  it('com buffer 0 reproduz o comportamento de hoje', () => {
    const result = calculateCurrentDailyProgress({
      clockIn: WEEKDAY_START,
      now: new Date(WEEKDAY_START.getTime() + 481 * MINUTE),
      contractDailyMinutes: 480,
      workedMinutesBeforeEntry: 0,
    });

    expect(result.overtimeMinutesSoFar).toBe(1);
  });

  // O buffer decide hora extra, nao jornada: a hora em que o contrato fechou
  // continua sendo a mesma.
  it('nao mexe em reachedDailyTargetAt', () => {
    const result = calculateCurrentDailyProgress({
      clockIn: WEEKDAY_START,
      now: new Date(WEEKDAY_START.getTime() + 488 * MINUTE),
      contractDailyMinutes: 480,
      workedMinutesBeforeEntry: 0,
      bufferMinutes: 10,
    });

    expect(result.reachedDailyTargetAt.getTime()).toBe(WEEKDAY_START.getTime() + 480 * MINUTE);
  });
});
