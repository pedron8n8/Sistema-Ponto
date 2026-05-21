const { Worker, Queue } = require('bullmq');
const { prisma } = require('../config/database');
const redis = require('../config/redis');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { parseDateFilter } = require('../utils/dateFilters');

// Fila de exportação de relatórios
const QUEUE_NAME = process.env.NODE_ENV === 'development' ? 'report-export-dev' : 'report-export';
const reportQueue = new Queue(QUEUE_NAME, {
  connection: redis,
});

// Diretório para armazenar os relatórios gerados
const REPORTS_DIR = path.join(__dirname, '../../exports');

// Garante que o diretório de exports existe
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

const STATUS_LABELS = {
  PENDING: 'Open',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

const ACTION_LABELS = {
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EDIT_REQUESTED: 'Edit Requested',
  EDIT_RESPONSE: 'Edit Response',
};

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-US') : '');
const formatTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString('en-US', { hour12: false })
    : '';

const resolveStatusLabel = (status) => STATUS_LABELS[status] || status || '';
const resolveActionLabel = (action) => ACTION_LABELS[action] || action || '';

const resolveBreakMinutes = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
};

const resolveWorkedMinutes = (entry) => {
  const stored = Number(entry.workedMinutes);
  if (Number.isFinite(stored) && stored > 0) {
    return Math.floor(stored);
  }

  if (!entry.clockIn || !entry.clockOut) {
    return 0;
  }

  const diffMs = new Date(entry.clockOut) - new Date(entry.clockIn);
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return 0;
  }

  const breakMinutes = resolveBreakMinutes(entry.breakMinutes);
  const totalMinutes = Math.floor(diffMs / 60000) - breakMinutes;
  return Math.max(0, totalMinutes);
};

const resolvePaymentSettled = (entry) => {
  const accrual = entry.bankHoursEntries?.[0];
  if (!accrual) {
    return 'N/A';
  }
  return accrual.paymentStatus === 'PAID' ? 'Yes' : 'No';
};

const buildDailyLogs = (entries) => {
  const headers = [
    'Entry ID',
    'User',
    'Email',
    'Supervisor',
    'Clock In Date',
    'Clock In Time',
    'Clock Out Date',
    'Clock Out Time',
    'Worked Hours',
    'Worked Minutes',
    'Break Minutes',
    'Status',
    'Notes',
    'IP Address',
    'Device',
    'Last Action',
    'Reviewer',
    'Payment Settled',
  ];

  const rows = entries.map((entry) => {
    const workedMinutes = resolveWorkedMinutes(entry);
    const workedHours = workedMinutes > 0 ? (workedMinutes / 60).toFixed(2) : '';
    const breakMinutes = resolveBreakMinutes(entry.breakMinutes);
    const lastLog = entry.logs[0];

    return [
      entry.id,
      entry.user.name || entry.user.email,
      entry.user.email,
      entry.user.supervisor?.name || 'N/A',
      formatDate(entry.clockIn),
      formatTime(entry.clockIn),
      formatDate(entry.clockOut),
      formatTime(entry.clockOut),
      workedHours,
      workedMinutes || '',
      breakMinutes || '',
      resolveStatusLabel(entry.status),
      entry.notes || '',
      entry.ipAddress || '',
      entry.device || '',
      lastLog ? resolveActionLabel(lastLog.action) : '',
      lastLog?.reviewer?.name || '',
      resolvePaymentSettled(entry),
    ];
  });

  return { headers, rows };
};

