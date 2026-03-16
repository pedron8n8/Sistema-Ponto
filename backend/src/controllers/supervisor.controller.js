const prisma = require('../config/database');
const { adjustBankHours, settleBankHoursAccruals } = require('../utils/bankHours');
const { normalizeMinutes, normalizeTime, normalizeTimeZone } = require('../utils/workSettings');

const PRESENCE_REFRESH_MS = 15000;

const PRESENCE_STATUS = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  ON_BREAK: 'ON_BREAK',
  OVERTIME_ACTIVE: 'OVERTIME_ACTIVE',
};

const KPI_PERIODS = new Set(['daily', 'weekly', 'monthly']);

const isElevatedRole = (role) => ['ADMIN', 'HR'].includes(role);

const buildSupervisorScopeWhere = ({ supervisorId, isAdmin }) =>
  isAdmin ? { role: { notIn: ['ADMIN', 'HR'] } } : { supervisorId };

const normalizeFilterValue = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.toLowerCase() : null;
};

const parseTimeToMinutes = (time) => {
  if (!time) return null;
  const match = String(time).trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const getNowMinutesForTimeZone = (timeZone) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date());

    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    return hour * 60 + minute;
  } catch (_error) {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }
};

const isWithinConfiguredWorkday = ({ nowMinutes, startTime, endTime }) => {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return true;
  }

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  }

  return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
};

const getDateRangeFromPeriod = ({ period, startDate, endDate }) => {
  if (startDate || endDate) {
    const start = startDate ? new Date(startDate) : new Date('1970-01-01T00:00:00.000Z');
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end, period: startDate || endDate ? 'custom' : period };
  }

  const now = new Date();
  const selectedPeriod = KPI_PERIODS.has(period) ? period : 'weekly';
  const start = new Date(now);
  const end = new Date(now);

  if (selectedPeriod === 'daily') {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  }

  if (selectedPeriod === 'weekly') {
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(now.getDate() + mondayOffset);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  }

  if (selectedPeriod === 'monthly') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  }

  return { start, end, period: selectedPeriod };
};

const enumerateDates = (start, end) => {
  const dates = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);

  while (cursor <= endDate) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
};

const isWeekday = (date) => {
  const day = date.getDay();
  return day >= 1 && day <= 5;
};

const formatDateBucket = (date) => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
};

const resolveVirtualOrgLabels = (member) => ({
  branch: member.timeZone || 'Global',
  department: member.role === 'SUPERVISOR' ? 'Lideranca' : 'Operacao',
  team: member.supervisor?.name || 'Sem equipe',
});

const applyVirtualOrgFilters = (members, filters) => {
  const branchFilter = normalizeFilterValue(filters.branch);
  const departmentFilter = normalizeFilterValue(filters.department);
  const teamFilter = normalizeFilterValue(filters.team);

  return members.filter((member) => {
    const labels = resolveVirtualOrgLabels(member);
    const branch = labels.branch.toLowerCase();
    const department = labels.department.toLowerCase();
    const team = labels.team.toLowerCase();

    const branchMatches = !branchFilter || branch === branchFilter;
    const departmentMatches = !departmentFilter || department === departmentFilter;
    const teamMatches = !teamFilter || team === teamFilter;

    return branchMatches && departmentMatches && teamMatches;
  });
};

const buildFilterOptions = (members) => {
  const branch = new Set();
  const department = new Set();
  const team = new Set();

  for (const member of members) {
    const labels = resolveVirtualOrgLabels(member);
    branch.add(labels.branch);
    department.add(labels.department);
    team.add(labels.team);
  }

  return {
    branch: Array.from(branch).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    department: Array.from(department).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    team: Array.from(team).sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };
};

