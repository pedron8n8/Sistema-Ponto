const { prisma } = require('../config/database');

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const PAYROLL_USER_ROLES = ['HR', 'SUPERVISOR', 'MEMBER'];

const parseDateFilter = (value, endOfDay = false) => {
  if (!value) return null;

  if (typeof value === 'string' && DATE_ONLY_REGEX.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return endOfDay
      ? new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
      : new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toMinutes = (entry) => {
  const worked = Number(entry.workedMinutes);
  if (Number.isFinite(worked) && worked >= 0) {
    return Math.floor(worked);
  }

  if (!entry.clockIn || !entry.clockOut) {
    return 0;
  }

  const start = new Date(entry.clockIn).getTime();
  const end = new Date(entry.clockOut).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }

  return Math.floor((end - start) / 60000);
};

const toMoney = (value) => Number(Number(value || 0).toFixed(2));

const calculateFinancialSummary = ({
  workedMinutes,
  overtimeMinutes50,
  overtimeMinutes100,
  hourlyRate,
}) => {
  const rate = Number(hourlyRate || 0);
  if (!Number.isFinite(rate) || rate <= 0) {
    return {
      hourlyRate: 0,
      regularAmount: 0,
      overtime50Amount: 0,
      overtime100Amount: 0,
      overtimeTotalAmount: 0,
      totalAmount: 0,
    };
  }

  const regularMinutes = Math.max(0, workedMinutes - overtimeMinutes50 - overtimeMinutes100);
  const regularAmount = (regularMinutes / 60) * rate;
  const overtime50Amount = (overtimeMinutes50 / 60) * rate * 1.5;
  const overtime100Amount = (overtimeMinutes100 / 60) * rate * 2;
  const overtimeTotalAmount = overtime50Amount + overtime100Amount;

  return {
    hourlyRate: toMoney(rate),
    regularAmount: toMoney(regularAmount),
    overtime50Amount: toMoney(overtime50Amount),
    overtime100Amount: toMoney(overtime100Amount),
    overtimeTotalAmount: toMoney(overtimeTotalAmount),
    totalAmount: toMoney(regularAmount + overtimeTotalAmount),
  };
};

const listScopedPayrollUsers = async (adminId) => {
  const users = await prisma.user.findMany({
    where: {
      organizationAdminId: adminId,
      role: {
        in: PAYROLL_USER_ROLES,
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      hourlyRate: true,
      contractDailyMinutes: true,
      workdayStartTime: true,
      workdayEndTime: true,
      timeZone: true,
    },
    orderBy: { name: 'asc' },
  });

  return users;
};

const buildPayrollFilters = ({ startDate, endDate, status, includePending }) => {
  const start = parseDateFilter(startDate, false);
  const end = parseDateFilter(endDate, true);

  if (!start || !end) {
    return {
      error: 'startDate e endDate são obrigatórios no formato YYYY-MM-DD.',
    };
  }

  if (start > end) {
    return {
      error: 'startDate não pode ser maior que endDate.',
    };
  }

  const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > 120) {
    return {
      error: 'Intervalo máximo permitido é de 120 dias por consulta.',
    };
  }

  const normalizedStatus = String(status || '').trim().toUpperCase();
  const allowedStatuses = ['PENDING', 'APPROVED', 'REJECTED'];

  const where = {
    clockIn: {
      gte: start,
      lte: end,
    },
  };

  if (normalizedStatus) {
    if (!allowedStatuses.includes(normalizedStatus)) {
      return {
        error: `status inválido. Use ${allowedStatuses.join(', ')}`,
      };
    }
    where.status = normalizedStatus;
  } else if (!includePending) {
    where.status = 'APPROVED';
  }

  return {
    where,
    start,
    end,
    status: normalizedStatus || (includePending ? 'ALL' : 'APPROVED'),
  };
};

const serializeEntry = (entry) => {
  const workedMinutes = toMinutes(entry);
  const overtimeMinutes = Number(entry.overtimeMinutes || 0);
  const overtimeMinutes50 = Number(entry.overtimeMinutes50 || 0);
  const overtimeMinutes100 = Number(entry.overtimeMinutes100 || 0);

  const financial = calculateFinancialSummary({
    workedMinutes,
    overtimeMinutes50,
    overtimeMinutes100,
    hourlyRate: entry.user?.hourlyRate,
  });

  return {
    entryId: entry.id,
    dateKey: new Date(entry.clockIn).toISOString().slice(0, 10),
    status: entry.status,
    clockIn: entry.clockIn,
    clockOut: entry.clockOut,
    notes: entry.notes,
    workedMinutes,
    overtimeMinutes,
    overtimeMinutes50,
    overtimeMinutes100,
    overtimePercent: Number(entry.overtimePercent || 0),
    bankHoursAccruedMinutes: Number(entry.bankHoursAccruedMinutes || 0),
    employee: {
      id: entry.user.id,
      name: entry.user.name,
      email: entry.user.email,
      role: entry.user.role,
      hourlyRate: entry.user.hourlyRate !== null ? Number(entry.user.hourlyRate) : null,
      contractDailyMinutes: entry.user.contractDailyMinutes,
      workdayStartTime: entry.user.workdayStartTime,
      workdayEndTime: entry.user.workdayEndTime,
      timeZone: entry.user.timeZone,
    },
    financial,
    updatedAt: entry.updatedAt,
  };
};

/**
 * GET /public/payroll/time-entries
 * API pública PRO para integração direta com folha
 */
const getPayrollTimeEntries = async (req, res) => {
  try {
    const adminId = req.publicApiAdmin.id;
    const {
      startDate,
      endDate,
      status,
      userId,
      includePending,
      page = 1,
      limit = 100,
    } = req.query;

    const includePendingFlag = String(includePending || 'false').toLowerCase() === 'true';

    const filterResult = buildPayrollFilters({
      startDate,
      endDate,
      status,
      includePending: includePendingFlag,
    });

    if (filterResult.error) {
      return res.status(400).json({
        error: 'Bad Request',
        message: filterResult.error,
      });
    }

    const scopedUsers = await listScopedPayrollUsers(adminId);
    const scopedUserIds = scopedUsers.map((user) => user.id);

    if (scopedUserIds.length === 0) {
      return res.json({
        integration: {
          provider: 'SystemaPonto Public API',
          version: '2026-03',
          generatedAt: new Date().toISOString(),
          scopeAdminId: adminId,
        },
        filters: {
          startDate,
          endDate,
          status: filterResult.status,
          userId: userId || null,
        },
        pagination: {
          page: Number(page) || 1,
          limit: Number(limit) || 100,
          total: 0,
          totalPages: 0,
        },
        data: [],
      });
    }

    if (userId && !scopedUserIds.includes(userId)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'userId fora do escopo da administração vinculada ao token.',
      });
    }

    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const limitNumber = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
    const skip = (pageNumber - 1) * limitNumber;

    const where = {
      ...filterResult.where,
      userId: userId ? String(userId) : { in: scopedUserIds },
    };

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
              hourlyRate: true,
              contractDailyMinutes: true,
              workdayStartTime: true,
              workdayEndTime: true,
              timeZone: true,
            },
          },
        },
        orderBy: [{ clockIn: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: limitNumber,
      }),
      prisma.timeEntry.count({ where }),
    ]);

    res.json({
      integration: {
        provider: 'SystemaPonto Public API',
        version: '2026-03',
        generatedAt: new Date().toISOString(),
        scopeAdminId: adminId,
      },
      filters: {
        startDate,
        endDate,
        status: filterResult.status,
        userId: userId || null,
      },
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber),
      },
      data: entries.map(serializeEntry),
    });
  } catch (error) {
    console.error('❌ Erro na API pública de folha (time-entries):', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao consultar registros para integração de folha.',
    });
  }
};

