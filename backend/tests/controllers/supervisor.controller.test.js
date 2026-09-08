// Testes para supervisor.controller

const mockPrisma = require('../mocks/prisma.mock');

// Mock dos módulos
jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/utils/recalcDay', () => ({
  recalculateUserDay: jest.fn(),
  reverseEntryBankHours: jest.fn().mockResolvedValue(undefined),
}));

const { reverseEntryBankHours } = require('../../src/utils/recalcDay');
const {
  getTeamPendingEntries,
  approveEntry,
  approveEntriesBulk,
  rejectEntry,
  rejectEntriesBulk,
  rejectOvertime,
  requestEdit,
  getTeamMembers,
  getTeamPresenceSnapshot,
} = require('../../src/controllers/supervisor.controller');

describe('Supervisor Controller', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockReq = {
      user: {
        id: 'supervisor-123',
        email: 'supervisor@test.com',
        role: 'SUPERVISOR',
      },
      body: {},
      query: {},
      params: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    jest.clearAllMocks();

    // O escopo virou hierárquico (utils/visibleUsers.js): resolver "quem está abaixo do ator"
    // consulta o banco. Sem este default, a travessia recebe undefined e o controller
    // devolve 500. member-123 é o subordinado direto usado na maioria dos casos.
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'member-123', isActive: true }]);
  });

  describe('getTeamPendingEntries', () => {
    it('should return empty array if supervisor has no subordinates', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await getTeamPendingEntries(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Nenhum subordinado encontrado',
          entries: [],
        })
      );
    });

    it('should return pending entries for subordinates', async () => {
      const subordinates = [
        { id: 'member-1', name: 'Member 1', email: 'member1@test.com' },
        { id: 'member-2', name: 'Member 2', email: 'member2@test.com' },
      ];

      const entries = [
        {
          id: 'entry-1',
          userId: 'member-1',
          status: 'PENDING',
          clockIn: new Date(),
          clockOut: new Date(),
          user: subordinates[0],
          logs: [],
        },
      ];

      mockPrisma.user.findMany.mockResolvedValue(subordinates);
      mockPrisma.timeEntry.findMany.mockResolvedValue(entries);
      mockPrisma.timeEntry.count.mockResolvedValue(1);
      mockPrisma.timeEntry.groupBy.mockResolvedValue([
        { status: 'PENDING', _count: 1 },
      ]);

      await getTeamPendingEntries(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          entries: expect.any(Array),
          subordinates: expect.any(Array),
          stats: expect.any(Object),
        })
      );
    });

    it('filtra o grupo pela cadeia inteira abaixo do responsável, não só os diretos', async () => {
      // Hierarquia real: ADMIN -> RH -> colaborador. Filtrar pelo grupo do RH tem que
      // trazer os netos, senão a tela fica vazia em quem tem três níveis.
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'rh-1', name: 'RH', role: 'HR', supervisorId: 'admin-1' },
        { id: 'lider-1', name: 'Lider', role: 'MEMBER', supervisorId: 'rh-1' },
        { id: 'neto-1', name: 'Neto', role: 'MEMBER', supervisorId: 'lider-1' },
        { id: 'fora-1', name: 'Outro time', role: 'MEMBER', supervisorId: 'admin-1' },
      ]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      mockPrisma.timeEntry.count.mockResolvedValue(0);
      mockPrisma.timeEntry.groupBy.mockResolvedValue([]);
      mockReq.query = { groupId: 'rh-1' };

      await getTeamPendingEntries(mockReq, mockRes);

      const where = mockPrisma.timeEntry.findMany.mock.calls[0][0].where;
      expect(where.userId.in.sort()).toEqual(['lider-1', 'neto-1']);
    });

    it('should return 403 if userId is not a subordinate', async () => {
      const subordinates = [
        { id: 'member-1', name: 'Member 1', email: 'member1@test.com' },
      ];

      mockPrisma.user.findMany.mockResolvedValue(subordinates);
      mockReq.query = { userId: 'other-user' };

      await getTeamPendingEntries(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
        })
      );
    });

    it('should filter by status', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'member-1' }]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      mockPrisma.timeEntry.count.mockResolvedValue(0);
      mockPrisma.timeEntry.groupBy.mockResolvedValue([]);
      mockReq.query = { status: 'APPROVED' };

      await getTeamPendingEntries(mockReq, mockRes);

      expect(mockPrisma.timeEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'APPROVED',
          }),
        })
      );
    });
  });

  describe('approveEntry', () => {
    it('should return 404 if entry does not exist', async () => {
      mockReq.params = { id: 'non-existent-entry' };
      mockPrisma.timeEntry.findUnique.mockResolvedValue(null);

      await approveEntry(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Not Found',
          message: 'Registro de ponto não encontrado',
        })
      );
    });

    it('should return 403 if entry belongs to non-subordinate', async () => {
      mockReq.params = { id: 'entry-123' };
      mockPrisma.timeEntry.findUnique.mockResolvedValue({
        id: 'entry-123',
        user: {
          id: 'other-user',
          supervisorId: 'other-supervisor',
        },
      });

      await approveEntry(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
        })
      );
    });

    it('should return 409 if entry is not pending', async () => {
      mockReq.params = { id: 'entry-123' };
      mockPrisma.timeEntry.findUnique.mockResolvedValue({
        id: 'entry-123',
        status: 'APPROVED',
        clockOut: new Date(),
        user: {
          id: 'member-123',
          supervisorId: 'supervisor-123',
        },
      });

      await approveEntry(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'ENTRY_NOT_PENDING',
          message: expect.stringContaining('já está com status'),
        })
      );
    });

    it('should return 422 if entry has no clock-out', async () => {
      mockReq.params = { id: 'entry-123' };
      mockPrisma.timeEntry.findUnique.mockResolvedValue({
        id: 'entry-123',
        status: 'PENDING',
        clockOut: null,
        user: {
          id: 'member-123',
          supervisorId: 'supervisor-123',
        },
      });

      await approveEntry(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(422);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'ENTRY_OPEN',
          message: expect.stringContaining('sem clock-out'),
        })
      );
    });

    it('should approve entry successfully', async () => {
      mockReq.params = { id: 'entry-123' };
      mockReq.body = { comment: 'Looks good!' };

      mockPrisma.timeEntry.findUnique.mockResolvedValue({
        id: 'entry-123',
        status: 'PENDING',
        clockOut: new Date(),
        user: {
          id: 'member-123',
          supervisorId: 'supervisor-123',
        },
      });

      const updatedEntry = {
        id: 'entry-123',
        status: 'APPROVED',
        user: { id: 'member-123', name: 'Member', email: 'member@test.com' },
      };

      const approvalLog = {
        id: 'log-123',
        timeEntryId: 'entry-123',
        reviewerId: 'supervisor-123',
        action: 'APPROVED',
        comment: 'Looks good!',
      };

      mockPrisma.$transaction.mockResolvedValue([updatedEntry, approvalLog]);

      await approveEntry(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Registro aprovado com sucesso',
          entry: expect.any(Object),
          approvalLog: expect.any(Object),
        })
      );
    });
  });

  describe('rejectEntry', () => {
    it('should return 400 if comment is missing', async () => {
      mockReq.params = { id: 'entry-123' };
      mockReq.body = {};

      await rejectEntry(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: expect.stringContaining('Comentário obrigatório'),
        })
      );
    });

    it('should return 400 if comment is too short', async () => {
      mockReq.params = { id: 'entry-123' };
      mockReq.body = { comment: 'No' };

      await rejectEntry(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Bad Request',
          message: expect.stringContaining('mínimo'),
        })
      );
    });

    it('should reject entry successfully', async () => {
      mockReq.params = { id: 'entry-123' };
      mockReq.body = { comment: 'Incorrect hours reported' };

      mockPrisma.timeEntry.findUnique.mockResolvedValue({
        id: 'entry-123',
        status: 'PENDING',
        user: {
          id: 'member-123',
          supervisorId: 'supervisor-123',
        },
      });

      const updatedEntry = {
        id: 'entry-123',
        status: 'REJECTED',
        user: { id: 'member-123', name: 'Member', email: 'member@test.com' },
      };

      const approvalLog = {
        id: 'log-123',
        action: 'REJECTED',
        comment: 'Incorrect hours reported',
      };

      mockPrisma.$transaction.mockResolvedValue([updatedEntry, approvalLog]);

      await rejectEntry(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Registro rejeitado',
        })
      );
    });
  });

  describe('bulk approve/deny', () => {
    // Lote típico de uma semana: um dia sem HE, um dia com HE aguardando decisão
    // e um dia que já saiu do estado PENDING.
    const bulkEntries = [
      {
        id: 'entry-plain',
        status: 'PENDING',
        clockOut: new Date(),
        overtimeStatus: null,
        workedMinutes: 480,
        overtimeMinutes: 0,
        overtimeMinutes50: 0,
        overtimeMinutes100: 0,
        bankHoursAccruedMinutes: 0,
        user: { id: 'member-123', supervisorId: 'supervisor-123' },
      },
      {
        id: 'entry-ot',
        status: 'PENDING',
        clockOut: new Date(),
        overtimeStatus: 'PENDING',
        // 570 trabalhados com 90 de HE => 480 reconhecidos se a HE for negada.
        workedMinutes: 570,
        overtimeMinutes: 90,
        overtimeMinutes50: 90,
        overtimeMinutes100: 0,
        bankHoursAccruedMinutes: 90,
        user: { id: 'member-123', supervisorId: 'supervisor-123' },
      },
      {
        id: 'entry-done',
        status: 'APPROVED',
        clockOut: new Date(),
        overtimeStatus: null,
        user: { id: 'member-123', supervisorId: 'supervisor-123' },
      },
    ];

    const allIds = ['entry-plain', 'entry-ot', 'entry-done'];

    // O $transaction do mock resolve um array de promises, então instrumentamos as
    // chamadas do Prisma para inspecionar o que cada operação do lote recebeu.
    const captureOps = () => {
      const ops = [];
      const record = (model, method, result) => (args) => {
        ops.push({ __model: model, __method: method, ...args });
        return Promise.resolve(result);
      };
      // `count` tem que sair das linhas que casam com o WHERE, nao ser fixo: o
      // controller passou a reportar approvedCount/rejectedCount a partir dele,
      // e um count fixo faria o teste passar com qualquer indice errado.
      mockPrisma.timeEntry.updateMany.mockImplementation((args) => {
        ops.push({ __model: 'timeEntry', __method: 'updateMany', ...args });
        return Promise.resolve(countMatching(args));
      });
      // O approve em lote passou a usar updateManyAndReturn na HE: a lista de
      // soltura do banco de horas sai do que o UPDATE escreveu, não da leitura
      // feita antes da transação.
      // Devolve as linhas que o UPDATE de fato escreveu (as que ainda estavam
      // com HE PENDING), como o banco devolveria. `overtimeApprovedCount` sai
      // daqui: reportar `overtimeIds.length` diria "N horas extras aprovadas"
      // para o supervisor que perdeu a corrida e não escreveu nenhuma.
      mockPrisma.timeEntry.updateManyAndReturn.mockImplementation((args) => {
        ops.push({ __model: 'timeEntry', __method: 'updateManyAndReturn', ...args });
        const ids = args.where?.id?.in || [];
        return Promise.resolve(
          bulkEntries.filter(
            (entry) => ids.includes(entry.id) && entry.overtimeStatus === args.where?.overtimeStatus
          )
        );
      });
      mockPrisma.approvalLog.createMany.mockImplementation(record('approvalLog', 'createMany', { count: 0 }));
      return ops;
    };

    // Conta as linhas que casam com o WHERE, como o banco faria. Fica no
    // beforeEach (e nao so no captureOps) para que um teste que nao instrumenta
    // as operacoes ainda receba uma contagem real em vez de 0 silencioso.
    const countMatching = (args) => {
      // A negacao de HE em lote escreve UM updateMany POR LINHA (o tempo
      // reconhecido depende do registro e updateMany so grava valor
      // constante), entao o WHERE vem com `id` ESCALAR e nao `id: { in: [...] }`.
      // Sem aceitar as duas formas, o count saia 0 e overtimeRejectedCount
      // reportaria zero negacao num lote que negou.
      const ids = args.where?.id?.in || (args.where?.id ? [args.where.id] : []);
      const matched = bulkEntries.filter((entry) => {
        if (!ids.includes(entry.id)) return false;
        if (args.where?.status && entry.status !== args.where.status) return false;
        if (args.where?.overtimeStatus && entry.overtimeStatus !== args.where.overtimeStatus)
          return false;
        return true;
      });
      return { count: matched.length };
    };

    beforeEach(() => {
      mockPrisma.timeEntry.updateMany.mockImplementation((args) =>
        Promise.resolve(countMatching(args))
      );
      mockPrisma.timeEntry.findMany.mockResolvedValue(bulkEntries);
      // O controller agora lê o RESULTADO da transação, então o mock precisa
      // devolvê-lo em vez de undefined.
      mockPrisma.$transaction.mockImplementation((operations) => Promise.all(operations));
    });

    it('aprova o lote e decide a HE pendente junto', async () => {
      mockReq.body = { entryIds: allIds };
      const ops = captureOps();

      await approveEntriesBulk(mockReq, mockRes);

      // entry-done já não estava PENDING: fica de fora com motivo.
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          approvedCount: 2,
          overtimeApprovedCount: 1,
          skipped: [{ id: 'entry-done', reason: 'ENTRY_NOT_PENDING' }],
        })
      );

      const otUpdate = ops.find((op) => op.data?.overtimeStatus === 'APPROVED');
      expect(otUpdate.where.id.in).toEqual(['entry-ot']);

      const logs = ops.filter((op) => op.__method === 'createMany').flatMap((op) => op.data);
      expect(logs.filter((log) => log.action === 'OVERTIME_APPROVED').map((log) => log.timeEntryId)).toEqual([
        'entry-ot',
      ]);
      expect(logs.filter((log) => log.action === 'APPROVED').map((log) => log.timeEntryId)).toEqual([
        'entry-plain',
        'entry-ot',
      ]);
    });

    it('reporta o que o UPDATE escreveu, nao o que a leitura previa achou', async () => {
      // Corrida: os dois supervisores leem entry-plain e entry-ot como PENDING,
      // mas o UPDATE do perdedor tem predicado `status: 'PENDING'` e so escreve
      // uma linha. Reportar validIds.length diria "2 aprovados" para quem
      // aprovou 1 — e o supervisor iria embora achando o lote resolvido.
      captureOps();
      mockPrisma.timeEntry.updateMany.mockResolvedValue({ count: 1 });
      mockReq.body = { entryIds: allIds };

      await approveEntriesBulk(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          approvedCount: 1,
          message: '1 registro(s) aprovado(s) com sucesso',
        })
      );
    });

    it('nega o lote, zera a HE e reverte o banco de horas', async () => {
      mockReq.body = { entryIds: allIds, comment: 'Semana fora do combinado' };
      const ops = captureOps();

      await rejectEntriesBulk(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          rejectedCount: 2,
          overtimeRejectedCount: 1,
          skipped: [{ id: 'entry-done', reason: 'ENTRY_NOT_PENDING' }],
        })
      );

      expect(reverseEntryBankHours).toHaveBeenCalledWith('entry-ot');
      expect(reverseEntryBankHours).toHaveBeenCalledTimes(1);

      // Um UPDATE por linha, não um updateMany na lista: o tempo reconhecido é
      // calculado por registro. O predicado de estado continua em cada linha.
      const otUpdate = ops.find((op) => op.data?.overtimeStatus === 'REJECTED');
      expect(otUpdate.where).toEqual({ id: 'entry-ot', overtimeStatus: 'PENDING' });
      expect(otUpdate.data).toMatchObject({
        // 570 trabalhados menos os 90 de HE negada.
        workedMinutes: 480,
        overtimeMinutes: 0,
        overtimeMinutes50: 0,
        overtimeMinutes100: 0,
        overtimePercent: 0,
        bankHoursAccruedMinutes: 0,
      });

      const logs = ops.filter((op) => op.__method === 'createMany').flatMap((op) => op.data);
      // A justificativa da HE guarda os minutos originais, como no rejectOvertime.
      expect(logs.find((log) => log.action === 'OVERTIME_REJECTED').comment).toContain('HE original: 90min');
      expect(logs.filter((log) => log.action === 'REJECTED')).toHaveLength(2);
    });

    it('exige comentário de pelo menos 5 caracteres para negar em lote', async () => {
      mockReq.body = { entryIds: allIds, comment: 'nao' };

      await rejectEntriesBulk(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(reverseEntryBankHours).not.toHaveBeenCalled();
    });

    it('ignora registro em aberto e de fora da equipe', async () => {
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        {
          id: 'entry-open',
          status: 'PENDING',
          clockOut: null,
          overtimeStatus: null,
          user: { id: 'member-123', supervisorId: 'supervisor-123' },
        },
        {
          id: 'entry-alheio',
          status: 'PENDING',
          clockOut: new Date(),
          overtimeStatus: null,
          user: { id: 'estranho-999', supervisorId: 'outro-supervisor' },
        },
      ]);
      mockReq.body = { entryIds: ['entry-open', 'entry-alheio', 'entry-sumiu'] };

      await approveEntriesBulk(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          approvedCount: 0,
          skipped: expect.arrayContaining([
            { id: 'entry-sumiu', reason: 'NOT_FOUND' },
            { id: 'entry-open', reason: 'ENTRY_OPEN' },
            { id: 'entry-alheio', reason: 'FORBIDDEN' },
          ]),
        })
      );
    });

    it('recusa lote vazio ou acima de 200 registros', async () => {
      mockReq.body = { entryIds: [] };
      await approveEntriesBulk(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);

      mockReq.body = { entryIds: Array.from({ length: 201 }, (_, i) => `e-${i}`) };
      await approveEntriesBulk(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    // Modo por período: o cliente manda o filtro da tela, o servidor resolve os ids.
    // É o que permite aprovar a semana de todos os colaboradores em um clique.
    describe('scope (período inteiro)', () => {
      it('resolve os pendentes do período e aprova todos', async () => {
        mockPrisma.timeEntry.count.mockResolvedValue(bulkEntries.length);
        mockReq.body = { scope: { startDate: '2026-08-10', endDate: '2026-08-16' } };
        const ops = captureOps();

        await approveEntriesBulk(mockReq, mockRes);

        // Mesmo filtro da listagem: equipe visível, pendente e fechado, dentro do range.
        const where = mockPrisma.timeEntry.findMany.mock.calls.at(-1)[0].where;
        expect(where).toMatchObject({
          userId: { in: ['member-123'] },
          status: 'PENDING',
          clockOut: { not: null },
        });
        // Datas locais: o range cobre o dia 10 inteiro até o fim do dia 16.
        expect(where.clockIn.gte.getDate()).toBe(10);
        expect(where.clockIn.lte.getDate()).toBe(16);
        expect(where.clockIn.lte.getHours()).toBe(23);

        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({ approvedCount: 2, overtimeApprovedCount: 1 })
        );
        expect(ops.find((op) => op.data?.overtimeStatus === 'APPROVED').where.id.in).toEqual(['entry-ot']);
      });

      it('recusa scope sem intervalo de datas', async () => {
        mockReq.body = { scope: { userId: 'member-123' } };

        await approveEntriesBulk(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockPrisma.timeEntry.updateMany).not.toHaveBeenCalled();
      });

      it('recusa período acima do teto e não escreve nada', async () => {
        mockPrisma.timeEntry.count.mockResolvedValue(501);
        mockReq.body = { scope: { startDate: '2026-08-01', endDate: '2026-08-31' }, comment: 'Mes inteiro errado' };

        await rejectEntriesBulk(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockPrisma.timeEntry.updateMany).not.toHaveBeenCalled();
        expect(reverseEntryBankHours).not.toHaveBeenCalled();
      });

      it('nega o período pedido e reverte o banco de horas da HE', async () => {
        mockPrisma.timeEntry.count.mockResolvedValue(bulkEntries.length);
        mockReq.body = {
          scope: { startDate: '2026-08-10', endDate: '2026-08-16' },
          comment: 'Semana inteira fora do combinado',
        };

        await rejectEntriesBulk(mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({ rejectedCount: 2, overtimeRejectedCount: 1 })
        );
        expect(reverseEntryBankHours).toHaveBeenCalledWith('entry-ot');
      });

      it('recusa colaborador fora do escopo do ator', async () => {
        mockReq.body = { scope: { startDate: '2026-08-10', endDate: '2026-08-16', userId: 'estranho-999' } };

        await approveEntriesBulk(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockPrisma.timeEntry.updateMany).not.toHaveBeenCalled();
      });
    });
  });

  // Negar HE desconta o tempo negado do tempo reconhecido da entrada. Antes a
  // HE ia a zero mas workedMinutes continuava cheio, então o total do período, o
  // KPI e o relatório seguiam mostrando as horas que o supervisor negou.
  describe('rejectOvertime', () => {
    const pendingOvertimeEntry = (over = {}) => ({
      id: 'entry-ot',
      userId: 'member-123',
      status: 'PENDING',
      clockIn: new Date('2026-08-28T11:00:00.000Z'),
      clockOut: new Date('2026-08-28T20:30:00.000Z'),
      overtimeStatus: 'PENDING',
      workedMinutes: 570,
      overtimeMinutes: 90,
      overtimeMinutes50: 90,
      overtimeMinutes100: 0,
      bankHoursAccruedMinutes: 90,
      user: {
        id: 'member-123',
        name: 'Member',
        email: 'm@test.com',
        supervisorId: 'supervisor-123',
        organizationAdminId: 'admin-1',
      },
      ...over,
    });

    beforeEach(() => {
      mockReq.params = { id: 'entry-ot' };
      mockPrisma.timeEntry.findUnique.mockResolvedValue(pendingOvertimeEntry());
      mockPrisma.$transaction.mockImplementation((operations) => Promise.all(operations));
      // A negacao passou a escrever com updateMany + predicado de estado, para
      // o perdedor de uma corrida perder. count: 1 = venceu a corrida.
      mockPrisma.timeEntry.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalLog.create.mockResolvedValue({ id: 'log-1' });
    });

    it('desconta a HE negada do tempo reconhecido da entrada', async () => {
      mockReq.body = { comment: 'Fora do combinado com o cliente' };

      await rejectOvertime(mockReq, mockRes);

      const update = mockPrisma.timeEntry.updateMany.mock.calls[0][0];
      // O predicado de estado viaja no UPDATE, nao so na leitura anterior.
      expect(update.where).toEqual({ id: 'entry-ot', overtimeStatus: 'PENDING' });
      expect(update.data).toMatchObject({
        overtimeStatus: 'REJECTED',
        // 570 trabalhados menos os 90 de HE negada.
        workedMinutes: 480,
        overtimeMinutes: 0,
        overtimeMinutes50: 0,
        overtimeMinutes100: 0,
        overtimePercent: 0,
        bankHoursAccruedMinutes: 0,
      });
      // clockIn/clockOut são o fato bruto e não entram no update.
      expect(update.data).not.toHaveProperty('clockIn');
      expect(update.data).not.toHaveProperty('clockOut');
      expect(reverseEntryBankHours).toHaveBeenCalledWith('entry-ot');
    });

    // Entrada que era HE de ponta a ponta (turno extra colado num dia já
    // completo): o reconhecido vai a zero, e é justamente o caso que fazia o
    // relatório recalcular a duração cheia de clockIn/clockOut.
    it('zera o reconhecido quando a entrada inteira era hora extra', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(
        pendingOvertimeEntry({ workedMinutes: 60, overtimeMinutes: 60, overtimeMinutes50: 60 })
      );
      mockReq.body = { comment: 'Turno extra nao autorizado' };

      await rejectOvertime(mockReq, mockRes);

      expect(mockPrisma.timeEntry.updateMany.mock.calls[0][0].data).toMatchObject({
        workedMinutes: 0,
        overtimeMinutes: 0,
      });
    });

    it('exige comentário de pelo menos 5 caracteres', async () => {
      mockReq.body = { comment: 'nao' };

      await rejectOvertime(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.timeEntry.updateMany).not.toHaveBeenCalled();
      expect(reverseEntryBankHours).not.toHaveBeenCalled();
    });

    // Quem perde a corrida tem que SABER que perdeu, em vez de receber 200 e
    // acreditar que a decisao dele entrou.
    it('devolve 409 quando outra pessoa ja decidiu a HE', async () => {
      mockPrisma.timeEntry.updateMany.mockResolvedValue({ count: 0 });
      mockReq.body = { comment: 'Fora do combinado com o cliente' };

      await rejectOvertime(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'OVERTIME_NOT_PENDING' })
      );
    });
  });

  describe('requestEdit', () => {
    it('should return 400 if comment is missing', async () => {
      mockReq.params = { id: 'entry-123' };
      mockReq.body = {};

      await requestEdit(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should request edit successfully', async () => {
      mockReq.params = { id: 'entry-123' };
      mockReq.body = { comment: 'Please verify the clock-in time' };

      mockPrisma.timeEntry.findUnique.mockResolvedValue({
        id: 'entry-123',
        user: {
          id: 'member-123',
          supervisorId: 'supervisor-123',
        },
      });

      const updatedEntry = {
        id: 'entry-123',
        status: 'PENDING',
        user: { id: 'member-123', name: 'Member', email: 'member@test.com' },
      };

      const approvalLog = {
        id: 'log-123',
        action: 'EDIT_REQUESTED',
        comment: 'Please verify the clock-in time',
      };

      mockPrisma.$transaction.mockResolvedValue([updatedEntry, approvalLog]);

      await requestEdit(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Solicitação de edição'),
        })
      );
    });
  });

  describe('getTeamMembers', () => {
    it('should return team members with stats', async () => {
      const subordinates = [
        {
          id: 'member-1',
          name: 'Member 1',
          email: 'member1@test.com',
          role: 'MEMBER',
          createdAt: new Date(),
          _count: { timeEntries: 10 },
        },
      ];

      mockPrisma.user.findMany.mockResolvedValue(subordinates);
      mockPrisma.timeEntry.groupBy.mockResolvedValue([
        { status: 'PENDING', _count: 3 },
        { status: 'APPROVED', _count: 7 },
      ]);

      await getTeamMembers(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          team: expect.any(Array),
          totalMembers: 1,
        })
      );
    });
  });

  describe('getTeamPresenceSnapshot', () => {
    const member = {
      id: 'member-1',
      name: 'Member 1',
      email: 'member1@test.com',
      role: 'MEMBER',
      timeZone: 'America/Sao_Paulo',
      contractDailyMinutes: 480,
      bankHoursLimitMinutes: 0,
      workdayStartTime: '08:00',
      workdayEndTime: '18:00',
      supervisor: { id: 'supervisor-123', name: 'Sup', email: 'supervisor@test.com' },
    };

    // buildTeamPresenceSnapshot faz 3 timeEntry.findMany em Promise.all, nesta ordem:
    // openEntries, todayEntries, latestEntriesWithLocation.
    const mockEntries = ({ open = [], today = [] }) => {
      mockPrisma.user.findMany.mockResolvedValue([member]);
      mockPrisma.timeEntry.findMany
        .mockResolvedValueOnce(open)
        .mockResolvedValueOnce(today)
        .mockResolvedValueOnce([]);
    };

    const firstMember = () => mockRes.json.mock.calls[0][0];

    it('reports ON_BREAK when the open entry has breakStartedAt', async () => {
      const clockIn = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const breakStartedAt = new Date(Date.now() - 10 * 60 * 1000);
      const openEntry = {
        id: 'entry-1',
        userId: member.id,
        clockIn,
        breakStartedAt,
        breakMinutes: 0,
        location: null,
        updatedAt: clockIn,
      };

      mockEntries({ open: [openEntry], today: [{ ...openEntry, clockOut: null, workedMinutes: 0 }] });

      await getTeamPresenceSnapshot(mockReq, mockRes);

      const payload = firstMember();
      expect(payload.members[0].status).toBe('ON_BREAK');
      expect(payload.members[0].since).toBe(breakStartedAt);
      expect(payload.summary.onBreak).toBe(1);
      expect(payload.summary.present).toBe(0);
    });

    it('reports PRESENT when the open entry has no active break', async () => {
      const clockIn = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const openEntry = {
        id: 'entry-1',
        userId: member.id,
        clockIn,
        breakStartedAt: null,
        breakMinutes: 30,
        location: null,
        updatedAt: clockIn,
      };

      mockEntries({ open: [openEntry], today: [{ ...openEntry, clockOut: null, workedMinutes: 0 }] });

      await getTeamPresenceSnapshot(mockReq, mockRes);

      const payload = firstMember();
      expect(payload.members[0].status).toBe('PRESENT');
      expect(payload.members[0].since).toBe(clockIn);
      expect(payload.summary.onBreak).toBe(0);
    });

    it('reports ABSENT after a mid-workday clock-out instead of ON_BREAK', async () => {
      const clockIn = new Date(Date.now() - 4 * 60 * 60 * 1000);
      const clockOut = new Date(Date.now() - 30 * 60 * 1000);

      mockEntries({
        open: [],
        today: [
          {
            id: 'entry-1',
            userId: member.id,
            clockIn,
            clockOut,
            workedMinutes: 210,
            location: null,
            updatedAt: clockOut,
          },
        ],
      });

      await getTeamPresenceSnapshot(mockReq, mockRes);

      const payload = firstMember();
      expect(payload.members[0].status).toBe('ABSENT');
      expect(payload.summary.onBreak).toBe(0);
      expect(payload.summary.absent).toBe(1);
    });

    it('excludes break minutes from the overtime check', async () => {
      // 9h desde o clock-in, 2h de pausa => 7h líquidas < 8h de contrato.
      const clockIn = new Date(Date.now() - 9 * 60 * 60 * 1000);
      const openEntry = {
        id: 'entry-1',
        userId: member.id,
        clockIn,
        breakStartedAt: null,
        breakMinutes: 120,
        location: null,
        updatedAt: clockIn,
      };

      mockEntries({ open: [openEntry], today: [{ ...openEntry, clockOut: null, workedMinutes: 0 }] });

      await getTeamPresenceSnapshot(mockReq, mockRes);

      expect(firstMember().members[0].status).toBe('PRESENT');
    });
  });

  describe('Error handling', () => {
    it('should handle database errors', async () => {
      mockPrisma.user.findMany.mockRejectedValue(new Error('DB Error'));

      await getTeamPendingEntries(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });
});
