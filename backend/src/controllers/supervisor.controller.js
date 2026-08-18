const { prisma } = require('../config/database');
const { adjustBankHours, settleBankHoursAccruals } = require('../utils/bankHours');
const { reverseEntryBankHours } = require('../utils/recalcDay');
const { normalizeMinutes, normalizeTime, normalizeTimeZone } = require('../utils/workSettings');
const { parseLocalDate } = require('../utils/timeCalculations');
const { presenceBus } = require('../utils/presenceBus');
const { resolveVisibleUserIds, canViewUser } = require('../utils/visibleUsers');
const { isHrLevel } = require('../utils/roles');

const PRESENCE_REFRESH_MS = 15000;
const DEFAULT_OVERTIME_LIMIT_MINUTES = Number(process.env.OVERTIME_DAILY_LIMIT_MINUTES || 120);
const OVERTIME_ALERT_THRESHOLD_PERCENT = Math.max(
  1,
  Math.min(100, Number(process.env.OVERTIME_ALERT_THRESHOLD_PERCENT || 80))
);
const OVERTIME_ALERT_CHANNELS = String(process.env.OVERTIME_ALERT_CHANNELS || 'IN_APP')
  .split(',')
  .map((channel) => channel.trim().toUpperCase())
  .filter(Boolean);

const PRESENCE_STATUS = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  ON_BREAK: 'ON_BREAK',
  OVERTIME_ACTIVE: 'OVERTIME_ACTIVE',
};

const KPI_PERIODS = new Set(['daily', 'weekly', 'monthly']);
const TEAM_MEMBER_ROLES = ['INTEGRATOR', 'HR', 'SUPERVISOR', 'MEMBER'];

const isElevatedRole = (role) => ['SUPERADMIN', 'ADMIN'].includes(role);

const getActorTeamOwnerId = (actor) => {
  if (!actor) return null;
  if (actor.role === 'ADMIN' || actor.role === 'SUPERADMIN') return actor.id;
  if (isHrLevel(actor.role)) return actor.organizationAdminId;
  return null;
};

/**
 * Escopo hierárquico: cada ator enxerga (e gerencia) toda a sua cadeia abaixo.
 * Ver utils/visibleUsers.js.
 */
const buildManagedTeamWhere = async (actor) => {
  const visibleIds = await resolveVisibleUserIds(actor);
  if (visibleIds === null) return { isActive: true }; // SUPERADMIN
  return { id: { in: visibleIds }, isActive: true };
};

// Mesmo conjunto usado na listagem: quem o ator vê na equipe é quem ele pode aprovar/editar.
const canManageTeamUser = async ({ actor, targetUser }) => {
  if (!actor || !targetUser) return false;
  return canViewUser(actor, targetUser.id);
};

const buildSupervisorScopeWhere = ({ supervisorId, isAdmin }) =>
  isAdmin
    ? { role: { in: TEAM_MEMBER_ROLES }, isActive: true, organizationAdminId: supervisorId }
    : { supervisorId, isActive: true };

const normalizeFilterValue = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.toLowerCase() : null;
};

