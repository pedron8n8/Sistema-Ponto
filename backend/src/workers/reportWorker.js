const { Worker, Queue } = require('bullmq');
const { prisma } = require('../config/database');
const redis = require('../config/redis');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { parseDateFilter, resolveTimeZone } = require('../utils/dateFilters');
const { calculateEntryPaymentRaw, calculateDayPaymentRaw, resolveSettledOvertime } = require('../utils/entryPayment');
const { resolveContractDailyMinutes } = require('../utils/overtime');

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

// Chave de dia (YYYY-MM-DD) no fuso do usuário — o teto contratual é por dia
// civil DAQUELA pessoa, não por UTC nem pelo fuso de quem pediu o export.
// Mesma técnica de getDateKeyForTimeZone em workers/proactiveAlertWorker.js
// (Intl.DateTimeFormat 'en-CA', que já devolve no formato YYYY-MM-DD), só que
// generalizada para uma data qualquer — lá é sempre "agora". resolveTimeZone
// (utils/dateFilters, já importado acima para parseDateFilter) dá o mesmo
// fallback de fuso usado no resto do relatório quando o usuário não tem um.
const resolveDayKeyForUser = (date, timeZone) => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: resolveTimeZone(timeZone),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(date));
  } catch (_error) {
    return new Date(date).toISOString().slice(0, 10);
  }
};

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

const resolveHourlyRate = (user) => {
  const rate = Number(user?.hourlyRate || 0);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
};

const resolveOvertimeMinutes = (entry) => ({
  ot50: Math.max(0, Number(entry.overtimeMinutes50) || 0),
  ot100: Math.max(0, Number(entry.overtimeMinutes100) || 0),
});

// HE só conta (horas e adicional) depois de aprovada. overtimeStatus null ⇒ registro sem HE
// a decidir (recalcDay.js:132), então o gate nunca descarta hora extra legítima.
// Delegado para entryPayment.resolveSettledOvertime (a mesma política, nomeada e
// compartilhada); só remapeia as chaves para o formato ot50/ot100 já usado aqui.
const resolveApprovedOvertime = (entry) => {
  const settled = resolveSettledOvertime(entry);
  return { ot50: settled.overtimeMinutes50, ot100: settled.overtimeMinutes100 };
};

// Normais = trabalhado menos TODA a HE (inclusive a pendente), para que HE aguardando
// decisão não seja promovida a hora normal.
const resolveRegularMinutes = (entry) => {
  const { ot50, ot100 } = resolveOvertimeMinutes(entry);
  return Math.max(0, resolveWorkedMinutes(entry) - ot50 - ot100);
};

// Usa a aritmética compartilhada (entryPayment.calculateEntryPaymentRaw), mas a
// política do export diverge da de custo: horas normais continuam descontando
// TODA a HE (resolveRegularMinutes, inalterado), enquanto o adicional só entra
// para a HE já aprovada (resolveApprovedOvertime). Para reaproveitar a mesma
// função pura sem duplicar a fórmula, passamos um "workedMinutes" sintético —
// normais aprovadas + HE aprovada — de forma que a subtração interna da
// função reproduza exatamente resolveRegularMinutes(entry) minutos de hora normal.
//
// Único consumidor hoje é buildDailyLogs (uma linha por entry, informativa — não
// leva o teto do contrato do dia, que é um conceito agregado por usuário/dia).
// buildSummary NÃO usa mais esta função: ela precisa do teto por (usuário, dia),
// então soma minutos crus por dia e precifica com entryPayment.calculateDayPaymentRaw
// (ver dayBuckets ali). Aqui devolvemos RAW (sem arredondar) só por convenção —
// buildDailyLogs arredonda no ponto de saída de qualquer forma.
const resolveEntryPayment = (entry) => {
  const rate = resolveHourlyRate(entry.user);
  if (rate <= 0) {
    return 0;
  }

  const { ot50, ot100 } = resolveApprovedOvertime(entry);
  const regularMinutes = resolveRegularMinutes(entry);

  const { totalAmount } = calculateEntryPaymentRaw({
    workedMinutes: regularMinutes + ot50 + ot100,
    overtimeMinutes50: ot50,
    overtimeMinutes100: ot100,
    hourlyRate: rate,
  });

  return totalAmount;
};

// Número (não string) para que a planilha permita somar/filtrar os valores.
const toMoney = (value) => (Number.isFinite(value) ? Number(value.toFixed(2)) : 0);

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
    'Hourly Rate',
    'Pending Payment',
    'Approved Payment',
    'Total Payment',
    'Payment Settled',
  ];

  const rows = entries.map((entry) => {
    const workedMinutes = resolveWorkedMinutes(entry);
    const workedHours = workedMinutes > 0 ? (workedMinutes / 60).toFixed(2) : '';
    const breakMinutes = resolveBreakMinutes(entry.breakMinutes);
    const lastLog = entry.logs[0];
    const payment = resolveEntryPayment(entry);
    const pendingPayment = entry.status === 'PENDING' ? payment : 0;
    const approvedPayment = entry.status === 'APPROVED' ? payment : 0;

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
      toMoney(resolveHourlyRate(entry.user)),
      toMoney(pendingPayment),
      toMoney(approvedPayment),
      toMoney(pendingPayment + approvedPayment),
      resolvePaymentSettled(entry),
    ];
  });

  return { headers, rows };
};

