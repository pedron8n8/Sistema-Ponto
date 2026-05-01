const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const { supabase, supabaseAdmin } = require('../src/config/supabase');
require('dotenv').config();

const fallbackConnectionString = `postgresql://${encodeURIComponent(process.env.POSTGRES_USER || 'postgres')}:${encodeURIComponent(process.env.POSTGRES_PASSWORD || 'postgres')}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'sistema_ponto'}`;
const connectionString = process.env.DATABASE_URL || fallbackConnectionString;
const databaseSchema = process.env.DATABASE_SCHEMA || 'schema_automation';

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool, {
  schema: databaseSchema,
});
const prisma = new PrismaClient({ adapter });

const EMAIL_DOMAIN = String(process.env.STAFF_SEED_EMAIL_DOMAIN || 'systemaponto.test')
  .trim()
  .replace(/^@/, '');
const OUTPUT_DIR = path.resolve(__dirname, '../exports');
const PRIMARY_ADMIN_NAME = 'Rhea Campbell';
const SUPERVISOR_NAME = 'Jhaniel';

const STAFF = [
  { name: 'Abdul Rauf', role: 'MEMBER' },
  { name: 'Aden Razzaq', role: 'MEMBER' },
  { name: 'Amanda Spinney', role: 'ADMIN' },
  { name: 'Amina Shah', role: 'MEMBER' },
  { name: 'Iyanuoluwa', role: 'MEMBER' },
  { name: 'Jhaniel', role: 'SUPERVISOR' },
  { name: 'Kafeel', role: 'MEMBER' },
  { name: 'Kazam Hussain', role: 'MEMBER' },
  { name: 'Kyle Miller', role: 'MEMBER' },
  { name: 'Leah', role: 'MEMBER' },
  { name: 'Maria Erika Aguilar', role: 'MEMBER' },
  { name: 'Mohammad Saim', role: 'MEMBER' },
  { name: 'Muhammad Kaleemullah', role: 'ADMIN' },
  { name: 'Muhammad Saim Rafiq', role: 'MEMBER' },
  { name: 'Pedro Henrique Ferri', role: 'SUPERADMIN' },
  { name: 'Rhea Campbell', role: 'ADMIN' },
  { name: 'Safeer Shahid', role: 'MEMBER' },
  { name: 'Sunshine Diel', role: 'HR' },
  { name: 'Umar Ahmad', role: 'MEMBER' },
];

const slugify = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.+/g, '.');

const randomSuffix = () => crypto.randomBytes(3).toString('hex');

const generatePassword = () => {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!';
  const all = lower + upper + digits + symbols;
  const required = [
    lower[crypto.randomInt(lower.length)],
    upper[crypto.randomInt(upper.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];

  while (required.length < 16) {
    required.push(all[crypto.randomInt(all.length)]);
  }

  return required.sort(() => crypto.randomInt(3) - 1).join('');
};

const verifySupabaseLogin = async ({ email, password }) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return {
      ok: false,
      message: error.message,
    };
  }

  if (data?.session?.access_token) {
    await supabase.auth.signOut().catch(() => {});
    return {
      ok: true,
      message: 'Login verificado',
    };
  }

  return {
    ok: false,
    message: 'Supabase nao retornou sessao para este login.',
  };
};

const ensureVerifiedPassword = async ({ supabaseUserId, email, password }) => {
  let currentPassword = password;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const verification = await verifySupabaseLogin({ email, password: currentPassword });

    if (verification.ok) {
      return currentPassword;
    }

    const nextPassword = generatePassword();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(supabaseUserId, {
      password: nextPassword,
    });

    if (error) {
      throw new Error(`Erro ao resetar senha de ${email}: ${error.message}`);
    }

    currentPassword = nextPassword;
  }

  const finalVerification = await verifySupabaseLogin({ email, password: currentPassword });
  if (!finalVerification.ok) {
    throw new Error(`Login de ${email} ainda falhou apos reset de senha: ${finalVerification.message}`);
  }

  return currentPassword;
};

const buildEmail = (name, usedEmails) => {
  const base = slugify(name) || 'user';
  let email = '';

  do {
    email = `${base}.${randomSuffix()}@${EMAIL_DOMAIN}`;
  } while (usedEmails.has(email));

  usedEmails.add(email);
  return email;
};

