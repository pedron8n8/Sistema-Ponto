// Batida offline: o horário gravado tem que ser o horário em que a pessoa bateu
// o ponto, não o horário em que o celular reencontrou sinal. workedMinutes,
// hora extra 50/100 e banco de horas saem todos de clockOut - clockIn, então
// gravar a hora da sincronização corrompe a folha de pagamento.

const mockPrisma = require('../mocks/prisma.mock');
const { stubTimeEntryFindFirst } = require('../mocks/timeEntryFindFirst');
const { captureRequestMetadata } = require('../../src/utils/requestMetadata');
const { evaluateGeofence } = require('../../src/utils/geofence');
const { verifyPin } = require('../../src/utils/pinAuth');
const { accrueBankHours } = require('../../src/utils/bankHours');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/utils/requestMetadata', () => ({
  captureRequestMetadata: jest.fn(),
}));
jest.mock('../../src/utils/geofence', () => ({
  evaluateGeofence: jest.fn(),
  getGeofencePublicConfig: jest.fn(),
  getGeofenceConfig: jest.fn(),
  LOCATION_VALIDATION_SOURCES: { GPS: 'GPS', TERMINAL_QR: 'TERMINAL_QR' },
}));
jest.mock('../../src/utils/pinAuth', () => ({
  verifyPin: jest.fn(),
  isPinLocked: jest.fn(() => false),
  getPinLockExpiry: jest.fn(() => null),
  PIN_MAX_ATTEMPTS: 5,
  PIN_LOCK_MINUTES: 15,
}));
jest.mock('../../src/utils/bankHours', () => ({
  accrueBankHours: jest.fn(),
  expireBankHoursIfNeeded: jest.fn(),
}));

const { clockIn, clockOut } = require('../../src/controllers/time.controller');

const HOUR = 60 * 60 * 1000;

