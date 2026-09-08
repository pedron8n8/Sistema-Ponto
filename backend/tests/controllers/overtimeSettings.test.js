// Configuracao do limiar de HE curta pelo painel.
//
// O limiar vive na linha do DONO do tenant (User.overtimeMinMinutes), e vale
// para todos os colaboradores da conta. Quem edita e ADMIN ou INTEGRATOR — o
// INTEGRATOR precisa aparecer explicito na rota, porque o roleCheck so o
// adiciona sozinho quando 'HR' esta na lista.
//
// Arquivo proprio em vez de entrar no admin.controller.test.js: aquela suite
// esta em quarentena no CI (.github/workflows/ci.yml), entao um teste la nao
// barraria regressao nenhuma.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const {
  getOvertimeSettings,
  updateOvertimeSettings,
} = require('../../src/controllers/admin.controller');

describe('configuracao do limiar de HE curta', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockReq = {
      user: { id: 'admin-1', role: 'ADMIN', organizationAdminId: 'admin-1' },
      body: {},
    };
  });

  describe('getOvertimeSettings', () => {
    it('devolve o limiar do dono do tenant', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ overtimeMinMinutes: 10 });

      await getOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'admin-1' } })
      );
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ overtimeMinMinutes: 10, enabled: true })
      );
    });

    it('reporta desligado quando nao ha limiar configurado', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ overtimeMinMinutes: null });

      await getOvertimeSettings(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ overtimeMinMinutes: null, enabled: false })
      );
    });

    // O INTEGRATOR nao e dono do tenant: le a configuracao do admin dele.
    it('resolve o dono do tenant quando quem chama e INTEGRATOR', async () => {
      mockReq.user = { id: 'integrator-9', role: 'INTEGRATOR', organizationAdminId: 'admin-1' };
      mockPrisma.user.findUnique.mockResolvedValue({ overtimeMinMinutes: 15 });

      await getOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'admin-1' } })
      );
    });
  });

  describe('updateOvertimeSettings', () => {
    it('grava o limiar no dono do tenant', async () => {
      mockReq.body = { overtimeMinMinutes: 10 };
      mockPrisma.user.update.mockResolvedValue({ overtimeMinMinutes: 10 });

      await updateOvertimeSettings(mockReq, mockRes);

      const update = mockPrisma.user.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'admin-1' });
      expect(update.data).toMatchObject({
        overtimeMinMinutes: 10,
        // Procedencia na MESMA escrita: a configuracao e do tenant e reduz
        // tempo reconhecido de todos, entao "quem mudou e quando" precisa
        // sobreviver ao container.
        overtimeMinMinutesUpdatedById: 'admin-1',
      });
      expect(update.data.overtimeMinMinutesUpdatedAt).toBeInstanceOf(Date);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ overtimeMinMinutes: 10, enabled: true })
      );
    });

    // Desligar e um estado, nao um zero: a coluna e nullable de proposito.
    it('desliga o limiar com null', async () => {
      mockReq.body = { overtimeMinMinutes: null };
      mockPrisma.user.update.mockResolvedValue({ overtimeMinMinutes: null });

      await updateOvertimeSettings(mockReq, mockRes);

      // A procedencia e gravada no desligamento tambem: "quem desligou e
      // quando" e uma pergunta tao legitima quanto "quem ligou".
      expect(mockPrisma.user.update.mock.calls[0][0].data).toMatchObject({
        overtimeMinMinutes: null,
        overtimeMinMinutesUpdatedById: 'admin-1',
      });
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false })
      );
    });

    it('trata zero como desligado', async () => {
      mockReq.body = { overtimeMinMinutes: 0 };
      mockPrisma.user.update.mockResolvedValue({ overtimeMinMinutes: null });

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.user.update.mock.calls[0][0].data).toMatchObject({
        overtimeMinMinutes: null,
      });
    });

    it('recusa valor negativo', async () => {
      mockReq.body = { overtimeMinMinutes: -5 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('recusa valor nao inteiro', async () => {
      mockReq.body = { overtimeMinMinutes: 7.5 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    // Teto de LEGALIDADE, nao de sanidade contra erro de digitacao. Com 120
    // permitidos, uma configuracao do tenant apagava ate 2h de HE trabalhada
    // por pessoa por dia: supressao salarial. A CLT (art. 58 §1º) tolera ~10min
    // no dia, que e tambem a regra pedida pelo produto.
    it('recusa limiar acima do teto', async () => {
      mockReq.body = { overtimeMinMinutes: 481 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('recusa 11 minutos: acima da tolerancia diaria da CLT', async () => {
      mockReq.body = { overtimeMinMinutes: 11 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('aceita exatamente 10 minutos', async () => {
      mockReq.body = { overtimeMinMinutes: 10 };
      mockPrisma.user.update.mockResolvedValue({ overtimeMinMinutes: 10 });

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockRes.status).not.toHaveBeenCalledWith(400);
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('anuncia o teto vigente no payload, para o painel nao chuta-lo', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ overtimeMinMinutes: 10 });

      await getOvertimeSettings(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ maxMinutes: 10 }));
    });

    it('grava no admin dono quando quem chama e INTEGRATOR', async () => {
      mockReq.user = { id: 'integrator-9', role: 'INTEGRATOR', organizationAdminId: 'admin-1' };
      mockReq.body = { overtimeMinMinutes: 10 };
      mockPrisma.user.update.mockResolvedValue({ overtimeMinMinutes: 10 });

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'admin-1' } })
      );
    });

    // SUPERADMIN passa por qualquer roleCheck mas nao pertence a tenant nenhum:
    // sem dono resolvido nao ha onde gravar, e gravar no proprio SUPERADMIN
    // criaria uma configuracao fantasma que nenhum colaborador leria.
    it('recusa quando nao ha dono de tenant a resolver', async () => {
      mockReq.user = { id: 'super-1', role: 'SUPERADMIN', organizationAdminId: null };
      mockReq.body = { overtimeMinMinutes: 10 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
