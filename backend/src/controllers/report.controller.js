const { reportQueue, REPORTS_DIR } = require('../workers/reportWorker');
const fs = require('fs');
const path = require('path');
const { prisma } = require('../config/database');
const {
  DATE_ONLY_REGEX,
  getUtcDateRangeForDateOnly,
  resolveTimeZone,
} = require('../utils/dateFilters');
const { canViewUser, resolveVisibleUserIds } = require('../utils/visibleUsers');
const {
  calculateDayPaymentRaw,
  allocateDayNormalMinutes,
  resolveIncurredOvertime,
  resolveSettledOvertime,
} = require('../utils/entryPayment');
const { resolveContractDailyMinutes } = require('../utils/overtime');
const { getOvertimeBufferMinutes, resolveOrganizationAdminId } = require('../utils/overtimeBuffer');
const {
  DAYS_IN_WEEK,
  addDaysToDateKey,
  buildWeeklyTimesheet,
} = require('../utils/weeklyTimesheet');
const { RECOGNIZED_MINUTES_SELECT } = require('../utils/recognizedMinutes');

const SUPPORTED_EXPORT_FORMATS = ['csv', 'xlsx'];

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
    const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
    const acceptsJsonBody = !contentType || contentType.includes('application/json') || contentType.includes('+json');
    const hasObjectBody = req.body && typeof req.body === 'object' && !Array.isArray(req.body);

    if (!acceptsJsonBody) {
      return res.status(415).json({
        error: 'Unsupported Media Type',
        message: 'Content-Type inválido. Use application/json',
      });
    }

    if (!hasObjectBody) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Body JSON inválido',
      });
    }

    const { startDate, endDate, status, userId, teamId, format = 'xlsx', timeZone } = req.body;
    const normalizedFormat = String(format || 'xlsx').toLowerCase();
    const reportTimeZone = resolveTimeZone(timeZone || user.timeZone);

    if (!SUPPORTED_EXPORT_FORMATS.includes(normalizedFormat)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Formato inválido. Use csv ou xlsx',
      });
    }

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

    // O escopo é sempre derivado do papel do ator no servidor; o cliente não escolhe quem exportar.
    const visibleUserIds = await resolveVisibleUserIds(user);

    if (userId && visibleUserIds !== null && !visibleUserIds.includes(userId)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você não tem acesso ao ponto deste colaborador',
      });
    }

    // Sem userId: `teamId` vale só como toggle "incluir equipe" — presente = escopo do ator,
    // ausente = apenas os próprios registros.
    let scopedUserIds = null;
    if (userId) {
      scopedUserIds = [userId];
    } else if (teamId) {
      scopedUserIds = visibleUserIds;
    } else {
      scopedUserIds = [user.id];
    }

    // Cria o job na fila
    const job = await reportQueue.add(
      'export-time-entries',
      {
        filters: {
          startDate,
          endDate,
          status: status || 'ALL',
          userIds: scopedUserIds,
          timeZone: reportTimeZone,
        },
        requestedBy: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        format: normalizedFormat,
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
        timeZone: reportTimeZone,
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
    const extension = path.extname(sanitizedFilename).toLowerCase();

    if (!['.csv', '.xlsx'].includes(extension)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Extensão de arquivo inválida. Use .csv ou .xlsx',
      });
    }

    const filepath = path.join(REPORTS_DIR, sanitizedFilename);

    // Verifica se o arquivo existe
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Relatório não encontrado ou já expirado',
      });
    }

    // Define headers para download
    if (extension === '.xlsx') {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
    } else {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    }
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

/**
 * GET /reports/daily-breakdown
 * Query: date=YYYY-MM-DD&teamId?&userId?
 * Retorna detalhamento diário por colaborador: horas, banco de horas e custo
 */
