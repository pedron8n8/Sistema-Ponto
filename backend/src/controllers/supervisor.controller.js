const prisma = require('../config/database');
const { adjustBankHours, settleBankHoursAccruals } = require('../utils/bankHours');
const { normalizeMinutes, normalizeTime, normalizeTimeZone } = require('../utils/workSettings');

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
    const isAdmin = req.user.role === 'ADMIN';
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
    const isAdmin = req.user.role === 'ADMIN';
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
    const isAdmin = req.user.role === 'ADMIN';
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
    const isAdmin = req.user.role === 'ADMIN';
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
    const isAdmin = req.user.role === 'ADMIN';
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
    const isAdmin = req.user.role === 'ADMIN';

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
 * PATCH /supervisor/team/:userId/bank-hours
 * Ajusta/zera banco de horas de membro da equipe (gestor)
 */
const adjustTeamMemberBankHours = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const isAdmin = req.user.role === 'ADMIN';
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
    const isAdmin = req.user.role === 'ADMIN';
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
    const isAdmin = req.user.role === 'ADMIN';

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
    const isAdmin = req.user.role === 'ADMIN';
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
  adjustTeamMemberBankHours,
  updateTeamMemberWorkSettings,
  getTeamBankHoursOverview,
  payTeamMemberBankHours,
};
