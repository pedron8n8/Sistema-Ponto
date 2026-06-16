const { prisma } = require('../config/database');
const { recalculateUserDay, reverseEntryBankHours } = require('../utils/recalcDay');
const { sendResendEmail } = require('../utils/resendNotifier');

const TEAM_MEMBER_ROLES = ['HR', 'SUPERVISOR', 'MEMBER'];

/**
 * Resolve o "dono" da organização (tenant) para o ator.
 * ADMIN é dono de si mesmo; HR pertence ao admin da sua organização.
 */
const getOrgOwnerId = (actor) => {
  if (!actor) return null;
  if (actor.role === 'ADMIN') return actor.id;
  if (actor.role === 'HR') return actor.organizationAdminId || null;
  return null;
};

/** Filtro Prisma para listar os colaboradores gerenciáveis pelo ator. */
const buildOrgTeamWhere = (actor) => {
  if (actor.role === 'SUPERADMIN') {
    return { role: { in: TEAM_MEMBER_ROLES }, isActive: true };
  }
  const ownerId = getOrgOwnerId(actor);
  if (!ownerId) return null;
  return { role: { in: TEAM_MEMBER_ROLES }, organizationAdminId: ownerId, isActive: true };
};

/** Verifica se o ator pode gerenciar (ver/editar) o colaborador alvo. */
const canManageTarget = (actor, target) => {
  if (!actor || !target) return false;
  if (actor.role === 'SUPERADMIN') return true;
  if (!TEAM_MEMBER_ROLES.includes(target.role)) return false;
  const ownerId = getOrgOwnerId(actor);
  if (!ownerId) return false;
  return target.organizationAdminId === ownerId;
};

const parseDateValue = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeBreakMinutes = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const formatMinutes = (minutes) => {
  const total = Math.max(0, Math.floor(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const serializeEntry = (entry) => ({
  id: entry.id,
  userId: entry.userId,
  clockIn: entry.clockIn,
  clockOut: entry.clockOut,
  notes: entry.notes,
  status: entry.status,
  breakMinutes: entry.breakMinutes,
  workedMinutes: entry.workedMinutes,
  overtimeMinutes: entry.overtimeMinutes,
  overtimeMinutes50: entry.overtimeMinutes50,
  overtimeMinutes100: entry.overtimeMinutes100,
  bankHoursAccruedMinutes: entry.bankHoursAccruedMinutes,
});

/** Registra a ação de edição/criação no ApprovalLog (auditoria). */
const writeApprovalLog = async ({ timeEntryId, reviewerId, action, before, after }) => {
  await prisma.approvalLog.create({
    data: {
      timeEntryId,
      reviewerId,
      action,
      comment: JSON.stringify({ before: before || null, after: after || null }),
    },
  });
};

/** Notifica o colaborador por e-mail (best-effort, nunca interrompe o fluxo). */
const notifyEmployee = async ({ employee, actor, action, entry }) => {
  try {
    if (!employee?.email) return;
    const labels = {
      HR_EDITED: 'ajustou seu registro de ponto',
      HR_CREATED: 'adicionou um registro de ponto',
      HR_DELETED: 'removeu um registro de ponto',
    };
    const verb = labels[action] || 'atualizou seu registro de ponto';
    const period = entry?.clockIn
      ? `${new Date(entry.clockIn).toLocaleString('pt-BR')}${entry.clockOut ? ' — ' + new Date(entry.clockOut).toLocaleString('pt-BR') : ''}`
      : '';
    await sendResendEmail({
      to: employee.email,
      subject: '[SystemaPonto] Seu registro de ponto foi atualizado pelo RH',
      text: [
        `Olá ${employee.name || ''},`.trim(),
        '',
        `${actor?.name || 'O RH'} ${verb}.`,
        period ? `Período: ${period}` : '',
        '',
        'Acesse o sistema para conferir os detalhes.',
      ]
        .filter((line) => line !== null && line !== undefined)
        .join('\n'),
    });
  } catch (error) {
    console.warn('⚠️ Falha ao notificar colaborador sobre edição de ponto:', error.message);
  }
};

/**
 * GET /hr/team
 * Lista os colaboradores da organização gerenciáveis pelo RH/ADMIN.
 */
const getHrTeam = async (req, res) => {
  try {
    const where = buildOrgTeamWhere(req.user);
    if (!where) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Sua conta não está vinculada a uma organização.',
      });
    }

    const members = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        contractDailyMinutes: true,
        workdayStartTime: true,
        workdayEndTime: true,
        timeZone: true,
        hourlyRate: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      members: members.map((m) => ({ ...m, hourlyRate: m.hourlyRate != null ? Number(m.hourlyRate) : null })),
    });
  } catch (error) {
    console.error('❌ Erro ao listar equipe (RH):', error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Erro ao listar colaboradores.' });
  }
};

