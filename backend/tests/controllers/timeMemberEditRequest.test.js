// Pedido de ajuste partindo do colaborador. Hoje o fluxo só existe na direção
// supervisor -> colaborador (EDIT_REQUESTED + PATCH /time/:id/notes); aqui o
// colaborador registra o pedido, mas NÃO move o próprio registro de status —
// quem decide continua sendo o supervisor.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const { requestCorrection } = require('../../src/controllers/time.controller');

describe('POST /time/:id/request-correction', () => {
  let mockReq;
  let mockRes;

  const ownEntry = (over = {}) => ({
    id: 'entry-1',
    userId: 'user-123',
    status: 'PENDING',
    clockIn: new Date('2026-08-28T12:00:00.000Z'),
    clockOut: null,
    ...over,
  });

  const createArgs = () => mockPrisma.approvalLog.create.mock.calls[0][0];

  beforeEach(() => {
    // jest.config tem resetMocks: true, então as implementações voltam a cada teste.
    mockReq = {
      user: { id: 'user-123', email: 'member@test.com', name: 'Member', role: 'MEMBER' },
      params: { id: 'entry-1' },
      body: { reason: 'Esqueci de bater a saída às 18h.' },
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockPrisma.approvalLog.create.mockResolvedValue({
      id: 'log-1',
      timeEntryId: 'entry-1',
      reviewerId: 'user-123',
      action: 'MEMBER_CORRECTION_REQUESTED',
      comment: 'Esqueci de bater a saída às 18h.',
    });
  });

  it('logs a correction request against the member own entry', async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(ownEntry());

    await requestCorrection(mockReq, mockRes);

    expect(mockPrisma.approvalLog.create).toHaveBeenCalledTimes(1);
    expect(createArgs().data).toEqual({
      timeEntryId: 'entry-1',
      reviewerId: 'user-123',
      action: 'MEMBER_CORRECTION_REQUESTED',
      comment: 'Esqueci de bater a saída às 18h.',
    });

    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ log: expect.objectContaining({ id: 'log-1' }) })
    );
  });

  it('never moves the entry out of PENDING', async () => {
    // O colaborador registra o pedido; tirar o próprio ponto de PENDING seria
    // aprovar a si mesmo. O supervisor continua decidindo.
    mockPrisma.timeEntry.findUnique.mockResolvedValue(ownEntry());

    await requestCorrection(mockReq, mockRes);

    expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
    expect(mockPrisma.timeEntry.updateMany).not.toHaveBeenCalled();
  });

  it('trims the reason before storing it', async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(ownEntry());
    mockReq.body.reason = '   Cheguei às 08h, o ponto marcou 09h.   ';

    await requestCorrection(mockReq, mockRes);

    expect(createArgs().data.comment).toBe('Cheguei às 08h, o ponto marcou 09h.');
  });

  it('rejects a request against another users entry with 403', async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(ownEntry({ userId: 'outro-usuario' }));

    await requestCorrection(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockPrisma.approvalLog.create).not.toHaveBeenCalled();
  });

  it('returns 404 when the entry does not exist', async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(null);

    await requestCorrection(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockPrisma.approvalLog.create).not.toHaveBeenCalled();
  });

  it('rejects a reason shorter than 5 characters with 400', async () => {
    mockReq.body.reason = 'oi';

    await requestCorrection(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Bad Request', message: expect.any(String) })
    );
    expect(mockPrisma.timeEntry.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.approvalLog.create).not.toHaveBeenCalled();
  });

  it('rejects a reason longer than 500 characters with 400', async () => {
    mockReq.body.reason = 'a'.repeat(501);

    await requestCorrection(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.approvalLog.create).not.toHaveBeenCalled();
  });

  it('rejects a missing reason with 400', async () => {
    mockReq.body = {};

    await requestCorrection(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.approvalLog.create).not.toHaveBeenCalled();
  });

  it('rejects a correction request on an APPROVED entry with 409', async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(ownEntry({ status: 'APPROVED' }));

    await requestCorrection(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockPrisma.approvalLog.create).not.toHaveBeenCalled();
  });

  it('returns 500 when the log cannot be written', async () => {
    mockPrisma.timeEntry.findUnique.mockResolvedValue(ownEntry());
    mockPrisma.approvalLog.create.mockRejectedValue(new Error('db down'));

    await requestCorrection(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(500);
  });
});
