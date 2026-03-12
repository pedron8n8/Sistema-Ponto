const prisma = require('../config/database');

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

module.exports = {
  getTimeEntryAuditLog,
  getUserTimeEntries,
  changeUserSupervisor,
  getSystemStats,
  getTeamOverview,
};
