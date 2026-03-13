const prisma = require('../config/database');
const { hashPin, isValidPinFormat } = require('../utils/pinAuth');
const { adjustBankHours, settleBankHoursAccruals } = require('../utils/bankHours');
const { normalizeMinutes, normalizeTime, normalizeHourlyRate, normalizeTimeZone } = require('../utils/workSettings');

/**
 * Controller para funcionalidades administrativas e auditoria
 */

/**
 * GET /admin/audit/:timeEntryId
 * Retorna todo o histórico de alterações de um registro de ponto
 */
const getTimeEntryAuditLog = async (req, res) => {
  try {
    const { timeEntryId } = req.params;

    // Busca o registro de ponto
    const timeEntry = await prisma.timeEntry.findUnique({
      where: { id: timeEntryId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            supervisor: {
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

    if (!timeEntry) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Registro de ponto não encontrado',
      });
    }

    // Busca todos os logs de aprovação relacionados
    const auditLogs = await prisma.approvalLog.findMany({
      where: { timeEntryId },
      include: {
        reviewer: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { timestamp: 'asc' },
    });

    // Calcula duração
    let duration = null;
    if (timeEntry.clockIn && timeEntry.clockOut) {
      const diff = new Date(timeEntry.clockOut) - new Date(timeEntry.clockIn);
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      duration = {
        hours,
        minutes,
        formatted: `${hours}h ${minutes}m`,
        totalMinutes: Math.floor(diff / 60000),
      };
    }

    // Monta timeline de eventos
    const timeline = [
      {
        event: 'CLOCK_IN',
        description: 'Registro de entrada',
        timestamp: timeEntry.clockIn,
        actor: timeEntry.user,
        details: {
          ipAddress: timeEntry.ipAddress,
          device: timeEntry.device,
          location: timeEntry.location,
          notes: timeEntry.notes,
        },
      },
    ];

    // Adiciona clock-out se existir
    if (timeEntry.clockOut) {
      timeline.push({
        event: 'CLOCK_OUT',
        description: 'Registro de saída',
        timestamp: timeEntry.clockOut,
        actor: timeEntry.user,
        details: {
          duration,
        },
      });
    }

    // Adiciona logs de aprovação
    auditLogs.forEach((log) => {
      const eventDescriptions = {
        APPROVED: 'Registro aprovado',
        REJECTED: 'Registro rejeitado',
        EDIT_REQUESTED: 'Solicitação de edição',
      };

      timeline.push({
        event: log.action,
        description: eventDescriptions[log.action] || log.action,
        timestamp: log.timestamp,
        actor: log.reviewer,
        details: {
          comment: log.comment,
        },
      });
    });

    // Ordena timeline por timestamp
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.json({
      timeEntry: {
        id: timeEntry.id,
        userId: timeEntry.userId,
        user: timeEntry.user,
        clockIn: timeEntry.clockIn,
        clockOut: timeEntry.clockOut,
        status: timeEntry.status,
        duration,
        createdAt: timeEntry.createdAt,
        updatedAt: timeEntry.updatedAt,
      },
      auditLogs,
      timeline,
      summary: {
        totalEvents: timeline.length,
        currentStatus: timeEntry.status,
        lastAction: auditLogs.length > 0 ? auditLogs[auditLogs.length - 1] : null,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar auditoria:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar histórico de auditoria',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /admin/users/:userId/entries
 * Lista todos os registros de ponto de um usuário (Admin view)
 */
const getUserTimeEntries = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, status, startDate, endDate } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Verifica se usuário existe
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        supervisor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    // Filtros
    const where = { userId };

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

    const [entries, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        include: {
          logs: {
            orderBy: { timestamp: 'desc' },
            take: 1,
            include: {
              reviewer: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: { clockIn: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.timeEntry.count({ where }),
    ]);

    // Calcula estatísticas
    const stats = await prisma.timeEntry.groupBy({
      by: ['status'],
      where: { userId },
      _count: true,
    });

    const statsFormatted = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    stats.forEach((s) => {
      statsFormatted[s.status] = s._count;
    });

    // Calcula total de horas trabalhadas (apenas aprovados)
    const approvedEntries = await prisma.timeEntry.findMany({
      where: {
        userId,
        status: 'APPROVED',
        clockOut: { not: null },
      },
      select: {
        clockIn: true,
        clockOut: true,
      },
    });

    let totalWorkedMinutes = 0;
    approvedEntries.forEach((entry) => {
      if (entry.clockIn && entry.clockOut) {
        totalWorkedMinutes += Math.floor(
          (new Date(entry.clockOut) - new Date(entry.clockIn)) / 60000
        );
      }
    });

    const totalWorkedHours = Math.floor(totalWorkedMinutes / 60);
    const totalWorkedMins = totalWorkedMinutes % 60;

    res.json({
      user,
      entries: entries.map((entry) => ({
        ...entry,
        duration:
          entry.clockIn && entry.clockOut
            ? (() => {
                const diff = new Date(entry.clockOut) - new Date(entry.clockIn);
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                return { hours, minutes, formatted: `${hours}h ${minutes}m` };
              })()
            : null,
        lastAction: entry.logs[0] || null,
      })),
      stats: statsFormatted,
      totalWorked: {
        hours: totalWorkedHours,
        minutes: totalWorkedMins,
        formatted: `${totalWorkedHours}h ${totalWorkedMins}m`,
        totalMinutes: totalWorkedMinutes,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar registros do usuário:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar registros',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * PATCH /admin/users/:userId/supervisor
 * Altera o supervisor de um usuário
 */
const changeUserSupervisor = async (req, res) => {
  try {
    const { userId } = req.params;
    const { supervisorId } = req.body;

    // Verifica se usuário existe
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    // Validações
    if (supervisorId === userId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Um usuário não pode ser supervisor de si mesmo',
      });
    }

    // Se supervisorId for null, remove o supervisor
    if (supervisorId === null) {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { supervisorId: null },
        include: {
          supervisor: true,
        },
      });

      return res.json({
        message: 'Supervisor removido com sucesso',
        user: updatedUser,
      });
    }

    // Verifica se novo supervisor existe
    const newSupervisor = await prisma.user.findUnique({
      where: { id: supervisorId },
    });

    if (!newSupervisor) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Novo supervisor não encontrado',
      });
    }

    // Verifica se pode ser supervisor
    if (!['ADMIN', 'SUPERVISOR'].includes(newSupervisor.role)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Apenas Admin ou Supervisor podem ser atribuídos como supervisores',
      });
    }

    // Previne hierarquia circular
    if (newSupervisor.supervisorId === userId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Não é possível criar hierarquia circular de supervisores',
      });
    }

    // Atualiza supervisor
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { supervisorId },
      include: {
        supervisor: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    console.log(
      `✅ Supervisor alterado: ${user.email} agora é supervisionado por ${newSupervisor.email}`
    );

    res.json({
      message: 'Supervisor alterado com sucesso',
      user: updatedUser,
      previousSupervisorId: user.supervisorId,
      newSupervisorId: supervisorId,
    });
  } catch (error) {
    console.error('❌ Erro ao alterar supervisor:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao alterar supervisor',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * PATCH /admin/users/:userId/pin
 * Define ou altera o PIN de um usuário (Admin only)
 */
const setUserPin = async (req, res) => {
  try {
    const { userId } = req.params;
    const { pin } = req.body;

    if (!isValidPinFormat(pin)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'PIN inválido. Use apenas números com 4 a 8 dígitos.',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    const { hash, salt } = hashPin(pin);

    await prisma.user.update({
      where: { id: userId },
      data: {
        pinHash: hash,
        pinSalt: salt,
        pinUpdatedAt: new Date(),
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });

    res.json({
      message: 'PIN definido com sucesso',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        hasPin: true,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao definir PIN:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao definir PIN',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * DELETE /admin/users/:userId/pin
 * Remove/reset PIN de um usuário (Admin only)
 */
const resetUserPin = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        pinHash: null,
        pinSalt: null,
        pinUpdatedAt: null,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });

    res.json({
      message: 'PIN resetado com sucesso',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        hasPin: false,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao resetar PIN:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao resetar PIN',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /admin/stats
 * Estatísticas gerais do sistema
 */
const getSystemStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Filtros de data
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.clockIn = {};
      if (startDate) {
        dateFilter.clockIn.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.clockIn.lte = end;
      }
    }

    // Contagem de usuários por role
    const usersByRole = await prisma.user.groupBy({
      by: ['role'],
      _count: true,
    });

    // Contagem de registros por status
    const entriesByStatus = await prisma.timeEntry.groupBy({
      by: ['status'],
      where: dateFilter,
      _count: true,
    });

    // Total de registros
    const totalEntries = await prisma.timeEntry.count({ where: dateFilter });

    // Registros pendentes de aprovação
    const pendingEntries = await prisma.timeEntry.count({
      where: { ...dateFilter, status: 'PENDING' },
    });

    // Registros hoje
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayEntries = await prisma.timeEntry.count({
      where: {
        clockIn: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    // Usuários ativos hoje (que fizeram clock-in)
    const activeUsersToday = await prisma.timeEntry.findMany({
      where: {
        clockIn: {
          gte: today,
          lt: tomorrow,
        },
      },
      distinct: ['userId'],
      select: { userId: true },
    });

    // Total de horas trabalhadas (aprovadas)
    const approvedEntries = await prisma.timeEntry.findMany({
      where: {
        ...dateFilter,
        status: 'APPROVED',
        clockOut: { not: null },
      },
      select: {
        clockIn: true,
        clockOut: true,
      },
    });

    let totalApprovedMinutes = 0;
    approvedEntries.forEach((entry) => {
      if (entry.clockIn && entry.clockOut) {
        totalApprovedMinutes += Math.floor(
          (new Date(entry.clockOut) - new Date(entry.clockIn)) / 60000
        );
      }
    });

    // Últimas ações de aprovação
    const recentApprovals = await prisma.approvalLog.findMany({
      take: 10,
      orderBy: { timestamp: 'desc' },
      include: {
        reviewer: {
          select: { id: true, name: true, email: true },
        },
        timeEntry: {
          select: {
            id: true,
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    res.json({
      users: {
        total: usersByRole.reduce((acc, r) => acc + r._count, 0),
        byRole: usersByRole.reduce((acc, r) => {
          acc[r.role] = r._count;
          return acc;
        }, {}),
      },
      timeEntries: {
        total: totalEntries,
        byStatus: entriesByStatus.reduce((acc, s) => {
          acc[s.status] = s._count;
          return acc;
        }, {}),
        pendingApproval: pendingEntries,
        today: todayEntries,
      },
      activity: {
        activeUsersToday: activeUsersToday.length,
        totalApprovedHours: Math.floor(totalApprovedMinutes / 60),
        totalApprovedMinutes: totalApprovedMinutes % 60,
      },
      recentApprovals: recentApprovals.map((log) => ({
        id: log.id,
        action: log.action,
        timestamp: log.timestamp,
        reviewer: log.reviewer,
        timeEntry: log.timeEntry,
        comment: log.comment,
      })),
    });
  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar estatísticas do sistema',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /admin/team-overview
 * Visão geral de todas as equipes
 */
const getTeamOverview = async (req, res) => {
  try {
    // Busca todos os supervisores com seus subordinados
    const supervisors = await prisma.user.findMany({
      where: {
        role: { in: ['ADMIN', 'SUPERVISOR'] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        subordinates: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    // Para cada supervisor, busca estatísticas de registros pendentes
    const teamsWithStats = await Promise.all(
      supervisors.map(async (sup) => {
        const subordinateIds = sup.subordinates.map((s) => s.id);

        if (subordinateIds.length === 0) {
          return {
            ...sup,
            stats: { PENDING: 0, APPROVED: 0, REJECTED: 0 },
            totalMembers: 0,
          };
        }

        const stats = await prisma.timeEntry.groupBy({
          by: ['status'],
          where: { userId: { in: subordinateIds } },
          _count: true,
        });

        const statsFormatted = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
        stats.forEach((s) => {
          statsFormatted[s.status] = s._count;
        });

        return {
          ...sup,
          stats: statsFormatted,
          totalMembers: subordinateIds.length,
        };
      })
    );

    // Usuários sem supervisor
    const usersWithoutSupervisor = await prisma.user.findMany({
      where: {
        supervisorId: null,
        role: 'MEMBER',
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    res.json({
      teams: teamsWithStats,
      usersWithoutSupervisor,
      summary: {
        totalTeams: supervisors.length,
        totalUsersWithoutSupervisor: usersWithoutSupervisor.length,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar visão geral das equipes:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar visão geral',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * PATCH /admin/users/:userId/bank-hours
 * Ajusta saldo do banco de horas (RH/Admin)
 * Body: { minutesDelta?: number, reason?: string, resetToZero?: boolean }
 */
const adjustUserBankHours = async (req, res) => {
  try {
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

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    if (!targetUser) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    const result = await adjustBankHours({
      userId,
      actorId: req.user.id,
      minutesDelta: parsedDelta,
      reason: String(reason).trim(),
      resetToZero: shouldReset,
    });

    if (!result) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    res.json({
      message: shouldReset ? 'Saldo de banco de horas zerado com sucesso' : 'Banco de horas ajustado com sucesso',
      user: targetUser,
      adjustment: {
        previousBalanceMinutes: result.previousBalance,
        appliedDeltaMinutes: result.appliedDelta,
        currentBalanceMinutes: result.balanceMinutes,
        maxLimitMinutes: result.maxLimit ?? null,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao ajustar banco de horas:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao ajustar banco de horas',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * PATCH /admin/users/:userId/work-settings
 * Define jornada e valor hora do colaborador
 * Body: { contractDailyMinutes?: number, workdayStartTime?: "08:00", workdayEndTime?: "17:00", hourlyRate?: number, timeZone?: string }
 */
const updateUserWorkSettings = async (req, res) => {
  try {
    const { userId } = req.params;
    const { contractDailyMinutes, workdayStartTime, workdayEndTime, hourlyRate, timeZone } = req.body;

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

    if (hourlyRate !== undefined) {
      const normalizedRate = normalizeHourlyRate(hourlyRate);
      if (normalizedRate === null) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'hourlyRate inválido. Use um número maior ou igual a zero.',
        });
      }
      updateData.hourlyRate = normalizedRate;
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    const updatedUser = await prisma.user.update({
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
        hourlyRate: true,
        timeZone: true,
      },
    });

    res.json({
      message: 'Configurações de jornada e valor-hora atualizadas com sucesso',
      user: updatedUser,
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar configuração de jornada/valor-hora:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao atualizar configuração de jornada/valor-hora',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /admin/bank-hours/overview
 * Lista saldo e status de banco de horas por colaborador
 */
const getBankHoursOverview = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        role: { not: 'ADMIN' },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        bankHoursBalanceMinutes: true,
      },
      orderBy: { name: 'asc' },
    });

    const ids = users.map((u) => u.id);

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

    const overview = users.map((user) => {
      const balance = user.bankHoursBalanceMinutes || 0;
      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        bankHours: {
          balanceMinutes: balance,
          creditMinutes: Math.max(0, balance),
          debtMinutes: Math.max(0, -balance),
          pendingMinutes: pendingMap[user.id] || 0,
          paidMinutes: paidMap[user.id] || 0,
        },
      };
    });

    res.json({ overview });
  } catch (error) {
    console.error('❌ Erro ao buscar overview de banco de horas:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar overview de banco de horas',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * PATCH /admin/users/:userId/bank-hours/pay
 * Dá baixa (paga) banco de horas pendente de um colaborador
 */
const payUserBankHours = async (req, res) => {
  try {
    const { userId } = req.params;
    const { entryIds, payAllPending = true, paymentNote } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Usuário não encontrado',
      });
    }

    const result = await settleBankHoursAccruals({
      userId,
      actorId: req.user.id,
      entryIds: Array.isArray(entryIds) ? entryIds : [],
      payAllPending: Boolean(payAllPending),
      paymentNote: paymentNote ? String(paymentNote).trim() : null,
    });

    res.json({
      message: result.paidMinutes > 0 ? 'Baixa de banco de horas realizada com sucesso' : 'Nenhum saldo pendente para baixa',
      user,
      payment: {
        paidMinutes: result.paidMinutes,
        paidEntries: result.paidEntries,
        currentBalanceMinutes: result.balanceMinutes,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao dar baixa no banco de horas:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao dar baixa no banco de horas',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

module.exports = {
  getTimeEntryAuditLog,
  getUserTimeEntries,
  changeUserSupervisor,
  getSystemStats,
  getTeamOverview,
  setUserPin,
  resetUserPin,
  adjustUserBankHours,
  updateUserWorkSettings,
  getBankHoursOverview,
  payUserBankHours,
};
