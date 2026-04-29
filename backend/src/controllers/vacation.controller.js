const { prisma } = require('../config/database');
const { buildUserPhotoUrl } = require('../utils/userPhoto');

const ACTIVE_VACATION_STATUSES = ['REQUESTED', 'SUPERVISOR_APPROVED', 'HR_CONFIRMED'];
const isElevatedVacationViewer = (role) => ['SUPERADMIN', 'ADMIN', 'HR'].includes(role);
const VACATION_REQUEST_TYPES = ['VACATION', 'DAY_OFF'];
const DAY_OFF_REASON_PREFIX = '[DAY_OFF]';

const resolveTenantOwnerId = (user) => {
  if (!user) return null;
  if (user.role === 'ADMIN') return user.id;
  return user.organizationAdminId || null;
};

const resolveActorTenantOwnerId = async (actor) => {
  if (!actor?.id) return null;

  const fromToken = resolveTenantOwnerId(actor);
  if (fromToken) {
    return fromToken;
  }

  const actorFromDb = await prisma.user.findUnique({
    where: { id: actor.id },
    select: {
      id: true,
      role: true,
      organizationAdminId: true,
    },
  });

  return resolveTenantOwnerId(actorFromDb);
};

const canReviewVacationWithinTenant = ({ actorTenantOwnerId, targetUser }) => {
  if (!targetUser) return false;
  const targetTenantOwnerId = resolveTenantOwnerId(targetUser);
  return Boolean(
    actorTenantOwnerId &&
    targetTenantOwnerId &&
    actorTenantOwnerId === targetTenantOwnerId
  );
};

const normalizeVacationRequestType = (value) => {
  const normalized = String(value || 'VACATION').trim().toUpperCase();
  return VACATION_REQUEST_TYPES.includes(normalized) ? normalized : null;
};

const parseVacationRequestTypeFromReason = (value) => {
  const normalized = String(value || '').trim();

  if (!normalized) {
    return {
      requestType: 'VACATION',
      reason: null,
    };
  }

  if (normalized === DAY_OFF_REASON_PREFIX || normalized.startsWith(`${DAY_OFF_REASON_PREFIX} `)) {
    const cleanedReason = normalized.replace(DAY_OFF_REASON_PREFIX, '').trim();
    return {
      requestType: 'DAY_OFF',
      reason: cleanedReason || null,
    };
  }

  return {
    requestType: 'VACATION',
    reason: normalized,
  };
};

const encodeVacationReasonWithType = ({ requestType, reason }) => {
  const normalizedReason = String(reason || '').trim();
  const normalizedType = normalizeVacationRequestType(requestType) || 'VACATION';

  if (normalizedType === 'DAY_OFF') {
    return normalizedReason ? `${DAY_OFF_REASON_PREFIX} ${normalizedReason}` : DAY_OFF_REASON_PREFIX;
  }

  return normalizedReason || null;
};

const getRequestTypeLabelPt = (requestType) => (requestType === 'DAY_OFF' ? 'folga' : 'férias');

const withUserPhoto = (req, user) => {
  if (!user) return user;
  return {
    ...user,
    photoUrl: buildUserPhotoUrl(req, user.photoPath),
  };
};

const withRequestPhoto = (req, request) => {
  const parsedReason = parseVacationRequestTypeFromReason(request.reason);

  return {
    ...request,
    requestType: parsedReason.requestType,
    reason: parsedReason.reason,
    user: withUserPhoto(req, request.user),
    supervisor: withUserPhoto(req, request.supervisor),
    hrReviewer: withUserPhoto(req, request.hrReviewer),
    logs: Array.isArray(request.logs)
      ? request.logs.map((log) => ({
          ...log,
          actor: withUserPhoto(req, log.actor),
        }))
      : request.logs,
  };
};

const parseDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const startOfDay = (date) => {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

const endOfDay = (date) => {
  const normalized = new Date(date);
  normalized.setHours(23, 59, 59, 999);
  return normalized;
};

const sendVacationEmailNotification = ({ to, subject, body }) => {
  // Placeholder de notificacao por e-mail ate integrar SMTP provider.
  console.log(`📧 [Vacation] To: ${to} | Subject: ${subject} | Body: ${body}`);
};

const validateVacationDateRange = ({ startDate, endDate }) => {
  const parsedStart = parseDate(startDate);
  const parsedEnd = parseDate(endDate);

  if (!parsedStart || !parsedEnd) {
    return { valid: false, message: 'Datas inválidas. Use o formato ISO ou YYYY-MM-DD.' };
  }

  const normalizedStart = startOfDay(parsedStart);
  const normalizedEnd = endOfDay(parsedEnd);

  if (normalizedStart > normalizedEnd) {
    return { valid: false, message: 'Data inicial não pode ser maior que a data final.' };
  }

  return {
    valid: true,
    startDate: normalizedStart,
    endDate: normalizedEnd,
  };
};

const createVacationRequest = async (req, res) => {
  try {
    const { startDate, endDate, reason, requestType } = req.body || {};
    const userId = req.user.id;
    const normalizedRequestType = normalizeVacationRequestType(requestType);

    if (!normalizedRequestType) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Tipo de solicitação inválido. Use VACATION ou DAY_OFF.',
      });
    }

    const dateValidation = validateVacationDateRange({ startDate, endDate });
    if (!dateValidation.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: dateValidation.message,
      });
    }

    const startDayKey = `${dateValidation.startDate.getFullYear()}-${dateValidation.startDate.getMonth()}-${dateValidation.startDate.getDate()}`;
    const endDayKey = `${dateValidation.endDate.getFullYear()}-${dateValidation.endDate.getMonth()}-${dateValidation.endDate.getDate()}`;

    if (normalizedRequestType === 'DAY_OFF' && startDayKey !== endDayKey) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Solicitação de folga deve ser para um único dia.',
      });
    }

    const normalizedReason = String(reason || '').trim();
    const encodedReason = encodeVacationReasonWithType({
      requestType: normalizedRequestType,
      reason: normalizedReason,
    });
    const requestTypeLabelPt = getRequestTypeLabelPt(normalizedRequestType);

    if (!req.user.supervisorId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Você não possui supervisor associado para aprovar férias.',
      });
    }

    const overlappingRequest = await prisma.vacationRequest.findFirst({
      where: {
        userId,
        status: { in: ACTIVE_VACATION_STATUSES },
        startDate: { lte: dateValidation.endDate },
        endDate: { gte: dateValidation.startDate },
      },
      select: {
        id: true,
      },
    });

    if (overlappingRequest) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Já existe solicitação de férias sobreposta para este período.',
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.vacationRequest.create({
        data: {
          userId,
          supervisorId: req.user.supervisorId,
          startDate: dateValidation.startDate,
          endDate: dateValidation.endDate,
          reason: encodedReason,
          status: 'REQUESTED',
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          supervisor: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      await tx.vacationApprovalLog.create({
        data: {
          vacationRequestId: request.id,
          actorId: userId,
          action: 'REQUESTED',
          comment: normalizedReason || (normalizedRequestType === 'DAY_OFF' ? 'Solicitação de folga' : null),
          toStatus: 'REQUESTED',
        },
      });

      return request;
    });

    if (created.supervisor?.email) {
      sendVacationEmailNotification({
        to: created.supervisor.email,
        subject: `Nova solicitação de ${requestTypeLabelPt} pendente`,
        body: `${created.user.name || created.user.email} solicitou ${requestTypeLabelPt} de ${created.startDate.toISOString()} até ${created.endDate.toISOString()}.`,
      });
    }

    sendVacationEmailNotification({
      to: created.user.email,
      subject: `Solicitação de ${requestTypeLabelPt} registrada`,
      body: `Sua solicitação de ${requestTypeLabelPt} foi registrada e aguarda aprovação do supervisor.`,
    });

    return res.status(201).json({
      message:
        normalizedRequestType === 'DAY_OFF'
          ? 'Solicitação de folga enviada com sucesso.'
          : 'Solicitação de férias enviada com sucesso.',
      request: withRequestPhoto(req, created),
    });
  } catch (error) {
    console.error('❌ Erro ao criar solicitação de férias:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao criar solicitação de férias',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

const getMyVacationRequests = async (req, res) => {
  try {
    const requests = await prisma.vacationRequest.findMany({
      where: { userId: req.user.id },
      include: {
        supervisor: {
          select: {
            id: true,
            name: true,
            email: true,
            photoPath: true,
          },
        },
        hrReviewer: {
          select: {
            id: true,
            name: true,
            email: true,
            photoPath: true,
          },
        },
        logs: {
          orderBy: { timestamp: 'desc' },
          include: {
            actor: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                photoPath: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    return res.json({ requests: requests.map((request) => withRequestPhoto(req, request)) });
  } catch (error) {
    console.error('❌ Erro ao buscar minhas solicitações de férias:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar solicitações de férias',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

const reviewVacationBySupervisor = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, comment } = req.body || {};
    const reviewerId = req.user.id;
    const isAdmin = isElevatedVacationViewer(req.user.role);

    if (!['APPROVE', 'REJECT'].includes(decision)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'decision inválida. Use APPROVE ou REJECT.',
      });
    }

    if (decision === 'REJECT' && (!comment || String(comment).trim().length < 5)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Comentário obrigatório para rejeição (mínimo 5 caracteres).',
      });
    }

    const request = await prisma.vacationRequest.findUnique({
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
        supervisor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!request) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Solicitação de férias não encontrada.',
      });
    }

    if (!isAdmin && request.user.supervisorId !== reviewerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você só pode revisar solicitações dos seus subordinados.',
      });
    }

    if (request.status !== 'REQUESTED') {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Solicitação não está pendente de supervisor. Status atual: ${request.status}`,
      });
    }

    const nextStatus = decision === 'APPROVE' ? 'SUPERVISOR_APPROVED' : 'SUPERVISOR_REJECTED';

    const updated = await prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.vacationRequest.update({
        where: { id },
        data: {
          status: nextStatus,
          supervisorId: request.user.supervisorId,
          supervisorReviewedAt: new Date(),
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          supervisor: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      await tx.vacationApprovalLog.create({
        data: {
          vacationRequestId: id,
          actorId: reviewerId,
          action: decision === 'APPROVE' ? 'SUPERVISOR_APPROVED' : 'SUPERVISOR_REJECTED',
          comment: comment ? String(comment).trim() : null,
          fromStatus: request.status,
          toStatus: nextStatus,
        },
      });

      return updatedRequest;
    });

    const parsedReason = parseVacationRequestTypeFromReason(request.reason);
    const requestTypeLabelPt = getRequestTypeLabelPt(parsedReason.requestType);

    sendVacationEmailNotification({
      to: updated.user.email,
      subject: `Atualização da solicitação de ${requestTypeLabelPt}`,
      body:
        decision === 'APPROVE'
          ? `Sua solicitação de ${requestTypeLabelPt} foi aprovada pelo supervisor e enviada para confirmação do RH.`
          : `Sua solicitação de ${requestTypeLabelPt} foi rejeitada pelo supervisor.`,
    });

    return res.json({
      message:
        decision === 'APPROVE'
          ? 'Solicitação aprovada pelo supervisor.'
          : 'Solicitação rejeitada pelo supervisor.',
      request: withRequestPhoto(req, updated),
    });
  } catch (error) {
    console.error('❌ Erro ao revisar solicitação de férias pelo supervisor:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao revisar solicitação de férias',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

const reviewVacationByHr = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, comment } = req.body || {};

    if (!['CONFIRM', 'REJECT'].includes(decision)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'decision inválida. Use CONFIRM ou REJECT.',
      });
    }

    if (decision === 'REJECT' && (!comment || String(comment).trim().length < 5)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Comentário obrigatório para rejeição do RH (mínimo 5 caracteres).',
      });
    }

    const request = await prisma.vacationRequest.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            organizationAdminId: true,
          },
        },
      },
    });

    if (!request) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Solicitação de férias não encontrada.',
      });
    }

    if (req.user.role !== 'SUPERADMIN') {
      const actorTenantOwnerId = await resolveActorTenantOwnerId(req.user);

      if (
        !canReviewVacationWithinTenant({
          actorTenantOwnerId,
          targetUser: request.user,
        })
      ) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Você não tem permissão para revisar esta solicitação de férias',
        });
      }
    }

    if (request.status !== 'SUPERVISOR_APPROVED') {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Solicitação não está pendente de RH. Status atual: ${request.status}`,
      });
    }

    const nextStatus = decision === 'CONFIRM' ? 'HR_CONFIRMED' : 'HR_REJECTED';

    const updated = await prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.vacationRequest.update({
        where: { id },
        data: {
          status: nextStatus,
          hrReviewerId: req.user.id,
          hrReviewedAt: new Date(),
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          hrReviewer: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      await tx.vacationApprovalLog.create({
        data: {
          vacationRequestId: id,
          actorId: req.user.id,
          action: decision === 'CONFIRM' ? 'HR_CONFIRMED' : 'HR_REJECTED',
          comment: comment ? String(comment).trim() : null,
          fromStatus: request.status,
          toStatus: nextStatus,
        },
      });

      return updatedRequest;
    });

    const parsedReason = parseVacationRequestTypeFromReason(request.reason);
    const requestTypeLabelPt = getRequestTypeLabelPt(parsedReason.requestType);

    sendVacationEmailNotification({
      to: updated.user.email,
      subject: `Resposta final do RH sobre ${requestTypeLabelPt}`,
      body:
        decision === 'CONFIRM'
          ? `Sua solicitação de ${requestTypeLabelPt} foi confirmada pelo RH.`
          : `Sua solicitação de ${requestTypeLabelPt} foi rejeitada pelo RH.`,
    });

    return res.json({
      message:
        decision === 'CONFIRM'
          ? 'Solicitação confirmada pelo RH.'
          : 'Solicitação rejeitada pelo RH.',
      request: withRequestPhoto(req, updated),
    });
  } catch (error) {
    console.error('❌ Erro ao revisar solicitação de férias pelo RH:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao revisar solicitação de férias pelo RH',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

const getTeamVacationRequests = async (req, res) => {
  try {
    const isAdmin = isElevatedVacationViewer(req.user.role);
    const { status = 'ALL' } = req.query;

    const members = await prisma.user.findMany({
      where: isAdmin
        ? { role: { notIn: ['ADMIN', 'HR'] }, isActive: true }
        : { supervisorId: req.user.id, isActive: true },
      select: { id: true },
    });

    const memberIds = members.map((item) => item.id);

    if (memberIds.length === 0) {
      return res.json({ requests: [] });
    }

    const where = {
      userId: { in: memberIds },
      ...(status !== 'ALL' ? { status } : {}),
    };

    const requests = await prisma.vacationRequest.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            photoPath: true,
          },
        },
        supervisor: {
          select: {
            id: true,
            name: true,
            email: true,
            photoPath: true,
          },
        },
        hrReviewer: {
          select: {
            id: true,
            name: true,
            email: true,
            photoPath: true,
          },
        },
        logs: {
          orderBy: { timestamp: 'desc' },
          include: {
            actor: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                photoPath: true,
              },
            },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    return res.json({ requests: requests.map((request) => withRequestPhoto(req, request)) });
  } catch (error) {
    console.error('❌ Erro ao listar solicitações de férias da equipe:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao listar solicitações de férias da equipe',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

const getHrVacationRequests = async (req, res) => {
  try {
    const { status = 'SUPERVISOR_APPROVED' } = req.query;

    const requests = await prisma.vacationRequest.findMany({
      where: {
        ...(status !== 'ALL' ? { status } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            photoPath: true,
          },
        },
        supervisor: {
          select: {
            id: true,
            name: true,
            email: true,
            photoPath: true,
          },
        },
        hrReviewer: {
          select: {
            id: true,
            name: true,
            email: true,
            photoPath: true,
          },
        },
        logs: {
          orderBy: { timestamp: 'desc' },
          include: {
            actor: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                photoPath: true,
              },
            },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    return res.json({ requests: requests.map((request) => withRequestPhoto(req, request)) });
  } catch (error) {
    console.error('❌ Erro ao listar solicitações de férias para RH:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao listar solicitações de férias para RH',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

const getTeamVacationCalendar = async (req, res) => {
  try {
    const isAdmin = isElevatedVacationViewer(req.user.role);
    const supervisorId = req.user.id;

    const now = new Date();
    const year = Math.max(2000, Number(req.query.year) || now.getFullYear());
    const month = Math.min(12, Math.max(1, Number(req.query.month) || now.getMonth() + 1));
    const minPresencePercent = Math.min(100, Math.max(0, Number(req.query.minPresencePercent) || 70));

    const rangeStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const rangeEnd = new Date(year, month, 0, 23, 59, 59, 999);

    const teamMembers = await prisma.user.findMany({
      where: isAdmin
        ? { role: { not: 'ADMIN' }, isActive: true }
        : { supervisorId, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
      },
      orderBy: { name: 'asc' },
    });

    const memberIds = teamMembers.map((member) => member.id);

    if (memberIds.length === 0) {
      return res.json({
        month: { year, month },
        minPresencePercent,
        teamSize: 0,
        days: [],
        annual: [],
        requests: [],
      });
    }

    const visibleStatuses = req.user.role === 'HR'
      ? ['SUPERVISOR_APPROVED', 'HR_CONFIRMED']
      : ['REQUESTED', 'SUPERVISOR_APPROVED', 'HR_CONFIRMED'];

    const requests = await prisma.vacationRequest.findMany({
      where: {
        userId: { in: memberIds },
        status: { in: visibleStatuses },
        startDate: { lte: rangeEnd },
        endDate: { gte: rangeStart },
      },
      select: {
        id: true,
        userId: true,
        startDate: true,
        endDate: true,
        reason: true,
        status: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            photoPath: true,
          },
        },
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
    });

    const totalDaysInMonth = new Date(year, month, 0).getDate();
    const days = [];

    for (let day = 1; day <= totalDaysInMonth; day += 1) {
      const currentDate = new Date(year, month - 1, day, 12, 0, 0, 0);

      const overlapping = requests.filter((request) => {
        return request.startDate <= currentDate && request.endDate >= currentDate;
      });

      const absentUserIds = Array.from(new Set(overlapping.map((item) => item.userId)));
      const absentCount = absentUserIds.length;
      const availableCount = teamMembers.length - absentCount;
      const presencePercent = teamMembers.length > 0 ? (availableCount / teamMembers.length) * 100 : 100;

      days.push({
        date: currentDate.toISOString().split('T')[0],
        absentCount,
        availableCount,
        teamSize: teamMembers.length,
        presencePercent: Number(presencePercent.toFixed(2)),
        belowThreshold: presencePercent < minPresencePercent,
        membersOnVacation: overlapping.map((item) => ({
          ...parseVacationRequestTypeFromReason(item.reason),
          id: item.user.id,
          name: item.user.name,
          email: item.user.email,
          photoUrl: buildUserPhotoUrl(req, item.user.photoPath),
          status: item.status,
        })),
      });
    }

    const annual = [];

    for (let m = 1; m <= 12; m += 1) {
      const monthStart = new Date(year, m - 1, 1, 0, 0, 0, 0);
      const monthEnd = new Date(year, m, 0, 23, 59, 59, 999);

      const monthRequests = await prisma.vacationRequest.findMany({
        where: {
          userId: { in: memberIds },
          status: { in: visibleStatuses },
          startDate: { lte: monthEnd },
          endDate: { gte: monthStart },
        },
        select: {
          userId: true,
          startDate: true,
          endDate: true,
        },
      });

      const uniqueUsers = new Set(monthRequests.map((item) => item.userId));

      annual.push({
        year,
        month: m,
        requestsCount: monthRequests.length,
        membersScheduled: uniqueUsers.size,
      });
    }

    return res.json({
      month: { year, month },
      minPresencePercent,
      teamSize: teamMembers.length,
      days,
      annual,
      requests: requests.map((request) => ({
        ...request,
        ...parseVacationRequestTypeFromReason(request.reason),
      })),
    });
  } catch (error) {
    console.error('❌ Erro ao montar calendário de férias da equipe:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar calendário de férias da equipe',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

module.exports = {
  createVacationRequest,
  getMyVacationRequests,
  getTeamVacationRequests,
  getHrVacationRequests,
  reviewVacationBySupervisor,
  reviewVacationByHr,
  getTeamVacationCalendar,
};
