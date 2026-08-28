// Pedido de ajuste partindo do colaborador. Hoje o fluxo só existe na direção
// supervisor -> colaborador (EDIT_REQUESTED + PATCH /time/:id/notes); aqui o
// colaborador registra o pedido, mas NÃO move o próprio registro de status —
// quem decide continua sendo o supervisor.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const { requestCorrection, updateMyEntryNotes } = require('../../src/controllers/time.controller');

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
    mockPrisma.timeEntry.findFirst.mockResolvedValue(ownEntry());

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
    mockPrisma.timeEntry.findFirst.mockResolvedValue(ownEntry());

    await requestCorrection(mockReq, mockRes);

    expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
    expect(mockPrisma.timeEntry.updateMany).not.toHaveBeenCalled();
  });

  it('trims the reason before storing it', async () => {
    mockPrisma.timeEntry.findFirst.mockResolvedValue(ownEntry());
    mockReq.body.reason = '   Cheguei às 08h, o ponto marcou 09h.   ';

    await requestCorrection(mockReq, mockRes);

    expect(createArgs().data.comment).toBe('Cheguei às 08h, o ponto marcou 09h.');
  });

  it('answers 404, not 403, for an entry that belongs to someone else', async () => {
    // O escopo está na própria consulta ({ id, userId }), então um registro de
    // outra pessoa simplesmente não é encontrado. Um 403 aqui confirmaria para
    // quem varre UUIDs que o id existe — só não é dele.
    mockPrisma.timeEntry.findFirst.mockResolvedValue(null);

    await requestCorrection(mockReq, mockRes);

    expect(mockPrisma.timeEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'entry-1', userId: 'user-123' } })
    );
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.status).not.toHaveBeenCalledWith(403);
    expect(mockPrisma.approvalLog.create).not.toHaveBeenCalled();
  });

  it('returns 404 when the entry does not exist', async () => {
    mockPrisma.timeEntry.findFirst.mockResolvedValue(null);

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
    expect(mockPrisma.timeEntry.findFirst).not.toHaveBeenCalled();
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
    mockPrisma.timeEntry.findFirst.mockResolvedValue(ownEntry({ status: 'APPROVED' }));

    await requestCorrection(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockPrisma.approvalLog.create).not.toHaveBeenCalled();
  });

  it('rejects a second correction request while the first is unanswered, with 409', async () => {
    // Sem isto o colaborador repete o pedido à vontade; como as telas de
    // pendências do supervisor leem só o último log (take: 1), cada repetição
    // esconde dele a própria última ação.
    mockPrisma.timeEntry.findFirst.mockResolvedValue(ownEntry());
    mockPrisma.approvalLog.findFirst.mockResolvedValue({ action: 'MEMBER_CORRECTION_REQUESTED' });

    await requestCorrection(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CORRECTION_ALREADY_REQUESTED' })
    );
    expect(mockPrisma.approvalLog.create).not.toHaveBeenCalled();
  });

  it('allows a new request once the supervisor has answered the previous one', async () => {
    mockPrisma.timeEntry.findFirst.mockResolvedValue(ownEntry());
    mockPrisma.approvalLog.findFirst.mockResolvedValue({ action: 'EDIT_REQUESTED' });

    await requestCorrection(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockPrisma.approvalLog.create).toHaveBeenCalledTimes(1);
  });

  it('does not claim anyone was notified', async () => {
    // Nada notifica ninguém neste caminho e não existe rota de notificação de
    // aprovação no sistema. A mensagem não pode prometer o que não acontece.
    mockPrisma.timeEntry.findFirst.mockResolvedValue(ownEntry());

    await requestCorrection(mockReq, mockRes);

    const [payload] = mockRes.json.mock.calls[0];
    expect(payload.message).not.toMatch(/notificad/i);
  });

  it('returns 500 when the log cannot be written', async () => {
    mockPrisma.timeEntry.findFirst.mockResolvedValue(ownEntry());
    mockPrisma.approvalLog.create.mockRejectedValue(new Error('db down'));

    await requestCorrection(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(500);
  });
});

