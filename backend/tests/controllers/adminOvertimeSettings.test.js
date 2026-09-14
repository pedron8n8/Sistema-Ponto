// Na LEITURA o buffer nunca falha (valor invalido vira 0). Na ESCRITA e o
// contrario: fora de 0..120 devolve 400 em vez de truncar em silencio, porque
// aqui a intencao do usuario e explicita e truncar esconde erro de digitacao.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const {
  getOvertimeSettings,
  updateOvertimeSettings,
} = require('../../src/controllers/admin.controller');

describe('configuracao de hora extra da empresa', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockReq = {
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN', organizationAdminId: null },
      body: {},
      params: {},
      query: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe('getOvertimeSettings', () => {
    it('devolve o buffer configurado da empresa de quem chama', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 10 } });

      await getOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.appSetting.findUnique).toHaveBeenCalledWith({
        where: { key: 'overtimeBuffer:admin-1' },
      });
      expect(mockRes.json).toHaveBeenCalledWith({ overtimeSettings: { bufferMinutes: 10 } });
    });

    it('devolve 0 quando a empresa nunca configurou', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);

      await getOvertimeSettings(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({ overtimeSettings: { bufferMinutes: 0 } });
    });
  });

  describe('updateOvertimeSettings', () => {
    beforeEach(() => {
      mockPrisma.appSetting.upsert.mockResolvedValue({});
    });

    it('grava o valor na chave da empresa', async () => {
      mockReq.body = { bufferMinutes: 15 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith({
        where: { key: 'overtimeBuffer:admin-1' },
        create: { key: 'overtimeBuffer:admin-1', value: { bufferMinutes: 15 } },
        update: { value: { bufferMinutes: 15 } },
      });
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ overtimeSettings: { bufferMinutes: 15 } })
      );
    });

    it('aceita 0 como desligar a tolerancia', async () => {
      mockReq.body = { bufferMinutes: 0 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { value: { bufferMinutes: 0 } } })
      );
    });

    it.each([
      ['acima do teto', 121],
      ['negativo', -1],
      ['fracionado', 10.5],
      ['string', '10'],
      ['ausente', undefined],
    ])('recusa %s com 400 em vez de truncar', async (_label, value) => {
      mockReq.body = { bufferMinutes: value };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.appSetting.upsert).not.toHaveBeenCalled();
    });

    it('grava na empresa do ator, nao no id dele, quando ele nao e o ADMIN dono', async () => {
      // Um SUPERVISOR nunca alcanca esta rota (roleCheck(['ADMIN'])), mas o
      // escopo e resolvido pelo mesmo helper em todo lugar: a empresa vem de
      // organizationAdminId quando ele existe.
      mockReq.user = { id: 'someone-2', role: 'ADMIN', organizationAdminId: 'admin-9' };
      mockReq.body = { bufferMinutes: 20 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'overtimeBuffer:admin-9' } })
      );
    });

    // roleCheck deixa SUPERADMIN passar por qualquer rota /admin, e ele nao
    // pertence a empresa nenhuma: gravaria numa chave que ninguem le.
    it('recusa SUPERADMIN, que nao tem empresa propria', async () => {
      mockReq.user = { id: 'super-1', role: 'SUPERADMIN', organizationAdminId: null };
      mockReq.body = { bufferMinutes: 20 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.appSetting.upsert).not.toHaveBeenCalled();
    });
  });
});