const getDateRangeFromPeriod = ({ period, startDate, endDate }) => {
  if (startDate || endDate) {
    const start = startDate ? parseLocalDate(startDate) : new Date('1970-01-01T00:00:00.000Z');
    const end = endDate ? parseLocalDate(endDate) : new Date();
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

const extractCoordinatesFromLocation = (locationPayload) => {
  if (!locationPayload || typeof locationPayload !== 'object') return null;

  const hasLatLng = (candidate) =>
    candidate &&
    typeof candidate === 'object' &&
    Number.isFinite(Number(candidate.lat)) &&
    Number.isFinite(Number(candidate.lng));

  if (hasLatLng(locationPayload)) {
    return {
      lat: Number(locationPayload.lat),
      lng: Number(locationPayload.lng),
      source: 'LEGACY',
    };
  }

  if (hasLatLng(locationPayload.clockOut)) {
    return {
      lat: Number(locationPayload.clockOut.lat),
      lng: Number(locationPayload.clockOut.lng),
      source: 'CLOCK_OUT',
    };
  }

  if (hasLatLng(locationPayload.clockIn)) {
    return {
      lat: Number(locationPayload.clockIn.lat),
      lng: Number(locationPayload.clockIn.lng),
      source: 'CLOCK_IN',
    };
  }

  return null;
};

const resolveOvertimeAlertLimitMinutes = (member) => {
  const fromUser = Number(member?.bankHoursLimitMinutes);
  if (Number.isFinite(fromUser) && fromUser > 0) {
    return Math.floor(fromUser);
  }

  if (Number.isFinite(DEFAULT_OVERTIME_LIMIT_MINUTES) && DEFAULT_OVERTIME_LIMIT_MINUTES > 0) {
    return Math.floor(DEFAULT_OVERTIME_LIMIT_MINUTES);
  }

  return 120;
};

const buildTeamPresenceSnapshot = async ({ supervisorId, supervisorEmail, supervisorName, isAdmin, filters }) => {
  const teamMembersRaw = await prisma.user.findMany({
    where: buildSupervisorScopeWhere({ supervisorId, isAdmin }),
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      timeZone: true,
      contractDailyMinutes: true,
      bankHoursLimitMinutes: true,
      workdayStartTime: true,
      workdayEndTime: true,
      supervisor: {
        select: {
          id: true,
          name: true,
          email: true,
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

  const [openEntries, todayEntries, latestEntriesWithLocation] = await Promise.all([
    prisma.timeEntry.findMany({
      where: {
        userId: { in: teamIds },
        clockOut: null,
      },
      select: {
        id: true,
        userId: true,
        clockIn: true,
        breakStartedAt: true,
        breakMinutes: true,
        location: true,
        updatedAt: true,
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
        workedMinutes: true,
        location: true,
        updatedAt: true,
      },
      orderBy: { clockIn: 'desc' },
    }),
    prisma.timeEntry.findMany({
      where: {
        userId: { in: teamIds },
        location: { not: null },
      },
      select: {
        id: true,
        userId: true,
        clockIn: true,
        clockOut: true,
        location: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.max(60, teamIds.length * 12),
    }),
  ]);

  const openEntryMap = new Map(openEntries.map((entry) => [entry.userId, entry]));
  const todayEntriesByUser = todayEntries.reduce((acc, entry) => {
    if (!acc[entry.userId]) acc[entry.userId] = [];
    acc[entry.userId].push(entry);
    return acc;
  }, {});

  const resolveEntryWorkedMinutes = (entry) => {
    if (!entry?.clockIn || !entry?.clockOut) return 0;

    const storedWorkedMinutes = Number(entry.workedMinutes);
    if (Number.isFinite(storedWorkedMinutes) && storedWorkedMinutes > 0) {
      return Math.floor(storedWorkedMinutes);
    }

    const start = new Date(entry.clockIn).getTime();
    const end = new Date(entry.clockOut).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.floor((end - start) / 60000);
  };

  const latestLocationByUser = new Map();
  for (const entry of latestEntriesWithLocation) {
    if (latestLocationByUser.has(entry.userId)) continue;
    const coordinates = extractCoordinatesFromLocation(entry.location);
    if (!coordinates) continue;
    latestLocationByUser.set(entry.userId, {
      ...coordinates,
      recordedAt: entry.clockOut || entry.clockIn,
      updatedAt: entry.updatedAt,
      timeEntryId: entry.id,
    });
  }

  const overtimeAlerts = [];

  const members = teamMembers.map((member) => {
    const labels = resolveVirtualOrgLabels(member);
    const openEntry = openEntryMap.get(member.id);
    const userTodayEntries = todayEntriesByUser[member.id] || [];

    let status = PRESENCE_STATUS.ABSENT;
    let since = null;

    if (openEntry) {
      const breakStartedAt = openEntry.breakStartedAt ? new Date(openEntry.breakStartedAt) : null;
      const onBreak = Boolean(breakStartedAt && Number.isFinite(breakStartedAt.getTime()));
      const ongoingBreakMinutes = onBreak
        ? Math.max(0, Math.floor((now - breakStartedAt) / 60000))
        : 0;
      const breakMinutesSoFar =
        Math.max(0, Number(openEntry.breakMinutes) || 0) + ongoingBreakMinutes;

      // Desconta a pausa, igual calculateDuration faz no clock-out.
      const elapsedMinutes = Math.max(
        0,
        Math.floor((now - new Date(openEntry.clockIn)) / 60000) - breakMinutesSoFar
      );
      const closedWorkedMinutesToday = userTodayEntries.reduce((sum, entry) => {
        if (!entry.clockOut) return sum;
        if (entry.id === openEntry.id) return sum;
        return sum + resolveEntryWorkedMinutes(entry);
      }, 0);
      const totalWorkedMinutesToday = closedWorkedMinutesToday + elapsedMinutes;
      const contractDailyMinutes = Number(member.contractDailyMinutes || 480);
      const overtimeMinutesSoFar = Math.max(0, totalWorkedMinutesToday - contractDailyMinutes);
      const overtimeLimitMinutes = resolveOvertimeAlertLimitMinutes(member);
      const thresholdMinutes = Math.ceil((overtimeLimitMinutes * OVERTIME_ALERT_THRESHOLD_PERCENT) / 100);

      status = onBreak
        ? PRESENCE_STATUS.ON_BREAK
        : totalWorkedMinutesToday > contractDailyMinutes
          ? PRESENCE_STATUS.OVERTIME_ACTIVE
          : PRESENCE_STATUS.PRESENT;
      since = onBreak ? openEntry.breakStartedAt : openEntry.clockIn;

      if (overtimeMinutesSoFar >= thresholdMinutes && thresholdMinutes > 0) {
        const dateKey = new Date(now).toISOString().slice(0, 10);

        const alertPayload = {
          type: 'OVERTIME_LIMIT_THRESHOLD',
          thresholdPercent: OVERTIME_ALERT_THRESHOLD_PERCENT,
          thresholdMinutes,
          overtimeMinutes: overtimeMinutesSoFar,
          overtimeLimitMinutes,
          dateKey,
          member: {
            id: member.id,
            name: member.name,
            email: member.email,
          },
          manager: {
            id: supervisorId,
            name: supervisorName || member.supervisor?.name || 'Gestor',
            email: supervisorEmail || member.supervisor?.email || null,
          },
          channels: OVERTIME_ALERT_CHANNELS,
          triggeredAt: new Date().toISOString(),
        };

        overtimeAlerts.push(alertPayload);
      }
    }
    // Sem ponto aberto = ABSENT. Pausa é lida de breakStartedAt, não inferida do clock-out.

    const lastLocation = latestLocationByUser.get(member.id) || null;

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
      lastLocation,
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
    overtimeAlerts,
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
/**
 * Ids abaixo de `rootId` na cadeia de supervisão, em qualquer profundidade, sem o próprio root.
 * Trabalha em memória sobre a equipe já carregada — a hierarquia real tem poucos níveis
 * (ADMIN -> RH -> colaborador), e um "grupo" precisa trazer a cadeia inteira, não só os diretos.
 */
const collectSubtreeIds = (people, rootId) => {
  const childrenBy = new Map();
  for (const person of people) {
    if (!person.supervisorId) continue;
    if (!childrenBy.has(person.supervisorId)) childrenBy.set(person.supervisorId, []);
    childrenBy.get(person.supervisorId).push(person.id);
  }

  const ids = new Set();
  const frontier = [rootId];
  while (frontier.length > 0) {
    for (const childId of childrenBy.get(frontier.pop()) || []) {
      if (ids.has(childId)) continue; // também corta ciclo de cadastro
      ids.add(childId);
      frontier.push(childId);
    }
  }

  return [...ids];
};

/**
 * Escopo de leitura de ponto da equipe: o mesmo filtro usado pela listagem e pelas ações
 * em lote por período. Devolve `null` quando o userId pedido está fora do escopo do ator —
 * o chamador responde 403.
 *
 * `groupId` recorta pela cadeia abaixo daquele responsável (não só os diretos).
 */
const buildTeamEntriesScope = async (actor, { status = 'PENDING', userId, groupId, startDate, endDate }) => {
  const subordinates = await prisma.user.findMany({
    where: await buildManagedTeamWhere(actor),
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      supervisorId: true,
    },
  });

  const subordinateIds = subordinates.map((s) => s.id);
  if (userId && !subordinateIds.includes(userId)) return null;

  const groupedSubordinateIds = groupId ? collectSubtreeIds(subordinates, groupId) : subordinateIds;

  const where = {
    userId: userId ? userId : { in: groupedSubordinateIds },
    ...(status !== 'ALL' && { status }),
  };

  // Pendente só conta registro fechado: um dia em aberto ainda não é revisável.
  if (status === 'PENDING') {
    where.clockOut = { not: null };
  }

  if (startDate || endDate) {
    where.clockIn = {};
    if (startDate) {
      where.clockIn.gte = parseLocalDate(startDate);
    }
    if (endDate) {
      const end = parseLocalDate(endDate);
      end.setHours(23, 59, 59, 999);
      where.clockIn.lte = end;
    }
  }

  return { subordinates, subordinateIds, where };
};

const getTeamPendingEntries = async (req, res) => {
  try {
    const { status = 'PENDING', page = 1, limit = 20, userId, groupId, startDate, endDate } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Se for ADMIN, pode visualizar todos os usuários não-admin
    // Se for SUPERVISOR, visualiza apenas os subordinados
    const scope = await buildTeamEntriesScope(req.user, { status, userId, groupId, startDate, endDate });

    // Verifica se o userId solicitado é subordinado deste supervisor (ADMIN pode ver todos)
    if (!scope) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode visualizar registros de seus subordinados',
      });
    }

    const { subordinates, subordinateIds, where } = scope;

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

    // Busca os registros
    const [entries, total, openEntries] = await Promise.all([
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
      prisma.timeEntry.findMany({
        where: {
          userId: { in: subordinateIds },
          clockOut: null,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: { clockIn: 'desc' },
      }),
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
      where: { userId: { in: subordinateIds }, clockOut: { not: null } },
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
      openEntries,
      subordinates,
      stats: {
        ...statsFormatted,
        OPEN: openEntries.length,
      },
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
            organizationAdminId: true,
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
    if (!(await canManageTeamUser({ actor: req.user, targetUser: entry.user }))) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode aprovar registros de seus subordinados',
      });
    }

    if (req.user.role === 'ADMIN' && entry.user.organizationAdminId !== supervisorId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode aprovar registros do seu tenant',
      });
    }

    // Verifica se o registro está pendente
    if (entry.status !== 'PENDING') {
      console.warn(
        `[approveEntry] Entry ${id} skipped (status=${entry.status}) by ${req.user.email}`
      );
      return res.status(409).json({
        error: 'Conflict',
        code: 'ENTRY_NOT_PENDING',
        message: `Registro já está com status ${entry.status}. Atualize a lista para ver o estado atual.`,
        entry: {
          id: entry.id,
          status: entry.status,
        },
      });
    }

    // Verifica se tem clock-out (registro completo)
    if (!entry.clockOut) {
      console.warn(
        `[approveEntry] Entry ${id} skipped (no clockOut) by ${req.user.email}`
      );
      return res.status(422).json({
        error: 'Unprocessable Entity',
        code: 'ENTRY_OPEN',
        message: 'Não é possível aprovar um registro ainda em andamento (sem clock-out).',
        entry: {
          id: entry.id,
          status: entry.status,
        },
      });
    }

    // Horas extras precisam ser decididas (aprovadas ou negadas) antes do ponto
    if (entry.overtimeStatus === 'PENDING') {
      return res.status(409).json({
        error: 'Conflict',
        code: 'OVERTIME_PENDING',
        message: 'Decida as horas extras deste registro (aprovar ou negar) antes de concluir a revisão.',
        entry: {
          id: entry.id,
          status: entry.status,
        },
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

// Teto de registros que uma ação por período pode atingir numa chamada.
// ponytail: o gargalo é o laço sequencial de reverseEntryBankHours no reject; se
// precisar de mais, mova a reversão para dentro do lote ou pagine no cliente.
const MAX_SCOPE_ENTRIES = 500;

const BULK_ENTRY_INCLUDE = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      supervisorId: true,
      organizationAdminId: true,
    },
  },
};

/** Separa o que o ator pode decidir do que precisa ser ignorado, com o motivo. */
const classifyBulkEntries = async (actor, entries, skipped) => {
  const eligible = [];

  for (const entry of entries) {
    if (!(await canManageTeamUser({ actor, targetUser: entry.user }))) {
      skipped.push({ id: entry.id, reason: 'FORBIDDEN' });
    } else if (actor.role === 'ADMIN' && entry.user.organizationAdminId !== actor.id) {
      skipped.push({ id: entry.id, reason: 'FORBIDDEN' });
    } else if (entry.status !== 'PENDING') {
      skipped.push({ id: entry.id, reason: 'ENTRY_NOT_PENDING' });
    } else if (!entry.clockOut) {
      skipped.push({ id: entry.id, reason: 'ENTRY_OPEN' });
    } else {
      eligible.push(entry);
    }
  }

  return { eligible, skipped };
};

/**
 * Modo por período: o servidor resolve quais registros entram, com o mesmo filtro da
 * listagem (buildTeamEntriesScope), então o cliente não precisa mandar ids.
 * Intervalo é obrigatório — "aprovar tudo desde sempre" não é alcançável por acidente.
 */
const loadEntriesForBulkScope = async (req, res, scope) => {
  const { startDate, endDate, userId, groupId } = scope || {};

  if (!startDate || !endDate) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'scope exige startDate e endDate.',
    });
    return null;
  }

  const resolved = await buildTeamEntriesScope(req.user, {
    status: 'PENDING',
    userId,
    groupId,
    startDate,
    endDate,
  });

  if (!resolved) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Você só pode revisar registros de seus subordinados',
    });
    return null;
  }

  const total = await prisma.timeEntry.count({ where: resolved.where });

  if (total > MAX_SCOPE_ENTRIES) {
    res.status(400).json({
      error: 'Bad Request',
      message: `O período selecionado tem ${total} registros pendentes, acima do limite de ${MAX_SCOPE_ENTRIES} por ação. Restrinja o filtro (colaborador, grupo ou período menor).`,
    });
    return null;
  }

  const entries = await prisma.timeEntry.findMany({
    where: resolved.where,
    include: BULK_ENTRY_INCLUDE,
  });

  // Nada a ignorar por "não encontrado": os ids saíram da própria consulta.
  return classifyBulkEntries(req.user, entries, []);
};