const buildSummary = (entries) => {
  const headers = [
    'User',
    'Email',
    'Open Entries',
    'Total Worked Hours',
    'Total Worked Minutes',
    'Total Break Minutes',
    'Payment Settled',
  ];

  const grouped = new Map();

  entries
    .filter((entry) => entry.status === 'PENDING')
    .forEach((entry) => {
      const userKey = entry.user.id;
      if (!grouped.has(userKey)) {
        grouped.set(userKey, {
          user: entry.user,
          totalWorkedMinutes: 0,
          totalBreakMinutes: 0,
          openEntries: 0,
          hasAccrual: false,
          hasPending: false,
          hasPaid: false,
        });
      }

      const summary = grouped.get(userKey);
      const workedMinutes = resolveWorkedMinutes(entry);
      const breakMinutes = resolveBreakMinutes(entry.breakMinutes);
      const accrual = entry.bankHoursEntries?.[0];

      summary.totalWorkedMinutes += workedMinutes;
      summary.totalBreakMinutes += breakMinutes;
      summary.openEntries += 1;

      if (accrual) {
        summary.hasAccrual = true;
        if (accrual.paymentStatus === 'PENDING') {
          summary.hasPending = true;
        }
        if (accrual.paymentStatus === 'PAID') {
          summary.hasPaid = true;
        }
      }
    });

  const rows = Array.from(grouped.values())
    .sort((a, b) => (a.user.name || '').localeCompare(b.user.name || '', 'en-US'))
    .map((summary) => {
      const paymentSettled = summary.hasAccrual
        ? summary.hasPending
          ? 'No'
          : 'Yes'
        : 'N/A';

      return [
        summary.user.name || summary.user.email,
        summary.user.email,
        summary.openEntries,
        summary.totalWorkedMinutes > 0 ? (summary.totalWorkedMinutes / 60).toFixed(2) : '0.00',
        summary.totalWorkedMinutes,
        summary.totalBreakMinutes,
        paymentSettled,
      ];
    });

  return { headers, rows };
};

const getReportData = async (filters) => {
  const { userId, teamId, startDate, endDate, status, supervisorId, timeZone } = filters;

  const where = {};

  if (userId) {
    where.userId = userId;
  } else if (supervisorId) {
    const subordinates = await prisma.user.findMany({
      where: { supervisorId },
      select: { id: true },
    });
    where.userId = { in: subordinates.map((s) => s.id) };
  } else if (teamId) {
    const teamMembers = await prisma.user.findMany({
      where: { supervisorId: teamId },
      select: { id: true },
    });
    where.userId = { in: [teamId, ...teamMembers.map((m) => m.id)] };
  }

  if (status && status !== 'ALL') {
    where.status = status;
  }

  if (startDate || endDate) {
    where.clockIn = {};
    if (startDate) {
      const parsedStartDate = parseDateFilter(startDate, false, timeZone);
      if (parsedStartDate) {
        where.clockIn.gte = parsedStartDate;
      }
    }
    if (endDate) {
      const parsedEndDate = parseDateFilter(endDate, true, timeZone);
      if (parsedEndDate) {
        where.clockIn.lte = parsedEndDate;
      }
    }

    if (!where.clockIn.gte && !where.clockIn.lte) {
      delete where.clockIn;
    }
  }

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
      bankHoursEntries: {
        where: {
          type: 'ACCRUAL',
          minutes: { gt: 0 },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          paymentStatus: true,
          minutes: true,
        },
      },
    },
    orderBy: [{ clockIn: 'desc' }],
  });

  const daily = buildDailyLogs(entries);
  const summary = buildSummary(entries);

  return {
    daily,
    summary,
    totalRecords: entries.length,
  };
};

/**
 * Gera CSV de registros de ponto
 */
const generateTimeEntriesCSV = async (filters) => {
  const { daily, totalRecords } = await getReportData(filters);
  const { headers, rows } = daily;

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
  const { daily, summary, totalRecords } = await getReportData(filters);
  const worksheet = xlsx.utils.aoa_to_sheet([daily.headers, ...daily.rows]);
  const summaryWorksheet = xlsx.utils.aoa_to_sheet([summary.headers, ...summary.rows]);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Daily Logs');
  xlsx.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary & Pending');
  const content = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return {
    content,
    totalRecords,
  };
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
    QUEUE_NAME,
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
  QUEUE_NAME,
};
