const prisma = require('../config/database');
const { captureRequestMetadata } = require('../utils/requestMetadata');
const { calculateDuration, getStartOfDay, getEndOfDay } = require('../utils/timeCalculations');

/**
 * Controller para gerenciamento de registros de ponto
 */

/**
 * POST /time/clock-in
 * Registra início do ponto
 */
const clockIn = async (req, res) => {
  try {
    const userId = req.user.id;
    const { notes } = req.body;

    // Verifica se já existe um ponto aberto (sem clock-out) para o usuário
    const openEntry = await prisma.timeEntry.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    if (openEntry) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Você já possui um ponto aberto. Faça clock-out antes de iniciar um novo registro.',
        openEntry: {
          id: openEntry.id,
          clockIn: openEntry.clockIn,
          notes: openEntry.notes,
        },
      });
    }

    // Captura metadados da requisição
    const metadata = captureRequestMetadata(req);

    // Cria novo registro de ponto
    const timeEntry = await prisma.timeEntry.create({
      data: {
        userId,
        clockIn: new Date(),
        notes: notes || null,
        ipAddress: metadata.ip,
        device: metadata.device,
        location: metadata.location,
        status: 'PENDING',
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
    });

    console.log(`✅ Clock-in registrado: ${req.user.email} às ${timeEntry.clockIn}`);

    res.status(201).json({
      message: 'Clock-in registrado com sucesso',
      timeEntry: {
        id: timeEntry.id,
        userId: timeEntry.userId,
        clockIn: timeEntry.clockIn,
        notes: timeEntry.notes,
        ipAddress: timeEntry.ipAddress,
        device: timeEntry.device,
        location: timeEntry.location,
        status: timeEntry.status,
        user: timeEntry.user,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao registrar clock-in:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao registrar entrada',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * POST /time/clock-out
 * Registra fim do ponto
 */
const clockOut = async (req, res) => {
  try {
    const userId = req.user.id;
    const { notes } = req.body;

    // Busca o último registro aberto (sem clock-out)
    const openEntry = await prisma.timeEntry.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    if (!openEntry) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Não há registro de ponto aberto. Faça clock-in primeiro.',
      });
    }

    const clockOutTime = new Date();

    // Atualiza o registro com clock-out
    const updatedEntry = await prisma.timeEntry.update({
      where: { id: openEntry.id },
      data: {
        clockOut: clockOutTime,
        notes: notes || openEntry.notes,
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
    });

    // Calcula duração
    const duration = calculateDuration(updatedEntry.clockIn, updatedEntry.clockOut);

    console.log(
      `✅ Clock-out registrado: ${req.user.email} às ${clockOutTime} (Duração: ${duration.formatted})`
    );

    res.json({
      message: 'Clock-out registrado com sucesso',
      timeEntry: {
        id: updatedEntry.id,
        userId: updatedEntry.userId,
        clockIn: updatedEntry.clockIn,
        clockOut: updatedEntry.clockOut,
        notes: updatedEntry.notes,
        ipAddress: updatedEntry.ipAddress,
        device: updatedEntry.device,
        location: updatedEntry.location,
        status: updatedEntry.status,
        duration,
        user: updatedEntry.user,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao registrar clock-out:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao registrar saída',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /time/me
 * Retorna histórico de pontos do usuário logado
 */
const getMyTimeEntries = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      page = 1, 
      limit = 20, 
      status,
      startDate,
      endDate,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Constrói filtros
    const where = { userId };

    // Filtro por status
    if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      where.status = status;
    }

    // Filtro por período
    if (startDate || endDate) {
      where.clockIn = {};
      if (startDate) {
        where.clockIn.gte = new Date(startDate);
      }
      if (endDate) {
        where.clockIn.lte = new Date(endDate);
      }
    }

    // Busca registros e contagem total
    const [entries, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { clockIn: 'desc' },
        include: {
          logs: {
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
            orderBy: { timestamp: 'desc' },
          },
        },
      }),
      prisma.timeEntry.count({ where }),
    ]);

    // Adiciona duração calculada a cada entrada
    const entriesWithDuration = entries.map((entry) => ({
      ...entry,
      duration: entry.clockOut ? calculateDuration(entry.clockIn, entry.clockOut) : null,
    }));

    // Calcula estatísticas do período
    const stats = {
      total: total,
      pending: await prisma.timeEntry.count({ where: { userId, status: 'PENDING' } }),
      approved: await prisma.timeEntry.count({ where: { userId, status: 'APPROVED' } }),
      rejected: await prisma.timeEntry.count({ where: { userId, status: 'REJECTED' } }),
    };

    res.json({
      entries: entriesWithDuration,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
      stats,
    });
  } catch (error) {
    console.error('❌ Erro ao buscar histórico:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar histórico de pontos',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * GET /time/current
 * Retorna o registro de ponto aberto (se existir)
 */
const getCurrentEntry = async (req, res) => {
  try {
    const userId = req.user.id;

    const openEntry = await prisma.timeEntry.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
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
    });

    if (!openEntry) {
      return res.json({
        hasOpenEntry: false,
        entry: null,
      });
    }

    // Calcula quanto tempo já passou desde o clock-in
    const elapsed = calculateDuration(openEntry.clockIn, new Date());

    res.json({
      hasOpenEntry: true,
      entry: {
        ...openEntry,
        elapsed,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar registro atual:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar registro atual',
    });
  }
};

/**
 * GET /time/today
 * Retorna todos os registros do dia atual
 */
const getTodayEntries = async (req, res) => {
  try {
    const userId = req.user.id;
    const startOfDay = getStartOfDay();
    const endOfDay = getEndOfDay();

    const entries = await prisma.timeEntry.findMany({
      where: {
        userId,
        clockIn: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      orderBy: { clockIn: 'asc' },
    });

    // Calcula total de horas trabalhadas hoje
    let totalMinutes = 0;
    entries.forEach((entry) => {
      if (entry.clockOut) {
        const duration = calculateDuration(entry.clockIn, entry.clockOut);
        totalMinutes += duration.totalMinutes;
      }
    });

    const totalHours = (totalMinutes / 60).toFixed(2);

    res.json({
      entries: entries.map((entry) => ({
        ...entry,
        duration: entry.clockOut ? calculateDuration(entry.clockIn, entry.clockOut) : null,
      })),
      summary: {
        totalEntries: entries.length,
        totalMinutes,
        totalHours,
        date: new Date().toISOString().split('T')[0],
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar registros do dia:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar registros do dia',
    });
  }
};

/**
 * GET /time/:id
 * Retorna detalhes de um registro específico
 */
const getTimeEntryById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const entry = await prisma.timeEntry.findUnique({
      where: { id },
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
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    if (!entry) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Registro de ponto não encontrado',
      });
    }

    // Verifica se o usuário tem permissão para ver este registro
    if (entry.userId !== userId && !['ADMIN', 'SUPERVISOR'].includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Você não tem permissão para visualizar este registro',
      });
    }

    // Se for supervisor, verifica se é subordinado
    if (req.user.role === 'SUPERVISOR' && entry.userId !== userId) {
      const subordinate = await prisma.user.findFirst({
        where: {
          id: entry.userId,
          supervisorId: userId,
        },
      });

      if (!subordinate) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Você não tem permissão para visualizar este registro',
        });
      }
    }

    res.json({
      entry: {
        ...entry,
        duration: entry.clockOut ? calculateDuration(entry.clockIn, entry.clockOut) : null,
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar registro:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar registro',
    });
  }
};

module.exports = {
  clockIn,
  clockOut,
  getMyTimeEntries,
  getCurrentEntry,
  getTodayEntries,
  getTimeEntryById,
};
