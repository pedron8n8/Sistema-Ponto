const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const { supabaseAdmin } = require('../src/config/supabase');
require('dotenv').config();

const fallbackConnectionString = `postgresql://${encodeURIComponent(process.env.POSTGRES_USER || 'postgres')}:${encodeURIComponent(process.env.POSTGRES_PASSWORD || 'postgres')}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'sistema_ponto'}`;
const connectionString = process.env.DATABASE_URL || fallbackConnectionString;

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEFAULT_EMAIL = process.env.SEED_RH_EMAIL || '';
const DEFAULT_PASSWORD = process.env.SEED_RH_PASSWORD || '';
const DEFAULT_NAME = process.env.SEED_RH_NAME || 'RH Empresa';
const DEFAULT_ORGANIZATION_ADMIN_ID = process.env.SEED_RH_ADMIN_ID || '';

const normalizeArg = (value, fallback) => {
  if (!value) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
};

const getSupabaseUserByEmail = async (email) => {
  let page = 1;
  const perPage = 200;

  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Erro ao listar usuários no Supabase: ${error.message}`);
    }

    const users = data?.users || [];
    const found = users.find((user) => String(user.email || '').toLowerCase() === email.toLowerCase());
    if (found) return found;

    if (users.length < perPage) break;
    page += 1;
  }

  return null;
};

const resolveOrganizationAdminId = async (adminIdCandidate) => {
  if (adminIdCandidate) {
    const adminById = await prisma.user.findUnique({
      where: { id: adminIdCandidate },
      select: { id: true, role: true, adminPlanId: true },
    });

    if (!adminById || adminById.role !== 'ADMIN') {
      throw new Error('SEED_RH_ADMIN_ID/arg adminId precisa apontar para um usuário ADMIN existente.');
    }

    if (!adminById.adminPlanId) {
      throw new Error('O ADMIN informado não possui plano vinculado.');
    }

    return adminById.id;
  }

  const fallbackAdmin = await prisma.user.findFirst({
    where: {
      role: 'ADMIN',
      adminPlanId: { not: null },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!fallbackAdmin) {
    throw new Error('Nenhum ADMIN com plano vinculado foi encontrado para associar o usuário RH.');
  }

  return fallbackAdmin.id;
};

const ensureRhUser = async ({ email, password, name, organizationAdminId }) => {
  let supabaseUser = await getSupabaseUserByEmail(email);

  if (!supabaseUser) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        role: 'HR',
        organizationAdminId,
      },
    });

    if (error) {
      throw new Error(`Erro ao criar usuário RH no Supabase: ${error.message}`);
    }

    supabaseUser = data.user;
  } else {
    await supabaseAdmin.auth.admin.updateUserById(supabaseUser.id, {
      password,
      email,
      user_metadata: {
        ...(supabaseUser.user_metadata || {}),
        name,
        role: 'HR',
        organizationAdminId,
      },
    });
  }

  const localById = await prisma.user.findUnique({ where: { id: supabaseUser.id } });

  if (localById) {
    await prisma.user.update({
      where: { id: supabaseUser.id },
      data: {
        email,
        name,
        role: 'HR',
        supervisorId: null,
        organizationAdminId,
      },
    });
  } else {
    const localByEmail = await prisma.user.findUnique({ where: { email } });

    if (localByEmail) {
      await prisma.user.update({
        where: { id: localByEmail.id },
        data: {
          name,
          role: 'HR',
          supervisorId: null,
          organizationAdminId,
        },
      });
    } else {
      await prisma.user.create({
        data: {
          id: supabaseUser.id,
          email,
          name,
          role: 'HR',
          supervisorId: null,
          organizationAdminId,
        },
      });
    }
  }

  return {
    id: supabaseUser.id,
    email,
    name,
    role: 'HR',
    organizationAdminId,
  };
};

(async () => {
  const email = normalizeArg(process.argv[2], DEFAULT_EMAIL);
  const password = normalizeArg(process.argv[3], DEFAULT_PASSWORD);
  const name = normalizeArg(process.argv[4], DEFAULT_NAME);
  const adminIdInput = normalizeArg(process.argv[5], DEFAULT_ORGANIZATION_ADMIN_ID);

  if (!email || !password) {
    console.error('❌ Informe email/senha por argumentos ou configure SEED_RH_EMAIL e SEED_RH_PASSWORD no .env');
    process.exitCode = 1;
    return;
  }

  try {
    const organizationAdminId = await resolveOrganizationAdminId(adminIdInput);
    const user = await ensureRhUser({ email, password, name, organizationAdminId });

    console.log('✅ Usuário RH configurado com sucesso');
    console.log(`   Email: ${user.email}`);
    console.log(`   Nome: ${user.name}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Admin responsável: ${user.organizationAdminId}`);
    console.log(`   ID: ${user.id}`);
  } catch (error) {
    console.error('❌ Falha ao configurar usuário RH:', error.message || error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
})();
