// Limiar de hora extra curta: HE do DIA abaixo do limiar nao e hora extra.
//
// Corte seco, nao franquia: cruzou o limiar, conta o valor CHEIO. 9min viram 0;
// 11min continuam 11, nao 1.
//
// O limiar vale por DIA, nao por marcacao. Num dia com varias entradas a HE e
// incremental, entao aplicar por marcacao deixaria alguem acumular hora extra em
// fatias de 9 minutos, e a empresa perderia minutos reais de trabalho. Aqui isso
// se traduz em: o limiar corta o TOTAL do dia, e a HE de cada entrada continua
// sendo a diferenca entre o total antes e depois dela.
//
// Cobre as tres funcoes porque a HE aparece em superficies diferentes com a
// mesma regra: o recalculo do dia, o progresso ao vivo do colaborador e o alerta
// proativo. Se so o recalculo respeitasse o limiar, o colaborador veria "8min de
// HE" durante o dia e ela sumiria no fechamento.

const {
  calculateOvertimeSummary,
  calculateIncrementalOvertimeSummary,
  calculateCurrentDailyProgress,
} = require('../../src/utils/overtime');

const CONTRACT = 480;
const THRESHOLD = 10;

// Segunda-feira, para nao cair na faixa de 100% de domingo.
const at = (hour, minute = 0) =>
  new Date(2026, 7, 31, hour, minute, 0, 0); // 31/08/2026 = segunda

const summaryFor = (workedMinutes, minOvertimeMinutes) =>
  calculateOvertimeSummary({
    clockIn: at(8),
    clockOut: new Date(at(8).getTime() + workedMinutes * 60000),
    contractDailyMinutes: CONTRACT,
    minOvertimeMinutes,
  });

describe('limiar de HE curta em calculateOvertimeSummary', () => {
  it('descarta a HE abaixo do limiar', () => {
    const result = summaryFor(CONTRACT + 9, THRESHOLD);

    expect(result.overtimeMinutes).toBe(0);
    expect(result.overtimeMinutes50).toBe(0);
    expect(result.overtimePercent).toBe(0);
  });

  // O limiar e inclusive: "menos de 10" descarta, 10 conta.
  it('mantem a HE exatamente no limiar', () => {
    expect(summaryFor(CONTRACT + 10, THRESHOLD).overtimeMinutes).toBe(10);
  });

  it('mantem o valor CHEIO acima do limiar, sem descontar a franquia', () => {
    expect(summaryFor(CONTRACT + 25, THRESHOLD).overtimeMinutes).toBe(25);
  });

  it('nao mexe em nada quando o limiar esta desligado', () => {
    expect(summaryFor(CONTRACT + 9, null).overtimeMinutes).toBe(9);
    expect(summaryFor(CONTRACT + 9, 0).overtimeMinutes).toBe(9);
    expect(summaryFor(CONTRACT + 9, undefined).overtimeMinutes).toBe(9);
  });

  // O tempo trabalhado e fato: o limiar decide o que e HE, nao quanto a pessoa
  // ficou. Sem isso o desconto de HE negada (recognizedMinutes) erraria a conta.
  it('nao altera o tempo trabalhado', () => {
    expect(summaryFor(CONTRACT + 9, THRESHOLD).workedMinutes).toBe(CONTRACT + 9);
  });
});

describe('limiar de HE curta por DIA em calculateIncrementalOvertimeSummary', () => {
  const incremental = (workedMinutes, workedMinutesBeforeEntry, minOvertimeMinutes) =>
    calculateIncrementalOvertimeSummary({
      clockIn: at(8),
      clockOut: new Date(at(8).getTime() + workedMinutes * 60000),
      contractDailyMinutes: CONTRACT,
      workedMinutesBeforeEntry,
      minOvertimeMinutes,
    });

  it('descarta a HE quando o total do dia fica abaixo do limiar', () => {
    // 475 antes + 10 agora = 485 no dia => 5min de HE, abaixo de 10.
    expect(incremental(10, 475, THRESHOLD).overtimeMinutes).toBe(0);
  });

  // O CASO QUE A ESCOLHA "POR DIA" EXISTE PARA COBRIR: duas marcacoes que
  // isoladamente ficariam abaixo do limiar, mas juntas passam. Por marcacao as
  // duas seriam zeradas e a empresa perderia 12 minutos reais.
  it('reconhece a HE quando duas marcacoes pequenas somam acima do limiar', () => {
    // 1a marcacao: 486 no dia => 6min, abaixo do limiar => 0.
    expect(incremental(486, 0, THRESHOLD).overtimeMinutes).toBe(0);
    // 2a marcacao: 486 + 6 = 492 no dia => 12min no total, acima do limiar.
    // A entrada recebe os 12, porque os 6 suprimidos antes voltam ao cruzar.
    expect(incremental(6, 486, THRESHOLD).overtimeMinutes).toBe(12);
  });

  it('nao cobra duas vezes a HE ja reconhecida antes da entrada', () => {
    // 500 antes (20min de HE, ja acima do limiar) + 10 agora => a entrada leva 10.
    expect(incremental(10, 500, THRESHOLD).overtimeMinutes).toBe(10);
  });

  it('nao mexe em nada quando o limiar esta desligado', () => {
    expect(incremental(10, 475, null).overtimeMinutes).toBe(5);
  });
});

describe('limiar de HE curta em calculateCurrentDailyProgress', () => {
  const progress = (minutesSoFar, minOvertimeMinutes) =>
    calculateCurrentDailyProgress({
      clockIn: at(8),
      now: new Date(at(8).getTime() + minutesSoFar * 60000),
      contractDailyMinutes: CONTRACT,
      workedMinutesBeforeEntry: 0,
      minOvertimeMinutes,
    });

  // Sem isto o colaborador ve "8min de HE" subindo no painel e ela desaparece no
  // fechamento do dia — e o alerta proativo dispara por HE que nao vai existir.
  it('nao anuncia HE abaixo do limiar', () => {
    expect(progress(CONTRACT + 8, THRESHOLD).overtimeMinutesSoFar).toBe(0);
  });

  it('anuncia a HE cheia depois de cruzar o limiar', () => {
    expect(progress(CONTRACT + 15, THRESHOLD).overtimeMinutesSoFar).toBe(15);
  });

  it('nao mexe em nada quando o limiar esta desligado', () => {
    expect(progress(CONTRACT + 8, null).overtimeMinutesSoFar).toBe(8);
  });

  // A meta diaria e sobre jornada cumprida, nao sobre HE: o limiar nao pode
  // alterar o momento em que a pessoa bateu o contrato.
  it('nao altera a marca de meta diaria atingida', () => {
    const result = progress(CONTRACT + 8, THRESHOLD);
    expect(result.hasReachedDailyTarget).toBe(true);
    expect(result.totalWorkedMinutes).toBe(CONTRACT + 8);
  });
});
