// Asercoes de FORMA da query, nao de comportamento.
//
// O mock do Prisma e um jest.fn() e IGNORA `select`: ele devolve o que a gente
// enfileira, com os campos que a gente enfileirar. Entao um teste de
// comportamento passa igual com um select incompleto — foi assim que o
// clock-out ficou sem o limiar de HE curta apesar de haver 16 testes verdes
// para o limiar nos calculadores.
//
// A licao virou este arquivo: quando a corretude depende de um campo CHEGAR na
// linha, o teste tem que olhar a query, nao o resultado.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const {
  getClockOutUserConfigSelect,
  getPriorEntriesSelect,
} = require('../../src/controllers/time.controller');

describe('clock-out e o limiar de HE curta do tenant', () => {
  it('pede o limiar do tenant na leitura de configuracao do colaborador', () => {
    // Sem isto o clock-out gravava overtimeMinutes: 6 e overtimeStatus:
    // 'PENDING' num tenant com limiar de 10min, e HE pendente bloqueia a
    // aprovacao do ponto.
    expect(getClockOutUserConfigSelect()).toEqual({
      contractDailyMinutes: true,
      hourlyRate: true,
      organizationAdmin: { select: { overtimeMinMinutes: true } },
    });
  });
});

describe('marcacoes anteriores do dia', () => {
  it('pede overtimeStatus junto com workedMinutes', () => {
    // resolveWorkedMinutes precisa distinguir um 0 autoritativo (HE negada) de
    // um 0 por falta de calculo. Sem o campo, o fallback devolvia a duracao
    // cheia e os minutos negados voltavam para workedMinutesBeforeEntry,
    // inflando o total do dia e dando HE nova em cima de tempo ja negado.
    expect(getPriorEntriesSelect()).toEqual({
      clockIn: true,
      clockOut: true,
      workedMinutes: true,
      overtimeStatus: true,
    });
  });
});