const getDailyBreakdown = async (req, res) => {
  try {
    const requester = req.user;
    const { date, userId, teamId, timeZone } = req.query;

    if (!date) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Parâmetro date é obrigatório (YYYY-MM-DD).',
      });
    }

    const reportTimeZone = resolveTimeZone(timeZone || requester.timeZone);
    const dateRange = getUtcDateRangeForDateOnly(date, reportTimeZone);
    if (!dateRange) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Data inválida. Use o formato YYYY-MM-DD.',
      });
    }

    // null = irrestrito (SUPERADMIN); array = lista exaustiva de ids permitidos.
    const visibleUserIds = await resolveVisibleUserIds(requester);

    if (userId && visibleUserIds !== null && !visibleUserIds.includes(userId)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você não tem permissão para consultar dados desse usuário.',
      });
    }

    if (teamId && visibleUserIds !== null && !visibleUserIds.includes(teamId)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você não tem permissão para consultar este time.',
      });
    }

    let allowedUserIds = visibleUserIds;

    if (userId) {
      allowedUserIds = [userId];
    } else if (teamId) {
      // Drill-down num sub-time: subordinados diretos do supervisor escolhido, sempre
      // intersectado com o que o ator já pode ver.
      const members = await prisma.user.findMany({
        where: { supervisorId: teamId },
        select: { id: true },
      });
      const teamIds = [teamId, ...members.map((m) => m.id)];
      allowedUserIds = visibleUserIds === null ? teamIds : teamIds.filter((id) => visibleUserIds.includes(id));
    }

    const where = {
      clockIn: {
        gte: dateRange.start,
        lt: dateRange.end,
      },
    };

    if (Array.isArray(allowedUserIds)) {
      where.userId = { in: allowedUserIds };
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            hourlyRate: true,
            timeZone: true,
            contractDailyMinutes: true,
          },
        },
      },
      orderBy: [{ user: { name: 'asc' } }, { clockIn: 'asc' }],
    });

    // Como um entry resolve seus minutos trabalhados nesta tela (sem descontar
    // breakMinutes — diferente do export, que os desconta em resolveWorkedMinutes;
    // pré-existente, não mudou aqui). Extraído para ser o mesmo acessor que
    // allocateDayNormalMinutes usa e que o loop abaixo usa.
    const resolveWorkedMinutesForEntry = (entry) =>
      entry.workedMinutes && entry.workedMinutes > 0
        ? entry.workedMinutes
        : entry.clockOut
          ? Math.max(0, Math.floor((new Date(entry.clockOut) - new Date(entry.clockIn)) / 60000))
          : 0;

    // O teto do dia é alocado por ENTRY (não recalculado por usuário "por fora")
    // via entryPayment.allocateDayNormalMinutes — a MESMA função que o export
    // (reportWorker.js) usa para as suas duas planilhas. É isso que garante que a
    // soma de entries[].totalCost abaixo bata exatamente com row.totalCost: os
    // dois vêm do mesmo minuto alocado por entry, nunca de um teto recalculado
    // separadamente no agregado. Este endpoint já é um único dia de calendário
    // (dateRange acima) — dayKey constante só agrupa por usuário, sem duplicar
    // a noção de "dia" que a query já fixou.
    const normalMinutesByEntryId = allocateDayNormalMinutes({
      entries,
      getEntryId: (entry) => entry.id,
      getUserId: (entry) => entry.userId,
      getDayKey: () => date,
      getClockIn: (entry) => entry.clockIn,
      getWorkedMinutes: resolveWorkedMinutesForEntry,
      getIncurredOvertime: resolveIncurredOvertime,
      getContractDailyMinutes: (entry) => resolveContractDailyMinutes(entry.user.contractDailyMinutes),
    });

    const byUser = new Map();

    for (const entry of entries) {
      const workedMinutes = resolveWorkedMinutesForEntry(entry);
      const bankAccrued = entry.bankHoursAccruedMinutes || 0;
      const hourlyRate = Number(entry.user.hourlyRate || 0);
      const contractDailyMinutes = resolveContractDailyMinutes(entry.user.contractDailyMinutes);

      const incurred = resolveIncurredOvertime(entry);
      const settled = resolveSettledOvertime(entry);
      const paidNormalMinutes = normalMinutesByEntryId.get(entry.id) || 0;

      // Linha de detalhe por entry (entries[] abaixo): usa o MESMO minuto normal
      // já alocado pelo teto do dia (paidNormalMinutes), com a HE incorrida (pior
      // caso) como adicional — não é mais um valor "pré-teto" informativo, por
      // isso soma exatamente ao total da linha (ver rows abaixo).
      const entryPayment = calculateDayPaymentRaw({
        normalMinutes: paidNormalMinutes,
        overtimeMinutes50: incurred.overtimeMinutes50,
        overtimeMinutes100: incurred.overtimeMinutes100,
        contractDailyMinutes,
        hourlyRate,
      });

      if (!byUser.has(entry.userId)) {
        byUser.set(entry.userId, {
          user: {
            id: entry.user.id,
            name: entry.user.name,
            email: entry.user.email,
            hourlyRate,
            timeZone: entry.user.timeZone,
          },
          contractDailyMinutes,
          workedMinutes: 0,
          bankHoursAccruedMinutes: 0,
          paidNormalMinutes: 0,
          incurredOvertimeMinutes50: 0,
          incurredOvertimeMinutes100: 0,
          settledOvertimeMinutes50: 0,
          settledOvertimeMinutes100: 0,
          regularCostRaw: 0,
          overtime50CostRaw: 0,
          overtime100CostRaw: 0,
          totalCostRaw: 0,
          entries: [],
        });
      }

      const row = byUser.get(entry.userId);
      row.workedMinutes += workedMinutes;
      row.bankHoursAccruedMinutes += bankAccrued;
      row.paidNormalMinutes += paidNormalMinutes;
      row.incurredOvertimeMinutes50 += incurred.overtimeMinutes50;
      row.incurredOvertimeMinutes100 += incurred.overtimeMinutes100;
      row.settledOvertimeMinutes50 += settled.overtimeMinutes50;
      row.settledOvertimeMinutes100 += settled.overtimeMinutes100;
      // regularCost/overtimeXCost/totalCost da linha (abaixo) são a SOMA destes
      // valores, nunca recalculados à parte — é isso que faz entries[].totalCost
      // somar exatamente a row.totalCost, por construção, não por coincidência.
      row.regularCostRaw += entryPayment.regularAmount;
      row.overtime50CostRaw += entryPayment.overtime50Amount;
      row.overtime100CostRaw += entryPayment.overtime100Amount;
      row.totalCostRaw += entryPayment.totalAmount;
      row.entries.push({
        id: entry.id,
        clockIn: entry.clockIn,
        clockOut: entry.clockOut,
        workedMinutes,
        bankHoursAccruedMinutes: bankAccrued,
        totalCost: Number(entryPayment.totalAmount.toFixed(2)),
      });
    }

    const rows = Array.from(byUser.values()).map((row) => {
      const totalCost = Number(row.totalCostRaw.toFixed(2));

      // "Pagavel agora": mesmo minuto normal já alocado pelo teto do dia
      // (row.paidNormalMinutes — idempotente sob o teto, cada parcela já veio
      // capada pelo enchimento cronológico), só a HE já APPROVED como adicional.
      const settledPayment = calculateDayPaymentRaw({
        normalMinutes: row.paidNormalMinutes,
        overtimeMinutes50: row.settledOvertimeMinutes50,
        overtimeMinutes100: row.settledOvertimeMinutes100,
        contractDailyMinutes: row.contractDailyMinutes,
        hourlyRate: row.user.hourlyRate,
      });

      // HE ainda aguardando decisão = custo total (incurred, RAW) - pagável agora
      // (settled). O "regular" é idêntico nos dois (mesmo minuto alocado), então
      // essa diferença só pode vir do adicional — exatamente a pergunta "quanto
      // do custo acima ainda não é pagável". Soma valores RAW e arredonda uma
      // única vez, como o resto do módulo.
      const pendingOvertimeCost = Number((row.totalCostRaw - settledPayment.totalAmount).toFixed(2));
      const pendingOvertimeMinutes =
        row.incurredOvertimeMinutes50 +
        row.incurredOvertimeMinutes100 -
        row.settledOvertimeMinutes50 -
        row.settledOvertimeMinutes100;

      return {
        user: row.user,
        workedMinutes: row.workedMinutes,
        bankHoursAccruedMinutes: row.bankHoursAccruedMinutes,
        regularCost: Number(row.regularCostRaw.toFixed(2)),
        overtime50Cost: Number(row.overtime50CostRaw.toFixed(2)),
        overtime100Cost: Number(row.overtime100CostRaw.toFixed(2)),
        totalCost,
        pendingOvertimeMinutes,
        pendingOvertimeCost,
        // Derivado de totalCost - pendingOvertimeCost (não recalculado), para que a
        // igualdade totalCost === settledCost + pendingOvertimeCost valha por construção.
        settledCost: Number((totalCost - pendingOvertimeCost).toFixed(2)),
        entries: row.entries,
      };
    });

    const summaryTotalCost = Number(rows.reduce((sum, row) => sum + row.totalCost, 0).toFixed(2));
    const summaryPendingOvertimeCost = Number(
      rows.reduce((sum, row) => sum + row.pendingOvertimeCost, 0).toFixed(2)
    );

    res.json({
      date,
      timeZone: reportTimeZone,
      rows,
      summary: {
        totalEmployees: rows.length,
        totalWorkedMinutes: rows.reduce((sum, row) => sum + row.workedMinutes, 0),
        totalBankHoursAccruedMinutes: rows.reduce((sum, row) => sum + row.bankHoursAccruedMinutes, 0),
        totalCost: summaryTotalCost,
        pendingOvertimeMinutes: rows.reduce((sum, row) => sum + row.pendingOvertimeMinutes, 0),
        pendingOvertimeCost: summaryPendingOvertimeCost,
        settledCost: Number((summaryTotalCost - summaryPendingOvertimeCost).toFixed(2)),
      },
    });
  } catch (error) {
    console.error('❌ Erro ao gerar breakdown diário:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao gerar breakdown diário',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /reports/weekly-timesheet
 * Query: weekStart=YYYY-MM-DD&userId?&timeZone?
 *
 * Timesheet da semana JA CALCULADO, respondido na hora e SEM FILA: este é o
 * caminho ao vivo. A geração assíncrona de planilha continua em /reports/export
 * — misturar os dois faria o painel esperar um worker para mostrar a semana
 * corrente, e o arquivo do Redis nunca é o retrato de agora.
 *
 * Endpoint único de propósito: o painel web e a tool do MCP consomem esta mesma
 * resposta, então os dois não têm como discordar do número.
 */
const getWeeklyTimesheet = async (req, res) => {
  try {
    const requester = req.user;
    const { weekStart, userId, timeZone } = req.query;

    if (!DATE_ONLY_REGEX.test(String(weekStart || ''))) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Parâmetro weekStart é obrigatório (YYYY-MM-DD).',
      });
    }

    // Sem userId a semana é a de quem pediu: é o que faz o MEMBER conseguir ver
    // o próprio timesheet sem nenhuma permissão extra.
    const targetUserId = userId || requester.id;

    // canViewUser em vez de comparar contra a lista à mão: resolveVisibleUserIds
    // devolve `null` para SUPERADMIN (irrestrito), e `null.includes(...)`
    // derrubaria a requisição justamente para quem pode ver tudo.
    if (targetUserId !== requester.id && !(await canViewUser(requester, targetUserId))) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você não tem permissão para consultar dados desse usuário.',
      });
    }

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        name: true,
        email: true,
        contractDailyMinutes: true,
        timeZone: true,
        // O buffer de HE e da EMPRESA: sem organizationAdminId nao ha como
        // resolver o tenant do colaborador.
        organizationAdminId: true,
      },
    });

    if (!target) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Colaborador não encontrado.',
      });
    }

    // O fuso do colaborador manda, não o de quem olha: o dia do ponto é o dia
    // de quem bateu. resolveTimeZone ainda valida e cai no padrão do produto se
    // vier lixo no query string.
    const effectiveTimeZone = resolveTimeZone(timeZone || target.timeZone || requester.timeZone);

    // Sétimo dia inclusivo (weekStart + 6) — é o último dia que `days` devolve.
    const weekEnd = addDaysToDateKey(String(weekStart), DAYS_IN_WEEK - 1);

    // A janela é ZONADA, não UTC: em São Paulo a segunda-feira local começa às
    // 03:00Z. Uma janela de weekStart 00:00Z traria a noite do domingo anterior
    // (que nenhum bucket recolhe) e deixaria de fora a noite do último domingo
    // — o dia apareceria vazio na tela mesmo com ponto batido.
    const windowStart = getUtcDateRangeForDateOnly(String(weekStart), effectiveTimeZone);
    const windowEnd = getUtcDateRangeForDateOnly(weekEnd, effectiveTimeZone);

    const entries = await prisma.timeEntry.findMany({
      where: {
        userId: targetUserId,
        clockIn: { gte: windowStart.start, lt: windowEnd.end },
      },
      select: {
        id: true,
        clockIn: true,
        clockOut: true,
        breakMinutes: true,
        overtimeMinutes: true,
        overtimeMinutes50: true,
        overtimeMinutes100: true,
        bankHoursAccruedMinutes: true,
        status: true,
        notes: true,
        // workedMinutes + overtimeStatus: sem o status o zero autoritativo de
        // uma HE negada cai no fallback de duração e os minutos negados voltam.
        ...RECOGNIZED_MINUTES_SELECT,
      },
      orderBy: { clockIn: 'asc' },
    });

    const timesheet = buildWeeklyTimesheet({
      entries,
      weekStart: String(weekStart),
      timeZone: effectiveTimeZone,
      contractDailyMinutes: target.contractDailyMinutes,
      bufferMinutes: await getOvertimeBufferMinutes(resolveOrganizationAdminId(target)),
    });

    res.json({
      weekStart: String(weekStart),
      weekEnd,
      timeZone: effectiveTimeZone,
      user: {
        id: target.id,
        name: target.name,
        email: target.email,
        contractDailyMinutes: target.contractDailyMinutes,
      },
      ...timesheet,
      // Quem consome mostra "atualizado às ...", e o MCP precisa saber que a
      // resposta é um retrato de agora e não um arquivo estável — sobretudo
      // quando hasOpenEntry é true e o total ainda vai crescer.
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erro ao montar timesheet semanal:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao montar o timesheet da semana',
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
  getDailyBreakdown,
  getWeeklyTimesheet,
};