const buildSummary = (entries) => {
  const headers = [
    'User',
    'Email',
    'Hourly Rate',
    'Pending Entries',
    'Approved Entries',
    'Normal Hours',
    'Approved OT Hours',
    'Pending Hours',
    'Approved Hours',
    'Total Hours',
    'Total Break Minutes',
    'Pending Payment',
    'Approved Payment',
    'Total Payment',
    'Payment Settled',
  ];

  // Passo 1: agrupa por (usuário, dia civil DO USUÁRIO) — o teto contratual é por
  // pessoa-dia, nunca pela janela inteira do relatório nem por entry isolado.
  // ponytail: REJECTED não entra em nenhum bucket — hora rejeitada não é hora a pagar.
  const dayBuckets = new Map();

  entries
    .filter((entry) => entry.status === 'PENDING' || entry.status === 'APPROVED')
    .forEach((entry) => {
      const dayKey = resolveDayKeyForUser(entry.clockIn, entry.user.timeZone);
      const bucketKey = `${entry.user.id}::${dayKey}`;
      if (!dayBuckets.has(bucketKey)) {
        dayBuckets.set(bucketKey, { user: entry.user, entries: [] });
      }
      dayBuckets.get(bucketKey).entries.push(entry);
    });

  // Passo 2: dentro de cada dia de cada usuário, capa os minutos normais do DIA
  // INTEIRO (soma de todos os entries daquele dia, decidido ou não — mesma
  // exclusão de resolveRegularMinutes) no contrato, e só então soma no total do
  // usuário. Aprovado tem prioridade sobre o teto (já confirmado, não perde
  // minutos por causa de um entry pendente no mesmo dia); pendente fica com o
  // que sobrar do teto — nunca inventa minutos normais além dele. HE pendente
  // nunca leva adicional, decisão que já existia e não muda aqui.
  const grouped = new Map();

  dayBuckets.forEach((bucket) => {
    const userKey = bucket.user.id;
    if (!grouped.has(userKey)) {
      grouped.set(userKey, {
        user: bucket.user,
        pendingEntries: 0,
        approvedEntries: 0,
        normalMinutes: 0,
        approvedOtMinutes: 0,
        pendingMinutes: 0,
        approvedMinutes: 0,
        totalBreakMinutes: 0,
        pendingPayment: 0,
        approvedPayment: 0,
        hasAccrual: false,
        hasPending: false,
      });
    }

    const summary = grouped.get(userKey);
    const contractDailyMinutes = resolveContractDailyMinutes(bucket.user.contractDailyMinutes);
    const rate = resolveHourlyRate(bucket.user);

    let dayNormalMinutesRaw = 0;
    let dayApprovedNormalMinutesRaw = 0;
    let dayApprovedOt50 = 0;
    let dayApprovedOt100 = 0;

    bucket.entries.forEach((entry) => {
      const regularMinutes = resolveRegularMinutes(entry);
      const { ot50, ot100 } = resolveApprovedOvertime(entry);

      dayNormalMinutesRaw += regularMinutes;
      if (entry.status === 'APPROVED') {
        dayApprovedNormalMinutesRaw += regularMinutes;
      }
      dayApprovedOt50 += ot50;
      dayApprovedOt100 += ot100;

      summary.totalBreakMinutes += resolveBreakMinutes(entry.breakMinutes);
      if (entry.status === 'PENDING') {
        summary.pendingEntries += 1;
      } else {
        summary.approvedEntries += 1;
      }

      const accrual = entry.bankHoursEntries?.[0];
      if (accrual) {
        summary.hasAccrual = true;
        if (accrual.paymentStatus === 'PENDING') {
          summary.hasPending = true;
        }
      }
    });

    // Teto do dia inteiro (qualquer status) e a fatia dele que HE aprovada usa —
    // ver comentário do passo 2 acima para a prioridade aprovado-primeiro.
    const dayCappedNormalMinutes = Math.min(dayNormalMinutesRaw, contractDailyMinutes);
    const approvedNormalMinutes = Math.min(dayApprovedNormalMinutesRaw, contractDailyMinutes);
    const pendingNormalMinutes = Math.max(0, dayCappedNormalMinutes - approvedNormalMinutes);

    const approvedPayment = calculateDayPaymentRaw({
      normalMinutes: approvedNormalMinutes,
      overtimeMinutes50: dayApprovedOt50,
      overtimeMinutes100: dayApprovedOt100,
      contractDailyMinutes,
      hourlyRate: rate,
    });

    summary.normalMinutes += dayCappedNormalMinutes;
    summary.approvedOtMinutes += dayApprovedOt50 + dayApprovedOt100;
    summary.approvedMinutes += approvedNormalMinutes + dayApprovedOt50 + dayApprovedOt100;
    summary.pendingMinutes += pendingNormalMinutes;
    summary.approvedPayment += approvedPayment.totalAmount;
    // Pendente nunca leva adicional (HE ainda não decidida não é paga) — só o
    // que sobrou do teto do dia, à taxa normal.
    summary.pendingPayment += rate > 0 ? (pendingNormalMinutes / 60) * rate : 0;
  });

  const toHours = (minutes) => (minutes > 0 ? (minutes / 60).toFixed(2) : '0.00');

  const rows = Array.from(grouped.values())
    .sort((a, b) => (a.user.name || '').localeCompare(b.user.name || '', 'en-US'))
    .map((summary) => {
      const paymentSettled = summary.hasAccrual ? (summary.hasPending ? 'No' : 'Yes') : 'N/A';

      return [
        summary.user.name || summary.user.email,
        summary.user.email,
        toMoney(resolveHourlyRate(summary.user)),
        summary.pendingEntries,
        summary.approvedEntries,
        toHours(summary.normalMinutes),
        toHours(summary.approvedOtMinutes),
        toHours(summary.pendingMinutes),
        toHours(summary.approvedMinutes),
        toHours(summary.pendingMinutes + summary.approvedMinutes),
        summary.totalBreakMinutes,
        toMoney(summary.pendingPayment),
        toMoney(summary.approvedPayment),
        toMoney(summary.pendingPayment + summary.approvedPayment),
        paymentSettled,
      ];
    });

  return { headers, rows };
};

