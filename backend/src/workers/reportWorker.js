const { Worker, Queue } = require('bullmq');
const prisma = require('../config/database');
const redis = require('../config/redis');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

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

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const parseDateFilter = (value, endOfDay = false) => {
  if (!value) return null;

  if (typeof value === 'string' && DATE_ONLY_REGEX.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return endOfDay
      ? new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
      : new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getReportRows = async (filters) => {
  const { userId, teamId, startDate, endDate, status, supervisorId } = filters;

  // Construir filtro dinâmico
  const where = {};

  if (userId) {
    where.userId = userId;
  } else if (supervisorId) {
    // Supervisor sempre fica restrito aos próprios subordinados
    const subordinates = await prisma.user.findMany({
      where: { supervisorId },
      select: { id: true },
    });
    where.userId = { in: subordinates.map((s) => s.id) };
  } else if (teamId) {
    // Busca membros da equipe de um supervisor específico
    const teamMembers = await prisma.user.findMany({
      where: { supervisorId: teamId },
      select: { id: true },
    });
    where.userId = { in: teamMembers.map((m) => m.id) };
  }

  if (status && status !== 'ALL') {
    where.status = status;
  }

  if (startDate || endDate) {
    where.clockIn = {};
    if (startDate) {
      const parsedStartDate = parseDateFilter(startDate, false);
      if (parsedStartDate) {
        where.clockIn.gte = parsedStartDate;
      }
    }
    if (endDate) {
      const parsedEndDate = parseDateFilter(endDate, true);
      if (parsedEndDate) {
        where.clockIn.lte = parsedEndDate;
      }
    }

    if (!where.clockIn.gte && !where.clockIn.lte) {
      delete where.clockIn;
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

  // Cabeçalho do relatório
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

  // Converter para linhas do relatório
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
      entry.notes || '',
      entry.ipAddress || '',
      entry.device || '',
      lastLog ? translateAction(lastLog.action) : '',
      lastLog?.reviewer?.name || '',
    ];
  });

  return {
    headers,
    rows,
    totalRecords: entries.length,
  };
};

/**
 * Gera CSV de registros de ponto
 */
const generateTimeEntriesCSV = async (filters) => {
  const { headers, rows, totalRecords } = await getReportRows(filters);

  // Montar CSV
  const csvContent = [
    headers.map((cell) => escapeCSV(cell)).join(';'),
    ...rows.map((row) => row.map((cell) => escapeCSV(cell)).join(';')),
  ].join('\n');

  return {
    content: csvContent,
    totalRecords,
  };
};

/**
 * Gera XLSX de registros de ponto
 */
const generateTimeEntriesXLSX = async (filters) => {
  const { headers, rows, totalRecords } = await getReportRows(filters);
  const worksheet = xlsx.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'RelatorioPonto');
  const content = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return {
    content,
    totalRecords,
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

      const { filters, requestedBy, format = 'xlsx' } = job.data;

      try {
        // Atualiza progresso
        await job.updateProgress(10);

        const normalizedFormat = String(format || 'xlsx').toLowerCase();
        const outputFormat = normalizedFormat === 'csv' ? 'csv' : 'xlsx';

        // Gera o conteúdo do relatório no formato solicitado
        const generator = outputFormat === 'csv' ? generateTimeEntriesCSV : generateTimeEntriesXLSX;
        const { content, totalRecords } = await generator({
          ...filters,
          supervisorId: requestedBy.role === 'SUPERVISOR' ? requestedBy.id : null,
        });

        await job.updateProgress(70);

        // Gera nome único para o arquivo
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `relatorio_ponto_${timestamp}.${outputFormat}`;
        const filepath = path.join(REPORTS_DIR, filename);

        // Salva o arquivo
        if (outputFormat === 'csv') {
          fs.writeFileSync(filepath, '\ufeff' + content, 'utf8'); // BOM para Excel
        } else {
          fs.writeFileSync(filepath, content);
        }

        await job.updateProgress(90);

        console.log(`✅ Relatório gerado: ${filename} (${totalRecords} registros)`);

        await job.updateProgress(100);

        return {
          success: true,
          filename,
          filepath,
          totalRecords,
          format: outputFormat,
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
  generateTimeEntriesXLSX,
  REPORTS_DIR,
};
