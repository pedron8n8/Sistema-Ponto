const prisma = require('../config/database');

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
    const { status = 'PENDING', page = 1, limit = 20, userId, startDate, endDate } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Busca os subordinados do supervisor
    const subordinates = await prisma.user.findMany({
      where: {
        supervisorId: supervisorId,
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

    // Verifica se o userId solicitado é subordinado deste supervisor
    if (userId && !subordinateIds.includes(userId)) {
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
    const { id } = req.params;
    const { comment } = req.body;

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
    if (entry.user.supervisorId !== supervisorId) {
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
    const { id } = req.params;
    const { comment } = req.body;

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
    if (entry.user.supervisorId !== supervisorId) {
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
    const { id } = req.params;
    const { comment } = req.body;

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
    if (entry.user.supervisorId !== supervisorId) {
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
    if (entry.user.supervisorId !== supervisorId) {
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

    const subordinates = await prisma.user.findMany({
      where: {
        supervisorId: supervisorId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
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

module.exports = {
  getTeamPendingEntries,
  approveEntry,
  rejectEntry,
  requestEdit,
  getEntryDetails,
  getTeamMembers,
};
