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

const DEFAULT_EMAIL = 'rh@empresa.com';
const DEFAULT_PASSWORD = 'rh123456';
const DEFAULT_NAME = 'RH Empresa';

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

const ensureRhUser = async ({ email, password, name }) => {
  let supabaseUser = await getSupabaseUserByEmail(email);

  if (!supabaseUser) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        role: 'HR',
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
        },
      });
    }
  }

  return {
    id: supabaseUser.id,
    email,
    name,
    role: 'HR',
  };
};

(async () => {
  const email = normalizeArg(process.argv[2], DEFAULT_EMAIL);
  const password = normalizeArg(process.argv[3], DEFAULT_PASSWORD);
  const name = normalizeArg(process.argv[4], DEFAULT_NAME);

  try {
    const user = await ensureRhUser({ email, password, name });

    console.log('✅ Usuário RH configurado com sucesso');
    console.log(`   Email: ${user.email}`);
    console.log(`   Nome: ${user.name}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   ID: ${user.id}`);
  } catch (error) {
    console.error('❌ Falha ao configurar usuário RH:', error.message || error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
})();