const getReportData = async (filters) => {
  const { userIds, startDate, endDate, status, timeZone } = filters;

  console.log('[reportWorker] getReportData filters:', JSON.stringify(filters));

  const where = {};

  // userIds já vem resolvido e validado pelo controller. null só acontece para SUPERADMIN.
  // Não existe branch "sem filtro" para os demais papéis: ausência de escopo nunca pode
  // significar "todo o banco".
  if (Array.isArray(userIds)) {
    where.userId = { in: userIds };
    console.log('[reportWorker] scope: %d usuário(s)', userIds.length);
  } else {
    console.log('[reportWorker] scope: irrestrito (SUPERADMIN)');
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
          hourlyRate: true,
          timeZone: true,
          contractDailyMinutes: true,
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

  const userBreakdown = entries.reduce((acc, e) => {
    const key = e.user?.email || e.user?.id || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  console.log('[reportWorker] entries by user:', userBreakdown, 'total:', entries.length);

  const pendingEntries = entries.filter((entry) => entry.status === 'PENDING');
  const reviewedEntries = entries.filter((entry) => entry.status !== 'PENDING');

  const daily = buildDailyLogs(reviewedEntries);
  const pendingDaily = buildDailyLogs(pendingEntries);
  const summary = buildSummary(entries);

  return {
    daily,
    pendingDaily,
    summary,
    totalRecords: entries.length,
  };
};

/**
 * Gera CSV de registros de ponto
 */
const generateTimeEntriesCSV = async (filters) => {
  const { daily, pendingDaily, totalRecords } = await getReportData(filters);
  const headers = daily.headers;
  const rows = [...daily.rows, ...pendingDaily.rows];

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
  const { daily, pendingDaily, summary, totalRecords } = await getReportData(filters);
  const worksheet = xlsx.utils.aoa_to_sheet([daily.headers, ...daily.rows]);
  const pendingWorksheet = xlsx.utils.aoa_to_sheet([pendingDaily.headers, ...pendingDaily.rows]);
  const summaryWorksheet = xlsx.utils.aoa_to_sheet([summary.headers, ...summary.rows]);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Daily Logs');
  xlsx.utils.book_append_sheet(workbook, pendingWorksheet, 'Pending Approval');
  xlsx.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary & Payments');
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
  // 0 é um valor válido (pagamento/minutos zerados) — só nulo/vazio vira célula vazia.
  if (value === null || value === undefined || value === '') return '';
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

      const { filters, format = 'xlsx' } = job.data;

      try {
        // Atualiza progresso
        await job.updateProgress(10);

        const normalizedFormat = String(format || 'xlsx').toLowerCase();
        const outputFormat = normalizedFormat === 'csv' ? 'csv' : 'xlsx';

        // Gera o conteúdo do relatório no formato solicitado
        const generator = outputFormat === 'csv' ? generateTimeEntriesCSV : generateTimeEntriesXLSX;
        // O escopo (filters.userIds) já vem resolvido pelo controller — o worker não deriva mais nada do papel.
        const { content, totalRecords } = await generator(filters);

        await job.updateProgress(70);

        // Gera nome único para o arquivo
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `time_report_${timestamp}.${outputFormat}`;
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
  buildDailyLogs,
  buildSummary,
  REPORTS_DIR,
  QUEUE_NAME,
};
