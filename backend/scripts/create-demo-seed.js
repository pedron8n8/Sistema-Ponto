const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const fallbackConnectionString = `postgresql://${encodeURIComponent(process.env.POSTGRES_USER || 'postgres')}:${encodeURIComponent(process.env.POSTGRES_PASSWORD || 'postgres')}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'sistema_ponto'}`;
const connectionString = process.env.DATABASE_URL || fallbackConnectionString;
const databaseSchema = process.env.DATABASE_SCHEMA || 'schema_automation';

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool, { schema: databaseSchema });
const prisma = new PrismaClient({ adapter });

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD || 'Omni!2026Seed#1';
const DEMO_DOMAIN = process.env.DEMO_SEED_EMAIL_DOMAIN || 'demo.omnipunt.test';

const USERS = [
  { key: 'superadmin', name: 'Demo Superadmin', role: 'SUPERADMIN', local: 'superadmin', hourlyRate: 150 },
  { key: 'admin', name: 'Demo Admin', role: 'ADMIN', local: 'admin', hourlyRate: 120 },
  { key: 'hr', name: 'Demo HR', role: 'HR', local: 'hr', hourlyRate: 88 },
  { key: 'supervisor', name: 'Demo Supervisor', role: 'SUPERVISOR', local: 'supervisor', hourlyRate: 78 },
  { key: 'member1', name: 'Ana QA', role: 'MEMBER', local: 'ana', hourlyRate: 42 },
  { key: 'member2', name: 'Bruno QA', role: 'MEMBER', local: 'bruno', hourlyRate: 46 },
  { key: 'member3', name: 'Carla QA', role: 'MEMBER', local: 'carla', hourlyRate: 51 },
  { key: 'member4', name: 'Diego QA', role: 'MEMBER', local: 'diego', hourlyRate: 38 },
];

const emailFor = (user) => `${user.local}@${DEMO_DOMAIN}`.toLowerCase();

const dayUtc = (dayOffset, hour, minute = 0) => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date;
};

const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60 * 1000);