/**
 * Carrega, autoriza e classifica um lote de registros.
 * Reaproveitado por approve-bulk e reject-bulk.
 *
 * Dois modos de entrada:
 *   { entryIds: string[] }  -> lote explícito, 1..200 ids (um colaborador na tela)
 *   { scope: { startDate, endDate, userId?, groupId? } } -> todos os pendentes do período
 *     dentro do escopo do ator, resolvidos no servidor. É isso que permite aprovar a
 *     semana inteira de todos os colaboradores do filtro em um clique, sem depender da
 *     página carregada no cliente nem do teto de 200 ids.
 *
 * Diferente das rotas de um registro só, o lote NÃO recusa registros com HE pendente:
 * as duas ações em lote decidem a HE junto (aprovar tudo / negar tudo), que é o
 * ponto de aprovar ou negar uma semana inteira em um clique.
 *
 * Retorna { eligible, skipped } ou null (resposta de erro já enviada).
 */
const loadEntriesForBulk = async (req, res) => {
  const { entryIds, scope } = req.body || {};

  if (scope) return loadEntriesForBulkScope(req, res, scope);

  if (!Array.isArray(entryIds) || entryIds.length === 0 || entryIds.length > 200) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Informe entryIds como um array com 1 a 200 registros, ou scope com startDate e endDate.',
    });
    return null;
  }

  const entries = await prisma.timeEntry.findMany({
    where: { id: { in: entryIds } },
    include: BULK_ENTRY_INCLUDE,
  });

  const foundIds = new Set(entries.map((entry) => entry.id));
  const skipped = entryIds
    .filter((id) => !foundIds.has(id))
    .map((id) => ({ id, reason: 'NOT_FOUND' }));

  return classifyBulkEntries(req.user, entries, skipped);
};