/**
 * GET /public/payroll/summary
 * Sumário por colaborador e dia para integração com folha
 */
const getPayrollSummary = async (req, res) => {
  try {
    const adminId = req.publicApiAdmin.id;
    const { startDate, endDate, status, userId, includePending } = req.query;
    const includePendingFlag = String(includePending || 'false').toLowerCase() === 'true';

    const filterResult = buildPayrollFilters({
      startDate,
      endDate,
      status,
      includePending: includePendingFlag,
    });

    if (filterResult.error) {
      return res.status(400).json({
        error: 'Bad Request',
        message: filterResult.error,
      });
    }

    const scopedUsers = await listScopedPayrollUsers(adminId);
    const scopedUserIds = scopedUsers.map((user) => user.id);

    if (userId && !scopedUserIds.includes(userId)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'userId fora do escopo da administração vinculada ao token.',
      });
    }

    const where = {
      ...filterResult.where,
      userId: userId ? String(userId) : { in: scopedUserIds },
    };

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
          },
        },
      },
      orderBy: [{ clockIn: 'asc' }],
    });

    const grouped = new Map();

    for (const entry of entries) {
      const normalized = serializeEntry(entry);
      const key = `${normalized.employee.id}:${normalized.dateKey}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          dateKey: normalized.dateKey,
          employee: normalized.employee,
          entriesCount: 0,
          workedMinutes: 0,
          overtimeMinutes: 0,
          overtimeMinutes50: 0,
          overtimeMinutes100: 0,
          bankHoursAccruedMinutes: 0,
          financial: {
            regularAmount: 0,
            overtime50Amount: 0,
            overtime100Amount: 0,
            overtimeTotalAmount: 0,
            totalAmount: 0,
          },
        });
      }

      const aggregate = grouped.get(key);
      aggregate.entriesCount += 1;
      aggregate.workedMinutes += normalized.workedMinutes;
      aggregate.overtimeMinutes += normalized.overtimeMinutes;
      aggregate.overtimeMinutes50 += normalized.overtimeMinutes50;
      aggregate.overtimeMinutes100 += normalized.overtimeMinutes100;
      aggregate.bankHoursAccruedMinutes += normalized.bankHoursAccruedMinutes;
      aggregate.financial.regularAmount = toMoney(
        aggregate.financial.regularAmount + normalized.financial.regularAmount
      );
      aggregate.financial.overtime50Amount = toMoney(
        aggregate.financial.overtime50Amount + normalized.financial.overtime50Amount
      );
      aggregate.financial.overtime100Amount = toMoney(
        aggregate.financial.overtime100Amount + normalized.financial.overtime100Amount
      );
      aggregate.financial.overtimeTotalAmount = toMoney(
        aggregate.financial.overtimeTotalAmount + normalized.financial.overtimeTotalAmount
      );
      aggregate.financial.totalAmount = toMoney(
        aggregate.financial.totalAmount + normalized.financial.totalAmount
      );
    }

    const summary = Array.from(grouped.values()).sort((a, b) => {
      if (a.dateKey !== b.dateKey) {
        return a.dateKey.localeCompare(b.dateKey);
      }
      return a.employee.name.localeCompare(b.employee.name, 'pt-BR');
    });

    res.json({
      integration: {
        provider: 'SystemaPonto Public API',
        version: '2026-03',
        generatedAt: new Date().toISOString(),
        scopeAdminId: adminId,
      },
      filters: {
        startDate,
        endDate,
        status: filterResult.status,
        userId: userId || null,
      },
      summary,
      totals: summary.reduce(
        (acc, row) => {
          acc.workedMinutes += row.workedMinutes;
          acc.overtimeMinutes += row.overtimeMinutes;
          acc.totalAmount = toMoney(acc.totalAmount + row.financial.totalAmount);
          return acc;
        },
        {
          workedMinutes: 0,
          overtimeMinutes: 0,
          totalAmount: 0,
        }
      ),
    });
  } catch (error) {
    console.error('❌ Erro na API pública de folha (summary):', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao consolidar dados da folha.',
    });
  }
};

module.exports = {
  getPayrollTimeEntries,
  getPayrollSummary,
};