const listAllSupabaseUsers = async () => {
  const users = [];
  let page = 1;
  const perPage = 200;

  while (page <= 50) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Erro ao listar usuarios no Supabase: ${error.message}`);

    const pageUsers = data?.users || [];
    users.push(...pageUsers);
    if (pageUsers.length < perPage) break;
    page += 1;
  }

  return users;
};

const getSupabaseUserByEmail = async (email) => {
  const users = await listAllSupabaseUsers();
  return users.find((user) => String(user.email || '').toLowerCase() === email.toLowerCase()) || null;
};

const ensureSupabaseUser = async ({ email, password, name, role, organizationAdminId, supervisorId }) => {
  const metadata = {
    name,
    role,
    seed: 'demo-system',
    ...(organizationAdminId ? { organizationAdminId } : {}),
    ...(supervisorId ? { supervisorId } : {}),
  };

  const existing = await getSupabaseUserByEmail(email);
  if (existing) {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata || {}),
        ...metadata,
      },
    });
    if (error) throw new Error(`Erro ao atualizar ${email} no Supabase: ${error.message}`);
    return data.user;
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) throw new Error(`Erro ao criar ${email} no Supabase: ${error.message}`);
  return data.user;
};

const deleteLocalUsersAndDependencies = async (userIds) => {
  if (userIds.length === 0) return;

  await prisma.vacationApprovalLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: userIds } },
        { vacationRequest: { userId: { in: userIds } } },
        { vacationRequest: { supervisorId: { in: userIds } } },
        { vacationRequest: { hrReviewerId: { in: userIds } } },
      ],
    },
  });
  await prisma.vacationRequest.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { supervisorId: { in: userIds } },
        { hrReviewerId: { in: userIds } },
      ],
    },
  });
  await prisma.approvalLog.deleteMany({
    where: {
      OR: [
        { reviewerId: { in: userIds } },
        { timeEntry: { userId: { in: userIds } } },
      ],
    },
  });
  await prisma.bankHoursEntry.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { timeEntry: { userId: { in: userIds } } },
      ],
    },
  });
  await prisma.timeEntry.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.adminBillingInvoice.deleteMany({ where: { adminUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
};

const resetLocalDemoData = async () => {
  const demoEmails = USERS.map(emailFor);
  const existing = await prisma.user.findMany({
    where: {
      OR: [
        { email: { in: demoEmails } },
        { organizationAdmin: { email: { in: demoEmails } } },
        { supervisor: { email: { in: demoEmails } } },
      ],
    },
    select: { id: true },
  });

  await deleteLocalUsersAndDependencies(existing.map((user) => user.id));
};

const ensureProPlan = async () => {
  return prisma.adminPlan.upsert({
    where: { code: 'PRO' },
    update: {
      name: 'Pro',
      description: 'Plano Pro para ambiente demo',
      monthlyPrice: 50,
      isActive: true,
    },
    create: {
      code: 'PRO',
      name: 'Pro',
      description: 'Plano Pro para ambiente demo',
      monthlyPrice: 50,
      isActive: true,
    },
  });
};

const createLocalUsers = async ({ supabaseByKey, proPlan }) => {
  const adminAuth = supabaseByKey.get('admin');
  const supervisorAuth = supabaseByKey.get('supervisor');
  const byKey = new Map();

  for (const user of USERS) {
    const supabaseUser = supabaseByKey.get(user.key);
    const isAdmin = user.role === 'ADMIN';
    const isSuperadmin = user.role === 'SUPERADMIN';
    const isMember = user.role === 'MEMBER';

    const created = await prisma.user.create({
      data: {
        id: supabaseUser.id,
        email: emailFor(user),
        name: user.name,
        role: user.role,
        isActive: true,
        supervisorId: isMember ? supervisorAuth.id : null,
        organizationAdminId: isSuperadmin ? null : adminAuth.id,
        contractDailyMinutes: 480,
        workdayStartTime: '08:00',
        workdayEndTime: '17:00',
        hourlyRate: user.hourlyRate,
        timeZone: 'America/Sao_Paulo',
        bankHoursBalanceMinutes: isMember ? 95 : 0,
        bankHoursLimitMinutes: isMember ? 1200 : null,
        bankHoursExpiryMonths: 6,
        bankHoursPolicyCode: isMember ? 'DEMO_STANDARD' : null,
        adminPlanId: isAdmin ? proPlan.id : null,
        adminPlanStatus: isAdmin ? 'ACTIVE' : 'INACTIVE',
        adminPlanLinkedAt: isAdmin ? new Date() : null,
        adminSeatLimit: isAdmin ? 25 : null,
        adminExtraSeatPrice: isAdmin ? 7.5 : null,
        adminActiveSeats: isAdmin ? USERS.filter((item) => item.role !== 'SUPERADMIN').length : 0,
        adminExtraSeatsContracted: isAdmin ? 10 : 0,
      },
    });

    byKey.set(user.key, created);
  }

  return byKey;
};

const createTimeEntry = async ({ userId, reviewerId, dayOffset, startHour, workedMinutes, status, notes, action, comment }) => {
  const clockIn = dayUtc(dayOffset, startHour);
  const clockOut = addMinutes(clockIn, workedMinutes);
  const overtimeMinutes = Math.max(workedMinutes - 480, 0);

  const entry = await prisma.timeEntry.create({
    data: {
      userId,
      clockIn,
      clockOut,
      notes,
      ipAddress: `192.168.10.${Math.abs(dayOffset) + startHour}`,
      device: 'Demo browser - Windows',
      workedMinutes,
      overtimeMinutes,
      overtimeMinutes50: overtimeMinutes,
      overtimeMinutes100: 0,
      overtimePercent: overtimeMinutes > 0 ? 50 : 0,
      bankHoursAccruedMinutes: status === 'APPROVED' ? overtimeMinutes : 0,
      status,
    },
  });

  if (action) {
    await prisma.approvalLog.create({
      data: {
        timeEntryId: entry.id,
        reviewerId,
        action,
        comment,
        timestamp: addMinutes(clockOut, 45),
      },
    });
  }

  if (overtimeMinutes > 0 && status === 'APPROVED') {
    await prisma.bankHoursEntry.create({
      data: {
        userId,
        timeEntryId: entry.id,
        type: 'ACCRUAL',
        paymentStatus: 'PENDING',
        minutes: overtimeMinutes,
        description: 'Horas extras geradas pelo seed demo',
        expiresAt: dayUtc(150, 23, 59),
        createdById: reviewerId,
      },
    });
  }

  return entry;
};

const createVacationRequest = async ({ userId, supervisorId, hrId, startOffset, days, status, reason }) => {
  const startDate = dayUtc(startOffset, 12);
  const endDate = dayUtc(startOffset + days - 1, 12);
  const supervisorReviewedAt = ['SUPERVISOR_APPROVED', 'HR_CONFIRMED', 'HR_REJECTED'].includes(status)
    ? dayUtc(-2, 15)
    : null;
  const hrReviewedAt = ['HR_CONFIRMED', 'HR_REJECTED'].includes(status) ? dayUtc(-1, 16) : null;

  const request = await prisma.vacationRequest.create({
    data: {
      userId,
      supervisorId,
      hrReviewerId: hrReviewedAt ? hrId : null,
      startDate,
      endDate,
      reason,
      status,
      requestedAt: dayUtc(-5, 10),
      supervisorReviewedAt,
      hrReviewedAt,
    },
  });

  await prisma.vacationApprovalLog.create({
    data: {
      vacationRequestId: request.id,
      actorId: userId,
      action: 'REQUESTED',
      comment: reason,
      fromStatus: null,
      toStatus: 'REQUESTED',
      timestamp: request.requestedAt,
    },
  });

  if (supervisorReviewedAt) {
    await prisma.vacationApprovalLog.create({
      data: {
        vacationRequestId: request.id,
        actorId: supervisorId,
        action: 'SUPERVISOR_APPROVED',
        comment: 'Aprovado pelo supervisor no seed demo',
        fromStatus: 'REQUESTED',
        toStatus: 'SUPERVISOR_APPROVED',
        timestamp: supervisorReviewedAt,
      },
    });
  }

  if (hrReviewedAt) {
    await prisma.vacationApprovalLog.create({
      data: {
        vacationRequestId: request.id,
        actorId: hrId,
        action: status,
        comment: status === 'HR_CONFIRMED' ? 'Ferias confirmadas pelo RH' : 'Periodo recusado pelo RH para teste',
        fromStatus: 'SUPERVISOR_APPROVED',
        toStatus: status,
        timestamp: hrReviewedAt,
      },
    });
  }
};

const seedDemoRecords = async (usersByKey) => {
  const admin = usersByKey.get('admin');
  const supervisor = usersByKey.get('supervisor');
  const hr = usersByKey.get('hr');
  const members = ['member1', 'member2', 'member3', 'member4'].map((key) => usersByKey.get(key));

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    await createTimeEntry({
      userId: member.id,
      reviewerId: supervisor.id,
      dayOffset: -9 + index,
      startHour: 8,
      workedMinutes: 480,
      status: 'APPROVED',
      notes: 'Jornada normal aprovada pelo seed demo',
      action: 'APPROVED',
      comment: 'Registro aprovado para teste',
    });
    await createTimeEntry({
      userId: member.id,
      reviewerId: supervisor.id,
      dayOffset: -5 + index,
      startHour: 8,
      workedMinutes: 540,
      status: 'APPROVED',
      notes: 'Jornada com hora extra',
      action: 'APPROVED',
      comment: 'Hora extra aprovada',
    });
    await createTimeEntry({
      userId: member.id,
      reviewerId: supervisor.id,
      dayOffset: -2 + index,
      startHour: 9,
      workedMinutes: 420,
      status: 'PENDING',
      notes: 'Registro pendente para aprovacao',
    });
  }

  await createTimeEntry({
    userId: members[0].id,
    reviewerId: supervisor.id,
    dayOffset: -1,
    startHour: 8,
    workedMinutes: 450,
    status: 'PENDING',
    notes: 'Preciso ajustar a observacao deste registro',
    action: 'EDIT_REQUESTED',
    comment: 'Detalhe melhor a saida antecipada',
  });

  await createTimeEntry({
    userId: members[1].id,
    reviewerId: admin.id,
    dayOffset: -3,
    startHour: 10,
    workedMinutes: 300,
    status: 'REJECTED',
    notes: 'Registro recusado para teste',
    action: 'REJECTED',
    comment: 'Registro fora da politica',
  });

  await prisma.bankHoursEntry.create({
    data: {
      userId: members[2].id,
      type: 'ADJUSTMENT',
      paymentStatus: 'PAID',
      paidAt: dayUtc(-1, 14),
      paidById: admin.id,
      paymentNote: 'Pagamento manual de banco de horas no seed demo',
      minutes: -120,
      description: 'Baixa paga de banco de horas',
      createdById: admin.id,
    },
  });

  await prisma.bankHoursEntry.create({
    data: {
      userId: members[3].id,
      type: 'EXPIRY',
      paymentStatus: 'PENDING',
      minutes: -45,
      description: 'Expiracao simulada de banco de horas',
      expiresAt: dayUtc(30, 23, 59),
      createdById: hr.id,
    },
  });

  await createVacationRequest({
    userId: members[0].id,
    supervisorId: supervisor.id,
    hrId: hr.id,
    startOffset: 12,
    days: 5,
    status: 'REQUESTED',
    reason: 'Ferias solicitadas aguardando supervisor',
  });
  await createVacationRequest({
    userId: members[1].id,
    supervisorId: supervisor.id,
    hrId: hr.id,
    startOffset: 20,
    days: 3,
    status: 'SUPERVISOR_APPROVED',
    reason: 'Ferias ja aprovadas pelo supervisor',
  });
  await createVacationRequest({
    userId: members[2].id,
    supervisorId: supervisor.id,
    hrId: hr.id,
    startOffset: 35,
    days: 10,
    status: 'HR_CONFIRMED',
    reason: 'Ferias confirmadas pelo RH',
  });
  await createVacationRequest({
    userId: members[3].id,
    supervisorId: supervisor.id,
    hrId: hr.id,
    startOffset: 45,
    days: 2,
    status: 'HR_REJECTED',
    reason: 'Solicitacao recusada para teste',
  });

  await prisma.adminBillingInvoice.createMany({
    data: [
      {
        adminUserId: admin.id,
        sourceType: 'BASE_PLAN',
        stripeSessionId: `demo_base_${admin.id}`,
        stripeInvoiceId: `demo_inv_base_${admin.id}`,
        stripeSubscriptionId: `demo_sub_${admin.id}`,
        status: 'complete',
        paymentStatus: 'paid',
        mode: 'subscription',
        currency: 'USD',
        amountTotal: 50,
        amountSubtotal: 50,
        expectedMonthlyAmountUsd: 50,
        customerEmail: admin.email,
        sessionCreatedAt: dayUtc(-15, 12),
        paidAt: dayUtc(-15, 12),
      },
      {
        adminUserId: admin.id,
        sourceType: 'ADDITIONAL_SEATS',
        stripeSessionId: `demo_extra_${admin.id}`,
        stripeInvoiceId: `demo_inv_extra_${admin.id}`,
        stripeSubscriptionId: `demo_sub_extra_${admin.id}`,
        status: 'complete',
        paymentStatus: 'paid',
        mode: 'subscription',
        currency: 'USD',
        amountTotal: 75,
        amountSubtotal: 75,
        expectedMonthlyAmountUsd: 75,
        overageSeats: 10,
        customerEmail: admin.email,
        sessionCreatedAt: dayUtc(-12, 12),
        paidAt: dayUtc(-12, 12),
      },
    ],
  });
};

const printCredentials = (usersByKey) => {
  console.log('\nCredenciais demo');
  console.log('--------------------------------------------------');
  for (const user of USERS) {
    const localUser = usersByKey.get(user.key);
    console.log(`${user.role.padEnd(11)} ${localUser.email} / ${DEMO_PASSWORD}`);
  }
  console.log('--------------------------------------------------\n');
};

const main = async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env do backend.');
  }

  console.log('Criando seed demo completo...');
  console.log(`Dominio: ${DEMO_DOMAIN}`);

  await resetLocalDemoData();

  const proPlan = await ensureProPlan();
  const supabaseByKey = new Map();

  for (const user of USERS) {
    const adminAuth = supabaseByKey.get('admin');
    const supervisorAuth = supabaseByKey.get('supervisor');
    const supabaseUser = await ensureSupabaseUser({
      email: emailFor(user),
      password: DEMO_PASSWORD,
      name: user.name,
      role: user.role,
      organizationAdminId: user.role === 'SUPERADMIN' ? null : adminAuth?.id,
      supervisorId: user.role === 'MEMBER' ? supervisorAuth?.id : null,
    });
    supabaseByKey.set(user.key, supabaseUser);
  }

  const usersByKey = await createLocalUsers({ supabaseByKey, proPlan });
  await seedDemoRecords(usersByKey);
  printCredentials(usersByKey);
  console.log('Seed demo completo criado com usuarios, ponto, banco de horas, valores/hora, faturas e ferias.');
};

main()
  .catch((error) => {
    console.error('Falha ao criar seed demo:', error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