/**
 * POST /supervisor/approve-bulk
 * Aprova vários registros de ponto de uma vez (aprovação em lote por período/colaborador).
 * HE ainda pendente no lote é aprovada junto.
 * Body: { entryIds: string[], comment?: string }
 */
const approveEntriesBulk = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const { comment } = req.body || {};

    const loaded = await loadEntriesForBulk(req, res);
    if (!loaded) return;
    const { eligible, skipped } = loaded;

    const validIds = eligible.map((entry) => entry.id);
    const overtimeIds = eligible
      .filter((entry) => entry.overtimeStatus === 'PENDING')
      .map((entry) => entry.id);

    if (validIds.length === 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Nenhum registro elegível para aprovação. Atualize a lista.',
        approvedCount: 0,
        overtimeApprovedCount: 0,
        skipped,
      });
    }

    // HE aprovada não mexe em banco de horas: o crédito já foi lançado no clock-out.
    await prisma.$transaction([
      ...(overtimeIds.length
        ? [
            prisma.timeEntry.updateMany({
              where: { id: { in: overtimeIds } },
              data: { overtimeStatus: 'APPROVED' },
            }),
            prisma.approvalLog.createMany({
              data: overtimeIds.map((timeEntryId) => ({
                timeEntryId,
                reviewerId: supervisorId,
                action: 'OVERTIME_APPROVED',
                comment: comment || null,
              })),
            }),
          ]
        : []),
      prisma.timeEntry.updateMany({
        where: { id: { in: validIds }, status: 'PENDING' },
        data: { status: 'APPROVED' },
      }),
      prisma.approvalLog.createMany({
        data: validIds.map((timeEntryId) => ({
          timeEntryId,
          reviewerId: supervisorId,
          action: 'APPROVED',
          comment: comment || null,
        })),
      }),
    ]);

    console.log(
      `✅ ${validIds.length} registros aprovados em lote (${overtimeIds.length} com HE) por ${req.user.email}`
    );

    res.json({
      message: `${validIds.length} registro(s) aprovado(s) com sucesso`,
      approvedCount: validIds.length,
      overtimeApprovedCount: overtimeIds.length,
      skipped,
    });
  } catch (error) {
    console.error('❌ Erro ao aprovar registros em lote:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao aprovar registros em lote',
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
            organizationAdminId: true,
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
    if (!(await canManageTeamUser({ actor: req.user, targetUser: entry.user }))) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode rejeitar registros de seus subordinados',
      });
    }

    if (req.user.role === 'ADMIN' && entry.user.organizationAdminId !== supervisorId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode rejeitar registros do seu tenant',
      });
    }

    // Verifica se o registro está pendente
    if (entry.status !== 'PENDING') {
      console.warn(
        `[rejectEntry] Entry ${id} skipped (status=${entry.status}) by ${req.user.email}`
      );
      return res.status(409).json({
        error: 'Conflict',
        code: 'ENTRY_NOT_PENDING',
        message: `Registro já está com status ${entry.status}. Atualize a lista para ver o estado atual.`,
        entry: {
          id: entry.id,
          status: entry.status,
        },
      });
    }

    // Horas extras precisam ser decididas (aprovadas ou negadas) antes do ponto
    if (entry.overtimeStatus === 'PENDING') {
      return res.status(409).json({
        error: 'Conflict',
        code: 'OVERTIME_PENDING',
        message: 'Decida as horas extras deste registro (aprovar ou negar) antes de concluir a revisão.',
        entry: {
          id: entry.id,
          status: entry.status,
        },
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
 * POST /supervisor/reject-bulk
 * Rejeita vários registros de ponto de uma vez (negação em lote por período/colaborador).
 * HE ainda pendente no lote é negada junto (zera o efeito e reverte o banco de horas).
 * Body: { entryIds: string[], comment: string }
 */
const rejectEntriesBulk = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const { comment } = req.body || {};

    // Mesma exigência do rejectEntry: negar sempre precisa de justificativa.
    if (!comment || comment.trim().length < 5) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Comentário obrigatório para rejeição (mínimo 5 caracteres)',
      });
    }

    const loaded = await loadEntriesForBulk(req, res);
    if (!loaded) return;
    const { eligible, skipped } = loaded;

    const validIds = eligible.map((entry) => entry.id);
    const overtimeEntries = eligible.filter((entry) => entry.overtimeStatus === 'PENDING');
    const overtimeIds = overtimeEntries.map((entry) => entry.id);

    if (validIds.length === 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Nenhum registro elegível para rejeição. Atualize a lista.',
        rejectedCount: 0,
        overtimeRejectedCount: 0,
        skipped,
      });
    }

    const trimmedComment = comment.trim();

    // Reverte o crédito de banco de horas antes da transação, igual ao rejectOvertime.
    // ponytail: sequencial; o lote é limitado a 200 registros.
    for (const id of overtimeIds) {
      await reverseEntryBankHours(id);
    }

    await prisma.$transaction([
      ...(overtimeIds.length
        ? [
            prisma.timeEntry.updateMany({
              where: { id: { in: overtimeIds } },
              data: {
                overtimeStatus: 'REJECTED',
                overtimeMinutes: 0,
                overtimeMinutes50: 0,
                overtimeMinutes100: 0,
                overtimePercent: 0,
                bankHoursAccruedMinutes: 0,
              },
            }),
            prisma.approvalLog.createMany({
              data: overtimeEntries.map((entry) => ({
                timeEntryId: entry.id,
                reviewerId: supervisorId,
                action: 'OVERTIME_REJECTED',
                comment: `${trimmedComment} [HE original: ${entry.overtimeMinutes}min (50%: ${entry.overtimeMinutes50}min, 100%: ${entry.overtimeMinutes100}min), banco: ${entry.bankHoursAccruedMinutes}min]`,
              })),
            }),
          ]
        : []),
      prisma.timeEntry.updateMany({
        where: { id: { in: validIds }, status: 'PENDING' },
        data: { status: 'REJECTED' },
      }),
      prisma.approvalLog.createMany({
        data: validIds.map((timeEntryId) => ({
          timeEntryId,
          reviewerId: supervisorId,
          action: 'REJECTED',
          comment: trimmedComment,
        })),
      }),
    ]);

    console.log(
      `❌ ${validIds.length} registros rejeitados em lote (${overtimeIds.length} com HE) por ${req.user.email}`
    );

    res.json({
      message: `${validIds.length} registro(s) rejeitado(s)`,
      rejectedCount: validIds.length,
      overtimeRejectedCount: overtimeIds.length,
      skipped,
    });
  } catch (error) {
    console.error('❌ Erro ao rejeitar registros em lote:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao rejeitar registros em lote',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * Validações comuns aos endpoints de decisão de horas extras.
 * Retorna o registro ou null (resposta de erro já enviada).
 */
const loadEntryForOvertimeDecision = async (req, res) => {
  const supervisorId = req.user.id;
  const { id } = req.params;

  const entry = await prisma.timeEntry.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          supervisorId: true,
          organizationAdminId: true,
        },
      },
    },
  });

  if (!entry) {
    res.status(404).json({
      error: 'Not Found',
      message: 'Registro de ponto não encontrado',
    });
    return null;
  }

  if (!(await canManageTeamUser({ actor: req.user, targetUser: entry.user }))) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Você só pode revisar horas extras de seus subordinados',
    });
    return null;
  }

  if (req.user.role === 'ADMIN' && entry.user.organizationAdminId !== supervisorId) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Você só pode revisar horas extras do seu tenant',
    });
    return null;
  }

  if (entry.status !== 'PENDING') {
    res.status(409).json({
      error: 'Conflict',
      code: 'ENTRY_NOT_PENDING',
      message: `Registro já está com status ${entry.status}. Atualize a lista para ver o estado atual.`,
      entry: { id: entry.id, status: entry.status },
    });
    return null;
  }

  if (!entry.clockOut) {
    res.status(422).json({
      error: 'Unprocessable Entity',
      code: 'ENTRY_OPEN',
      message: 'Não é possível revisar horas extras de um registro ainda em andamento (sem clock-out).',
      entry: { id: entry.id, status: entry.status },
    });
    return null;
  }

  if (entry.overtimeStatus !== 'PENDING') {
    res.status(409).json({
      error: 'Conflict',
      code: 'OVERTIME_NOT_PENDING',
      message: 'Este registro não possui horas extras aguardando decisão.',
      entry: { id: entry.id, status: entry.status, overtimeStatus: entry.overtimeStatus },
    });
    return null;
  }

  return entry;
};

