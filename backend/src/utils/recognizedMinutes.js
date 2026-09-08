// Negar hora extra desconta os minutos negados do tempo reconhecido da entrada
// (rejectOvertime e o ramo REJECTED de recalcDay gravam workedMinutes já
// descontado). Quando a entrada valia HE do começo ao fim — turno extra colado
// num dia que já bateu o contrato — o reconhecido cai para 0.
//
// Isso colide com o fallback dos consumidores. workedMinutes é Int @default(0)
// (schema.prisma:167), então eles tratam 0 como "nunca calculado" e recalculam a
// duração de clockIn/clockOut, ressuscitando no relatório justamente os minutos
// que o supervisor negou.
//
// Não dá para resolver aceitando todo 0: o fallback existe para curar registro
// legado que nunca passou por recalcDay, e por valor os dois zeros são iguais. O
// discriminador é a decisão: overtimeStatus REJECTED significa que alguém
// decidiu, então o valor gravado é autoritativo mesmo valendo 0.
//
// Fica só o predicado, e não um cálculo compartilhado, porque os três fallbacks
// não concordam entre si — o do relatório desconta pausa, os do KPI e da folha
// não. Unificá-los mudaria em silêncio o número de folha de registros antigos.
// Exige number de verdade em vez de passar por Number(): Number(null) e
// Number('') são 0, e um null tratado como zero autoritativo suprimiria o
// fallback justamente no caso que ele existe para curar. Prisma devolve Int
// como number, então ser estrito aqui não perde nenhum registro real.
const isWorkedMinutesAuthoritative = (entry) => {
  if (!entry || typeof entry.workedMinutes !== 'number') return false;

  const stored = entry.workedMinutes;
  if (!Number.isFinite(stored) || stored < 0) return false;
  if (stored > 0) return true;

  return entry.overtimeStatus === 'REJECTED';
};

// Campos que QUALQUER query precisa trazer para o predicado acima funcionar.
// Espalhe no `select` em vez de listar a mao.
//
// O bug que isso previne: um `select` sem overtimeStatus faz o predicado
// comparar `undefined === 'REJECTED'` e devolver false para sempre. O guard
// vira codigo morto — nao quebra nada, so deixa o fallback ressuscitar
// justamente os minutos negados. Aconteceu no snapshot de presenca, no scan do
// alerta proativo e nas marcacoes anteriores do clock-out.
const RECOGNIZED_MINUTES_SELECT = {
  workedMinutes: true,
  overtimeStatus: true,
};

// Torna audivel o guard morto. O mock do Prisma e um jest.fn() e ignora
// `select`, entao teste de comportamento nao pega um select incompleto: a linha
// chega com o campo faltando e tudo "passa", com o numero errado.
//
// Em teste isto explode, para a falha aparecer em quem escreveu a query. Em
// producao apenas avisa: um registro legado real pode chegar sem o campo, e
// derrubar a requisicao do colaborador seria pior que somar demais.
const assertOvertimeStatusSelected = (entry, context) => {
  if (!entry || entry.workedMinutes !== 0) return;
  if (entry.overtimeStatus !== undefined) return;

  const message =
    `[recognizedMinutes] ${context}: entrada com workedMinutes 0 chegou sem ` +
    'overtimeStatus no select. Espalhe RECOGNIZED_MINUTES_SELECT na query, senao ' +
    'o zero autoritativo de HE negada cai no fallback e os minutos negados voltam.';

  if (process.env.NODE_ENV === 'test') {
    throw new Error(message);
  }

  console.warn(message);
};

module.exports = {
  isWorkedMinutesAuthoritative,
  RECOGNIZED_MINUTES_SELECT,
  assertOvertimeStatusSelected,
};