const escapeCsv = (value) => {
  const raw = String(value ?? '');
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const getSupabaseUserByEmail = async (email) => {
  let page = 1;
  const perPage = 200;

  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Erro ao listar usuarios no Supabase: ${error.message}`);
    }

    const users = data?.users || [];
    const found = users.find(
      (user) => String(user.email || '').toLowerCase() === email.toLowerCase()
    );
    if (found) return found;

    if (users.length < perPage) break;
    page += 1;
  }

  return null;
};

const ensureSupabaseUser = async ({ email, password, name, role, organizationAdminId, supervisorId }) => {
  const metadata = {
    name,
    role,
    ...(organizationAdminId ? { organizationAdminId } : {}),
    ...(supervisorId ? { supervisorId } : {}),
  };

  const existing = await getSupabaseUserByEmail(email);
  if (existing) {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
      email,
      password,
      user_metadata: {
        ...(existing.user_metadata || {}),
        ...metadata,
      },
    });

    if (error) {
      throw new Error(`Erro ao atualizar ${email} no Supabase: ${error.message}`);
    }

    return data.user;
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });

  if (error) {
    throw new Error(`Erro ao criar ${email} no Supabase: ${error.message}`);
  }

  return data.user;
};

const ensureProPlan = async () => {
  return prisma.adminPlan.upsert({
    where: { code: 'PRO' },
    update: {
      name: 'Pro',
      description: 'Plano Pro para administradores',
      monthlyPrice: 50,
      isActive: true,
    },
    create: {
      code: 'PRO',
      name: 'Pro',
      description: 'Plano Pro para administradores',
      monthlyPrice: 50,
      isActive: true,
    },
  });
};

const upsertLocalUser = async ({ supabaseUser, email, name, role, organizationAdminId, supervisorId, proPlan }) => {
  const isAdmin = role === 'ADMIN';
  const isSuperAdmin = role === 'SUPERADMIN';
  const adminData = isAdmin
    ? {
        adminPlanId: proPlan.id,
        adminPlanStatus: 'ACTIVE',
        adminPlanLinkedAt: new Date(),
        adminSeatLimit: 50,
        adminExtraSeatPrice: 0,
        adminActiveSeats: STAFF.filter((person) => person.role !== 'SUPERADMIN').length,
        adminExtraSeatsContracted: 0,
      }
    : {
        adminPlanId: null,
        adminPlanStatus: 'INACTIVE',
        adminPlanLinkedAt: null,
        adminSeatLimit: null,
        adminExtraSeatPrice: null,
        adminActiveSeats: 0,
        adminExtraSeatsContracted: 0,
      };

  const data = {
    email,
    name,
    role,
    isActive: true,
    supervisorId: role === 'MEMBER' ? supervisorId : null,
    organizationAdminId: isSuperAdmin ? null : organizationAdminId,
    timeZone: 'America/Sao_Paulo',
    ...adminData,
  };

  const localById = await prisma.user.findUnique({ where: { id: supabaseUser.id } });
  if (localById) {
    return prisma.user.update({
      where: { id: supabaseUser.id },
      data,
    });
  }

  const localByEmail = await prisma.user.findUnique({ where: { email } });
  if (localByEmail) {
    await prisma.$transaction(async (tx) => {
      const relatedUsers = await tx.user.findMany({
        where: {
          OR: [
            { id: localByEmail.id },
            { organizationAdminId: localByEmail.id },
            { supervisorId: localByEmail.id },
          ],
        },
        select: { id: true },
      });
      const relatedUserIds = relatedUsers.map((user) => user.id);

      await tx.vacationApprovalLog.deleteMany({
        where: {
          OR: [
            { vacationRequest: { userId: { in: relatedUserIds } } },
            { vacationRequest: { supervisorId: { in: relatedUserIds } } },
            { vacationRequest: { hrReviewerId: { in: relatedUserIds } } },
            { actorId: { in: relatedUserIds } },
          ],
        },
      });
      await tx.vacationRequest.deleteMany({
        where: {
          OR: [
            { userId: { in: relatedUserIds } },
            { supervisorId: { in: relatedUserIds } },
            { hrReviewerId: { in: relatedUserIds } },
          ],
        },
      });
      await tx.approvalLog.deleteMany({
        where: {
          OR: [
            { reviewerId: { in: relatedUserIds } },
            { timeEntry: { userId: { in: relatedUserIds } } },
          ],
        },
      });
      await tx.bankHoursEntry.deleteMany({
        where: {
          OR: [
            { userId: { in: relatedUserIds } },
            { timeEntry: { userId: { in: relatedUserIds } } },
          ],
        },
      });
      await tx.timeEntry.deleteMany({ where: { userId: { in: relatedUserIds } } });
      await tx.adminBillingInvoice.deleteMany({ where: { adminUserId: { in: relatedUserIds } } });
      await tx.user.deleteMany({ where: { id: { in: relatedUserIds } } });
    });

    return prisma.user.create({
      data: {
        id: supabaseUser.id,
        ...data,
      },
    });
  }

  return prisma.user.create({
    data: {
      id: supabaseUser.id,
      ...data,
    },
  });
};

const writeCredentialsReport = (createdUsers) => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUTPUT_DIR, `staff_credentials_${timestamp}.json`);
  const csvPath = path.join(OUTPUT_DIR, `staff_credentials_${timestamp}.csv`);
  const mdPath = path.join(OUTPUT_DIR, `staff_credentials_${timestamp}.md`);
  const latestJsonPath = path.join(OUTPUT_DIR, 'staff_credentials_latest.json');
  const latestCsvPath = path.join(OUTPUT_DIR, 'staff_credentials_latest.csv');
  const latestMdPath = path.join(OUTPUT_DIR, 'staff_credentials_latest.md');

  const publicRows = createdUsers.map(({ id, name, role, email, password, organizationAdminId, supervisorId }) => ({
    id,
    name,
    role,
    email,
    password,
    organizationAdminId,
    supervisorId,
  }));

  const csvHeader = ['name', 'role', 'email', 'password', 'id', 'organizationAdminId', 'supervisorId'];
  const csv = [
    csvHeader.join(','),
    ...publicRows.map((row) => csvHeader.map((key) => escapeCsv(row[key])).join(',')),
  ].join('\n');

  const md = [
    '# Credenciais dos Funcionarios',
    '',
    `Gerado em: ${new Date().toISOString()}`,
    '',
    '> Guarde este arquivo com cuidado. Ele contem senhas em texto claro.',
    '',
    '| Nome | Cargo | Email | Senha |',
    '| --- | --- | --- | --- |',
    ...publicRows.map(
      (row) => `| ${row.name} | ${row.role} | ${row.email} | \`${row.password}\` |`
    ),
    '',
  ].join('\n');

  fs.writeFileSync(jsonPath, JSON.stringify(publicRows, null, 2));
  fs.writeFileSync(latestJsonPath, JSON.stringify(publicRows, null, 2));
  fs.writeFileSync(csvPath, csv);
  fs.writeFileSync(latestCsvPath, csv);
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(latestMdPath, md);

  return { jsonPath, csvPath, mdPath, latestJsonPath, latestCsvPath, latestMdPath };
};

