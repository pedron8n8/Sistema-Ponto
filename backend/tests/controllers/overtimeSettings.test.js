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

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        data: { overtimeMinMinutes: 10 },
        select: { overtimeMinMinutes: true },
      });
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ overtimeMinMinutes: 10, enabled: true })
      );
    });

    // Desligar e um estado, nao um zero: a coluna e nullable de proposito.
    it('desliga o limiar com null', async () => {
      mockReq.body = { overtimeMinMinutes: null };
      mockPrisma.user.update.mockResolvedValue({ overtimeMinMinutes: null });

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { overtimeMinMinutes: null } })
      );
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false })
      );
    });

    it('trata zero como desligado', async () => {
      mockReq.body = { overtimeMinMinutes: 0 };
      mockPrisma.user.update.mockResolvedValue({ overtimeMinMinutes: null });

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { overtimeMinMinutes: null } })
      );
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

    // Teto de sanidade: um limiar de 8h transformaria a jornada inteira em
    // "sem hora extra" por engano de digitacao.
    it('recusa limiar acima do teto', async () => {
      mockReq.body = { overtimeMinMinutes: 481 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
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
