const { reportQueue, REPORTS_DIR } = require('../workers/reportWorker');
const fs = require('fs');
const path = require('path');

/**
 * Controller para geração de relatórios
 */

/**
 * POST /reports/export
 * Cria um job de exportação na fila
 */
const createExportJob = async (req, res) => {
  try {
    const user = req.user;
    const { startDate, endDate, status, userId, teamId, format = 'csv' } = req.body;

    // Validação de datas
    if (!startDate || !endDate) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Data inicial e final são obrigatórias',
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Formato de data inválido. Use YYYY-MM-DD',
      });
    }

    if (start > end) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Data inicial não pode ser maior que data final',
      });
    }

    // Limite de 90 dias por exportação
    const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (diffDays > 90) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Período máximo de exportação é 90 dias',
      });
    }

    // Supervisor só pode exportar dados de seus subordinados
    if (user.role === 'SUPERVISOR' && userId) {
      const prisma = require('../config/database');
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { supervisorId: true },
      });

      if (!targetUser || targetUser.supervisorId !== user.id) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Você só pode exportar dados de seus subordinados',
        });
      }
    }

    // Member só pode exportar seus próprios dados
    if (user.role === 'MEMBER') {
      if (userId && userId !== user.id) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Você só pode exportar seus próprios dados',
        });
      }
    }

    // Cria o job na fila
    const job = await reportQueue.add(
      'export-time-entries',
      {
        filters: {
          startDate,
          endDate,
          status: status || 'ALL',
          userId: user.role === 'MEMBER' ? user.id : userId || null,
          teamId: teamId || null,
        },
        requestedBy: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        format,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          age: 24 * 3600, // Remove após 24 horas
          count: 100, // Mantém últimos 100
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Remove falhas após 7 dias
        },
      }
    );

    console.log(`📊 Job de exportação criado: ${job.id} por ${user.email}`);

    res.status(202).json({
      message: 'Exportação iniciada',
      jobId: job.id,
      status: 'processing',
      filters: {
        startDate,
        endDate,
        status: status || 'ALL',
      },
      checkStatusUrl: `/api/v1/reports/status/${job.id}`,
    });
  } catch (error) {
    console.error('❌ Erro ao criar job de exportação:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao iniciar exportação',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /reports/status/:jobId
 * Verifica o status de um job de exportação
 */
const getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await reportQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Job não encontrado',
      });
    }

    const state = await job.getState();
    const progress = job.progress;

    let response = {
      jobId: job.id,
      state,
      progress,
      createdAt: new Date(job.timestamp).toISOString(),
    };

    if (state === 'completed') {
      const result = job.returnvalue;
      response = {
        ...response,
        result: {
          filename: result.filename,
          totalRecords: result.totalRecords,
          generatedAt: result.generatedAt,
          downloadUrl: result.downloadUrl,
        },
      };
    } else if (state === 'failed') {
      response.error = job.failedReason;
    }

    res.json(response);
  } catch (error) {
    console.error('❌ Erro ao buscar status do job:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao verificar status',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /reports/download/:filename
 * Download de um relatório gerado
 */
const downloadReport = async (req, res) => {
  try {
    const { filename } = req.params;

    // Sanitiza o nome do arquivo para evitar path traversal
    const sanitizedFilename = path.basename(filename);
    const filepath = path.join(REPORTS_DIR, sanitizedFilename);

    // Verifica se o arquivo existe
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Relatório não encontrado ou já expirado',
      });
    }

    // Define headers para download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);

    // Envia o arquivo
    const fileStream = fs.createReadStream(filepath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('❌ Erro ao fazer download:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao baixar relatório',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /reports/list
 * Lista relatórios disponíveis (últimas 24h)
 */
const listReports = async (req, res) => {
  try {
    // Lista jobs completados
    const completedJobs = await reportQueue.getCompleted(0, 50);

    const reports = completedJobs
      .filter((job) => job.returnvalue)
      .map((job) => ({
        jobId: job.id,
        filename: job.returnvalue.filename,
        totalRecords: job.returnvalue.totalRecords,
        generatedAt: job.returnvalue.generatedAt,
        downloadUrl: job.returnvalue.downloadUrl,
        requestedBy: job.data.requestedBy.email,
        filters: job.data.filters,
      }));

    res.json({
      reports,
      total: reports.length,
    });
  } catch (error) {
    console.error('❌ Erro ao listar relatórios:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao listar relatórios',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * DELETE /reports/:filename
 * Remove um relatório específico (apenas ADMIN)
 */
const deleteReport = async (req, res) => {
  try {
    const { filename } = req.params;

    const sanitizedFilename = path.basename(filename);
    const filepath = path.join(REPORTS_DIR, sanitizedFilename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Relatório não encontrado',
      });
    }

    fs.unlinkSync(filepath);

    console.log(`🗑️ Relatório deletado: ${sanitizedFilename}`);

    res.json({
      message: 'Relatório removido com sucesso',
      filename: sanitizedFilename,
    });
  } catch (error) {
    console.error('❌ Erro ao deletar relatório:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao remover relatório',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

module.exports = {
  createExportJob,
  getJobStatus,
  downloadReport,
  listReports,
  deleteReport,
};
