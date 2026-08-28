// A METADE QUE FALTAVA. O represamento do banco de horas (accrueBankHours
// recusa creditar registro nascido de batida offline) tinha teste; a SOLTURA
// não tinha nenhum. É a metade em que a falha some com as horas do colaborador
// em silêncio: o crédito nunca sai e ninguém recebe erro.
//
// Cobre releaseDeferredBankHours pelos dois caminhos que a chamam:
// approveOvertime (um registro) e approveEntriesBulk (o lote).

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/utils/bankHours', () => ({
  accrueBankHours: jest.fn(),
  adjustBankHours: jest.fn(),
  settleBankHoursAccruals: jest.fn(),
  // isBankHoursDeferred é a regra em teste: usa a implementação real.
  isBankHoursDeferred: jest.requireActual('../../src/utils/bankHours').isBankHoursDeferred,
}));
jest.mock('../../src/utils/recalcDay', () => ({
  recalculateUserDay: jest.fn(),
  reverseEntryBankHours: jest.fn().mockResolvedValue(undefined),
}));

const { accrueBankHours } = require('../../src/utils/bankHours');
const { approveOvertime, approveEntriesBulk } = require('../../src/controllers/supervisor.controller');

const deferredLocation = {
  offline: {
    event: 'clockOut',
    occurredAt: '2026-08-28T20:00:00.000Z',
    syncedAt: '2026-08-28T21:00:00.000Z',
    bankHoursDeferred: true,
  },
};

const member = { id: 'member-123', name: 'Member', email: 'm@test.com', supervisorId: 'supervisor-123', organizationAdminId: 'admin-1' };

const deferredEntry = (over = {}) => ({
  id: 'entry-offline',
  userId: 'member-123',
  status: 'PENDING',
  clockIn: new Date('2026-08-28T08:00:00.000Z'),
  clockOut: new Date('2026-08-28T20:00:00.000Z'),
  overtimeStatus: 'PENDING',
  overtimeMinutes: 240,
  overtimeMinutes50: 240,
  overtimeMinutes100: 0,
  bankHoursAccruedMinutes: 0,
  location: deferredLocation,
  user: member,
  ...over,
});

const onlineEntry = (over = {}) =>
  deferredEntry({ id: 'entry-online', location: { clockIn: null, clockOut: null }, bankHoursAccruedMinutes: 240, ...over });