describe('batida offline (occurredAt)', () => {
  let mockReq;
  let mockRes;

  const createArgs = () => mockPrisma.timeEntry.create.mock.calls[0][0];
  const updateArgs = () => mockPrisma.timeEntry.update.mock.calls[0][0];

  beforeEach(() => {
    // jest.config tem resetMocks: true, então as implementações dos mocks
    // precisam ser reinstaladas a cada teste.
    mockReq = {
      user: { id: 'user-123', email: 'member@test.com', name: 'Member', role: 'MEMBER' },
      body: { pin: '1234' },
      query: {},
      params: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    captureRequestMetadata.mockReturnValue({
      ip: '127.0.0.1',
      device: 'OmniPunt Android',
      location: null,
    });

    evaluateGeofence.mockReturnValue({
      enabled: false,
      allowed: true,
      inside: true,
      hasCoordinates: false,
      reason: 'GEOFENCE_DISABLED',
    });

    // Usuário autentica por PIN (sem facial cadastrada).
    verifyPin.mockResolvedValue(true);
    mockPrisma.user.findUnique.mockResolvedValue({
      facialEmbedding: null,
      facialThreshold: 0.45,
      pinHash: 'hash',
      pinSalt: 'salt',
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      contractDailyMinutes: 480,
      hourlyRate: 0,
    });
    mockPrisma.user.update.mockResolvedValue({});

    accrueBankHours.mockResolvedValue({
      accruedMinutes: 0,
      discardedMinutes: 0,
      balanceMinutes: 0,
      expiredMinutes: 0,
    });

    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    mockPrisma.timeEntry.create.mockResolvedValue({ id: 'entry-1', user: {} });
    mockPrisma.timeEntry.update.mockResolvedValue({ id: 'entry-1', user: {} });
  });

  describe('clock-in', () => {
    it('records an offline clock-in at the time it actually happened', async () => {
      const occurredAt = new Date(Date.now() - 4 * HOUR);
      stubTimeEntryFindFirst(mockPrisma, { open: null });
      mockReq.body.occurredAt = occurredAt.toISOString();

      await clockIn(mockReq, mockRes);

      expect(mockPrisma.timeEntry.create).toHaveBeenCalled();
      expect(createArgs().data.clockIn.getTime()).toBe(occurredAt.getTime());

      const { offline } = createArgs().data.location;
      expect(offline.event).toBe('clockIn');
      expect(offline.occurredAt).toBe(occurredAt.toISOString());
      expect(offline.skewMs).toBeGreaterThanOrEqual(4 * HOUR - 5000);
      expect(offline.skewMs).toBeLessThanOrEqual(4 * HOUR + 5000);
      expect(typeof offline.syncedAt).toBe('string');
    });

    it('returns 400 INVALID_OCCURRED_AT for a future occurredAt', async () => {
      stubTimeEntryFindFirst(mockPrisma, { open: null });
      mockReq.body.occurredAt = new Date(Date.now() + HOUR).toISOString();

      await clockIn(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_OCCURRED_AT' })
      );
      expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
    });

    it('returns 400 INVALID_OCCURRED_AT for a malformed occurredAt', async () => {
      stubTimeEntryFindFirst(mockPrisma, { open: null });
      mockReq.body.occurredAt = 'ontem de manhã';

      await clockIn(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_OCCURRED_AT' })
      );
      expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
    });

    it('still uses the server clock when occurredAt is absent', async () => {
      stubTimeEntryFindFirst(mockPrisma, { open: null });
      const before = Date.now();

      await clockIn(mockReq, mockRes);

      const { clockIn: stamped, location } = createArgs().data;
      expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
      expect(stamped.getTime()).toBeLessThanOrEqual(Date.now());
      expect(location.offline).toBeUndefined();
    });

    // A janela de 48h do resolvePunchTimestamp limita só o intervalo absoluto;
    // sozinha ela deixa uma entrada retroativa cair em cima de turno já
    // fechado, e o clock-out seguinte conta o mesmo tempo duas vezes.
    describe('sobreposição com registro existente', () => {
      const closedShift = {
        id: 'entry-0',
        userId: 'user-123',
        clockIn: new Date(Date.now() - 10 * HOUR),
        clockOut: new Date(Date.now() - 2 * HOUR),
      };

      it('rejects a backdated clock-in that lands inside a closed entry with 409', async () => {
        stubTimeEntryFindFirst(mockPrisma, { open: null, others: [closedShift] });
        mockReq.body.occurredAt = new Date(Date.now() - 6 * HOUR).toISOString();

        await clockIn(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(409);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Conflict',
            code: 'PUNCH_OVERLAPS_EXISTING_ENTRY',
          })
        );
        expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
      });

      it('rejects a backdated clock-in that precedes a closed entry with 409', async () => {
        stubTimeEntryFindFirst(mockPrisma, { open: null, others: [closedShift] });
        mockReq.body.occurredAt = new Date(Date.now() - 12 * HOUR).toISOString();

        await clockIn(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(409);
        expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
      });

      it('accepts a backdated clock-in that starts after the closed entry ended', async () => {
        // O guard não pode ser largo demais: um segundo turno no mesmo dia,
        // depois do primeiro ter fechado, é legítimo.
        const occurredAt = new Date(Date.now() - HOUR);
        stubTimeEntryFindFirst(mockPrisma, { open: null, others: [closedShift] });
        mockReq.body.occurredAt = occurredAt.toISOString();

        await clockIn(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(201);
        expect(createArgs().data.clockIn.getTime()).toBe(occurredAt.getTime());
      });

      it('does not run the overlap query for an online clock-in', async () => {
        // Batida online carrega o relógio do servidor: não há como sobrepor
        // nada, e a consulta extra sairia caro em todo clock-in do sistema.
        stubTimeEntryFindFirst(mockPrisma, { open: null, others: [closedShift] });

        await clockIn(mockReq, mockRes);

        expect(mockPrisma.timeEntry.findFirst).toHaveBeenCalledTimes(1);
        expect(mockRes.status).toHaveBeenCalledWith(201);
      });
    });

    it('marks the offline clock-in so bank hours stay deferred until approval', async () => {
      // O crédito de banco de horas mexe no saldo do colaborador na hora. Com
      // horário escolhido pelo cliente isso não pode acontecer antes de um
      // humano olhar, então o registro nasce marcado.
      stubTimeEntryFindFirst(mockPrisma, { open: null });
      mockReq.body.occurredAt = new Date(Date.now() - 3 * HOUR).toISOString();

      await clockIn(mockReq, mockRes);

      expect(createArgs().data.location.offline.bankHoursDeferred).toBe(true);
    });
  });

  describe('clock-out', () => {
    const openEntry = (clockInAt) => ({
      id: 'entry-1',
      userId: 'user-123',
      clockIn: clockInAt,
      clockOut: null,
      notes: null,
      location: null,
      breakMinutes: 0,
      breakStartedAt: null,
      breaks: [],
    });

    it('computes worked minutes from the real punch interval, not the sync time', async () => {
      // Entrou 12h atrás, saiu 4h atrás, sincronizou agora: 8h trabalhadas.
      const occurredAt = new Date(Date.now() - 4 * HOUR);
      stubTimeEntryFindFirst(mockPrisma, { open: openEntry(new Date(Date.now() - 12 * HOUR)) });
      mockReq.body.occurredAt = occurredAt.toISOString();

      await clockOut(mockReq, mockRes);

      expect(mockPrisma.timeEntry.update).toHaveBeenCalled();
      const { data } = updateArgs();
      expect(data.clockOut.getTime()).toBe(occurredAt.getTime());
      // 8h e não 12h — 12h seria a hora da sincronização.
      expect(data.workedMinutes).toBe(480);
      expect(data.overtimeMinutes).toBe(0);
      expect(data.location.offline.event).toBe('clockOut');
      expect(data.location.offline.occurredAt).toBe(occurredAt.toISOString());
    });

    it('keeps the offline evidence of the clock-in when both punches came from the queue', async () => {
      const entry = openEntry(new Date(Date.now() - 12 * HOUR));
      entry.location = {
        clockIn: null,
        clockOut: null,
        geofence: { clockIn: null, clockOut: null },
        offline: { event: 'clockIn', occurredAt: '2026-08-28T08:00:00.000Z', syncedAt: '2026-08-28T12:00:00.000Z', skewMs: 4 * HOUR },
      };
      stubTimeEntryFindFirst(mockPrisma, { open: entry });
      mockReq.body.occurredAt = new Date(Date.now() - 4 * HOUR).toISOString();

      await clockOut(mockReq, mockRes);

      expect(updateArgs().data.location.offline.clockIn.event).toBe('clockIn');
    });

    it('returns 400 INVALID_OCCURRED_AT for an occurredAt older than 48h', async () => {
      stubTimeEntryFindFirst(mockPrisma, { open: openEntry(new Date(Date.now() - 72 * HOUR)) });
      mockReq.body.occurredAt = new Date(Date.now() - 49 * HOUR).toISOString();

      await clockOut(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_OCCURRED_AT' })
      );
      expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
    });

    it('still uses the server clock when occurredAt is absent', async () => {
      stubTimeEntryFindFirst(mockPrisma, { open: openEntry(new Date(Date.now() - 8 * HOUR)) });
      const before = Date.now();

      await clockOut(mockReq, mockRes);

      const { data } = updateArgs();
      expect(data.clockOut.getTime()).toBeGreaterThanOrEqual(before);
      expect(data.clockOut.getTime()).toBeLessThanOrEqual(Date.now());
      expect(data.location.offline).toBeUndefined();
    });

    it('marks the offline clock-out so bank hours stay deferred until approval', async () => {
      stubTimeEntryFindFirst(mockPrisma, { open: openEntry(new Date(Date.now() - 12 * HOUR)) });
      mockReq.body.occurredAt = new Date(Date.now() - 4 * HOUR).toISOString();

      await clockOut(mockReq, mockRes);

      expect(updateArgs().data.location.offline.bankHoursDeferred).toBe(true);
    });

    // O guard de ordem olha só o clockIn. Uma saída posterior ao clockIn mas
    // anterior à pausa grava breaks: [{ start, end }] com end < start —
    // intervalo impossível, para sempre, numa coluna de auditoria de folha —
    // enquanto resolveBreakMinutes clampa o delta negativo em 0 e a pausa
    // silenciosamente deixa de ser descontada.
    describe('pausa em aberto', () => {
      it('rejects an occurredAt before the open break start', async () => {
        const entry = openEntry(new Date(Date.now() - 6 * HOUR));
        entry.breakStartedAt = new Date(Date.now() - HOUR);
        stubTimeEntryFindFirst(mockPrisma, { open: entry });
        mockReq.body.occurredAt = new Date(Date.now() - 3 * HOUR).toISOString();

        await clockOut(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'OCCURRED_AT_BEFORE_BREAK' })
        );
        expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
        expect(accrueBankHours).not.toHaveBeenCalled();
      });

      it('rejects an occurredAt before the end of an already closed break', async () => {
        const entry = openEntry(new Date(Date.now() - 6 * HOUR));
        entry.breaks = [
          { start: new Date(Date.now() - 5 * HOUR), end: new Date(Date.now() - 4 * HOUR) },
          { start: new Date(Date.now() - 3 * HOUR), end: new Date(Date.now() - 2 * HOUR) },
        ];
        stubTimeEntryFindFirst(mockPrisma, { open: entry });
        mockReq.body.occurredAt = new Date(Date.now() - 3.5 * HOUR).toISOString();

        await clockOut(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'OCCURRED_AT_BEFORE_BREAK' })
        );
        expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
      });

      it('accepts an occurredAt after the break and closes it with a positive interval', async () => {
        const breakStartedAt = new Date(Date.now() - 3 * HOUR);
        const occurredAt = new Date(Date.now() - HOUR);
        const entry = openEntry(new Date(Date.now() - 6 * HOUR));
        entry.breakStartedAt = breakStartedAt;
        stubTimeEntryFindFirst(mockPrisma, { open: entry });
        mockReq.body.occurredAt = occurredAt.toISOString();

        await clockOut(mockReq, mockRes);

        const [closedBreak] = updateArgs().data.breaks;
        expect(new Date(closedBreak.end).getTime()).toBeGreaterThan(
          new Date(closedBreak.start).getTime()
        );
        // 5h de janela menos 2h de pausa.
        expect(updateArgs().data.workedMinutes).toBe(180);
      });
    });

    describe('sobreposição com registro posterior', () => {
      it('rejects an offline clock-out that runs over a later entry with 409', async () => {
        const laterEntry = {
          id: 'entry-2',
          userId: 'user-123',
          clockIn: new Date(Date.now() - 3 * HOUR),
          clockOut: new Date(Date.now() - HOUR),
        };
        stubTimeEntryFindFirst(mockPrisma, {
          open: openEntry(new Date(Date.now() - 10 * HOUR)),
          others: [laterEntry],
        });
        mockReq.body.occurredAt = new Date(Date.now() - 2 * HOUR).toISOString();

        await clockOut(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(409);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'PUNCH_OVERLAPS_EXISTING_ENTRY' })
        );
        expect(mockPrisma.timeEntry.update).not.toHaveBeenCalled();
        expect(accrueBankHours).not.toHaveBeenCalled();
      });

      it('accepts an offline clock-out that stops before the later entry starts', async () => {
        const laterEntry = {
          id: 'entry-2',
          userId: 'user-123',
          clockIn: new Date(Date.now() - 3 * HOUR),
          clockOut: new Date(Date.now() - HOUR),
        };
        stubTimeEntryFindFirst(mockPrisma, {
          open: openEntry(new Date(Date.now() - 10 * HOUR)),
          others: [laterEntry],
        });
        mockReq.body.occurredAt = new Date(Date.now() - 4 * HOUR).toISOString();

        await clockOut(mockReq, mockRes);

        expect(mockPrisma.timeEntry.update).toHaveBeenCalled();
        expect(updateArgs().data.workedMinutes).toBe(360);
      });
    });

    // A hora extra 50/100 depende do que já foi trabalhado no dia, e o dia é
    // recortado a partir do clock-out. Todo teste offline stubava findMany como
    // [] e nunca exercitava esse recorte.
    describe('recorte do dia', () => {
      const findManyArgs = () => mockPrisma.timeEntry.findMany.mock.calls[0][0];

      it('scopes prior worked minutes to the clock-out day and before the open entry', async () => {
        const clockInAt = new Date(Date.now() - 5 * HOUR);
        const occurredAt = new Date(Date.now() - HOUR);
        stubTimeEntryFindFirst(mockPrisma, { open: openEntry(clockInAt) });
        mockPrisma.timeEntry.findMany.mockResolvedValue([
          { clockIn: new Date(Date.now() - 12 * HOUR), clockOut: new Date(Date.now() - 6 * HOUR), workedMinutes: 360 },
        ]);
        mockReq.body.occurredAt = occurredAt.toISOString();

        await clockOut(mockReq, mockRes);

        const { where } = findManyArgs();
        expect(where.userId).toBe('user-123');
        expect(where.clockIn.lt).toEqual(clockInAt);
        expect(where.clockOut).toEqual({ not: null });

        // 6h já trabalhadas + 4h agora: 2h dentro da jornada de 8h e 2h de HE.
        expect(updateArgs().data.workedMinutes).toBe(240);
        expect(updateArgs().data.overtimeMinutes).toBe(120);
        expect(updateArgs().data.overtimeStatus).toBe('PENDING');
      });

      it('handles a shift that spans midnight without borrowing the previous day', async () => {
        // Turno entra 22h e sai 6h do dia seguinte. O recorte sai do clock-out,
        // então o registro da véspera fica fora e a jornada recomeça do zero —
        // 8h contínuas viram jornada cheia, sem hora extra.
        const clockInAt = new Date(Date.now() - 8 * HOUR);
        const occurredAt = new Date(Date.now() - 30 * 60 * 1000);
        stubTimeEntryFindFirst(mockPrisma, { open: openEntry(clockInAt) });
        mockPrisma.timeEntry.findMany.mockResolvedValue([]);
        mockReq.body.occurredAt = occurredAt.toISOString();

        await clockOut(mockReq, mockRes);

        const { where } = findManyArgs();
        // A janela do dia é a do clock-out, não a do clock-in.
        expect(where.clockIn.gte.getTime()).toBeLessThanOrEqual(occurredAt.getTime());
        expect(where.clockIn.lte.getTime()).toBeGreaterThanOrEqual(occurredAt.getTime());

        expect(updateArgs().data.workedMinutes).toBe(450);
        expect(updateArgs().data.overtimeMinutes).toBe(0);
      });
    });
  });
});
