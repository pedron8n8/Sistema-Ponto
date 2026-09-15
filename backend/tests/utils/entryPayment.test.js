// Testes unitários para utils/entryPayment.js — a aritmética compartilhada e as
// duas políticas nomeadas (settled vs incurred).

const {
  calculateEntryPayment,
  calculateEntryPaymentRaw,
  resolveSettledOvertime,
  resolveIncurredOvertime,
} = require('../../src/utils/entryPayment');

describe('calculateEntryPayment', () => {
  it('calcula normais + HE 50% + HE 100% e arredonda para 2 casas', () => {
    // 240min normais + 60min a 1.5x + 60min a 2x, a $10/h => 40 + 15 + 20 = 75
    const result = calculateEntryPayment({
      workedMinutes: 360,
      overtimeMinutes50: 60,
      overtimeMinutes100: 60,
      hourlyRate: 10,
    });

    expect(result).toEqual({
      hourlyRate: 10,
      regularAmount: 40,
      overtime50Amount: 15,
      overtime100Amount: 20,
      overtimeTotalAmount: 35,
      totalAmount: 75,
    });
  });

  it('arredonda o resultado para 2 casas decimais', () => {
    const result = calculateEntryPayment({
      workedMinutes: 100,
      overtimeMinutes50: 0,
      overtimeMinutes100: 0,
      hourlyRate: 33.333,
    });

    // 100/60 * 33.333 = 55.555, e toFixed(2) do JS arredonda esse valor para 55.55
    // (representação binária de 55.555 é ligeiramente menor que o exato).
    expect(result.regularAmount).toBe(55.55);
    expect(result.totalAmount).toBe(55.55);
  });

  it('retorna tudo zerado quando a taxa é zero', () => {
    const result = calculateEntryPayment({
      workedMinutes: 480,
      overtimeMinutes50: 60,
      overtimeMinutes100: 0,
      hourlyRate: 0,
    });

    expect(result).toEqual({
      hourlyRate: 0,
      regularAmount: 0,
      overtime50Amount: 0,
      overtime100Amount: 0,
      overtimeTotalAmount: 0,
      totalAmount: 0,
    });
  });

  it('retorna tudo zerado quando a taxa é null/undefined', () => {
    expect(
      calculateEntryPayment({ workedMinutes: 480, overtimeMinutes50: 0, overtimeMinutes100: 0, hourlyRate: null })
    ).toEqual({
      hourlyRate: 0,
      regularAmount: 0,
      overtime50Amount: 0,
      overtime100Amount: 0,
      overtimeTotalAmount: 0,
      totalAmount: 0,
    });

    expect(
      calculateEntryPayment({ workedMinutes: 480, overtimeMinutes50: 0, overtimeMinutes100: 0 })
    ).toEqual(
      expect.objectContaining({ totalAmount: 0 })
    );
  });

  it('retorna tudo zerado quando a taxa é negativa', () => {
    const result = calculateEntryPayment({
      workedMinutes: 480,
      overtimeMinutes50: 0,
      overtimeMinutes100: 0,
      hourlyRate: -10,
    });

    expect(result.totalAmount).toBe(0);
    expect(result.regularAmount).toBe(0);
  });

  it('nunca deixa minutos normais ficarem negativos quando a HE excede o trabalhado', () => {
    const result = calculateEntryPayment({
      workedMinutes: 60,
      overtimeMinutes50: 60,
      overtimeMinutes100: 60,
      hourlyRate: 10,
    });

    // regularMinutes = max(0, 60 - 60 - 60) = 0
    expect(result.regularAmount).toBe(0);
  });
});

describe('calculateEntryPaymentRaw', () => {
  it('não arredonda nada, ao contrário de calculateEntryPayment', () => {
    const result = calculateEntryPaymentRaw({
      workedMinutes: 100,
      overtimeMinutes50: 0,
      overtimeMinutes100: 0,
      hourlyRate: 33.333,
    });

    // 100/60 * 33.333 = 55.555 exato em ponto flutuante, sem toFixed.
    expect(result.regularAmount).toBeCloseTo(55.555, 10);
    expect(result.totalAmount).toBeCloseTo(55.555, 10);
  });

  it('soma RAW de várias entries e arredonda uma única vez bate com a conta exata', () => {
    // $8/h, 400min cada: (400/60)*8 = 53.333...
    const single = calculateEntryPaymentRaw({
      workedMinutes: 400,
      overtimeMinutes50: 0,
      overtimeMinutes100: 0,
      hourlyRate: 8,
    });

    const summedRaw = single.totalAmount * 3;
    // Somar os 3 valores raw e arredondar uma vez dá 160.00 (3 * 53.333... = 160 exato),
    // diferente de arredondar cada um antes (3 * 53.33 = 159.99).
    expect(Number(summedRaw.toFixed(2))).toBe(160);
  });

  it('retorna tudo zerado quando a taxa é zero, null ou negativa, igual ao wrapper', () => {
    expect(
      calculateEntryPaymentRaw({ workedMinutes: 480, overtimeMinutes50: 0, overtimeMinutes100: 0, hourlyRate: 0 })
    ).toEqual({
      hourlyRate: 0,
      regularAmount: 0,
      overtime50Amount: 0,
      overtime100Amount: 0,
      overtimeTotalAmount: 0,
      totalAmount: 0,
    });

    expect(
      calculateEntryPaymentRaw({ workedMinutes: 480, overtimeMinutes50: 0, overtimeMinutes100: 0, hourlyRate: null })
    ).toEqual(
      expect.objectContaining({ totalAmount: 0 })
    );

    expect(
      calculateEntryPaymentRaw({ workedMinutes: 480, overtimeMinutes50: 0, overtimeMinutes100: 0, hourlyRate: -10 })
    ).toEqual(
      expect.objectContaining({ totalAmount: 0 })
    );
  });
});

