const { createClient } = require('@supabase/supabase-js');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config();

const fallbackConnectionString = `postgresql://${encodeURIComponent(process.env.POSTGRES_USER || 'postgres')}:${encodeURIComponent(process.env.POSTGRES_PASSWORD || 'postgres')}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'sistema_ponto'}`;
const connectionString = process.env.DATABASE_URL || fallbackConnectionString;

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const ADMIN_PLAN_CATALOG = {
  STARTER: {
    code: 'STARTER',
    name: 'Starter',
    monthlyPrice: 30,
    maxSeats: 3,
  },
  GROWTH: {
    code: 'GROWTH',
    name: 'Growth',
    monthlyPrice: 40,
    maxSeats: 5,
  },
  PRO: {
    code: 'PRO',
    name: 'Pro',
    monthlyPrice: 50,
    maxSeats: 7,
  },
};

const PLAN_CODES = ['STARTER', 'GROWTH', 'PRO'];
const PLAN_ROLE_SPECS = [
  { role: 'ADMIN', localPart: 'admin', defaultNamePrefix: 'Admin' },
  { role: 'HR', localPart: 'hr', defaultNamePrefix: 'HR' },
  { role: 'SUPERVISOR', localPart: 'supervisor', defaultNamePrefix: 'Supervisor' },
  { role: 'MEMBER', localPart: 'member', defaultNamePrefix: 'Collaborator' },
];

const CREATE_ORDER = [
  ...PLAN_CODES.flatMap((planCode) => PLAN_ROLE_SPECS.map((spec) => `${planCode}_${spec.role}`)),
];

const normalize = (value) => String(value || '').trim();

const defaultSeedPassword =
  normalize(process.env.SEED_DEFAULT_PASSWORD) ||
  normalize(process.env.PENTEST_STRONG_DEFAULT_PASSWORD) ||
  'Rhea!2026#SeedStrong';
const defaultEmailDomain = normalize(process.env.SEED_EMAIL_DOMAIN).toLowerCase() || 'empresa.com';

const parsedExtraAdminSeatMonthlyUsd = Number(process.env.EXTRA_ADMIN_SEAT_MONTHLY_USD);
const EXTRA_ADMIN_SEAT_MONTHLY_USD = Number(
  (
    Number.isFinite(parsedExtraAdminSeatMonthlyUsd) && parsedExtraAdminSeatMonthlyUsd >= 0
      ? parsedExtraAdminSeatMonthlyUsd
      : 7.5
  ).toFixed(2)
);

const buildSeedPaidInvoices = ({ adminUserId, adminEmail, planConfig, additionalSeats }) => {
  const now = new Date();
  const currentCyclePaidAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10, 13, 0, 0));
  const previousCyclePaidAt = new Date(currentCyclePaidAt);
  previousCyclePaidAt.setUTCMonth(previousCyclePaidAt.getUTCMonth() - 1);

  const basePlanAmount = Number(planConfig.monthlyPrice.toFixed(2));
  const additionalSeatsAmount = Number((additionalSeats * EXTRA_ADMIN_SEAT_MONTHLY_USD).toFixed(2));
  const invoiceIdSuffix = String(adminUserId || 'admin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || 'admin';

  const invoices = [
    {
      sourceType: 'BASE_PLAN',
      stripeSessionId: `seed_base_plan_prev_${invoiceIdSuffix}`,
      stripeInvoiceId: `seed_inv_base_prev_${invoiceIdSuffix}`,
      stripeSubscriptionId: `seed_sub_plan_${invoiceIdSuffix}`,
      status: 'complete',
      paymentStatus: 'paid',
      mode: 'subscription',
      currency: 'USD',
      amountTotal: basePlanAmount,
      amountSubtotal: basePlanAmount,
      expectedMonthlyAmountUsd: basePlanAmount,
      overageSeats: null,
      customerEmail: adminEmail,
      sessionCreatedAt: previousCyclePaidAt,
      paidAt: previousCyclePaidAt,
    },
    {
      sourceType: 'BASE_PLAN',
      stripeSessionId: `seed_base_plan_curr_${invoiceIdSuffix}`,
      stripeInvoiceId: `seed_inv_base_curr_${invoiceIdSuffix}`,
      stripeSubscriptionId: `seed_sub_plan_${invoiceIdSuffix}`,
      status: 'complete',
      paymentStatus: 'paid',
      mode: 'subscription',
      currency: 'USD',
      amountTotal: basePlanAmount,
      amountSubtotal: basePlanAmount,
      expectedMonthlyAmountUsd: basePlanAmount,
      overageSeats: null,
      customerEmail: adminEmail,
      sessionCreatedAt: currentCyclePaidAt,
      paidAt: currentCyclePaidAt,
    },
  ];

  if (additionalSeats > 0) {
    invoices.push({
      sourceType: 'ADDITIONAL_SEATS',
      stripeSessionId: `seed_extra_seats_curr_${invoiceIdSuffix}`,
      stripeInvoiceId: `seed_inv_extra_curr_${invoiceIdSuffix}`,
      stripeSubscriptionId: `seed_sub_extra_${invoiceIdSuffix}`,
      status: 'complete',
      paymentStatus: 'paid',
      mode: 'subscription',
      currency: 'USD',
      amountTotal: additionalSeatsAmount,
      amountSubtotal: additionalSeatsAmount,
      expectedMonthlyAmountUsd: additionalSeatsAmount,
      overageSeats: additionalSeats,
      customerEmail: adminEmail,
      sessionCreatedAt: currentCyclePaidAt,
      paidAt: currentCyclePaidAt,
    });
  }

  return invoices;
};

