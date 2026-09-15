// Testes unitários para utils/entryPayment.js — a aritmética compartilhada e as
// duas políticas nomeadas (settled vs incurred).

const {
  calculateEntryPayment,
  calculateDayPaymentRaw,
  resolveSettledOvertime,
  resolveIncurredOvertime,
} = require('../../src/utils/entryPayment');

describe('calculateEntryPayment', () => {
  it('calcula normais + HE 50% + HE 100% (adicionais em standby: multiplicador 1)', () => {
    // 240min normais + 60min HE50 + 60min HE100, a $10/h, tudo a 1x => 40 + 10 + 10 = 60
    const result = calculateEntryPayment({
      workedMinutes: 360,
      overtimeMinutes50: 60,
      overtimeMinutes100: 60,
      hourlyRate: 10,
    });

    expect(result).toEqual({
      hourlyRate: 10,
      regularAmount: 40,
      overtime50Amount: 10,
      overtime100Amount: 10,
      overtimeTotalAmount: 20,
      totalAmount: 60,
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

// calculateDayPaymentRaw recebe `normalMinutes` JÁ somado do dia inteiro e JÁ
// excluindo HE (trabalhado - HE incorrida, responsabilidade do chamador — a mesma
// exclusão de resolveRegularMinutes/resolveIncurredOvertime) e só então aplica o
// teto do contrato. As quatro linhas abaixo são a tabela de verificação do brief:
// contrato 480min, R$30/h.
describe('calculateDayPaymentRaw', () => {
  it('linha 1: worked 490 com tolerância engolindo o excesso (OT 0) -> paga só o teto (240, não 245)', () => {
    // normalMinutes = 490 trabalhado - 0 HE incorrida (colunas em 0, status null)
    const result = calculateDayPaymentRaw({
      normalMinutes: 490,
      overtimeMinutes50: 0,
      overtimeMinutes100: 0,
      contractDailyMinutes: 480,
      hourlyRate: 30,
    });

    expect(result.regularMinutes).toBe(480);
    expect(result.regularAmount).toBe(240);
    expect(result.totalAmount).toBe(240);
  });

  it('linha 2: worked 495, mesma tolerância -> mesmo teto (240, não 247.50)', () => {
    const result = calculateDayPaymentRaw({
      normalMinutes: 495,
      overtimeMinutes50: 0,
      overtimeMinutes100: 0,
      contractDailyMinutes: 480,
      hourlyRate: 30,
    });

    expect(result.regularAmount).toBe(240);
    expect(result.totalAmount).toBe(240);
  });

  it('linha 3: worked 540, HE 60min APROVADA -> inalterado (270, HE a 1x)', () => {
    // normalMinutes = 540 trabalhado - 60 HE incorrida = 480 (já no teto, sem sobra
    // acima dele) — por isso o teto não muda nada aqui, igual ao valor de antes.
    const result = calculateDayPaymentRaw({
      normalMinutes: 480,
      overtimeMinutes50: 60,
      overtimeMinutes100: 0,
      contractDailyMinutes: 480,
      hourlyRate: 30,
    });

    expect(result.regularAmount).toBe(240);
    expect(result.overtime50Amount).toBe(30);
    expect(result.totalAmount).toBe(270);
  });

  it('linha 4: worked 540, HE 60min NEGADA (colunas zeradas) -> não vira hora normal (240, não 270)', () => {
    // rejectOvertime zera as colunas: HE incorrida = 0, então normalMinutes = 540 -
    // 0 = 540 (não 480); e overtimeMinutes50/100 aqui é a HE SETTLED (aprovada),
    // que para uma HE negada é sempre 0 — é o teto do contrato, sozinho, que
    // impede os 540 de virarem 540min de hora normal.
    const result = calculateDayPaymentRaw({
      normalMinutes: 540,
      overtimeMinutes50: 0,
      overtimeMinutes100: 0,
      contractDailyMinutes: 480,
      hourlyRate: 30,
    });

    expect(result.regularMinutes).toBe(480);
    expect(result.regularAmount).toBe(240);
    expect(result.overtimeTotalAmount).toBe(0);
    expect(result.totalAmount).toBe(240);
  });

  it('o teto é por DIA, não por entry: 300+240 já somados pagam min(540,480), não 300+240', () => {
    const result = calculateDayPaymentRaw({
      normalMinutes: 300 + 240,
      overtimeMinutes50: 0,
      overtimeMinutes100: 0,
      contractDailyMinutes: 480,
      hourlyRate: 30,
    });

    expect(result.regularMinutes).toBe(480);
    expect(result.regularAmount).toBe(240);
    expect(result.totalAmount).toBe(240);
  });

  it('dia abaixo do contrato fica inalterado: 400 trabalhado paga 400', () => {
    const result = calculateDayPaymentRaw({
      normalMinutes: 400,
      overtimeMinutes50: 0,
      overtimeMinutes100: 0,
      contractDailyMinutes: 480,
      hourlyRate: 30,
    });

    expect(result.regularMinutes).toBe(400);
    expect(result.regularAmount).toBe(200);
    expect(result.totalAmount).toBe(200);
  });

  it('retorna tudo zerado quando a taxa é zero', () => {
    expect(
      calculateDayPaymentRaw({
        normalMinutes: 600,
        overtimeMinutes50: 60,
        overtimeMinutes100: 0,
        contractDailyMinutes: 480,
        hourlyRate: 0,
      })
    ).toEqual({
      hourlyRate: 0,
      regularMinutes: 0,
      regularAmount: 0,
      overtime50Amount: 0,
      overtime100Amount: 0,
      overtimeTotalAmount: 0,
      totalAmount: 0,
    });
  });
});
