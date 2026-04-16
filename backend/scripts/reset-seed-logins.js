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

const SEED_USER_DEFINITIONS = [
  {
    key: 'SUPERADMIN',
    emailEnv: 'SEED_SUPERADMIN_EMAIL',
    passwordEnv: 'SEED_SUPERADMIN_PASSWORD',
    nameEnv: 'SEED_SUPERADMIN_NAME',
    defaultName: 'Super Admin',
    role: 'SUPERADMIN',
  },
  {
    key: 'ADMIN',
    emailEnv: 'SEED_ADMIN_EMAIL',
    passwordEnv: 'SEED_ADMIN_PASSWORD',
    nameEnv: 'SEED_ADMIN_NAME',
    defaultName: 'Administrador',
    role: 'ADMIN',
  },
  {
    key: 'RH',
    emailEnv: 'SEED_RH_EMAIL',
    passwordEnv: 'SEED_RH_PASSWORD',
    nameEnv: 'SEED_RH_NAME',
    defaultName: 'RH Empresa',
    role: 'HR',
  },
  {
    key: 'SUPERVISOR1',
    emailEnv: 'SEED_SUPERVISOR1_EMAIL',
    passwordEnv: 'SEED_SUPERVISOR1_PASSWORD',
    nameEnv: 'SEED_SUPERVISOR1_NAME',
    defaultName: 'Supervisor 1',
    role: 'SUPERVISOR',
  },
  {
    key: 'SUPERVISOR2',
    emailEnv: 'SEED_SUPERVISOR2_EMAIL',
    passwordEnv: 'SEED_SUPERVISOR2_PASSWORD',
    nameEnv: 'SEED_SUPERVISOR2_NAME',
    defaultName: 'Supervisor 2',
    role: 'SUPERVISOR',
  },
  {
    key: 'MEMBER1',
    emailEnv: 'SEED_MEMBER1_EMAIL',
    passwordEnv: 'SEED_MEMBER1_PASSWORD',
    nameEnv: 'SEED_MEMBER1_NAME',
    defaultName: 'Colaborador 1',
    role: 'MEMBER',
  },
  {
    key: 'MEMBER2',
    emailEnv: 'SEED_MEMBER2_EMAIL',
    passwordEnv: 'SEED_MEMBER2_PASSWORD',
    nameEnv: 'SEED_MEMBER2_NAME',
    defaultName: 'Colaborador 2',
    role: 'MEMBER',
  },
];

const CREATE_ORDER = [
  'SUPERADMIN',
  'ADMIN',
  'SUPERVISOR1',
  'SUPERVISOR2',
  'MEMBER1',
  'MEMBER2',
  'RH',
];

const normalize = (value) => String(value || '').trim();