const buildPlanSeeds = () => {
  const users = [];

  for (const planCode of PLAN_CODES) {
    const planConfig = ADMIN_PLAN_CATALOG[planCode];
    const planSlug = planCode.toLowerCase();

    for (const spec of PLAN_ROLE_SPECS) {
      const envPrefix = `SEED_${planCode}_${spec.role}`;
      const defaultEmail = `${planSlug}.${spec.localPart}@${defaultEmailDomain}`;
      const defaultName = `${spec.defaultNamePrefix} ${planConfig.name}`;

      users.push({
        key: `${planCode}_${spec.role}`,
        planCode,
        role: spec.role,
        email: normalize(process.env[`${envPrefix}_EMAIL`]) || defaultEmail,
        password: normalize(process.env[`${envPrefix}_PASSWORD`]) || defaultSeedPassword,
        name: normalize(process.env[`${envPrefix}_NAME`]) || defaultName,
        emailEnv: `${envPrefix}_EMAIL`,
        passwordEnv: `${envPrefix}_PASSWORD`,
      });
    }
  }

  return users;
};

const buildSeedUsers = () => {
  return buildPlanSeeds();
};

const validateRequiredConfiguration = (seedUsers) => {
  const missing = [];

  if (!normalize(process.env.SUPABASE_URL)) {
    missing.push('SUPABASE_URL');
  }

  if (!normalize(process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }

  for (const user of seedUsers) {
    if (!normalize(user.email)) {
      missing.push(user.emailEnv);
    }

    if (!normalize(user.password)) {
      missing.push(user.passwordEnv);
    }
  }

  const seenEmails = new Set();
  for (const user of seedUsers) {
    const lowerEmail = user.email.toLowerCase();
    if (seenEmails.has(lowerEmail)) {
      throw new Error(`Email duplicado no seed: ${user.email}`);
    }
    seenEmails.add(lowerEmail);
  }

  if (missing.length > 0) {
    throw new Error(`Variaveis de ambiente ausentes: ${missing.join(', ')}`);
  }
};

const buildSupabaseAdminClient = () => {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

const listAllSupabaseUsers = async (supabaseAdmin) => {
  const users = [];
  let page = 1;
  const perPage = 200;

  while (page <= 50) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw new Error(`Erro ao listar usuarios do Supabase: ${error.message}`);
    }

    const pageUsers = data?.users || [];
    users.push(...pageUsers);

    if (pageUsers.length < perPage) {
      break;
    }

    page += 1;
  }

  return users;
};

