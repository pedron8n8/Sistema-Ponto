// Testes unitários para report.controller.js

const mockPrisma = require('../mocks/prisma.mock');
const { mockSupabaseAdmin } = require('../mocks/supabase.mock');

// Mock da fila BullMQ
const mockReportQueue = {
  add: jest.fn(),
  getJob: jest.fn(),
};

jest.mock('../../src/config/database', () => mockPrisma);
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));
jest.mock('../../src/workers/reportWorker', () => ({
  reportQueue: mockReportQueue,
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
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
    };
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
        progress: jest.fn().mockReturnValue(100),
        returnvalue: { filePath: '/exports/report.csv' },
        failedReason: null,
      });

      await reportController.getJobStatus(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-123',
          status: 'completed',
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
        progress: jest.fn().mockReturnValue(50),
        returnvalue: null,
        failedReason: 'Database connection error',
      });

      await reportController.getJobStatus(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          failedReason: 'Database connection error',
        })
      );
    });
  });

  describe('downloadReport', () => {
    it('deve fazer download do arquivo quando existe', async () => {
      req.params.filename = 'report-123.csv';
      fs.existsSync.mockReturnValue(true);

      await reportController.downloadReport(req, res);

      expect(res.download).toHaveBeenCalled();
    });

    it('deve retornar 404 quando arquivo não existe', async () => {
      req.params.filename = 'nonexistent.csv';
      fs.existsSync.mockReturnValue(false);

      await reportController.downloadReport(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Arquivo não encontrado',
        })
      );
    });

    it('deve prevenir path traversal', async () => {
      req.params.filename = '../../../etc/passwd';

      await reportController.downloadReport(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Nome de arquivo inválido',
        })
      );
    });

    it('deve rejeitar arquivos sem extensão csv', async () => {
      req.params.filename = 'malicious.exe';

      await reportController.downloadReport(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('listReports', () => {
    it('deve listar arquivos de relatório', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['report1.csv', 'report2.csv', 'other.txt']);
      fs.statSync.mockReturnValue({
        size: 1024,
        mtime: new Date('2024-01-15'),
        birthtime: new Date('2024-01-15'),
      });

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

    it('deve retornar lista vazia quando diretório não existe', async () => {
      fs.existsSync.mockReturnValue(false);

      await reportController.listReports(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          reports: [],
        })
      );
    });

    it('deve ordenar por data mais recente', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['old.csv', 'new.csv']);
      fs.statSync.mockImplementation((path) => ({
        size: 1024,
        mtime: path.includes('new') ? new Date('2024-01-20') : new Date('2024-01-10'),
        birthtime: path.includes('new') ? new Date('2024-01-20') : new Date('2024-01-10'),
      }));

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
          message: 'Relatório deletado com sucesso',
        })
      );
    });

    it('deve retornar 404 quando arquivo não existe', async () => {
      req.params.filename = 'nonexistent.csv';
      fs.existsSync.mockReturnValue(false);

      await reportController.deleteReport(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('deve prevenir path traversal na deleção', async () => {
      req.params.filename = '../../config.json';

      await reportController.deleteReport(req, res);

      expect(fs.unlinkSync).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
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
});