describe('soltura do banco de horas represado', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockReq = {
      user: { id: 'supervisor-123', email: 'supervisor@test.com', role: 'SUPERVISOR' },
      params: {},
      body: {},
      query: {},
    };
    mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    // Escopo hierárquico: quem está abaixo do ator sai do banco.
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'member-123', isActive: true }]);
    mockPrisma.$transaction.mockImplementation((operations) => Promise.all(operations));
    mockPrisma.timeEntry.update.mockResolvedValue({ id: 'entry-offline', user: member });
    mockPrisma.timeEntry.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.timeEntry.updateManyAndReturn.mockResolvedValue([]);
    mockPrisma.approvalLog.create.mockResolvedValue({ id: 'log-1' });
    mockPrisma.approvalLog.createMany.mockResolvedValue({ count: 1 });

    accrueBankHours.mockResolvedValue({ accruedMinutes: 240, discardedMinutes: 0, balanceMinutes: 240 });
  });

  describe('approveOvertime (um registro)', () => {
    beforeEach(() => {
      mockReq.params = { id: 'entry-offline' };
    });

    it('releases the deferred credit and stamps the accrued minutes on the entry', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(deferredEntry());

      await approveOvertime(mockReq, mockRes);

      expect(accrueBankHours).toHaveBeenCalledWith({
        userId: 'member-123',
        overtimeMinutes: 240,
        timeEntryId: 'entry-offline',
      });
      // O crédito só existe de verdade quando também aparece na coluna do registro.
      expect(mockPrisma.timeEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-offline' },
        data: { bankHoursAccruedMinutes: 240 },
      });
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ bankHours: expect.objectContaining({ accruedMinutes: 240 }) })
      );
    });

    it('approves the overtime BEFORE releasing, because accrueBankHours re-reads the entry', async () => {
      // Ordem invertida = crédito represado para sempre: as rotas de decisão de
      // HE recusam registro que já saiu de PENDING, então nada o solta depois.
      mockPrisma.timeEntry.findUnique.mockResolvedValue(deferredEntry());
      const order = [];
      mockPrisma.timeEntry.update.mockImplementation(async ({ data }) => {
        order.push(data.overtimeStatus ? 'approve' : 'stamp');
        return { id: 'entry-offline', user: member };
      });
      accrueBankHours.mockImplementation(async () => {
        order.push('accrue');
        return { accruedMinutes: 240 };
      });

      await approveOvertime(mockReq, mockRes);

      expect(order).toEqual(['approve', 'accrue', 'stamp']);
    });

    it('does NOT re-credit a normal punch: that credit already left at clock-out', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(onlineEntry());

      await approveOvertime(mockReq, mockRes);

      expect(accrueBankHours).not.toHaveBeenCalled();
      // Só o update da aprovação da HE.
      expect(mockPrisma.timeEntry.update).toHaveBeenCalledTimes(1);
    });

    it('keeps the supervisor decision even when the credit fails', async () => {
      // A decisão do supervisor não é recalculável; o crédito é (recalcDay).
      // Derrubar a aprovação por causa do banco de horas trocaria um problema
      // recuperável por um irrecuperável.
      mockPrisma.timeEntry.findUnique.mockResolvedValue(deferredEntry());
      accrueBankHours.mockRejectedValue(new Error('too many clients already'));

      await approveOvertime(mockReq, mockRes);

      expect(mockRes.status).not.toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Horas extras aprovadas com sucesso' })
      );
    });

    it('does not stamp anything when the credit came back zero (bank hours limit reached)', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(deferredEntry());
      accrueBankHours.mockResolvedValue({ accruedMinutes: 0, discardedMinutes: 240 });

      await approveOvertime(mockReq, mockRes);

      expect(mockPrisma.timeEntry.update).toHaveBeenCalledTimes(1);
    });

    it('releases nothing for an entry that is no longer awaiting an overtime decision', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(deferredEntry({ overtimeStatus: 'APPROVED' }));

      await approveOvertime(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(accrueBankHours).not.toHaveBeenCalled();
    });

    // A checagem de overtimeStatus em loadEntryForOvertimeDecision é uma
    // LEITURA. O predicado no WHERE do UPDATE é o que o banco avalia, e é ele
    // que decide quem soltou o crédito represado.
    it('scopes the approval update with overtimeStatus PENDING', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(deferredEntry());

      await approveOvertime(mockReq, mockRes);

      expect(mockPrisma.timeEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'entry-offline', overtimeStatus: 'PENDING' },
          data: { overtimeStatus: 'APPROVED' },
        })
      );
    });

    // A CORRIDA. Duplo toque no botão "aprovar HE", retry de request que deu
    // timeout, dois supervisores na mesma fila: os dois passam pela leitura
    // vendo PENDING. Sem predicado no UPDATE os dois gravam APPROVED, os dois
    // chamam releaseDeferredBankHours e accrueBankHours — que relê o registro e
    // vê 'APPROVED' nas duas vezes — cria DUAS linhas ACCRUAL e faz DOIS
    // increments: 240min trabalhados viram 480min de saldo, e
    // reverseEntryBankHours reverte cada linha só uma vez.
    it('credits exactly one ACCRUAL when two approvals race on the same entry', async () => {
      // Estado da linha no banco. É contra ele que o predicado do UPDATE é
      // avaliado, como o Postgres faria em READ COMMITTED: o segundo UPDATE
      // reavalia a linha já APPROVED e não encontra nada.
      const row = { overtimeStatus: 'PENDING' };

      // Os dois lados leem PENDING: é o que torna a corrida possível.
      mockPrisma.timeEntry.findUnique.mockResolvedValue(deferredEntry());
      mockPrisma.timeEntry.update.mockImplementation(async ({ where, data }) => {
        // Só o update da aprovação traz o predicado; o carimbo de
        // bankHoursAccruedMinutes vem depois, com where só de id.
        if (where.overtimeStatus) {
          if (row.overtimeStatus !== where.overtimeStatus) {
            const notFound = new Error(
              'An operation failed because it depends on one or more records that were required but not found.'
            );
            notFound.code = 'P2025';
            throw notFound;
          }
          row.overtimeStatus = data.overtimeStatus;
        }
        return { id: 'entry-offline', user: member };
      });

      const loserRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const loserReq = { ...mockReq, params: { id: 'entry-offline' } };

      await Promise.all([approveOvertime(mockReq, mockRes), approveOvertime(loserReq, loserRes)]);

      // Uma linha ACCRUAL e um increment no saldo — não dois.
      expect(accrueBankHours).toHaveBeenCalledTimes(1);
      expect(row.overtimeStatus).toBe('APPROVED');

      // Exatamente um lado aprovou; o outro levou 409, não 500.
      const statuses = [mockRes, loserRes].map((r) => r.status.mock.calls.map(([code]) => code));
      const conflicts = statuses.filter((calls) => calls.includes(409));
      expect(conflicts).toHaveLength(1);
      expect(statuses.flat()).not.toContain(500);

      const winner = mockRes.status.mock.calls.length ? loserRes : mockRes;
      expect(winner.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Horas extras aprovadas com sucesso' })
      );
    });

    it('answers the loser of the race with 409 OVERTIME_NOT_PENDING, not 500', async () => {
      // Mesmo código que loadEntryForOvertimeDecision devolve quando a leitura
      // já pega o registro fora de PENDING: o cliente trata os dois igual.
      mockPrisma.timeEntry.findUnique.mockResolvedValue(deferredEntry());
      const notFound = new Error('Record to update not found.');
      notFound.code = 'P2025';
      mockPrisma.timeEntry.update.mockRejectedValue(notFound);

      await approveOvertime(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Conflict',
          code: 'OVERTIME_NOT_PENDING',
          message: 'Este registro não possui horas extras aguardando decisão.',
        })
      );
      expect(accrueBankHours).not.toHaveBeenCalled();
    });
  });

  describe('approveEntriesBulk (lote)', () => {
    beforeEach(() => {
      mockReq.body = { entryIds: ['entry-offline', 'entry-online'] };
      mockPrisma.timeEntry.findMany.mockResolvedValue([deferredEntry(), onlineEntry()]);
    });

    it('releases the credit only for the deferred entry in the batch', async () => {
      mockPrisma.timeEntry.updateManyAndReturn.mockResolvedValue([deferredEntry(), onlineEntry()]);

      await approveEntriesBulk(mockReq, mockRes);

      expect(accrueBankHours).toHaveBeenCalledTimes(1);
      expect(accrueBankHours).toHaveBeenCalledWith(
        expect.objectContaining({ timeEntryId: 'entry-offline' })
      );
    });

    // A corrida: dois supervisores aprovam o mesmo lote ao mesmo tempo. O
    // predicado `overtimeStatus: 'PENDING'` no WHERE faz o segundo UPDATE não
    // encontrar nada (em READ COMMITTED ele espera o commit do primeiro e
    // reavalia a linha já APPROVED), e a lista de soltura sai DO UPDATE.
    it('scopes the overtime update with overtimeStatus PENDING', async () => {
      mockPrisma.timeEntry.updateManyAndReturn.mockResolvedValue([deferredEntry()]);

      await approveEntriesBulk(mockReq, mockRes);

      expect(mockPrisma.timeEntry.updateManyAndReturn).toHaveBeenCalledWith({
        where: { id: { in: ['entry-offline', 'entry-online'] }, overtimeStatus: 'PENDING' },
        data: { overtimeStatus: 'APPROVED' },
      });
    });

    it('credits nothing when a concurrent approval already took the batch', async () => {
      // O perdedor da corrida: UPDATE não escreveu linha nenhuma. Sem isto,
      // os dois lados creditavam — duas linhas ACCRUAL e dois increments no
      // saldo do colaborador.
      mockPrisma.timeEntry.updateManyAndReturn.mockResolvedValue([]);

      await approveEntriesBulk(mockReq, mockRes);

      expect(accrueBankHours).not.toHaveBeenCalled();
    });

    // O número que o supervisor lê na tela tem que ser o que o banco escreveu.
    // `overtimeIds.length` é a contagem da LEITURA anterior: quem perde a
    // corrida via "2 horas extras aprovadas" tendo aprovado nenhuma.
    it('reports the overtimes actually updated, not the pre-read count', async () => {
      mockPrisma.timeEntry.updateManyAndReturn.mockResolvedValue([deferredEntry()]);

      await approveEntriesBulk(mockReq, mockRes);

      // A leitura anterior viu 2 registros com HE pendente; o UPDATE escreveu 1.
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ overtimeApprovedCount: 1 })
      );
    });

    it('reports zero overtimes approved when a concurrent approval took the whole batch', async () => {
      mockPrisma.timeEntry.updateManyAndReturn.mockResolvedValue([]);

      await approveEntriesBulk(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ overtimeApprovedCount: 0 })
      );
    });

    it('does not take the release list from the pre-transaction read', async () => {
      // A leitura anterior mostra a HE pendente e represada; o UPDATE devolve
      // só o registro online. Quem manda é o UPDATE.
      mockPrisma.timeEntry.updateManyAndReturn.mockResolvedValue([onlineEntry()]);

      await approveEntriesBulk(mockReq, mockRes);

      expect(accrueBankHours).not.toHaveBeenCalled();
    });

    it('runs the releases one at a time: the balance is read-modify-write per user', async () => {
      const second = deferredEntry({ id: 'entry-offline-2' });
      mockPrisma.timeEntry.updateManyAndReturn.mockResolvedValue([deferredEntry(), second]);

      let inFlight = 0;
      let maxInFlight = 0;
      accrueBankHours.mockImplementation(async () => {
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return { accruedMinutes: 240 };
      });

      await approveEntriesBulk(mockReq, mockRes);

      expect(accrueBankHours).toHaveBeenCalledTimes(2);
      expect(maxInFlight).toBe(1);
    });

    it('skips the overtime update entirely when nothing in the batch has pending overtime', async () => {
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        deferredEntry({ overtimeStatus: null, overtimeMinutes: 0 }),
      ]);
      mockReq.body = { entryIds: ['entry-offline'] };

      await approveEntriesBulk(mockReq, mockRes);

      expect(mockPrisma.timeEntry.updateManyAndReturn).not.toHaveBeenCalled();
      expect(accrueBankHours).not.toHaveBeenCalled();
    });
  });
});