const deleteExistingSeedUsersInSupabase = async (supabaseAdmin, seedUsers) => {
  const allUsers = await listAllSupabaseUsers(supabaseAdmin);
  const targetEmails = new Set(seedUsers.map((user) => user.email.toLowerCase()));

  const usersToDelete = allUsers
    .filter((user) => targetEmails.has(normalize(user.email).toLowerCase()))
    .sort((a, b) => normalize(a.email).localeCompare(normalize(b.email)));

  for (const user of usersToDelete) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);

    if (error) {
      throw new Error(`Erro ao excluir usuario ${user.email} (${user.id}) no Supabase: ${error.message}`);
    }

    console.log(`Supabase user removed: ${user.email} (${user.id})`);
  }

  if (usersToDelete.length === 0) {
    console.log('Supabase: no previous seed users to remove.');
  }
};

const createSeedUsersInSupabase = async (supabaseAdmin, seedUsers) => {
  const byKey = new Map(seedUsers.map((user) => [user.key, user]));
  const createdByKey = new Map();

  for (const key of CREATE_ORDER) {
    const user = byKey.get(key);

    if (!user) {
      throw new Error(`Usuario ${key} nao encontrado na configuracao de seed.`);
    }

    const metadata = {
      name: user.name,
      role: user.role,
    };

    if (user.planCode) {
      metadata.planCode = user.planCode;
    }

    if (['HR', 'SUPERVISOR', 'MEMBER'].includes(user.role)) {
      const admin = createdByKey.get(`${user.planCode}_ADMIN`);
      if (!admin) {
        throw new Error(`ADMIN do plano ${user.planCode} precisa ser criado antes de ${user.role}.`);
      }
      metadata.organizationAdminId = admin.id;
    }

    if (user.role === 'MEMBER') {
      const supervisor = createdByKey.get(`${user.planCode}_SUPERVISOR`);
      if (!supervisor) {
        throw new Error(`SUPERVISOR do plano ${user.planCode} precisa ser criado antes de MEMBER.`);
      }
      metadata.supervisorId = supervisor.id;
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (error) {
      throw new Error(`Erro ao criar usuario ${user.email} no Supabase: ${error.message}`);
    }

    const created = data?.user;
    if (!created?.id) {
      throw new Error(`Supabase nao retornou ID para ${user.email}.`);
    }

    if (user.role === 'ADMIN') {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(created.id, {
        user_metadata: {
          ...metadata,
          organizationAdminId: created.id,
        },
      });

      if (updateError) {
        throw new Error(`Erro ao atualizar metadados do ADMIN ${user.email}: ${updateError.message}`);
      }
    }

    createdByKey.set(user.key, {
      ...user,
      id: created.id,
      email: normalize(created.email || user.email),
    });

    console.log(`Supabase user created: ${created.email} (${created.id})`);
  }

  return createdByKey;
};

const resetLocalUserDomain = async () => {
  await prisma.vacationApprovalLog.deleteMany();
  await prisma.vacationRequest.deleteMany();
  await prisma.approvalLog.deleteMany();
  await prisma.bankHoursEntry.deleteMany();
  await prisma.timeEntry.deleteMany();
  await prisma.adminBillingInvoice.deleteMany();
  await prisma.user.deleteMany({
    where: {
      role: {
        not: 'SUPERADMIN',
      },
    },
  });

  console.log('Local database: non-superadmin user domain data removed.');
};

const upsertAdminPlans = async () => {
  const plans = {};

  for (const planCode of PLAN_CODES) {
    const planConfig = ADMIN_PLAN_CATALOG[planCode];
    const plan = await prisma.adminPlan.upsert({
      where: { code: planConfig.code },
      update: {
        name: planConfig.name,
        description: `Plano ${planConfig.name} para administradores`,
        monthlyPrice: Number(planConfig.monthlyPrice.toFixed(2)),
        isActive: true,
      },
      create: {
        code: planConfig.code,
        name: planConfig.name,
        description: `Plano ${planConfig.name} para administradores`,
        monthlyPrice: Number(planConfig.monthlyPrice.toFixed(2)),
        isActive: true,
      },
    });

    plans[planCode] = plan;
  }

  return plans;
};

const seedLocalUsers = async (createdByKey) => {
  const planByCode = await upsertAdminPlans();

  for (const planCode of PLAN_CODES) {
    const planConfig = ADMIN_PLAN_CATALOG[planCode];
    const plan = planByCode[planCode];

    const admin = createdByKey.get(`${planCode}_ADMIN`);
    const hr = createdByKey.get(`${planCode}_HR`);
    const supervisor = createdByKey.get(`${planCode}_SUPERVISOR`);
    const member = createdByKey.get(`${planCode}_MEMBER`);

    if (!admin || !hr || !supervisor || !member) {
      throw new Error(`Usuarios do plano ${planCode} estao incompletos para seed local.`);
    }

    const teamActiveSeats = 4;
    const additionalSeats = Math.max(teamActiveSeats - planConfig.maxSeats, 0);
    const seatLimit = planConfig.maxSeats + additionalSeats;

    await prisma.user.create({
      data: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: 'ADMIN',
        supervisorId: null,
        organizationAdminId: admin.id,
        adminPlanId: plan.id,
        adminPlanStatus: 'ACTIVE',
        adminPlanLinkedAt: new Date(),
        adminSeatLimit: seatLimit,
        adminExtraSeatPrice: EXTRA_ADMIN_SEAT_MONTHLY_USD,
        adminActiveSeats: teamActiveSeats,
        adminExtraSeatsContracted: additionalSeats,
      },
    });

    await prisma.user.create({
      data: {
        id: hr.id,
        email: hr.email,
        name: hr.name,
        role: 'HR',
        supervisorId: null,
        organizationAdminId: admin.id,
      },
    });

    await prisma.user.create({
      data: {
        id: supervisor.id,
        email: supervisor.email,
        name: supervisor.name,
        role: 'SUPERVISOR',
        supervisorId: null,
        organizationAdminId: admin.id,
      },
    });

    await prisma.user.create({
      data: {
        id: member.id,
        email: member.email,
        name: member.name,
        role: 'MEMBER',
        supervisorId: supervisor.id,
        organizationAdminId: admin.id,
      },
    });

    const invoices = buildSeedPaidInvoices({
      adminUserId: admin.id,
      adminEmail: admin.email,
      planConfig,
      additionalSeats,
    });

    for (const invoice of invoices) {
      await prisma.adminBillingInvoice.upsert({
        where: { stripeSessionId: invoice.stripeSessionId },
        update: {
          ...invoice,
          adminUserId: admin.id,
          syncedAt: new Date(),
        },
        create: {
          ...invoice,
          adminUserId: admin.id,
        },
      });
    }
  }

  console.log('Local database: plans, users and invoices seeded.');
};

