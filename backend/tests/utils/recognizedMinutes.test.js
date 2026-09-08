// workedMinutes é Int @default(0) (schema.prisma:167), então um 0 gravado é
// ambíguo: pode ser registro legado que nunca passou por recalcDay, ou pode ser
// o valor correto de uma entrada cuja HE foi negada e valia HE do começo ao fim.
//
// Os consumidores (reportWorker, KPIs do supervisor, API de folha) tratam 0 como
// ausência e recalculam a duração de clockIn/clockOut. Com a negação de HE
// descontando do tempo reconhecido, esse fallback RESSUSCITA no relatório
// exatamente os minutos que o supervisor acabou de negar — e o caso não é
// exótico: é a forma normal de um turno extra colado num dia já completo, em que
// a entrada inteira é HE incremental.
//
// Esta regra é o discriminador: overtimeStatus REJECTED significa que alguém
// decidiu, então o valor gravado é autoritativo mesmo valendo 0.

const {
  isWorkedMinutesAuthoritative,
  RECOGNIZED_MINUTES_SELECT,
  assertOvertimeStatusSelected,
} = require('../../src/utils/recognizedMinutes');

describe('isWorkedMinutesAuthoritative', () => {
  it('confia no valor gravado quando é positivo', () => {
    expect(isWorkedMinutesAuthoritative({ workedMinutes: 480 })).toBe(true);
  });

  it('confia no zero gravado quando a HE foi negada', () => {
    expect(
      isWorkedMinutesAuthoritative({ workedMinutes: 0, overtimeStatus: 'REJECTED' })
    ).toBe(true);
  });

  // O fallback existe para curar registro legado sem cálculo; sem decisão de HE
  // um zero continua sendo tratado como ausência.
  it('não confia no zero de registro sem decisão de HE', () => {
    expect(isWorkedMinutesAuthoritative({ workedMinutes: 0, overtimeStatus: null })).toBe(false);
    expect(isWorkedMinutesAuthoritative({ workedMinutes: 0 })).toBe(false);
  });

  // HE pendente ou aprovada nunca zera o reconhecido, então um zero aqui é
  // ausência de cálculo, não decisão.
  it('não confia no zero de HE pendente ou aprovada', () => {
    expect(
      isWorkedMinutesAuthoritative({ workedMinutes: 0, overtimeStatus: 'PENDING' })
    ).toBe(false);
    expect(
      isWorkedMinutesAuthoritative({ workedMinutes: 0, overtimeStatus: 'APPROVED' })
    ).toBe(false);
  });

  it('não confia em valor ausente ou não numérico, mesmo com HE negada', () => {
    expect(isWorkedMinutesAuthoritative({ overtimeStatus: 'REJECTED' })).toBe(false);
    expect(
      isWorkedMinutesAuthoritative({ workedMinutes: null, overtimeStatus: 'REJECTED' })
    ).toBe(false);
    expect(
      isWorkedMinutesAuthoritative({ workedMinutes: 'abc', overtimeStatus: 'REJECTED' })
    ).toBe(false);
  });

  it('não confia em valor negativo', () => {
    expect(
      isWorkedMinutesAuthoritative({ workedMinutes: -30, overtimeStatus: 'REJECTED' })
    ).toBe(false);
  });

  it('tolera entrada nula', () => {
    expect(isWorkedMinutesAuthoritative(null)).toBe(false);
    expect(isWorkedMinutesAuthoritative(undefined)).toBe(false);
  });
});

describe('RECOGNIZED_MINUTES_SELECT', () => {
  it('pede os dois campos que o predicado precisa', () => {
    expect(RECOGNIZED_MINUTES_SELECT).toEqual({
      workedMinutes: true,
      overtimeStatus: true,
    });
  });
});

// O guard acima e invisivel quando falha: nao quebra nada, so devolve o numero
// errado. E o mock do Prisma e um jest.fn() que IGNORA `select`, entao nenhum
// teste de comportamento pega um select incompleto — foi assim que o guard do
// snapshot de presenca nasceu morto, comparando `undefined === 'REJECTED'`.
describe('assertOvertimeStatusSelected', () => {
  it('explode quando o zero chega sem overtimeStatus no select', () => {
    // Forma exata que a query de presenca usava antes da correcao.
    const rowFromIncompleteSelect = { id: 'e1', userId: 'u1', workedMinutes: 0, location: null };

    expect(() => assertOvertimeStatusSelected(rowFromIncompleteSelect, 'presenca')).toThrow(
      /overtimeStatus/
    );
  });

  it('aceita o zero quando overtimeStatus veio no select', () => {
    expect(() =>
      assertOvertimeStatusSelected({ workedMinutes: 0, overtimeStatus: 'REJECTED' }, 'presenca')
    ).not.toThrow();

    // null tambem e "veio no select" — e o estado de quem nao tem HE nenhuma.
    expect(() =>
      assertOvertimeStatusSelected({ workedMinutes: 0, overtimeStatus: null }, 'presenca')
    ).not.toThrow();
  });

  it('nao se mete quando o valor gravado e positivo', () => {
    // Valor positivo nunca cai no fallback, entao o campo nao importa ali.
    expect(() => assertOvertimeStatusSelected({ workedMinutes: 480 }, 'presenca')).not.toThrow();
  });

  it('tolera entrada nula', () => {
    expect(() => assertOvertimeStatusSelected(null, 'presenca')).not.toThrow();
    expect(() => assertOvertimeStatusSelected(undefined, 'presenca')).not.toThrow();
  });
});
