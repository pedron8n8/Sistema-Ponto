const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config();

// Configuração do Prisma
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const parsedExtraAdminSeatMonthlyUsd = Number(process.env.EXTRA_ADMIN_SEAT_MONTHLY_USD);
const EXTRA_ADMIN_SEAT_MONTHLY_USD = Number(
  (
    Number.isFinite(parsedExtraAdminSeatMonthlyUsd) && parsedExtraAdminSeatMonthlyUsd >= 0
      ? parsedExtraAdminSeatMonthlyUsd
      : 7.5
  ).toFixed(2)
);

const normalizeText = (value, fallback = '') => {
  const normalized = String(value || '').trim();
  return normalized || fallback;
};

const normalizeEmail = (value, fallback) => normalizeText(value, fallback).toLowerCase();

const STATIC_SEED_IDS = {
  ADMIN: '70fd1122-4764-4f55-8be9-018801c4d1ce',
  SUPERVISOR1: '0baa0bc9-6092-422c-a3a6-81d8dfbba261',
  SUPERVISOR2: '2af82c10-3d3b-4ca5-9e42-bff7ddae4ff2',
  MEMBER1: '50d2c9d7-ab40-44ba-8858-e161b1bb929f',
  MEMBER2: '892eced6-7521-4d6d-8b2f-53b788c8341b',
};

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

const resolveSeedPlanConfig = () => {
  const defaultPlanCode = String(process.env.DEFAULT_ADMIN_PLAN_CODE || 'STARTER').trim().toUpperCase();
  return ADMIN_PLAN_CATALOG[defaultPlanCode] || ADMIN_PLAN_CATALOG.STARTER;
};

const buildSeedPaidInvoices = ({ adminUserId, adminEmail, planConfig }) => {
  const now = new Date();
  const currentCyclePaidAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10, 13, 0, 0));
  const previousCyclePaidAt = new Date(currentCyclePaidAt);
  previousCyclePaidAt.setUTCMonth(previousCyclePaidAt.getUTCMonth() - 1);

  const additionalSeats = 2;
  const basePlanAmount = Number(planConfig.monthlyPrice.toFixed(2));
  const additionalSeatsAmount = Number((additionalSeats * EXTRA_ADMIN_SEAT_MONTHLY_USD).toFixed(2));
  const invoiceIdSuffix = String(adminUserId || 'admin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || 'admin';

  return [
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
    {
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
    },
  ];
};

/**
 * Script de seed para popular o banco com dados iniciais
 */
