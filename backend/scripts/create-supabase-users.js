const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Script para criar usuários no Supabase
 */

const users = [
  {
    email: process.env.SEED_ADMIN_EMAIL || 'admin@empresa.com',
    password: process.env.SEED_ADMIN_PASSWORD || '',
    name: 'Administrador',
    role: 'ADMIN',
  },
  {
    email: process.env.SEED_SUPERVISOR1_EMAIL || 'supervisor1@empresa.com',
    password: process.env.SEED_SUPERVISOR1_PASSWORD || '',
    name: 'Supervisor 1',
    role: 'SUPERVISOR',
  },
  {
    email: process.env.SEED_SUPERVISOR2_EMAIL || 'supervisor2@empresa.com',
    password: process.env.SEED_SUPERVISOR2_PASSWORD || '',
    name: 'Supervisor 2',
    role: 'SUPERVISOR',
  },
  {
    email: process.env.SEED_MEMBER1_EMAIL || 'colaborador1@empresa.com',
    password: process.env.SEED_MEMBER1_PASSWORD || '',
    name: 'Colaborador 1',
    role: 'MEMBER',
  },
  {
    email: process.env.SEED_MEMBER2_EMAIL || 'colaborador2@empresa.com',
    password: process.env.SEED_MEMBER2_PASSWORD || '',
    name: 'Colaborador 2',
    role: 'MEMBER',
  },
];

async function createUsers() {
  console.log('🚀 Criando usuários no Supabase...\n');

  const createdUsers = [];

  for (const userData of users) {
    try {
      console.log(`📧 Criando: ${userData.email}...`);

      if (!userData.password) {
        console.log('   ⚠️  Senha não informada no ambiente. Usuário ignorado.\n');
        continue;
      }

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: userData.email,
        password: userData.password,
        email_confirm: true,
        user_metadata: {
          name: userData.name,
          role: userData.role,
        },
      });

      if (error) {
        console.error(`   ❌ Erro: ${error.message}\n`);
      } else {
        console.log(`   ✅ Criado! ID: ${data.user.id}`);
        console.log(`   📝 Email: ${data.user.email}`);
        console.log('   🔐 Senha: definida via variável de ambiente\n');

        createdUsers.push({
          id: data.user.id,
          email: data.user.email,
          name: userData.name,
          role: userData.role,
        });
      }
    } catch (error) {
      console.error(`   ❌ Erro inesperado: ${error.message}\n`);
    }
  }

  console.log('✅ Processo concluído!\n');

  if (createdUsers.length > 0) {
    console.log('📋 Copie este código para usar no seed.js:\n');
    console.log('const users = [');
    createdUsers.forEach((user) => {
      console.log(`  {`);
      console.log(`    id: '${user.id}',`);
      console.log(`    email: '${user.email}',`);
      console.log(`    name: '${user.name}',`);
      console.log(`    role: '${user.role}',`);
      console.log(`    supervisorId: null,`);
      console.log(`  },`);
    });
    console.log('];\n');

    console.log('\n🔑 Credenciais criadas:');
    console.log('─────────────────────────────────────────────────────');
    users.forEach((user) => {
      console.log(`  ${user.email} / senha definida via .env`);
    });
    console.log('─────────────────────────────────────────────────────\n');
  }

  console.log('📝 Próximos passos:');
  console.log('   1. Copie o código acima e cole no prisma/seed.js');
  console.log('   2. Execute: npm run prisma:seed');
  console.log('   3. Teste o login com as credenciais acima\n');
}

createUsers();