const printSummary = (createdByKey) => {
  console.log('\nSeeded logins by plan:');
  console.log('-----------------------------------------------------');

  for (const planCode of PLAN_CODES) {
    console.log(`\n${planCode}`);

    for (const spec of PLAN_ROLE_SPECS) {
      const key = `${planCode}_${spec.role}`;
      const user = createdByKey.get(key);

      console.log(`  ${spec.role.padEnd(10)} ${user.email} / ${user.password}`);
    }
  }
  console.log('\nSUPERADMIN was not modified by this script.');
  console.log('Configure SUPERADMIN only via .env and run npm run create:superadmin when needed.');

  console.log('-----------------------------------------------------\n');
};

(async () => {
  try {
    const seedUsers = buildSeedUsers();
    validateRequiredConfiguration(seedUsers);

    const supabaseAdmin = buildSupabaseAdminClient();

    console.log('Resetting all-plan seed users in Supabase and syncing local database...\n');

    await deleteExistingSeedUsersInSupabase(supabaseAdmin, seedUsers);
    const createdByKey = await createSeedUsersInSupabase(supabaseAdmin, seedUsers);

    await resetLocalUserDomain();
    await seedLocalUsers(createdByKey);

    printSummary(createdByKey);
    console.log('Done.');
  } catch (error) {
    console.error('Failed to seed all plans:', error.message || error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
})();