const getSeedUsersFromEnv = () => {
  return SEED_USER_DEFINITIONS.map((definition) => ({
    key: definition.key,
    role: definition.role,
    email: normalize(process.env[definition.emailEnv]),
    password: normalize(process.env[definition.passwordEnv]),
    name: normalize(process.env[definition.nameEnv]) || definition.defaultName,
    emailEnv: definition.emailEnv,
    passwordEnv: definition.passwordEnv,
  }));
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
    if (!user.email) {
      missing.push(user.emailEnv);
    }

    if (!user.password) {
      missing.push(user.passwordEnv);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(', ')}`);
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
      throw new Error(`Erro ao listar usuários do Supabase: ${error.message}`);
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
      throw new Error(`Erro ao excluir usuário ${user.email} (${user.id}) no Supabase: ${error.message}`);
    }

    console.log(`🗑️ Supabase: usuário removido -> ${user.email} (${user.id})`);
  }

  if (usersToDelete.length === 0) {
    console.log('ℹ️ Supabase: nenhum usuário seed existente para excluir.');
  }
};

const createSeedUsersInSupabase = async (supabaseAdmin, seedUsers) => {
  const byKey = new Map(seedUsers.map((user) => [user.key, user]));
  const createdByKey = new Map();

  for (const key of CREATE_ORDER) {
    const user = byKey.get(key);

    if (!user) {
      throw new Error(`Usuário ${key} não encontrado na configuração de seed.`);
    }

    const metadata = {
      name: user.name,
      role: user.role,
    };

    if (['SUPERVISOR', 'MEMBER', 'HR'].includes(user.role)) {
      const admin = createdByKey.get('ADMIN');
      if (!admin) {
        throw new Error('ADMIN precisa ser criado antes de SUPERVISOR/MEMBER/HR.');
      }
      metadata.organizationAdminId = admin.id;
    }

    if (user.role === 'MEMBER') {
      const supervisor = createdByKey.get('SUPERVISOR1');
      if (!supervisor) {
        throw new Error('SUPERVISOR1 precisa ser criado antes dos MEMBERs.');
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
      throw new Error(`Erro ao criar usuário ${user.email} no Supabase: ${error.message}`);
    }

    const created = data?.user;
    if (!created?.id) {
      throw new Error(`Supabase não retornou ID para ${user.email}.`);
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
      id: created.id,
      email: created.email,
      name: user.name,
      role: user.role,
    });

    console.log(`✅ Supabase: usuário criado -> ${created.email} (${created.id})`);
  }

  return createdByKey;
};

const resetLocalUserDomain = async () => {
  // Limpa tabelas dependentes antes de recriar usuários com novos IDs.
  await prisma.vacationApprovalLog.deleteMany();
  await prisma.vacationRequest.deleteMany();
  await prisma.approvalLog.deleteMany();
  await prisma.bankHoursEntry.deleteMany();
  await prisma.timeEntry.deleteMany();
  await prisma.user.deleteMany();

  console.log('🗑️ Banco local: dados de usuários e dependências removidos.');
};

const seedLocalUsers = async (createdByKey) => {
  const adminPlan = await prisma.adminPlan.upsert({
    where: { code: 'STARTER' },
    update: {
      name: 'Starter',
      monthlyPrice: 30,
      isActive: true,
    },
    create: {
      code: 'STARTER',
      name: 'Starter',
      description: 'Plano Starter para administradores',
      monthlyPrice: 30,
      isActive: true,
    },
  });

  const superadmin = createdByKey.get('SUPERADMIN');
  const admin = createdByKey.get('ADMIN');
  const rh = createdByKey.get('RH');
  const supervisor1 = createdByKey.get('SUPERVISOR1');
  const supervisor2 = createdByKey.get('SUPERVISOR2');
  const member1 = createdByKey.get('MEMBER1');
  const member2 = createdByKey.get('MEMBER2');

  await prisma.user.create({
    data: {
      id: superadmin.id,
      email: superadmin.email,
      name: superadmin.name,
      role: 'SUPERADMIN',
      supervisorId: null,
      organizationAdminId: null,
      adminPlanStatus: 'INACTIVE',
    },
  });

  await prisma.user.create({
    data: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: 'ADMIN',
      supervisorId: null,
      organizationAdminId: admin.id,
      adminPlanId: adminPlan.id,
      adminPlanStatus: 'ACTIVE',
      adminPlanLinkedAt: new Date(),
    },
  });

  await prisma.user.create({
    data: {
      id: supervisor1.id,
      email: supervisor1.email,
      name: supervisor1.name,
      role: 'SUPERVISOR',
      supervisorId: null,
      organizationAdminId: admin.id,
    },
  });

  await prisma.user.create({
    data: {
      id: supervisor2.id,
      email: supervisor2.email,
      name: supervisor2.name,
      role: 'SUPERVISOR',
      supervisorId: null,
      organizationAdminId: admin.id,
    },
  });

  await prisma.user.create({
    data: {
      id: member1.id,
      email: member1.email,
      name: member1.name,
      role: 'MEMBER',
      supervisorId: supervisor1.id,
      organizationAdminId: admin.id,
    },
  });

  await prisma.user.create({
    data: {
      id: member2.id,
      email: member2.email,
      name: member2.name,
      role: 'MEMBER',
      supervisorId: supervisor1.id,
      organizationAdminId: admin.id,
    },
  });

  await prisma.user.create({
    data: {
      id: rh.id,
      email: rh.email,
      name: rh.name,
      role: 'HR',
      supervisorId: null,
      organizationAdminId: admin.id,
    },
  });

  console.log('✅ Banco local: usuários seed recriados e sincronizados.');
};

const printSummary = (seedUsers, createdByKey) => {
  console.log('\n📋 Resumo dos logins recriados:');
  console.log('─────────────────────────────────────────────────────');

  for (const user of seedUsers) {
    const created = createdByKey.get(user.key);
    console.log(`${created.email} (${user.role}) -> ${created.id}`);
  }

  console.log('─────────────────────────────────────────────────────');
  console.log('🔐 Senhas: mantidas conforme variáveis SEED_*_PASSWORD do .env\n');
};

(async () => {
  try {
    const seedUsers = getSeedUsersFromEnv();
    validateRequiredConfiguration(seedUsers);

    const supabaseAdmin = buildSupabaseAdminClient();

    console.log('🚀 Resetando logins seed no Supabase e sincronizando banco local...\n');

    await deleteExistingSeedUsersInSupabase(supabaseAdmin, seedUsers);
    const createdByKey = await createSeedUsersInSupabase(supabaseAdmin, seedUsers);

    await resetLocalUserDomain();
    await seedLocalUsers(createdByKey);

    printSummary(seedUsers, createdByKey);
    console.log('✅ Processo concluído com sucesso.');
  } catch (error) {
    console.error('❌ Falha ao resetar logins seed:', error.message || error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
})();