/**
 * PATCH /supervisor/overtime/:id/approve
 * Aprova as horas extras de um registro (pré-requisito para aprovar/rejeitar o ponto)
 */
const approveOvertime = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const { id } = req.params;
    const { comment } = req.body || {};

    const entry = await loadEntryForOvertimeDecision(req, res);
    if (!entry) return;

    const [updatedEntry, approvalLog] = await prisma.$transaction([
      prisma.timeEntry.update({
        where: { id },
        data: { overtimeStatus: 'APPROVED' },
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
          action: 'OVERTIME_APPROVED',
          comment: comment || null,
        },
      }),
    ]);

    console.log(`✅ Horas extras do registro ${id} aprovadas por ${req.user.email}`);

    res.json({
      message: 'Horas extras aprovadas com sucesso',
      entry: updatedEntry,
      approvalLog,
    });
  } catch (error) {
    console.error('❌ Erro ao aprovar horas extras:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao aprovar horas extras',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * PATCH /supervisor/overtime/:id/reject
 * Nega as horas extras de um registro: zera o efeito (não paga, não acumula banco)
 * revertendo o crédito de banco de horas já lançado. O ponto continua aprovável depois.
 */
const rejectOvertime = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const { id } = req.params;
    const { comment } = req.body || {};

    // Comentário obrigatório para negar horas extras
    if (!comment || comment.trim().length < 5) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Comentário obrigatório para negar horas extras (mínimo 5 caracteres)',
      });
    }

    const entry = await loadEntryForOvertimeDecision(req, res);
    if (!entry) return;

    // Reverte o crédito de banco de horas já lançado no clock-out
    await reverseEntryBankHours(id);

    const [updatedEntry, approvalLog] = await prisma.$transaction([
      prisma.timeEntry.update({
        where: { id },
        data: {
          overtimeStatus: 'REJECTED',
          overtimeMinutes: 0,
          overtimeMinutes50: 0,
          overtimeMinutes100: 0,
          overtimePercent: 0,
          bankHoursAccruedMinutes: 0,
        },
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
          action: 'OVERTIME_REJECTED',
          comment: `${comment.trim()} [HE original: ${entry.overtimeMinutes}min (50%: ${entry.overtimeMinutes50}min, 100%: ${entry.overtimeMinutes100}min), banco: ${entry.bankHoursAccruedMinutes}min]`,
        },
      }),
    ]);

    console.log(`❌ Horas extras do registro ${id} negadas por ${req.user.email}`);

    res.json({
      message: 'Horas extras negadas',
      entry: updatedEntry,
      approvalLog,
    });
  } catch (error) {
    console.error('❌ Erro ao negar horas extras:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao negar horas extras',
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
            organizationAdminId: true,
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
    if (!(await canManageTeamUser({ actor: req.user, targetUser: entry.user }))) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode solicitar edição de registros de seus subordinados',
      });
    }

    if (req.user.role === 'ADMIN' && entry.user.organizationAdminId !== supervisorId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode solicitar ajustes em registros do seu tenant',
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
            organizationAdminId: true,
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
    if (!(await canManageTeamUser({ actor: req.user, targetUser: entry.user }))) {
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
    const subordinates = await prisma.user.findMany({
      where: await buildManagedTeamWhere(req.user),
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
          where: { userId: sub.id, clockOut: { not: null } },
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
    const teamOwnerId = getActorTeamOwnerId(req.user);
    const snapshot = await buildTeamPresenceSnapshot({
      supervisorId: teamOwnerId || req.user.id,
      supervisorEmail: req.user.email,
      supervisorName: req.user.name,
      isAdmin: Boolean(teamOwnerId),
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
      const teamOwnerId = getActorTeamOwnerId(req.user);
      const snapshot = await buildTeamPresenceSnapshot({
        supervisorId: teamOwnerId || req.user.id,
        supervisorEmail: req.user.email,
        supervisorName: req.user.name,
        isAdmin: Boolean(teamOwnerId),
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

  // Rede de segurança: transições que acontecem só pelo relógio (PRESENT -> OVERTIME_ACTIVE)
  // e edições manuais de admin/RH não emitem evento de batida.
  const refreshInterval = setInterval(() => {
    pushSnapshot().catch(() => undefined);
  }, PRESENCE_REFRESH_MS);

  const keepAliveInterval = setInterval(() => {
    if (!closed) {
      res.write(': keep-alive\n\n');
    }
  }, 25000);

  // ponytail: debounce de 500ms — uma rajada de batidas gera um snapshot, não N.
  // Sem filtro por equipe: qualquer batida acorda todas as streams abertas. Se o nº de
  // supervisores online crescer, filtrar pelo userId do payload.
  let pendingPush = null;
  const onPunch = () => {
    if (closed || pendingPush) return;
    pendingPush = setTimeout(() => {
      pendingPush = null;
      pushSnapshot().catch(() => undefined);
    }, 500);
  };
  presenceBus.on('punch', onPunch);

  req.on('close', () => {
    closed = true;
    clearInterval(refreshInterval);
    clearInterval(keepAliveInterval);
    presenceBus.off('punch', onPunch);
    clearTimeout(pendingPush);
    res.end();
  });
};

/**
 * GET /supervisor/kpis/hours
 * KPIs de horas: previsto x realizado x extras
 */
const getTeamHoursKpis = async (req, res) => {
  try {
    const teamOwnerId = getActorTeamOwnerId(req.user);
    const payload = await buildHoursKpisPayload({
      supervisorId: teamOwnerId || req.user.id,
      isAdmin: Boolean(teamOwnerId),
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
        organizationAdminId: true,
      },
    });

    if (!member) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Colaborador não encontrado',
      });
    }

    if (!(await canManageTeamUser({ actor: req.user, targetUser: member }))) {
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
        organizationAdminId: true,
      },
    });

    if (!member) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Colaborador não encontrado',
      });
    }

    if (!(await canManageTeamUser({ actor: req.user, targetUser: member }))) {
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
          message: 'timeZone inválido. Use um timezone IANA válido (ex.: America/Chicago).',
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
    const team = await prisma.user.findMany({
      where: await buildManagedTeamWhere(req.user),
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
        organizationAdminId: true,
      },
    });

    if (!member) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Colaborador não encontrado',
      });
    }

    if (!(await canManageTeamUser({ actor: req.user, targetUser: member }))) {
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
  approveEntriesBulk,
  rejectEntry,
  rejectEntriesBulk,
  approveOvertime,
  rejectOvertime,
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