// As duas funcionalidades se trancavam: updateMyEntryNotes exigia que o log
// MAIS RECENTE fosse EDIT_REQUESTED, e o pedido do colaborador entra como log
// mais recente. Supervisor pede edição -> colaborador clica "Pedir ajuste" ->
// PATCH /time/:id/notes passava a responder 400 para sempre.
describe('PATCH /time/:id/notes depois de um pedido de ajuste do colaborador', () => {
  let mockReq;
  let mockRes;

  // Aplica o include.logs (where/orderBy/take) como o Prisma aplicaria: é
  // exatamente esse filtro que separa a conversa de edição do resto do log.
  const stubEntryWithLogs = (logs, status = 'PENDING') => {
    mockPrisma.timeEntry.findFirst.mockImplementation(async (args) => {
      const logFilter = args?.include?.logs || {};
      const actions = logFilter.where?.action?.in;
      const visible = actions ? logs.filter((log) => actions.includes(log.action)) : [...logs];
      visible.sort((a, b) => b.timestamp - a.timestamp);

      return {
        id: 'entry-1',
        userId: 'user-123',
        status,
        logs: logFilter.take ? visible.slice(0, logFilter.take) : visible,
      };
    });
  };

  const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000);

  beforeEach(() => {
    mockReq = {
      user: { id: 'user-123', email: 'member@test.com', name: 'Member', role: 'MEMBER' },
      params: { id: 'entry-1' },
      body: { notes: 'Saí às 18h, o registro ficou aberto.' },
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockPrisma.$transaction.mockImplementation((operations) => Promise.all(operations));
    mockPrisma.timeEntry.update.mockResolvedValue({ id: 'entry-1', status: 'PENDING' });
    mockPrisma.approvalLog.create.mockResolvedValue({ id: 'log-2' });
  });

  it('still accepts the notes when the member asked for a correction afterwards', async () => {
    stubEntryWithLogs([
      { action: 'EDIT_REQUESTED', timestamp: at(30) },
      { action: 'MEMBER_CORRECTION_REQUESTED', timestamp: at(10) },
    ]);

    await updateMyEntryNotes(mockReq, mockRes);

    expect(mockRes.status).not.toHaveBeenCalledWith(400);
    expect(mockPrisma.timeEntry.update).toHaveBeenCalledTimes(1);
  });

  it('accepts the notes for a plain outstanding edit request', async () => {
    stubEntryWithLogs([{ action: 'EDIT_REQUESTED', timestamp: at(30) }]);

    await updateMyEntryNotes(mockReq, mockRes);

    expect(mockPrisma.timeEntry.update).toHaveBeenCalledTimes(1);
  });

  it('still rejects when the edit request was already answered', async () => {
    // O guard não pode ficar largo demais: respondido é respondido.
    stubEntryWithLogs([
      { action: 'EDIT_REQUESTED', timestamp: at(30) },
      { action: 'EDIT_RESPONSE', timestamp: at(20) },
      { action: 'MEMBER_CORRECTION_REQUESTED', timestamp: at(10) },
    ]);

    await updateMyEntryNotes(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
  });

  it('still rejects when no edit was ever requested', async () => {
    stubEntryWithLogs([{ action: 'MEMBER_CORRECTION_REQUESTED', timestamp: at(10) }]);

    await updateMyEntryNotes(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
  });

  // O filtro de logs enxerga só EDIT_REQUESTED/EDIT_RESPONSE, então um APPROVED
  // posterior é invisível para ele. Sem uma checagem do próprio entry.status, o
  // colaborador reabria o ponto já aprovado — o update grava status: 'PENDING'.
  it('rejects the notes on an APPROVED entry with 409, even with an outstanding edit request', async () => {
    // Sequência real: supervisor pede ajuste, muda de ideia e aprova o ponto,
    // e só então o colaborador responde ao pedido.
    stubEntryWithLogs(
      [
        { action: 'EDIT_REQUESTED', timestamp: at(30) },
        { action: 'APPROVED', timestamp: at(10) },
      ],
      'APPROVED'
    );

    await updateMyEntryNotes(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ENTRY_ALREADY_APPROVED' })
    );
    expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
    expect(mockPrisma.approvalLog.create).not.toHaveBeenCalled();
  });

  // Mesma regra que requestCorrection já aplicava: as duas escritas do
  // colaborador tratam um ponto aprovado do mesmo jeito.
  it('matches requestCorrection: both member-facing writes refuse an APPROVED entry', async () => {
    stubEntryWithLogs([{ action: 'EDIT_REQUESTED', timestamp: at(30) }], 'APPROVED');

    await updateMyEntryNotes(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(409);
  });
});
