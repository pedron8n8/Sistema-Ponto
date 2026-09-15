// Testes unitários para report.controller.js

const mockPrisma = require('../mocks/prisma.mock');
const { mockSupabaseAdmin } = require('../mocks/supabase.mock');

// Mock da fila BullMQ
const mockReportQueue = {
  add: jest.fn(),
  getJob: jest.fn(),
  getCompleted: jest.fn(),
};

jest.mock('../../src/config/database', () => ({
  ...mockPrisma,
  prisma: mockPrisma,
}));
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));
jest.mock('../../src/workers/reportWorker', () => ({
  reportQueue: mockReportQueue,
  REPORTS_DIR: '/tmp/exports',
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  createReadStream: jest.fn(),
}));

const fs = require('fs');
const reportController = require('../../src/controllers/report.controller');

describe('Report Controller', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      user: { id: 'admin-123', role: 'ADMIN' },
      body: {},
      params: {},
      query: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      download: jest.fn(),
      setHeader: jest.fn(),
    };

    // O escopo do extrato agora é resolvido no servidor (utils/visibleUsers.js) e consulta
    // o banco. Sem este default a resolução recebe undefined e o export devolve 500.
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-123', isActive: true }]);
  });

  describe('createExportJob', () => {
    it('deve criar um job de exportação com sucesso', async () => {
      req.body = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        status: 'APPROVED',
      };

      mockReportQueue.add.mockResolvedValue({
        id: 'job-123',
        opts: {},
      });

      await reportController.createExportJob(req, res);

      expect(mockReportQueue.add).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('deve usar filtros padrão quando não fornecidos', async () => {
      req.body = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      mockReportQueue.add.mockResolvedValue({ id: 'job-456' });

      await reportController.createExportJob(req, res);

      expect(mockReportQueue.add).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('deve retornar erro quando a fila falha', async () => {
      req.body = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      mockReportQueue.add.mockRejectedValue(new Error('Queue error'));

      await reportController.createExportJob(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getJobStatus', () => {
    it('deve retornar status do job quando encontrado', async () => {
      req.params.jobId = 'job-123';

      mockReportQueue.getJob.mockResolvedValue({
        id: 'job-123',
        getState: jest.fn().mockResolvedValue('completed'),
        progress: 100,
        timestamp: Date.now(),
        returnvalue: {
          filename: 'report.csv',
          totalRecords: 10,
          generatedAt: new Date().toISOString(),
          downloadUrl: '/api/v1/reports/download/report.csv',
        },
        failedReason: null,
      });

      await reportController.getJobStatus(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-123',
          state: 'completed',
          progress: 100,
        })
      );
    });

    it('deve retornar 404 quando job não encontrado', async () => {
      req.params.jobId = 'job-nonexistent';
      mockReportQueue.getJob.mockResolvedValue(null);

      await reportController.getJobStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Job não encontrado',
        })
      );
    });

    it('deve retornar motivo de falha quando job falhou', async () => {
      req.params.jobId = 'job-failed';

      mockReportQueue.getJob.mockResolvedValue({
        id: 'job-failed',
        getState: jest.fn().mockResolvedValue('failed'),
        progress: 50,
        timestamp: Date.now(),
        returnvalue: null,
        failedReason: 'Database connection error',
      });

      await reportController.getJobStatus(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'failed',
          error: 'Database connection error',
        })
      );
    });
  });

  describe('downloadReport', () => {
    it('deve fazer download do arquivo quando existe', async () => {
      req.params.filename = 'report-123.csv';
      fs.existsSync.mockReturnValue(true);
      const pipe = jest.fn();
      fs.createReadStream.mockReturnValue({ pipe });

      await reportController.downloadReport(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(fs.createReadStream).toHaveBeenCalled();
      expect(pipe).toHaveBeenCalledWith(res);
    });

    it('deve retornar 404 quando arquivo não existe', async () => {
      req.params.filename = 'nonexistent.csv';
      fs.existsSync.mockReturnValue(false);

      await reportController.downloadReport(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Relatório não encontrado ou já expirado',
        })
      );
    });

    it('deve rejeitar path traversal sem extensão permitida', async () => {
      req.params.filename = '../../../etc/passwd';

      await reportController.downloadReport(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('deve rejeitar arquivos sem extensão permitida', async () => {
      req.params.filename = 'malicious.exe';

      await reportController.downloadReport(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('listReports', () => {
    it('deve listar relatórios de jobs completados', async () => {
      mockReportQueue.getCompleted.mockResolvedValue([
        {
          id: 'job-1',
          returnvalue: {
            filename: 'report1.csv',
            totalRecords: 20,
            generatedAt: '2024-01-10T12:00:00.000Z',
            downloadUrl: '/api/v1/reports/download/report1.csv',
          },
          data: {
            requestedBy: { email: 'admin@empresa.com' },
            filters: { status: 'ALL' },
          },
        },
      ]);

      await reportController.listReports(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          reports: expect.arrayContaining([
            expect.objectContaining({
              filename: expect.stringContaining('.csv'),
            }),
          ]),
        })
      );
    });

    it('deve retornar lista vazia quando não há jobs completados', async () => {
      mockReportQueue.getCompleted.mockResolvedValue([]);

      await reportController.listReports(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          reports: [],
        })
      );
    });

    it('deve manter ordem retornada pela fila de jobs', async () => {
      mockReportQueue.getCompleted.mockResolvedValue([
        {
          id: 'job-new',
          returnvalue: {
            filename: 'new.csv',
            totalRecords: 2,
            generatedAt: '2024-01-20T12:00:00.000Z',
            downloadUrl: '/api/v1/reports/download/new.csv',
          },
          data: { requestedBy: { email: 'a@a.com' }, filters: {} },
        },
        {
          id: 'job-old',
          returnvalue: {
            filename: 'old.csv',
            totalRecords: 2,
            generatedAt: '2024-01-10T12:00:00.000Z',
            downloadUrl: '/api/v1/reports/download/old.csv',
          },
          data: { requestedBy: { email: 'b@b.com' }, filters: {} },
        },
      ]);

      await reportController.listReports(req, res);

      const reports = res.json.mock.calls[0][0].reports;
      expect(reports[0].filename).toBe('new.csv');
    });
  });

  describe('deleteReport', () => {
    it('deve deletar arquivo com sucesso', async () => {
      req.params.filename = 'report-123.csv';
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockReturnValue(undefined);

      await reportController.deleteReport(req, res);

      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Relatório removido com sucesso',
        })
      );
    });

    it('deve retornar 404 quando arquivo não existe', async () => {
      req.params.filename = 'nonexistent.csv';
      fs.existsSync.mockReturnValue(false);

      await reportController.deleteReport(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('deve sanitizar path traversal na deleção', async () => {
      req.params.filename = '../../config.json';
      fs.existsSync.mockReturnValue(false);

      await reportController.deleteReport(req, res);

      expect(fs.unlinkSync).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('deve retornar erro quando falha ao deletar', async () => {
      req.params.filename = 'report.csv';
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await reportController.deleteReport(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getDailyBreakdown', () => {
    it('deve consultar o dia no fuso horario informado', async () => {
      req.user = { id: 'admin-123', role: 'ADMIN', timeZone: 'UTC' };
      req.query = {
        date: '2026-05-08',
        timeZone: 'America/Sao_Paulo',
      };

      mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-123' }]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);

      await reportController.getDailyBreakdown(req, res);

      expect(mockPrisma.timeEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clockIn: {
              gte: new Date('2026-05-08T03:00:00.000Z'),
              lt: new Date('2026-05-09T03:00:00.000Z'),
            },
          }),
        })
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-05-08',
          timeZone: 'America/Sao_Paulo',
        })
      );
    });

    it('calcula regularCost/overtime50Cost/overtime100Cost/totalCost por linha e no summary', async () => {
      req.user = { id: 'admin-123', role: 'ADMIN', timeZone: 'UTC' };
      req.query = { date: '2026-05-08' };

      mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-123' }]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        {
          id: 'entry-a',
          userId: 'user-a',
          clockIn: new Date('2026-05-08T13:00:00Z'),
          clockOut: new Date('2026-05-08T21:00:00Z'),
          workedMinutes: 480,
          overtimeMinutes50: 0,
          overtimeMinutes100: 0,
          overtimeStatus: null,
          bankHoursAccruedMinutes: 0,
          user: { id: 'user-a', name: 'Ana', email: 'ana@test.com', hourlyRate: 20, timeZone: 'UTC' },
        },
      ]);

      await reportController.getDailyBreakdown(req, res);

      const payload = res.json.mock.calls[0][0];
      expect(payload.rows).toHaveLength(1);
      // 480min a $20/h, sem HE: 8h * 20 = 160
      expect(payload.rows[0]).toEqual(
        expect.objectContaining({
          regularCost: 160,
          overtime50Cost: 0,
          overtime100Cost: 0,
          totalCost: 160,
          pendingOvertimeMinutes: 0,
          pendingOvertimeCost: 0,
          settledCost: 160,
        })
      );
      expect(payload.summary).toEqual(
        expect.objectContaining({
          totalCost: 160,
          pendingOvertimeMinutes: 0,
          pendingOvertimeCost: 0,
          settledCost: 160,
        })
      );
    });

    it('soma os valores RAW por usuario e arredonda uma unica vez, sem acumular centavos por entry', async () => {
      // $8/h e 130min por entry: (130/60)*8 = 17.3333... , que arredondado sozinho
      // vira 17.33. Três entries desse usuário no mesmo dia, se cada uma fosse
      // arredondada ANTES de somar, dariam 3 * 17.33 = 51.99. Somando os valores RAW
      // e arredondando uma única vez no final, o resultado exato é 390/60*8 = 52.00.
      // As duas contas dão respostas diferentes de propósito — é essa divergência
      // que o teste prova que não acontece.
      // (Antes desta mudança este teste usava 3 entries de 400min = 1200min no dia;
      // com o teto de contrato por dia agora em vigor, 1200min > 480min de contrato
      // padrão faria o teto — não o arredondamento — dominar o resultado. Trocado
      // para 130min * 3 = 390min, abaixo do contrato, para continuar testando SÓ o
      // arredondamento, sem o teto interferir.)
      req.user = { id: 'admin-123', role: 'ADMIN', timeZone: 'UTC' };
      req.query = { date: '2026-05-08' };

      const makeEntry = (id) => ({
        id,
        userId: 'user-cents',
        clockIn: new Date('2026-05-08T13:00:00Z'),
        clockOut: new Date('2026-05-08T15:10:00Z'),
        workedMinutes: 130,
        overtimeMinutes50: 0,
        overtimeMinutes100: 0,
        overtimeStatus: null,
        bankHoursAccruedMinutes: 0,
        user: { id: 'user-cents', name: 'Cents', email: 'cents@test.com', hourlyRate: 8, timeZone: 'UTC' },
      });

      mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-123' }]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        makeEntry('entry-1'),
        makeEntry('entry-2'),
        makeEntry('entry-3'),
      ]);

      await reportController.getDailyBreakdown(req, res);

      const payload = res.json.mock.calls[0][0];
      const row = payload.rows.find((r) => r.user.id === 'user-cents');

      // Soma dos RAW arredondada uma vez: 52.00. NÃO 51.99 (soma dos já arredondados).
      expect(row.regularCost).toBe(52);
      expect(row.totalCost).toBe(52);
      expect(row.settledCost).toBe(52);
      expect(payload.summary.totalCost).toBe(52);

      // Cada linha individual de entries[] continua arredondada por entry (17.33),
      // exatamente como antes — só a soma por usuário muda de estratégia.
      expect(row.entries.map((e) => e.totalCost)).toEqual([17.33, 17.33, 17.33]);
    });

    it('reconcilia totalCost = settledCost + pendingOvertimeCost com HE aprovada, pendente e sem HE', async () => {
      req.user = { id: 'admin-123', role: 'ADMIN', timeZone: 'UTC' };
      req.query = { date: '2026-05-08' };

      mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-123' }]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        // Sem HE: 480min a $20/h => 160, nada pendente.
        {
          id: 'entry-plain',
          userId: 'user-plain',
          clockIn: new Date('2026-05-08T13:00:00Z'),
          clockOut: new Date('2026-05-08T21:00:00Z'),
          workedMinutes: 480,
          overtimeMinutes50: 0,
          overtimeMinutes100: 0,
          overtimeStatus: null,
          bankHoursAccruedMinutes: 0,
          user: { id: 'user-plain', name: 'Plain', email: 'plain@test.com', hourlyRate: 20, timeZone: 'UTC' },
        },
        // HE aprovada: 240min normais + 60 HE50 + 60 HE100, $10/h, tudo a 1x (adicionais em standby) => 40+10+10 = 60, tudo já pagável.
        {
          id: 'entry-approved',
          userId: 'user-approved',
          clockIn: new Date('2026-05-08T13:00:00Z'),
          clockOut: new Date('2026-05-08T19:00:00Z'),
          workedMinutes: 360,
          overtimeMinutes50: 60,
          overtimeMinutes100: 60,
          overtimeStatus: 'APPROVED',
          bankHoursAccruedMinutes: 0,
          user: { id: 'user-approved', name: 'Approved', email: 'approved@test.com', hourlyRate: 10, timeZone: 'UTC' },
        },
        // Mesma jornada, mas HE ainda pendente de decisão: mesmo total de custo (60, pior
        // caso), porém só 40 já são pagáveis — os outros 20 (10+10 da HE) ficam
        // pendentes. É EXATAMENTE o mesmo cenário e os mesmos números do teste
        // "não paga adicional de HE ainda pendente de decisão" em reportWorker.test.js,
        // que fixa o "Approved Payment" do export em 40 para este entry.
        {
          id: 'entry-pending',
          userId: 'user-pending',
          clockIn: new Date('2026-05-08T13:00:00Z'),
          clockOut: new Date('2026-05-08T19:00:00Z'),
          workedMinutes: 360,
          overtimeMinutes50: 60,
          overtimeMinutes100: 60,
          overtimeStatus: 'PENDING',
          bankHoursAccruedMinutes: 0,
          user: { id: 'user-pending', name: 'Pending', email: 'pending@test.com', hourlyRate: 10, timeZone: 'UTC' },
        },
      ]);

      await reportController.getDailyBreakdown(req, res);

      const payload = res.json.mock.calls[0][0];
      const rowByUser = Object.fromEntries(payload.rows.map((row) => [row.user.id, row]));

      const plain = rowByUser['user-plain'];
      expect(plain.totalCost).toBe(160);
      expect(plain.pendingOvertimeCost).toBe(0);
      expect(plain.settledCost).toBe(160);
      expect(plain.totalCost).toBe(plain.settledCost + plain.pendingOvertimeCost);

      const approved = rowByUser['user-approved'];
      expect(approved.totalCost).toBe(60);
      expect(approved.pendingOvertimeCost).toBe(0);
      expect(approved.settledCost).toBe(60);
      expect(approved.totalCost).toBe(approved.settledCost + approved.pendingOvertimeCost);

      const pending = rowByUser['user-pending'];
      expect(pending.totalCost).toBe(60);
      expect(pending.pendingOvertimeMinutes).toBe(120);
      expect(pending.pendingOvertimeCost).toBe(20);
      // O que sobra pagável agora (40) é exatamente o que o export (reportWorker,
      // política resolveSettledOvertime) pagaria para o mesmo entry — prova que as
      // duas telas reconciliam por construção, não por coincidência de arredondamento.
      expect(pending.settledCost).toBe(40);
      expect(pending.totalCost).toBe(pending.settledCost + pending.pendingOvertimeCost);

      // Também vale agregado, no summary.
      expect(payload.summary.totalCost).toBe(280);
      expect(payload.summary.pendingOvertimeMinutes).toBe(120);
      expect(payload.summary.pendingOvertimeCost).toBe(20);
      expect(payload.summary.settledCost).toBe(260);
      expect(payload.summary.totalCost).toBe(payload.summary.settledCost + payload.summary.pendingOvertimeCost);
    });

    // Tabela de verificação do brief: contrato 480min (padrão, sem contractDailyMinutes
    // no usuário), R$30/h. Cada caso isolado num usuário próprio para não interagir
    // com o teto dos outros.
    const makeRowEntry = ({ userId, workedMinutes, overtimeMinutes50 = 0, overtimeMinutes100 = 0, overtimeStatus = null }) => ({
      id: `entry-${userId}`,
      userId,
      clockIn: new Date('2026-05-08T13:00:00Z'),
      clockOut: new Date('2026-05-08T21:00:00Z'),
      workedMinutes,
      overtimeMinutes50,
      overtimeMinutes100,
      overtimeStatus,
      bankHoursAccruedMinutes: 0,
      user: { id: userId, name: userId, email: `${userId}@test.com`, hourlyRate: 30, timeZone: 'UTC' },
    });

    it('linha 1: worked 490, tolerância engoliu o excesso (OT 0) -> paga 240, não 245', async () => {
      req.user = { id: 'admin-123', role: 'ADMIN', timeZone: 'UTC' };
      req.query = { date: '2026-05-08' };
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-123' }]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        makeRowEntry({ userId: 'row1', workedMinutes: 490 }),
      ]);

      await reportController.getDailyBreakdown(req, res);

      const row = res.json.mock.calls[0][0].rows[0];
      expect(row.regularCost).toBe(240);
      expect(row.totalCost).toBe(240);
      expect(row.settledCost).toBe(240);
      // O drill-down (entries[]) tem que bater com a linha: antes desta rodada
      // do fix, entries[0].totalCost ficava em 245 (valor pré-teto, sem cap)
      // enquanto row.totalCost já mostrava 240 — a mesma divergência de "duas
      // respostas no mesmo documento" que existia entre as abas do export.
      expect(row.entries).toHaveLength(1);
      expect(row.entries[0].totalCost).toBe(240);
    });

    it('linha 2: worked 495, mesma tolerância -> paga 240, não 247.50', async () => {
      req.user = { id: 'admin-123', role: 'ADMIN', timeZone: 'UTC' };
      req.query = { date: '2026-05-08' };
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-123' }]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        makeRowEntry({ userId: 'row2', workedMinutes: 495 }),
      ]);

      await reportController.getDailyBreakdown(req, res);

      const row = res.json.mock.calls[0][0].rows[0];
      expect(row.totalCost).toBe(240);
    });

    it('linha 3: worked 540, HE 60min APROVADA -> inalterado (270, HE a 1x)', async () => {
      req.user = { id: 'admin-123', role: 'ADMIN', timeZone: 'UTC' };
      req.query = { date: '2026-05-08' };
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-123' }]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        makeRowEntry({ userId: 'row3', workedMinutes: 540, overtimeMinutes50: 60, overtimeStatus: 'APPROVED' }),
      ]);

      await reportController.getDailyBreakdown(req, res);

      const row = res.json.mock.calls[0][0].rows[0];
      expect(row.totalCost).toBe(270);
      expect(row.settledCost).toBe(270);
      expect(row.pendingOvertimeCost).toBe(0);
    });

    it('linha 4: worked 540, HE 60min NEGADA (colunas zeradas) -> não volta como hora normal (240, não 270)', async () => {
      req.user = { id: 'admin-123', role: 'ADMIN', timeZone: 'UTC' };
      req.query = { date: '2026-05-08' };
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-123' }]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        // rejectOvertime zera overtimeMinutes50/100 e marca overtimeStatus REJECTED.
        makeRowEntry({ userId: 'row4', workedMinutes: 540, overtimeMinutes50: 0, overtimeStatus: 'REJECTED' }),
      ]);

      await reportController.getDailyBreakdown(req, res);

      const row = res.json.mock.calls[0][0].rows[0];
      expect(row.totalCost).toBe(240);
      expect(row.settledCost).toBe(240);
      expect(row.pendingOvertimeCost).toBe(0);
      // Drill-down bate com a linha: a HE negada não reaparece como custo extra
      // no entry isolado (270 seria o valor pré-teto errado).
      expect(row.entries[0].totalCost).toBe(240);
    });

    it('teto por dia, não por entry: dois entries de 300 e 240min pagam min(540,480), não 300+240', async () => {
      req.user = { id: 'admin-123', role: 'ADMIN', timeZone: 'UTC' };
      req.query = { date: '2026-05-08' };
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-123' }]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        { ...makeRowEntry({ userId: 'split', workedMinutes: 300 }), id: 'entry-split-1' },
        { ...makeRowEntry({ userId: 'split', workedMinutes: 240 }), id: 'entry-split-2' },
      ]);

      await reportController.getDailyBreakdown(req, res);

      const row = res.json.mock.calls[0][0].rows[0];
      // min(540, 480) = 480min a R$30/h = 240, não 300+240=540min (270).
      expect(row.workedMinutes).toBe(540);
      expect(row.totalCost).toBe(240);
      expect(row.settledCost).toBe(240);
      // Drill-down: o enchimento cronológico dá 150 ao primeiro entry (300min,
      // dentro do teto) e 90 ao segundo (180min de sobra no teto, não os 240
      // inteiros) — soma exatamente aos 240 da linha, nunca 300+240=540min de
      // custo (270).
      expect(row.entries.map((e) => e.totalCost)).toEqual([150, 90]);
      expect(row.entries.reduce((sum, e) => sum + e.totalCost, 0)).toBe(row.totalCost);
    });

    it('dia abaixo do contrato fica inalterado: 400 trabalhado paga 400min (200)', async () => {
      req.user = { id: 'admin-123', role: 'ADMIN', timeZone: 'UTC' };
      req.query = { date: '2026-05-08' };
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-123' }]);
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        makeRowEntry({ userId: 'below', workedMinutes: 400 }),
      ]);

      await reportController.getDailyBreakdown(req, res);

      const row = res.json.mock.calls[0][0].rows[0];
      expect(row.totalCost).toBe(200);
      expect(row.settledCost).toBe(200);
    });
  });
});
