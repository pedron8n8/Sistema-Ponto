const { Worker, Queue } = require('bullmq');
const prisma = require('../config/database');
const redis = require('../config/redis');
const fs = require('fs');
const path = require('path');

// Fila de exportação de relatórios
const reportQueue = new Queue('report-export', {
  connection: redis,
});

// Diretório para armazenar os relatórios gerados
const REPORTS_DIR = path.join(__dirname, '../../exports');

// Garante que o diretório de exports existe
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/**
 * Gera CSV de registros de ponto
 */
const generateTimeEntriesCSV = async (filters) => {
  const { userId, teamId, startDate, endDate, status, supervisorId } = filters;

  // Construir filtro dinâmico
  const where = {};

  if (userId) {
    where.userId = userId;
  } else if (teamId) {
    // Busca membros da equipe de um supervisor específico
    const teamMembers = await prisma.user.findMany({
      where: { supervisorId: teamId },
      select: { id: true },
    });
    where.userId = { in: teamMembers.map((m) => m.id) };
  } else if (supervisorId) {
    // Busca subordinados do supervisor que solicitou
    const subordinates = await prisma.user.findMany({
      where: { supervisorId },
      select: { id: true },
    });
    where.userId = { in: subordinates.map((s) => s.id) };
  }

  if (status && status !== 'ALL') {
    where.status = status;
  }

  if (startDate || endDate) {
    where.clockIn = {};
    if (startDate) {
      where.clockIn.gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.clockIn.lte = end;
    }
  }

  // Busca os registros
  const entries = await prisma.timeEntry.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          supervisor: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      logs: {
        orderBy: { timestamp: 'desc' },
        take: 1,
        include: {
          reviewer: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: [{ clockIn: 'desc' }],
  });

  // Cabeçalho do CSV
  const headers = [
    'ID',
    'Colaborador',
    'Email',
    'Supervisor',
    'Data Entrada',
    'Hora Entrada',
    'Data Saída',
    'Hora Saída',
    'Duração (horas)',
    'Duração (minutos)',
    'Status',
    'Notas',
    'IP',
    'Dispositivo',
    'Última Ação',
    'Revisor',
  ];

  // Converter para linhas CSV
  const rows = entries.map((entry) => {
    // Calcular duração
    let durationHours = '';
    let durationMinutes = '';
    if (entry.clockIn && entry.clockOut) {
      const diff = new Date(entry.clockOut) - new Date(entry.clockIn);
      const totalMinutes = Math.floor(diff / 60000);
      durationHours = (totalMinutes / 60).toFixed(2);
      durationMinutes = totalMinutes;
    }

    const clockInDate = entry.clockIn ? new Date(entry.clockIn) : null;
    const clockOutDate = entry.clockOut ? new Date(entry.clockOut) : null;

    const lastLog = entry.logs[0];

    return [
      entry.id,
      entry.user.name || entry.user.email,
      entry.user.email,
      entry.user.supervisor?.name || 'N/A',
      clockInDate ? clockInDate.toLocaleDateString('pt-BR') : '',
      clockInDate ? clockInDate.toLocaleTimeString('pt-BR') : '',
      clockOutDate ? clockOutDate.toLocaleDateString('pt-BR') : '',
      clockOutDate ? clockOutDate.toLocaleTimeString('pt-BR') : '',
      durationHours,
      durationMinutes,
      translateStatus(entry.status),
      escapeCSV(entry.notes || ''),
      entry.ipAddress || '',
      escapeCSV(entry.device || ''),
      lastLog ? translateAction(lastLog.action) : '',
      lastLog?.reviewer?.name || '',
    ];
  });

  // Montar CSV
  const csvContent = [headers.join(';'), ...rows.map((row) => row.join(';'))].join('\n');

  return {
    content: csvContent,
    totalRecords: entries.length,
  };
};

/**
 * Traduz status para português
 */
const translateStatus = (status) => {
  const translations = {
    PENDING: 'Pendente',
    APPROVED: 'Aprovado',
    REJECTED: 'Rejeitado',
  };
  return translations[status] || status;
};

/**
 * Traduz ação para português
 */
const translateAction = (action) => {
  const translations = {
    APPROVED: 'Aprovado',
    REJECTED: 'Rejeitado',
    EDIT_REQUESTED: 'Edição Solicitada',
  };
  return translations[action] || action;
};

/**
 * Escapa valores para CSV
 */
const escapeCSV = (value) => {
  if (!value) return '';
  const str = String(value);
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * Worker para processar jobs de exportação
 */
const createReportWorker = () => {
  const worker = new Worker(
    'report-export',
    async (job) => {
      console.log(`📊 Processando job de relatório: ${job.id}`);

      const { filters, requestedBy, format = 'csv' } = job.data;

      try {
        // Atualiza progresso
        await job.updateProgress(10);

        // Gera o CSV
        const { content, totalRecords } = await generateTimeEntriesCSV({
          ...filters,
          supervisorId: requestedBy.role === 'SUPERVISOR' ? requestedBy.id : null,
        });

        await job.updateProgress(70);

        // Gera nome único para o arquivo
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `relatorio_ponto_${timestamp}.csv`;
        const filepath = path.join(REPORTS_DIR, filename);

        // Salva o arquivo
        fs.writeFileSync(filepath, '\ufeff' + content, 'utf8'); // BOM para Excel

        await job.updateProgress(90);

        console.log(`✅ Relatório gerado: ${filename} (${totalRecords} registros)`);

        await job.updateProgress(100);

        return {
          success: true,
          filename,
          filepath,
          totalRecords,
          generatedAt: new Date().toISOString(),
          downloadUrl: `/api/v1/reports/download/${filename}`,
        };
      } catch (error) {
        console.error(`❌ Erro ao gerar relatório:`, error);
        throw error;
      }
    },
    {
      connection: redis,
      concurrency: 2, // Processa até 2 jobs simultaneamente
    }
  );

  worker.on('completed', (job, result) => {
    console.log(`✅ Job ${job.id} completado:`, result.filename);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job.id} falhou:`, err.message);
  });

  worker.on('progress', (job, progress) => {
    console.log(`📈 Job ${job.id} progresso: ${progress}%`);
  });

  return worker;
};

module.exports = {
  reportQueue,
  createReportWorker,
  generateTimeEntriesCSV,
  REPORTS_DIR,
};