const buildTeamPresenceSnapshot = async ({ supervisorId, isAdmin, filters }) => {
  const teamMembersRaw = await prisma.user.findMany({
    where: buildSupervisorScopeWhere({ supervisorId, isAdmin }),
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      timeZone: true,
      contractDailyMinutes: true,
      workdayStartTime: true,
      workdayEndTime: true,
      supervisor: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  const filterOptions = buildFilterOptions(teamMembersRaw);
  const teamMembers = applyVirtualOrgFilters(teamMembersRaw, filters);

  if (teamMembers.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        total: 0,
        present: 0,
        absent: 0,
        onBreak: 0,
        overtimeActive: 0,
      },
      filters: filterOptions,
      members: [],
    };
  }

  const now = new Date();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const teamIds = teamMembers.map((member) => member.id);

  const [openEntries, todayEntries] = await Promise.all([
    prisma.timeEntry.findMany({
      where: {
        userId: { in: teamIds },
        clockOut: null,
      },
      select: {
        id: true,
        userId: true,
        clockIn: true,
      },
      orderBy: { clockIn: 'desc' },
    }),
    prisma.timeEntry.findMany({
      where: {
        userId: { in: teamIds },
        clockIn: { gte: startOfDay },
      },
      select: {
        id: true,
        userId: true,
        clockIn: true,
        clockOut: true,
      },
      orderBy: { clockIn: 'desc' },
    }),
  ]);

  const openEntryMap = new Map(openEntries.map((entry) => [entry.userId, entry]));
  const todayEntriesByUser = todayEntries.reduce((acc, entry) => {
    if (!acc[entry.userId]) acc[entry.userId] = [];
    acc[entry.userId].push(entry);
    return acc;
  }, {});

  const members = teamMembers.map((member) => {
    const labels = resolveVirtualOrgLabels(member);
    const openEntry = openEntryMap.get(member.id);
    const userTodayEntries = todayEntriesByUser[member.id] || [];
    const nowMinutes = getNowMinutesForTimeZone(member.timeZone);
    const withinConfiguredWorkday = isWithinConfiguredWorkday({
      nowMinutes,
      startTime: member.workdayStartTime,
      endTime: member.workdayEndTime,
    });

    let status = PRESENCE_STATUS.ABSENT;
    let since = null;

    if (openEntry) {
      const elapsedMinutes = Math.max(0, Math.floor((now - new Date(openEntry.clockIn)) / 60000));
      status =
        elapsedMinutes > Number(member.contractDailyMinutes || 480)
          ? PRESENCE_STATUS.OVERTIME_ACTIVE
          : PRESENCE_STATUS.PRESENT;
      since = openEntry.clockIn;
    } else if (userTodayEntries.length > 0 && withinConfiguredWorkday) {
      status = PRESENCE_STATUS.ON_BREAK;
      since = userTodayEntries[0].clockIn;
    }

    return {
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
      },
      status,
      since,
      metadata: {
        branch: labels.branch,
        department: labels.department,
        team: labels.team,
      },
      schedule: {
        contractDailyMinutes: member.contractDailyMinutes,
        workdayStartTime: member.workdayStartTime,
        workdayEndTime: member.workdayEndTime,
      },
    };
  });

  const summary = members.reduce(
    (acc, item) => {
      if (item.status === PRESENCE_STATUS.PRESENT) acc.present += 1;
      if (item.status === PRESENCE_STATUS.ABSENT) acc.absent += 1;
      if (item.status === PRESENCE_STATUS.ON_BREAK) acc.onBreak += 1;
      if (item.status === PRESENCE_STATUS.OVERTIME_ACTIVE) acc.overtimeActive += 1;
      return acc;
    },
    {
      total: members.length,
      present: 0,
      absent: 0,
      onBreak: 0,
      overtimeActive: 0,
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    summary,
    filters: filterOptions,
    members,
  };
};

