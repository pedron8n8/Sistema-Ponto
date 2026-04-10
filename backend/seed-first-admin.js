const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Criar pool de conexão simples
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT) || 5432,
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.POSTGRES_DB || 'sistema_ponto',
});

// Criar adapter e cliente Prisma
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ensureDefaultAdminPlan = async () => {
  return prisma.adminPlan.upsert({
    where: { code: 'BASE' },
    update: {
      name: 'Plano Base',
      isActive: true,
    },
    create: {
      code: 'BASE',
      name: 'Plano Base',
      description: 'Plano padrão para administradores',
      monthlyPrice: 0,
      isActive: true,
    },
  });
};

async function seedFirstAdmin() {
  try {
    console.log('🚀 Criando primeiro usuário ADMIN no sistema...\n');

    const email = process.env.INITIAL_ADMIN_EMAIL;
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    const name = process.env.INITIAL_ADMIN_NAME || 'Admin';

    if (!email || !password) {
      console.error('❌ Defina INITIAL_ADMIN_EMAIL e INITIAL_ADMIN_PASSWORD no backend/.env antes de executar este script.');
      process.exitCode = 1;
      return;
    }

    const defaultAdminPlan = await ensureDefaultAdminPlan();

    // 1. Faz login no Supabase para obter o ID do usuário
    console.log('1️⃣ Autenticando no Supabase...');
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      console.error('❌ Erro ao autenticar:', authError.message);
      console.log('\n💡 Certifique-se de que:');
      console.log('   - O usuário existe no Supabase');
      console.log('   - A senha está correta');
      console.log('   - As variáveis SUPABASE_URL e SUPABASE_KEY estão corretas no .env');
      return;
    }

    const supabaseUserId = authData.user.id;
    const supabaseEmail = authData.user.email;
    console.log('   ✅ Autenticado! ID:', supabaseUserId);

    // 2. Verifica se já existe no banco local
    console.log('\n2️⃣ Verificando se usuário já existe no banco local...');
    const existingUser = await prisma.user.findUnique({
      where: { id: supabaseUserId }
    });

    if (existingUser) {
      console.log('   ⚠️  Usuário já existe no banco!');
      console.log('   📋 Dados atuais:');
      console.log('      - ID:', existingUser.id);
      console.log('      - Email:', existingUser.email);
      console.log('      - Nome:', existingUser.name);
      console.log('      - Role:', existingUser.role);

      console.log('\n3️⃣ Garantindo vínculo ADMIN + plano...');
      await prisma.user.update({
        where: { id: supabaseUserId },
        data: {
          email: supabaseEmail,
          name,
          role: 'ADMIN',
          supervisorId: null,
          organizationAdminId: supabaseUserId,
          adminPlanId: defaultAdminPlan.id,
          adminPlanStatus: existingUser.adminPlanStatus || 'ACTIVE',
          adminPlanLinkedAt: existingUser.adminPlanLinkedAt || new Date(),
        }
      });
      console.log('   ✅ Usuário atualizado para regra nova (self-admin + plano).');
      
      return;
    }

    // 3. Cria o usuário no banco local
    console.log('   ✅ Usuário não existe, criando...');
    console.log('\n3️⃣ Cadastrando no banco de dados local...');
    
    const user = await prisma.user.create({
      data: {
        id: supabaseUserId,
        email: supabaseEmail,
        name: name,
        role: 'ADMIN',
        supervisorId: null,
        organizationAdminId: supabaseUserId,
        adminPlanId: defaultAdminPlan.id,
        adminPlanStatus: 'ACTIVE',
        adminPlanLinkedAt: new Date(),
      }
    });

    console.log('   ✅ Usuário criado com sucesso!\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 PRIMEIRO ADMIN CADASTRADO COM SUCESSO!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Dados do usuário:');
    console.log('   - ID:', user.id);
    console.log('   - Email:', user.email);
    console.log('   - Nome:', user.name);
    console.log('   - Role:', user.role);
    console.log('   - Criado em:', user.createdAt.toLocaleString('pt-BR'));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    console.log('\n✅ Agora você pode usar o token JWT para acessar o sistema!');
    console.log('   Execute: node get-token.js\n');

  } catch (error) {
    console.error('\n❌ Erro ao criar admin:', error);
    
    if (error.code === 'P2002') {
      console.log('\n💡 O usuário já existe no banco de dados.');
    } else {
      console.error('Detalhes:', error.message);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

seedFirstAdmin();