/**
 * GET /hr/daily?date=YYYY-MM-DD
 * Visão por data: todos os colaboradores e o tempo trabalhado naquele dia.
 */
const getHrDaily = async (req, res) => {
  try {
    const where = buildOrgTeamWhere(req.user);
    if (!where) {
      return res.status(403).json({ error: 'Forbidden', message: 'Sua conta não está vinculada a uma organização.' });
    }

    const refDate = parseDateValue(req.query.date) || new Date();
    const dayStart = new Date(refDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(refDate);
    dayEnd.setHours(23, 59, 59, 999);

    const members = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });

    const memberIds = members.map((m) => m.id);
    const entries = memberIds.length
      ? await prisma.timeEntry.findMany({
          where: { userId: { in: memberIds }, clockIn: { gte: dayStart, lte: dayEnd } },
          orderBy: { clockIn: 'asc' },
        })
      : [];

    const entriesByUser = entries.reduce((acc, entry) => {
      (acc[entry.userId] = acc[entry.userId] || []).push(entry);
      return acc;
    }, {});

    const rows = members.map((member) => {
      const memberEntries = entriesByUser[member.id] || [];
      const totals = memberEntries.reduce(
        (acc, e) => {
          acc.workedMinutes += e.workedMinutes || 0;
          acc.overtimeMinutes += e.overtimeMinutes || 0;
          return acc;
        },
        { workedMinutes: 0, overtimeMinutes: 0 }
      );
      return {
        user: member,
        entries: memberEntries.map(serializeEntry),
        totals: {
          ...totals,
          workedLabel: formatMinutes(totals.workedMinutes),
          overtimeLabel: formatMinutes(totals.overtimeMinutes),
        },
      };
    });

    res.json({ date: dayStart.toISOString(), rows });
  } catch (error) {
    console.error('❌ Erro ao carregar visão diária (RH):', error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Erro ao carregar a visão diária.' });
  }
};

/**
 * GET /hr/users/:userId/daily?startDate&endDate
 * Visão por colaborador: registros agrupados por dia.
 */
const getHrUserDaily = async (req, res) => {
  try {
    const { userId } = req.params;
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, organizationAdminId: true, hourlyRate: true },
    });

    if (!target) {
      return res.status(404).json({ error: 'Not Found', message: 'Colaborador não encontrado.' });
    }
    if (!canManageTarget(req.user, target)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Você não pode acessar este colaborador.' });
    }

    const end = parseDateValue(req.query.endDate) || new Date();
    end.setHours(23, 59, 59, 999);
    const start = parseDateValue(req.query.startDate) || new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);

    const entries = await prisma.timeEntry.findMany({
      where: { userId, clockIn: { gte: start, lte: end } },
      orderBy: { clockIn: 'desc' },
    });

    const dayMap = new Map();
    for (const entry of entries) {
      const d = new Date(entry.clockIn);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!dayMap.has(key)) {
        dayMap.set(key, { date: key, entries: [], workedMinutes: 0, overtimeMinutes: 0 });
      }
      const day = dayMap.get(key);
      day.entries.push(serializeEntry(entry));
      day.workedMinutes += entry.workedMinutes || 0;
      day.overtimeMinutes += entry.overtimeMinutes || 0;
    }

    const days = Array.from(dayMap.values()).map((day) => ({
      ...day,
      workedLabel: formatMinutes(day.workedMinutes),
      overtimeLabel: formatMinutes(day.overtimeMinutes),
    }));

    res.json({
      user: { id: target.id, name: target.name, email: target.email, role: target.role },
      days,
    });
  } catch (error) {
    console.error('❌ Erro ao carregar registros do colaborador (RH):', error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Erro ao carregar os registros.' });
  }
};

/**
 * PATCH /hr/entries/:id
 * Edita clock-in/out, intervalo e notas de um registro. Recalcula e aprova automaticamente.
 */
const updateHrEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const { clockIn, clockOut, breakMinutes, notes } = req.body || {};

    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true, role: true, organizationAdminId: true } } },
    });

    if (!entry) {
      return res.status(404).json({ error: 'Not Found', message: 'Registro não encontrado.' });
    }
    if (!canManageTarget(req.user, entry.user)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Você não pode editar este registro.' });
    }

    const data = {};
    let nextClockIn = entry.clockIn;
    let nextClockOut = entry.clockOut;

    if (clockIn !== undefined) {
      const parsed = parseDateValue(clockIn);
      if (!parsed) return res.status(400).json({ error: 'Bad Request', message: 'clockIn inválido.' });
      data.clockIn = parsed;
      nextClockIn = parsed;
    }
    if (clockOut !== undefined) {
      const parsed = parseDateValue(clockOut);
      if (!parsed) return res.status(400).json({ error: 'Bad Request', message: 'clockOut inválido.' });
      data.clockOut = parsed;
      nextClockOut = parsed;
    }

    // Registros abertos (sem clockOut) não são editáveis sem informar a saída.
    if (!nextClockOut) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Informe o horário de saída (clockOut) para editar este registro.',
      });
    }
    if (new Date(nextClockOut).getTime() <= new Date(nextClockIn).getTime()) {
      return res.status(400).json({ error: 'Bad Request', message: 'A saída deve ser posterior à entrada.' });
    }

    if (breakMinutes !== undefined) {
      const normalized = normalizeBreakMinutes(breakMinutes);
      if (normalized === null) return res.status(400).json({ error: 'Bad Request', message: 'breakMinutes inválido.' });
      data.breakMinutes = normalized;
    }
    if (notes !== undefined) {
      data.notes = notes == null ? null : String(notes);
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'Informe ao menos um campo para atualizar.' });
    }

    const before = serializeEntry(entry);

    await prisma.timeEntry.update({
      where: { id },
      data: { ...data, status: 'APPROVED' },
    });

    // Recalcula o(s) dia(s) afetado(s) — entrada pode ter mudado de dia.
    const affectedDays = new Set([new Date(nextClockIn).toDateString(), new Date(entry.clockIn).toDateString()]);
    for (const dayString of affectedDays) {
      await recalculateUserDay({ userId: entry.userId, date: new Date(dayString) });
    }

    const updated = await prisma.timeEntry.findUnique({ where: { id } });
    await writeApprovalLog({
      timeEntryId: id,
      reviewerId: req.user.id,
      action: 'HR_EDITED',
      before,
      after: serializeEntry(updated),
    });
    await notifyEmployee({ employee: entry.user, actor: req.user, action: 'HR_EDITED', entry: updated });

    res.json({ message: 'Registro atualizado com sucesso.', entry: serializeEntry(updated) });
  } catch (error) {
    console.error('❌ Erro ao editar registro (RH):', error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Erro ao editar o registro.' });
  }
};

/**
 * POST /hr/users/:userId/entries
 * Adiciona um registro completo (entrada + saída) para um dia esquecido. Aprovado automaticamente.
 */
const createHrEntry = async (req, res) => {
  try {
    const { userId } = req.params;
    const { clockIn, clockOut, breakMinutes, notes } = req.body || {};

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, organizationAdminId: true },
    });
    if (!target) return res.status(404).json({ error: 'Not Found', message: 'Colaborador não encontrado.' });
    if (!canManageTarget(req.user, target)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Você não pode criar registros para este colaborador.' });
    }

    const parsedIn = parseDateValue(clockIn);
    const parsedOut = parseDateValue(clockOut);
    if (!parsedIn || !parsedOut) {
      return res.status(400).json({ error: 'Bad Request', message: 'Informe entrada (clockIn) e saída (clockOut) válidas.' });
    }
    if (parsedOut.getTime() <= parsedIn.getTime()) {
      return res.status(400).json({ error: 'Bad Request', message: 'A saída deve ser posterior à entrada.' });
    }
    const normalizedBreak = breakMinutes === undefined ? 0 : normalizeBreakMinutes(breakMinutes);
    if (normalizedBreak === null) {
      return res.status(400).json({ error: 'Bad Request', message: 'breakMinutes inválido.' });
    }

    const created = await prisma.timeEntry.create({
      data: {
        userId,
        clockIn: parsedIn,
        clockOut: parsedOut,
        breakMinutes: normalizedBreak,
        notes: notes == null ? null : String(notes),
        status: 'APPROVED',
      },
    });

    await recalculateUserDay({ userId, date: parsedIn });

    const updated = await prisma.timeEntry.findUnique({ where: { id: created.id } });
    await writeApprovalLog({
      timeEntryId: created.id,
      reviewerId: req.user.id,
      action: 'HR_CREATED',
      before: null,
      after: serializeEntry(updated),
    });
    await notifyEmployee({ employee: target, actor: req.user, action: 'HR_CREATED', entry: updated });

    res.status(201).json({ message: 'Registro criado com sucesso.', entry: serializeEntry(updated) });
  } catch (error) {
    console.error('❌ Erro ao criar registro (RH):', error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Erro ao criar o registro.' });
  }
};