describe('resolveSettledOvertime', () => {
  it('devolve os minutos armazenados quando overtimeStatus é APPROVED', () => {
    const entry = { overtimeStatus: 'APPROVED', overtimeMinutes50: 30, overtimeMinutes100: 15 };
    expect(resolveSettledOvertime(entry)).toEqual({ overtimeMinutes50: 30, overtimeMinutes100: 15 });
  });

  it('devolve zero quando overtimeStatus é PENDING', () => {
    const entry = { overtimeStatus: 'PENDING', overtimeMinutes50: 30, overtimeMinutes100: 15 };
    expect(resolveSettledOvertime(entry)).toEqual({ overtimeMinutes50: 0, overtimeMinutes100: 0 });
  });

  it('devolve zero quando overtimeStatus é REJECTED', () => {
    const entry = { overtimeStatus: 'REJECTED', overtimeMinutes50: 30, overtimeMinutes100: 15 };
    expect(resolveSettledOvertime(entry)).toEqual({ overtimeMinutes50: 0, overtimeMinutes100: 0 });
  });

  it('devolve zero quando overtimeStatus é null (sem HE a decidir)', () => {
    const entry = { overtimeStatus: null, overtimeMinutes50: 0, overtimeMinutes100: 0 };
    expect(resolveSettledOvertime(entry)).toEqual({ overtimeMinutes50: 0, overtimeMinutes100: 0 });
  });
});

describe('resolveIncurredOvertime', () => {
  it('devolve toda a HE registrada independente do status', () => {
    expect(resolveIncurredOvertime({ overtimeStatus: 'PENDING', overtimeMinutes50: 30, overtimeMinutes100: 15 })).toEqual({
      overtimeMinutes50: 30,
      overtimeMinutes100: 15,
    });
    expect(resolveIncurredOvertime({ overtimeStatus: 'APPROVED', overtimeMinutes50: 30, overtimeMinutes100: 15 })).toEqual({
      overtimeMinutes50: 30,
      overtimeMinutes100: 15,
    });
    expect(resolveIncurredOvertime({ overtimeStatus: 'REJECTED', overtimeMinutes50: 30, overtimeMinutes100: 15 })).toEqual({
      overtimeMinutes50: 30,
      overtimeMinutes100: 15,
    });
  });
});

describe('incurred = settled + pending', () => {
  it('vale para um entry com HE pendente (nada aprovado ainda)', () => {
    const entry = { overtimeStatus: 'PENDING', overtimeMinutes50: 40, overtimeMinutes100: 20 };

    const incurred = resolveIncurredOvertime(entry);
    const settled = resolveSettledOvertime(entry);
    const pending = {
      overtimeMinutes50: incurred.overtimeMinutes50 - settled.overtimeMinutes50,
      overtimeMinutes100: incurred.overtimeMinutes100 - settled.overtimeMinutes100,
    };

    expect(settled).toEqual({ overtimeMinutes50: 0, overtimeMinutes100: 0 });
    expect(pending).toEqual(incurred);
    expect(incurred.overtimeMinutes50).toBe(settled.overtimeMinutes50 + pending.overtimeMinutes50);
    expect(incurred.overtimeMinutes100).toBe(settled.overtimeMinutes100 + pending.overtimeMinutes100);
  });

  it('vale para um entry totalmente aprovado (pending fica em zero)', () => {
    const entry = { overtimeStatus: 'APPROVED', overtimeMinutes50: 40, overtimeMinutes100: 20 };

    const incurred = resolveIncurredOvertime(entry);
    const settled = resolveSettledOvertime(entry);

    expect(incurred).toEqual(settled);
  });
});