const main = async () => {
  console.log('Criando funcionarios no Supabase Auth e no banco local...');
  console.log(`Dominio dos emails gerados: ${EMAIL_DOMAIN}`);

  const proPlan = await ensureProPlan();
  const usedEmails = new Set();
  const preparedUsers = STAFF.map((person) => ({
    ...person,
    email: buildEmail(person.name, usedEmails),
    password: generatePassword(),
  }));

  const primaryAdminSeed = preparedUsers.find((person) => person.name === PRIMARY_ADMIN_NAME);
  const supervisorSeed = preparedUsers.find((person) => person.name === SUPERVISOR_NAME);

  if (!primaryAdminSeed || !supervisorSeed) {
    throw new Error('Lista de funcionarios precisa conter Rhea Campbell e Jhaniel.');
  }

  const createdByName = new Map();
  const creationOrder = [
    ...preparedUsers.filter((person) => person.role === 'SUPERADMIN'),
    ...preparedUsers.filter((person) => person.role === 'ADMIN'),
    ...preparedUsers.filter((person) => person.role === 'SUPERVISOR'),
    ...preparedUsers.filter((person) => person.role === 'HR'),
    ...preparedUsers.filter((person) => person.role === 'MEMBER'),
  ];

  for (const person of creationOrder) {
    const primaryAdmin = createdByName.get(PRIMARY_ADMIN_NAME);
    const supervisor = createdByName.get(SUPERVISOR_NAME);
    const organizationAdminId =
      person.role === 'SUPERADMIN'
        ? null
        : person.role === 'ADMIN'
          ? null
          : primaryAdmin?.id;
    const supervisorId = person.role === 'MEMBER' ? supervisor?.id : null;

    const supabaseUser = await ensureSupabaseUser({
      email: person.email,
      password: person.password,
      name: person.name,
      role: person.role,
      organizationAdminId,
      supervisorId,
    });

    const effectiveOrganizationAdminId =
      person.role === 'ADMIN' ? supabaseUser.id : organizationAdminId;

    const localUser = await upsertLocalUser({
      supabaseUser,
      email: person.email,
      name: person.name,
      role: person.role,
      organizationAdminId: effectiveOrganizationAdminId,
      supervisorId,
      proPlan,
    });

    const verifiedPassword = await ensureVerifiedPassword({
      supabaseUserId: supabaseUser.id,
      email: person.email,
      password: person.password,
    });

    createdByName.set(person.name, {
      id: localUser.id,
      name: localUser.name,
      role: localUser.role,
      email: person.email,
      password: verifiedPassword,
      organizationAdminId: localUser.organizationAdminId,
      supervisorId: localUser.supervisorId,
    });

    console.log(`OK ${person.name} (${person.role}) -> ${person.email} (login verificado)`);
  }

  const createdUsers = STAFF.map((person) => createdByName.get(person.name));
  const paths = writeCredentialsReport(createdUsers);

  console.log('\nFuncionarios criados com sucesso.');
  console.log(`Credenciais JSON: ${paths.jsonPath}`);
  console.log(`Credenciais CSV:  ${paths.csvPath}`);
  console.log(`Credenciais MD:   ${paths.mdPath}`);
  console.log('\nGuarde estes arquivos com cuidado: eles contem senhas em texto claro.');
};

main()
  .catch((error) => {
    console.error('Falha ao criar funcionarios:', error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