const buildHoursKpisPayload = async ({ supervisorId, isAdmin, query }) => {
  const { userId, period = 'weekly', startDate, endDate, branch, department, team } = query;

  const teamMembersRaw = await prisma.user.findMany({
    where: buildSupervisorScopeWhere({ supervisorId, isAdmin }),
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      timeZone: true,
      contractDailyMinutes: true,
      supervisorId: true,
      supervisor: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  const filterOptions = buildFilterOptions(teamMembersRaw);

  let scopedMembers = applyVirtualOrgFilters(teamMembersRaw, { branch, department, team });

  if (userId) {
    scopedMembers = scopedMembers.filter((member) => member.id === userId);
  }

  if (scopedMembers.length === 0) {
    const { start, end, period: resolvedPeriod } = getDateRangeFromPeriod({ period, startDate, endDate });
    return {
      generatedAt: new Date().toISOString(),
      range: {
        start: start.toISOString(),
        end: end.toISOString(),
        period: resolvedPeriod,
      },
      filters: filterOptions,
      summary: {
        expectedMinutes: 0,
        workedMinutes: 0,
        overtimeMinutes: 0,
      },
      byCollaborator: [],
      byTeam: [],
      timeline: [],
    };
  }

  const { start, end, period: resolvedPeriod } = getDateRangeFromPeriod({ period, startDate, endDate });
  const scopedIds = scopedMembers.map((member) => member.id);
  const entries = await prisma.timeEntry.findMany({
    where: {
      userId: { in: scopedIds },
      clockIn: {
        gte: start,
        lte: end,
      },
    },
    select: {
      userId: true,
      clockIn: true,
      clockOut: true,
      workedMinutes: true,
      overtimeMinutes: true,
    },
    orderBy: { clockIn: 'asc' },
  });

  const memberMap = new Map(scopedMembers.map((member) => [member.id, member]));
  const byCollaboratorMap = new Map();

  for (const member of scopedMembers) {
    byCollaboratorMap.set(member.id, {
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
      },
      metadata: resolveVirtualOrgLabels(member),
      expectedMinutes: 0,
      workedMinutes: 0,
      overtimeMinutes: 0,
    });
  }

  const dates = enumerateDates(start, end);

  for (const member of scopedMembers) {
    const snapshot = byCollaboratorMap.get(member.id);
    const weekdayCount = dates.reduce((acc, date) => acc + (isWeekday(date) ? 1 : 0), 0);
    snapshot.expectedMinutes = weekdayCount * Number(member.contractDailyMinutes || 480);
  }

  for (const entry of entries) {
    const snapshot = byCollaboratorMap.get(entry.userId);
    if (!snapshot) continue;

    const fallbackWorkedMinutes =
      entry.clockOut && entry.clockIn
        ? Math.max(0, Math.floor((new Date(entry.clockOut) - new Date(entry.clockIn)) / 60000))
        : 0;

    snapshot.workedMinutes += Number(entry.workedMinutes || fallbackWorkedMinutes || 0);
    snapshot.overtimeMinutes += Number(entry.overtimeMinutes || 0);
  }

  const byCollaborator = Array.from(byCollaboratorMap.values()).sort((a, b) =>
    a.member.name.localeCompare(b.member.name, 'pt-BR')
  );

  const byTeamMap = new Map();

  for (const item of byCollaborator) {
    const key = item.metadata.team;
    if (!byTeamMap.has(key)) {
      byTeamMap.set(key, {
        team: key,
        expectedMinutes: 0,
        workedMinutes: 0,
        overtimeMinutes: 0,
      });
    }

    const aggregate = byTeamMap.get(key);
    aggregate.expectedMinutes += item.expectedMinutes;
    aggregate.workedMinutes += item.workedMinutes;
    aggregate.overtimeMinutes += item.overtimeMinutes;
  }

  const timelineMap = new Map();

  for (const date of dates) {
    const key = formatDateBucket(date);
    timelineMap.set(key, {
      date: key,
      expectedMinutes: 0,
      workedMinutes: 0,
      overtimeMinutes: 0,
    });
  }

  for (const date of dates) {
    const key = formatDateBucket(date);
    const bucket = timelineMap.get(key);
    if (!bucket || !isWeekday(date)) continue;
    const dayExpected = scopedMembers.reduce(
      (acc, member) => acc + Number(member.contractDailyMinutes || 480),
      0
    );
    bucket.expectedMinutes += dayExpected;
  }

  for (const entry of entries) {
    const key = formatDateBucket(new Date(entry.clockIn));
    const bucket = timelineMap.get(key);
    if (!bucket) continue;

    const fallbackWorkedMinutes =
      entry.clockOut && entry.clockIn
        ? Math.max(0, Math.floor((new Date(entry.clockOut) - new Date(entry.clockIn)) / 60000))
        : 0;

    bucket.workedMinutes += Number(entry.workedMinutes || fallbackWorkedMinutes || 0);
    bucket.overtimeMinutes += Number(entry.overtimeMinutes || 0);
  }

  const summary = byCollaborator.reduce(
    (acc, item) => {
      acc.expectedMinutes += item.expectedMinutes;
      acc.workedMinutes += item.workedMinutes;
      acc.overtimeMinutes += item.overtimeMinutes;
      return acc;
    },
    {
      expectedMinutes: 0,
      workedMinutes: 0,
      overtimeMinutes: 0,
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    range: {
      start: start.toISOString(),
      end: end.toISOString(),
      period: resolvedPeriod,
    },
    filters: filterOptions,
    summary,
    byCollaborator,
    byTeam: Array.from(byTeamMap.values()),
    timeline: Array.from(timelineMap.values()),
  };
};

const sendSseEvent = (res, eventName, payload) => {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

/**
 * Controller para workflow de aprovação do supervisor
 */

/**
 * GET /supervisor/entries
 * Lista registros pendentes dos membros da equipe do supervisor logado
 */
const getTeamPendingEntries = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const isAdmin = isElevatedRole(req.user.role);
    const { status = 'PENDING', page = 1, limit = 20, userId, startDate, endDate } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Se for ADMIN, pode visualizar todos os usuários não-admin
    // Se for SUPERVISOR, visualiza apenas os subordinados
    const subordinates = await prisma.user.findMany({
      where: {
        ...(isAdmin ? { role: { not: 'ADMIN' } } : { supervisorId: supervisorId }),
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (subordinates.length === 0) {
      return res.json({
        message: 'Nenhum subordinado encontrado',
        entries: [],
        subordinates: [],
        stats: {
          PENDING: 0,
          APPROVED: 0,
          REJECTED: 0,
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: 0,
          totalPages: 0,
        },
      });
    }

    const subordinateIds = subordinates.map((s) => s.id);

    // Filtros de busca
    const where = {
      userId: userId ? userId : { in: subordinateIds },
      ...(status !== 'ALL' && { status }),
    };

    // Filtro por data
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

    // Verifica se o userId solicitado é subordinado deste supervisor (ADMIN pode ver todos)
    if (!isAdmin && userId && !subordinateIds.includes(userId)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode visualizar registros de seus subordinados',
      });
    }

    // Busca os registros
    const [entries, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
          logs: {
            orderBy: { timestamp: 'desc' },
            take: 1,
            include: {
              reviewer: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
        orderBy: [{ status: 'asc' }, { clockIn: 'desc' }],
        skip,
        take: limitNum,
      }),
      prisma.timeEntry.count({ where }),
    ]);

    // Calcula duração para cada entrada
    const entriesWithDuration = entries.map((entry) => {
      let duration = null;
      if (entry.clockIn && entry.clockOut) {
        const diff = new Date(entry.clockOut) - new Date(entry.clockIn);
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        duration = { hours, minutes, formatted: `${hours}h ${minutes}m` };
      }
      return {
        ...entry,
        duration,
        lastAction: entry.logs[0] || null,
      };
    });

    // Estatísticas por status
    const stats = await prisma.timeEntry.groupBy({
      by: ['status'],
      where: { userId: { in: subordinateIds } },
      _count: true,
    });

    const statsFormatted = {
      PENDING: 0,
      APPROVED: 0,
      REJECTED: 0,
    };
    stats.forEach((s) => {
      statsFormatted[s.status] = s._count;
    });

    res.json({
      entries: entriesWithDuration,
      subordinates,
      stats: statsFormatted,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar registros da equipe:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar registros pendentes',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * PATCH /supervisor/approve/:id
 * Aprova um registro de ponto e registra no ApprovalLog
 */
const approveEntry = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const isAdmin = isElevatedRole(req.user.role);
    const { id } = req.params;
    const { comment } = req.body || {};

    // Busca o registro
    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            supervisorId: true,
          },
        },
      },
    });

    if (!entry) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Registro de ponto não encontrado',
      });
    }

    // Verifica se o registro é de um subordinado do supervisor
    if (!isAdmin && entry.user.supervisorId !== supervisorId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode aprovar registros de seus subordinados',
      });
    }

    // Verifica se o registro está pendente
    if (entry.status !== 'PENDING') {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Registro não pode ser aprovado. Status atual: ${entry.status}`,
      });
    }

    // Verifica se tem clock-out (registro completo)
    if (!entry.clockOut) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Não é possível aprovar um registro sem clock-out',
      });
    }

    // Atualiza o status e cria o log em uma transação
    const [updatedEntry, approvalLog] = await prisma.$transaction([
      prisma.timeEntry.update({
        where: { id },
        data: { status: 'APPROVED' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      prisma.approvalLog.create({
        data: {
          timeEntryId: id,
          reviewerId: supervisorId,
          action: 'APPROVED',
          comment: comment || null,
        },
      }),
    ]);

    console.log(`✅ Registro ${id} aprovado por ${req.user.email}`);

    res.json({
      message: 'Registro aprovado com sucesso',
      entry: updatedEntry,
      approvalLog,
    });
  } catch (error) {
    console.error('❌ Erro ao aprovar registro:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao aprovar registro',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * PATCH /supervisor/reject/:id
 * Rejeita um registro de ponto e registra no ApprovalLog
 */
const rejectEntry = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const isAdmin = isElevatedRole(req.user.role);
    const { id } = req.params;
    const { comment } = req.body || {};

    // Comentário obrigatório para rejeição
    if (!comment || comment.trim().length < 5) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Comentário obrigatório para rejeição (mínimo 5 caracteres)',
      });
    }

    // Busca o registro
    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            supervisorId: true,
          },
        },
      },
    });

    if (!entry) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Registro de ponto não encontrado',
      });
    }

    // Verifica se o registro é de um subordinado
    if (!isAdmin && entry.user.supervisorId !== supervisorId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode rejeitar registros de seus subordinados',
      });
    }

    // Verifica se o registro está pendente
    if (entry.status !== 'PENDING') {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Registro não pode ser rejeitado. Status atual: ${entry.status}`,
      });
    }

    // Atualiza o status e cria o log
    const [updatedEntry, approvalLog] = await prisma.$transaction([
      prisma.timeEntry.update({
        where: { id },
        data: { status: 'REJECTED' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      prisma.approvalLog.create({
        data: {
          timeEntryId: id,
          reviewerId: supervisorId,
          action: 'REJECTED',
          comment: comment.trim(),
        },
      }),
    ]);

    console.log(`❌ Registro ${id} rejeitado por ${req.user.email}`);

    res.json({
      message: 'Registro rejeitado',
      entry: updatedEntry,
      approvalLog,
    });
  } catch (error) {
    console.error('❌ Erro ao rejeitar registro:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao rejeitar registro',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * PATCH /supervisor/request-edit/:id
 * Solicita edição do colaborador (volta para PENDING com comentário)
 */
const requestEdit = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const isAdmin = isElevatedRole(req.user.role);
    const { id } = req.params;
    const { comment } = req.body || {};

    // Comentário obrigatório para solicitação de edição
    if (!comment || comment.trim().length < 5) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Comentário obrigatório para solicitação de edição (mínimo 5 caracteres)',
      });
    }

    // Busca o registro
    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            supervisorId: true,
          },
        },
      },
    });

    if (!entry) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Registro de ponto não encontrado',
      });
    }

    // Verifica se é subordinado
    if (!isAdmin && entry.user.supervisorId !== supervisorId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode solicitar edição de registros de seus subordinados',
      });
    }

    // Cria o log de solicitação de edição (status permanece ou volta para PENDING)
    const [updatedEntry, approvalLog] = await prisma.$transaction([
      prisma.timeEntry.update({
        where: { id },
        data: { status: 'PENDING' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      prisma.approvalLog.create({
        data: {
          timeEntryId: id,
          reviewerId: supervisorId,
          action: 'EDIT_REQUESTED',
          comment: comment.trim(),
        },
      }),
    ]);

    console.log(`📝 Edição solicitada para registro ${id} por ${req.user.email}`);

    res.json({
      message: 'Solicitação de edição enviada ao colaborador',
      entry: updatedEntry,
      approvalLog,
    });
  } catch (error) {
    console.error('❌ Erro ao solicitar edição:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao solicitar edição',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /supervisor/entries/:id
 * Detalhes de um registro específico com histórico de aprovação
 */
const getEntryDetails = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const isAdmin = isElevatedRole(req.user.role);
    const { id } = req.params;

    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            supervisorId: true,
          },
        },
        logs: {
          orderBy: { timestamp: 'desc' },
          include: {
            reviewer: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!entry) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Registro de ponto não encontrado',
      });
    }

    // Verifica se é subordinado do supervisor
    if (!isAdmin && entry.user.supervisorId !== supervisorId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode visualizar registros de seus subordinados',
      });
    }

    // Calcula duração
    let duration = null;
    if (entry.clockIn && entry.clockOut) {
      const diff = new Date(entry.clockOut) - new Date(entry.clockIn);
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      duration = { hours, minutes, formatted: `${hours}h ${minutes}m`, totalMinutes: Math.floor(diff / 60000) };
    }

    res.json({
      entry: {
        ...entry,
        duration,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar detalhes do registro:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar detalhes do registro',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /supervisor/team
 * Lista os membros da equipe do supervisor
 */
const getTeamMembers = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const isAdmin = isElevatedRole(req.user.role);

    const subordinates = await prisma.user.findMany({
      where: {
        ...(isAdmin ? { role: { not: 'ADMIN' } } : { supervisorId: supervisorId }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        contractDailyMinutes: true,
        workdayStartTime: true,
        workdayEndTime: true,
        timeZone: true,
        createdAt: true,
        _count: {
          select: {
            timeEntries: true,
          },
        },
      },
    });

    // Busca estatísticas de cada subordinado
    const subordinatesWithStats = await Promise.all(
      subordinates.map(async (sub) => {
        const stats = await prisma.timeEntry.groupBy({
          by: ['status'],
          where: { userId: sub.id },
          _count: true,
        });

        const statsFormatted = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
        stats.forEach((s) => {
          statsFormatted[s.status] = s._count;
        });

        return {
          ...sub,
          totalEntries: sub._count.timeEntries,
          stats: statsFormatted,
        };
      })
    );

    res.json({
      team: subordinatesWithStats,
      totalMembers: subordinates.length,
    });
  } catch (error) {
    console.error('❌ Erro ao buscar equipe:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar membros da equipe',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /supervisor/presence
 * Snapshot de presença em tempo real da equipe
 */
const getTeamPresenceSnapshot = async (req, res) => {
  try {
    const snapshot = await buildTeamPresenceSnapshot({
      supervisorId: req.user.id,
      isAdmin: isElevatedRole(req.user.role),
      filters: req.query,
    });

    res.json(snapshot);
  } catch (error) {
    console.error('❌ Erro ao buscar snapshot de presença da equipe:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar presença da equipe',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /supervisor/presence/stream
 * Stream SSE com atualização contínua de presença
 */
const streamTeamPresence = async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;

  const pushSnapshot = async () => {
    if (closed) return;

    try {
      const snapshot = await buildTeamPresenceSnapshot({
        supervisorId: req.user.id,
        isAdmin: isElevatedRole(req.user.role),
        filters: req.query,
      });
      sendSseEvent(res, 'presence', snapshot);
    } catch (error) {
      sendSseEvent(res, 'error', {
        message: 'Falha ao atualizar presença em tempo real',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  };

  await pushSnapshot();

  const refreshInterval = setInterval(() => {
    pushSnapshot().catch(() => undefined);
  }, PRESENCE_REFRESH_MS);

  const keepAliveInterval = setInterval(() => {
    if (!closed) {
      res.write(': keep-alive\n\n');
    }
  }, 25000);

  req.on('close', () => {
    closed = true;
    clearInterval(refreshInterval);
    clearInterval(keepAliveInterval);
    res.end();
  });
};

/**
 * GET /supervisor/kpis/hours
 * KPIs de horas: previsto x realizado x extras
 */
const getTeamHoursKpis = async (req, res) => {
  try {
    const payload = await buildHoursKpisPayload({
      supervisorId: req.user.id,
      isAdmin: isElevatedRole(req.user.role),
      query: req.query,
    });

    res.json(payload);
  } catch (error) {
    console.error('❌ Erro ao buscar KPIs de horas da equipe:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar KPIs de horas da equipe',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * PATCH /supervisor/team/:userId/bank-hours
 * Ajusta/zera banco de horas de membro da equipe (gestor)
 */
const adjustTeamMemberBankHours = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const isAdmin = isElevatedRole(req.user.role);
    const { userId } = req.params;
    const { minutesDelta, reason, resetToZero } = req.body;

    const shouldReset = Boolean(resetToZero);
    const parsedDelta = Math.trunc(Number(minutesDelta) || 0);

    if (!shouldReset && parsedDelta === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Informe minutesDelta diferente de zero ou use resetToZero=true.',
      });
    }

    if (!reason || String(reason).trim().length < 5) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Motivo do ajuste é obrigatório (mínimo 5 caracteres).',
      });
    }

    const member = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        supervisorId: true,
      },
    });

    if (!member) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Colaborador não encontrado',
      });
    }

    if (!isAdmin && member.supervisorId !== supervisorId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode ajustar banco de horas de seus subordinados',
      });
    }

    const result = await adjustBankHours({
      userId,
      actorId: supervisorId,
      minutesDelta: parsedDelta,
      reason: String(reason).trim(),
      resetToZero: shouldReset,
    });

    res.json({
      message: shouldReset ? 'Saldo do banco de horas zerado com sucesso' : 'Banco de horas ajustado com sucesso',
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
      },
      adjustment: {
        previousBalanceMinutes: result.previousBalance,
        appliedDeltaMinutes: result.appliedDelta,
        currentBalanceMinutes: result.balanceMinutes,
        maxLimitMinutes: result.maxLimit ?? null,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao ajustar banco de horas do membro da equipe:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao ajustar banco de horas',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * PATCH /supervisor/team/:userId/work-settings
 * Define jornada do colaborador da equipe (gestor)
 */
const updateTeamMemberWorkSettings = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const isAdmin = isElevatedRole(req.user.role);
    const { userId } = req.params;
    const { contractDailyMinutes, workdayStartTime, workdayEndTime, timeZone } = req.body;

    const member = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        supervisorId: true,
      },
    });

    if (!member) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Colaborador não encontrado',
      });
    }

    if (!isAdmin && member.supervisorId !== supervisorId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode ajustar jornada de seus subordinados',
      });
    }

    const updateData = {};

    if (contractDailyMinutes !== undefined) {
      const normalizedMinutes = normalizeMinutes(contractDailyMinutes);
      if (normalizedMinutes === null) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'contractDailyMinutes inválido. Use um valor entre 60 e 1440.',
        });
      }
      updateData.contractDailyMinutes = normalizedMinutes;
    }

    if (workdayStartTime !== undefined) {
      const normalizedStart = normalizeTime(workdayStartTime);
      if (normalizedStart === null) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'workdayStartTime inválido. Use o formato HH:mm.',
        });
      }
      updateData.workdayStartTime = normalizedStart;
    }

    if (workdayEndTime !== undefined) {
      const normalizedEnd = normalizeTime(workdayEndTime);
      if (normalizedEnd === null) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'workdayEndTime inválido. Use o formato HH:mm.',
        });
      }
      updateData.workdayEndTime = normalizedEnd;
    }

    if (timeZone !== undefined) {
      const normalizedTimeZone = normalizeTimeZone(timeZone);
      if (normalizedTimeZone === null) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'timeZone inválido. Use um timezone IANA válido (ex.: America/New_York).',
        });
      }
      updateData.timeZone = normalizedTimeZone;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Informe ao menos um campo para atualização.',
      });
    }

    const updatedMember = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        contractDailyMinutes: true,
        workdayStartTime: true,
        workdayEndTime: true,
        timeZone: true,
      },
    });

    res.json({
      message: 'Jornada do colaborador atualizada com sucesso',
      member: updatedMember,
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar jornada do colaborador:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao atualizar jornada do colaborador',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /supervisor/team/bank-hours/overview
 * Lista overview de banco de horas da equipe
 */
const getTeamBankHoursOverview = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const isAdmin = isElevatedRole(req.user.role);

    const team = await prisma.user.findMany({
      where: isAdmin
        ? { role: { not: 'ADMIN' } }
        : { supervisorId: supervisorId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        bankHoursBalanceMinutes: true,
      },
      orderBy: { name: 'asc' },
    });

    const ids = team.map((u) => u.id);

    const [pendingAccruals, paidAccruals] = await Promise.all([
      prisma.bankHoursEntry.groupBy({
        by: ['userId'],
        where: {
          userId: { in: ids },
          type: 'ACCRUAL',
          paymentStatus: 'PENDING',
          minutes: { gt: 0 },
          expiredAt: null,
        },
        _sum: { minutes: true },
      }),
      prisma.bankHoursEntry.groupBy({
        by: ['userId'],
        where: {
          userId: { in: ids },
          type: 'ACCRUAL',
          paymentStatus: 'PAID',
          minutes: { gt: 0 },
        },
        _sum: { minutes: true },
      }),
    ]);

    const pendingMap = Object.fromEntries(
      pendingAccruals.map((row) => [row.userId, row._sum.minutes || 0])
    );
    const paidMap = Object.fromEntries(
      paidAccruals.map((row) => [row.userId, row._sum.minutes || 0])
    );

    const overview = team.map((member) => {
      const balance = member.bankHoursBalanceMinutes || 0;
      return {
        member: {
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
        },
        bankHours: {
          balanceMinutes: balance,
          creditMinutes: Math.max(0, balance),
          debtMinutes: Math.max(0, -balance),
          pendingMinutes: pendingMap[member.id] || 0,
          paidMinutes: paidMap[member.id] || 0,
        },
      };
    });

    res.json({ overview });
  } catch (error) {
    console.error('❌ Erro ao buscar overview de banco de horas da equipe:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar overview de banco de horas da equipe',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * PATCH /supervisor/team/:userId/bank-hours/pay
 * Dá baixa (paga) banco de horas pendente de membro da equipe
 */
const payTeamMemberBankHours = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const isAdmin = isElevatedRole(req.user.role);
    const { userId } = req.params;
    const { entryIds, payAllPending = true, paymentNote } = req.body;

    const member = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        supervisorId: true,
      },
    });

    if (!member) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Colaborador não encontrado',
      });
    }

    if (!isAdmin && member.supervisorId !== supervisorId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode dar baixa no banco de horas de seus subordinados',
      });
    }

    const result = await settleBankHoursAccruals({
      userId,
      actorId: supervisorId,
      entryIds: Array.isArray(entryIds) ? entryIds : [],
      payAllPending: Boolean(payAllPending),
      paymentNote: paymentNote ? String(paymentNote).trim() : null,
    });

    res.json({
      message: result.paidMinutes > 0 ? 'Baixa de banco de horas realizada com sucesso' : 'Nenhum saldo pendente para baixa',
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
      },
      payment: {
        paidMinutes: result.paidMinutes,
        paidEntries: result.paidEntries,
        currentBalanceMinutes: result.balanceMinutes,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao dar baixa no banco de horas do membro:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao dar baixa no banco de horas',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

module.exports = {
  getTeamPendingEntries,
  approveEntry,
  rejectEntry,
  requestEdit,
  getEntryDetails,
  getTeamMembers,
  getTeamPresenceSnapshot,
  streamTeamPresence,
  getTeamHoursKpis,
  adjustTeamMemberBankHours,
  updateTeamMemberWorkSettings,
  getTeamBankHoursOverview,
  payTeamMemberBankHours,
};