/**
 * DELETE /hr/entries/:id
 * Remove um registro, revertendo banco de horas e recalculando o dia.
 */
const deleteHrEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true, role: true, organizationAdminId: true } } },
    });
    if (!entry) return res.status(404).json({ error: 'Not Found', message: 'Registro não encontrado.' });
    if (!canManageTarget(req.user, entry.user)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Você não pode remover este registro.' });
    }

    const employee = entry.user;
    const entryDay = new Date(entry.clockIn);
    const snapshot = serializeEntry(entry);

    // Reverte créditos pendentes de banco de horas deste registro.
    await reverseEntryBankHours(id);
    // Desvincula créditos já pagos (preserva o histórico financeiro) e remove logs (FK obrigatória).
    await prisma.bankHoursEntry.updateMany({ where: { timeEntryId: id }, data: { timeEntryId: null } });
    await prisma.approvalLog.deleteMany({ where: { timeEntryId: id } });
    await prisma.timeEntry.delete({ where: { id } });

    await recalculateUserDay({ userId: employee.id, date: entryDay });

    console.warn(
      `🗑️ [HR_DELETED] entry=${id} user=${employee.email} by=${req.user.email} snapshot=${JSON.stringify(snapshot)}`
    );
    await notifyEmployee({ employee, actor: req.user, action: 'HR_DELETED', entry: snapshot });

    res.json({ message: 'Registro removido com sucesso.' });
  } catch (error) {
    console.error('❌ Erro ao remover registro (RH):', error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Erro ao remover o registro.' });
  }
};

/**
 * PATCH /hr/users/:userId/work-settings
 * Ajusta a jornada do colaborador, incluindo valor/hora (hourlyRate).
 */
const updateHrWorkSettings = async (req, res) => {
  try {
    const { userId } = req.params;
    const { contractDailyMinutes, workdayStartTime, workdayEndTime, timeZone, hourlyRate } = req.body || {};

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, organizationAdminId: true },
    });
    if (!target) return res.status(404).json({ error: 'Not Found', message: 'Colaborador não encontrado.' });
    if (!canManageTarget(req.user, target)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Você não pode ajustar a jornada deste colaborador.' });
    }

    const data = {};

    if (contractDailyMinutes !== undefined) {
      const parsed = Number(contractDailyMinutes);
      if (!Number.isFinite(parsed) || parsed < 60 || parsed > 1440) {
        return res.status(400).json({ error: 'Bad Request', message: 'contractDailyMinutes inválido (60 a 1440).' });
      }
      data.contractDailyMinutes = Math.floor(parsed);
    }
    if (workdayStartTime !== undefined) {
      if (workdayStartTime !== null && !/^\d{2}:\d{2}$/.test(String(workdayStartTime))) {
        return res.status(400).json({ error: 'Bad Request', message: 'workdayStartTime inválido (HH:mm).' });
      }
      data.workdayStartTime = workdayStartTime || null;
    }
    if (workdayEndTime !== undefined) {
      if (workdayEndTime !== null && !/^\d{2}:\d{2}$/.test(String(workdayEndTime))) {
        return res.status(400).json({ error: 'Bad Request', message: 'workdayEndTime inválido (HH:mm).' });
      }
      data.workdayEndTime = workdayEndTime || null;
    }
    if (timeZone !== undefined) {
      data.timeZone = timeZone ? String(timeZone) : 'America/Chicago';
    }
    if (hourlyRate !== undefined) {
      if (hourlyRate === null || hourlyRate === '') {
        data.hourlyRate = null;
      } else {
        const parsed = Number(hourlyRate);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return res.status(400).json({ error: 'Bad Request', message: 'hourlyRate inválido.' });
        }
        data.hourlyRate = parsed;
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'Informe ao menos um campo para atualizar.' });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        contractDailyMinutes: true,
        workdayStartTime: true,
        workdayEndTime: true,
        timeZone: true,
        hourlyRate: true,
      },
    });

    res.json({
      message: 'Jornada atualizada com sucesso.',
      member: { ...updated, hourlyRate: updated.hourlyRate != null ? Number(updated.hourlyRate) : null },
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar jornada (RH):', error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Erro ao atualizar a jornada.' });
  }
};

module.exports = {
  getHrTeam,
  getHrDaily,
  getHrUserDaily,
  updateHrEntry,
  createHrEntry,
  deleteHrEntry,
  updateHrWorkSettings,
};
