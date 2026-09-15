// O RH cria e fecha registros fora do fluxo de ponto. Se esses registros
// nascessem sem snapshot, valeriam 0 para sempre — e o buffer da empresa nao
// alcancaria justamente o dia esquecido que o RH acabou de lancar.
//
// O outro lado importa mais: editar um registro JA FECHADO nao pode re-carimbar
// o buffer atual. E esse o cenario que o snapshot existe para impedir — ADMIN
// sobe a tolerancia, RH corrige um typo num dia antigo, hora extra ja aprovada
// muda sozinha.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/utils/recalcDay', () => ({
  recalculateUserDay: jest.fn().mockResolvedValue([]),
  reverseEntryBankHours: jest.fn().mockResolvedValue({ reversedMinutes: 0 }),
}));
jest.mock('../../src/utils/resendNotifier', () => ({
  sendResendEmail: jest.fn().mockResolvedValue(undefined),
}));

const { createHrEntry, updateHrEntry } = require('../../src/controllers/hr.controller');

const TARGET = {
  id: 'member-1',
  name: 'Member',
  email: 'member@test.com',
  role: 'MEMBER',
  organizationAdminId: 'admin-1',
};

describe('snapshot do buffer nos registros do RH', () => {
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

    mockPrisma.user.findUnique.mockResolvedValue(TARGET);
    mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 10 } });
    mockPrisma.timeEntry.create.mockResolvedValue({ id: 'entry-new' });
    mockPrisma.timeEntry.update.mockResolvedValue({ id: 'entry-1' });
    mockPrisma.timeEntry.findUnique.mockResolvedValue({ id: 'entry-new', userId: TARGET.id });
    mockPrisma.approvalLog.create.mockResolvedValue({ id: 'log-1' });
  });

  describe('createHrEntry', () => {
    beforeEach(() => {
      mockReq.params = { userId: TARGET.id };
      mockReq.body = {
        clockIn: '2026-08-26T08:00:00-03:00',
        clockOut: '2026-08-26T16:25:00-03:00',
      };
    });

    it('grava o buffer vigente da empresa no registro criado', async () => {
      await createHrEntry(mockReq, mockRes);

      expect(mockPrisma.timeEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ overtimeBufferMinutes: 10 }),
        })
      );
      expect(mockPrisma.appSetting.findUnique).toHaveBeenCalledWith({
        where: { key: 'overtimeBuffer:admin-1' },
      });
    });

    it('grava o default de 15 quando a empresa nunca configurou', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);

      await createHrEntry(mockReq, mockRes);

      expect(mockPrisma.timeEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ overtimeBufferMinutes: 15 }),
        })
      );
    });
  });

  describe('updateHrEntry', () => {
    const storedEntry = (over = {}) => ({
      id: 'entry-1',
      userId: TARGET.id,
      clockIn: new Date('2026-08-26T11:00:00.000Z'),
      clockOut: null,
      breakMinutes: 0,
      notes: null,
      overtimeBufferMinutes: null,
      user: TARGET,
      ...over,
    });

    beforeEach(() => {
      mockReq.params = { id: 'entry-1' };
    });

    it('carimba o buffer ao fechar pela primeira vez um registro aberto', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(storedEntry({ clockOut: null }));
      mockReq.body = { clockOut: '2026-08-26T16:25:00-03:00' };

      await updateHrEntry(mockReq, mockRes);

      expect(mockPrisma.timeEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ overtimeBufferMinutes: 10 }),
        })
      );
    });

    // O coracao da protecao: o dia antigo nao se mexe.
    it('nao re-carimba um registro ja fechado', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(
        storedEntry({ clockOut: new Date('2026-08-26T19:00:00.000Z'), overtimeBufferMinutes: 30 })
      );
      mockReq.body = { notes: 'corrigindo um typo' };

      await updateHrEntry(mockReq, mockRes);

      const updateData = mockPrisma.timeEntry.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('overtimeBufferMinutes');
      expect(mockPrisma.appSetting.findUnique).not.toHaveBeenCalled();
    });

    it('nao carimba nada quando o registro continua aberto', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(storedEntry({ clockOut: null }));
      mockReq.body = { notes: 'ainda em andamento' };

      await updateHrEntry(mockReq, mockRes);

      const updateData = mockPrisma.timeEntry.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('overtimeBufferMinutes');
    });
  });
});