async function main() {
  console.log('🌱 Iniciando seed do banco de dados...\n');

  // Limpar dados existentes (opcional - descomente se necessário)
  // await prisma.approvalLog.deleteMany();
  // await prisma.timeEntry.deleteMany();
  // await prisma.user.deleteMany();
  // console.log('🗑️  Dados existentes removidos\n');

  const seedUsers = {
    admin: {
      email: normalizeEmail(process.env.SEED_ADMIN_EMAIL, 'admin@empresa.com'),
      name: normalizeText(process.env.SEED_ADMIN_NAME, 'Administrador'),
      staticId: STATIC_SEED_IDS.ADMIN,
    },
    supervisor1: {
      email: normalizeEmail(process.env.SEED_SUPERVISOR1_EMAIL, 'supervisor1@empresa.com'),
      name: normalizeText(process.env.SEED_SUPERVISOR1_NAME, 'Supervisor 1'),
      staticId: STATIC_SEED_IDS.SUPERVISOR1,
    },
    supervisor2: {
      email: normalizeEmail(process.env.SEED_SUPERVISOR2_EMAIL, 'supervisor2@empresa.com'),
      name: normalizeText(process.env.SEED_SUPERVISOR2_NAME, 'Supervisor 2'),
      staticId: STATIC_SEED_IDS.SUPERVISOR2,
    },
    member1: {
      email: normalizeEmail(process.env.SEED_MEMBER1_EMAIL, 'colaborador1@empresa.com'),
      name: normalizeText(process.env.SEED_MEMBER1_NAME, 'Colaborador 1'),
      staticId: STATIC_SEED_IDS.MEMBER1,
    },
    member2: {
      email: normalizeEmail(process.env.SEED_MEMBER2_EMAIL, 'colaborador2@empresa.com'),
      name: normalizeText(process.env.SEED_MEMBER2_NAME, 'Colaborador 2'),
      staticId: STATIC_SEED_IDS.MEMBER2,
    },
  };

  const seedPlanConfig = resolveSeedPlanConfig();
  const seedExtraSeatsContracted = 2;
  const seedTeamActiveSeats = 5;
  const seedSeatLimit = seedPlanConfig.maxSeats + seedExtraSeatsContracted;

  const planByCode = {};
  for (const planConfig of Object.values(ADMIN_PLAN_CATALOG)) {
    const upsertedPlan = await prisma.adminPlan.upsert({
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

    planByCode[planConfig.code] = upsertedPlan;
  }

  const selectedAdminPlan = planByCode[seedPlanConfig.code] || planByCode.STARTER;

  console.log('👥 Criando usuários...\n');

  const admin = await prisma.user.upsert({
    where: { email: seedUsers.admin.email },
    update: {
      name: seedUsers.admin.name,
      role: 'ADMIN',
      supervisorId: null,
      adminPlanId: selectedAdminPlan.id,
      adminPlanStatus: 'ACTIVE',
      adminPlanLinkedAt: new Date(),
      adminSeatLimit: seedSeatLimit,
      adminExtraSeatPrice: EXTRA_ADMIN_SEAT_MONTHLY_USD,
      adminActiveSeats: seedTeamActiveSeats,
      adminExtraSeatsContracted: seedExtraSeatsContracted,
    },
    create: {
      id: seedUsers.admin.staticId,
      email: seedUsers.admin.email,
      name: seedUsers.admin.name,
      role: 'ADMIN',
      supervisorId: null,
      organizationAdminId: seedUsers.admin.staticId,
      adminPlanId: selectedAdminPlan.id,
      adminPlanStatus: 'ACTIVE',
      adminPlanLinkedAt: new Date(),
      adminSeatLimit: seedSeatLimit,
      adminExtraSeatPrice: EXTRA_ADMIN_SEAT_MONTHLY_USD,
      adminActiveSeats: seedTeamActiveSeats,
      adminExtraSeatsContracted: seedExtraSeatsContracted,
    },
  });

  if (admin.organizationAdminId !== admin.id) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { organizationAdminId: admin.id },
    });
  }

  const supervisor1 = await prisma.user.upsert({
    where: { email: seedUsers.supervisor1.email },
    update: {
      name: seedUsers.supervisor1.name,
      role: 'SUPERVISOR',
      supervisorId: null,
      organizationAdminId: admin.id,
    },
    create: {
      id: seedUsers.supervisor1.staticId,
      email: seedUsers.supervisor1.email,
      name: seedUsers.supervisor1.name,
      role: 'SUPERVISOR',
      supervisorId: null,
      organizationAdminId: admin.id,
    },
  });

  const supervisor2 = await prisma.user.upsert({
    where: { email: seedUsers.supervisor2.email },
    update: {
      name: seedUsers.supervisor2.name,
      role: 'SUPERVISOR',
      supervisorId: null,
      organizationAdminId: admin.id,
    },
    create: {
      id: seedUsers.supervisor2.staticId,
      email: seedUsers.supervisor2.email,
      name: seedUsers.supervisor2.name,
      role: 'SUPERVISOR',
      supervisorId: null,
      organizationAdminId: admin.id,
    },
  });

  const member1 = await prisma.user.upsert({
    where: { email: seedUsers.member1.email },
    update: {
      name: seedUsers.member1.name,
      role: 'MEMBER',
      supervisorId: supervisor1.id,
      organizationAdminId: admin.id,
    },
    create: {
      id: seedUsers.member1.staticId,
      email: seedUsers.member1.email,
      name: seedUsers.member1.name,
      role: 'MEMBER',
      supervisorId: supervisor1.id,
      organizationAdminId: admin.id,
    },
  });

  const member2 = await prisma.user.upsert({
    where: { email: seedUsers.member2.email },
    update: {
      name: seedUsers.member2.name,
      role: 'MEMBER',
      supervisorId: supervisor1.id,
      organizationAdminId: admin.id,
    },
    create: {
      id: seedUsers.member2.staticId,
      email: seedUsers.member2.email,
      name: seedUsers.member2.name,
      role: 'MEMBER',
      supervisorId: supervisor1.id,
      organizationAdminId: admin.id,
    },
  });

  console.log(`✅ Usuário criado/atualizado: ${admin.email} (${admin.role})`);
  console.log(`✅ Usuário criado/atualizado: ${supervisor1.email} (${supervisor1.role})`);
  console.log(`✅ Usuário criado/atualizado: ${supervisor2.email} (${supervisor2.role})`);
  console.log(`✅ Usuário criado/atualizado: ${member1.email} (${member1.role})`);
  console.log(`✅ Usuário criado/atualizado: ${member2.email} (${member2.role})`);

  console.log('\n💳 Criando faturas pagas de exemplo para a conta ADMIN...\n');

  const seedInvoices = buildSeedPaidInvoices({
    adminUserId: admin.id,
    adminEmail: admin.email,
    planConfig: seedPlanConfig,
  });

  for (const invoiceData of seedInvoices) {
    try {
      await prisma.adminBillingInvoice.upsert({
        where: { stripeSessionId: invoiceData.stripeSessionId },
        update: {
          ...invoiceData,
          adminUserId: admin.id,
          syncedAt: new Date(),
        },
        create: {
          ...invoiceData,
          adminUserId: admin.id,
        },
      });

      console.log(
        `✅ Fatura seed criada/atualizada: ${invoiceData.sourceType} (${invoiceData.paymentStatus})`
      );
    } catch (error) {
      console.log(`⚠️  Erro ao criar fatura seed ${invoiceData.stripeSessionId}: ${error.message}`);
    }
  }

  console.log('\n📊 Criando registros de ponto de exemplo...\n');

  // Registros de ponto de exemplo para o Colaborador 1
  const timeEntries = [
    {
      userId: member1.id,
      clockIn: new Date('2026-03-10T08:00:00'),
      clockOut: new Date('2026-03-10T12:00:00'),
      notes: 'Manhã - trabalho normal',
      ipAddress: '192.168.1.100',
      device: 'Desktop - Chrome on Windows',
      status: 'PENDING',
    },
    {
      userId: member1.id,
      clockIn: new Date('2026-03-10T13:00:00'),
      clockOut: new Date('2026-03-10T18:00:00'),
      notes: 'Tarde - trabalho normal',
      ipAddress: '192.168.1.100',
      device: 'Desktop - Chrome on Windows',
      status: 'APPROVED',
    },
    {
      userId: member1.id,
      clockIn: new Date('2026-03-11T08:30:00'),
      clockOut: new Date('2026-03-11T12:30:00'),
      notes: 'Manhã',
      ipAddress: '192.168.1.100',
      device: 'Desktop - Chrome on Windows',
      status: 'PENDING',
    },
  ];

  for (const entryData of timeEntries) {
    try {
      const entry = await prisma.timeEntry.create({
        data: entryData,
      });
      console.log(
        `✅ Registro criado: ${entry.clockIn.toISOString()} - Status: ${entry.status}`
      );
    } catch (error) {
      console.log(`⚠️  Erro ao criar registro: ${error.message}`);
    }
  }

  console.log('\n📝 Criando logs de aprovação...\n');

  // Log de aprovação para o segundo registro
  const approvalLogs = [
    {
      timeEntryId: (
        await prisma.timeEntry.findFirst({
          where: {
            userId: member1.id,
            status: 'APPROVED',
          },
        })
      )?.id,
      reviewerId: supervisor1.id,
      action: 'APPROVED',
      comment: 'Registro aprovado - tudo correto',
      timestamp: new Date('2026-03-11T10:00:00'),
    },
  ];

  for (const logData of approvalLogs) {
    if (logData.timeEntryId) {
      try {
        const log = await prisma.approvalLog.create({
          data: logData,
        });
        console.log(`✅ Log de aprovação criado: ${log.action}`);
      } catch (error) {
        console.log(`⚠️  Erro ao criar log: ${error.message}`);
      }
    }
  }

  // Estatísticas
  const stats = {
    users: await prisma.user.count(),
    timeEntries: await prisma.timeEntry.count(),
    approvalLogs: await prisma.approvalLog.count(),
    paidInvoices: await prisma.adminBillingInvoice.count(),
  };

  console.log('\n📊 Estatísticas do banco de dados:');
  console.log(`   👥 Usuários: ${stats.users}`);
  console.log(`   ⏰ Registros de ponto: ${stats.timeEntries}`);
  console.log(`   📝 Logs de aprovação: ${stats.approvalLogs}`);
  console.log(`   💳 Faturas da conta ADMIN: ${stats.paidInvoices}`);

  console.log('\n✅ Seed concluído com sucesso!\n');

  console.log('⚠️  IMPORTANTE:');
  console.log('   1. Crie estes usuários no Supabase com os emails acima');
  console.log('   2. Copie os IDs reais do Supabase e atualize este arquivo');
  console.log('   3. Execute o seed novamente com os IDs corretos\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Erro ao executar seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
