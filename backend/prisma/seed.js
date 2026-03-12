const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config();

// Configuração do Prisma
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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

  // ====================================================
  // IMPORTANTE: Você precisa criar estes usuários no Supabase primeiro!
  // ====================================================
  // Use o painel do Supabase ou a API para criar os usuários
  // Os IDs abaixo são exemplos - substitua pelos IDs reais do Supabase

  const users = [
    {
      id: '70fd1122-4764-4f55-8be9-018801c4d1ce',
      email: 'admin@empresa.com',
      name: 'Administrador',
      role: 'ADMIN',
      supervisorId: null,
    },
    {
      id: '0baa0bc9-6092-422c-a3a6-81d8dfbba261',
      email: 'supervisor1@empresa.com',
      name: 'Supervisor 1',
      role: 'SUPERVISOR',
      supervisorId: null,
    },
    {
      id: '2af82c10-3d3b-4ca5-9e42-bff7ddae4ff2',
      email: 'supervisor2@empresa.com',
      name: 'Supervisor 2',
      role: 'SUPERVISOR',
      supervisorId: null,
    },
    {
      id: '50d2c9d7-ab40-44ba-8858-e161b1bb929f',
      email: 'colaborador1@empresa.com',
      name: 'Colaborador 1',
      role: 'MEMBER',
      supervisorId: '0baa0bc9-6092-422c-a3a6-81d8dfbba261', // Supervisor 1
    },
    {
      id: '892eced6-7521-4d6d-8b2f-53b788c8341b',
      email: 'colaborador2@empresa.com',
      name: 'Colaborador 2',
      role: 'MEMBER',
      supervisorId: '0baa0bc9-6092-422c-a3a6-81d8dfbba261', // Supervisor 1
    },
  ];

  console.log('👥 Criando usuários...\n');

  for (const userData of users) {
    try {
      const user = await prisma.user.upsert({
        where: { id: userData.id },
        update: userData,
        create: userData,
      });
      console.log(`✅ Usuário criado/atualizado: ${user.email} (${user.role})`);
    } catch (error) {
      console.log(`⚠️  Erro ao criar ${userData.email}: ${error.message}`);
    }
  }

  console.log('\n📊 Criando registros de ponto de exemplo...\n');

  // Registros de ponto de exemplo para o Colaborador 1
  const timeEntries = [
    {
      userId: '50d2c9d7-ab40-44ba-8858-e161b1bb929f',
      clockIn: new Date('2026-03-10T08:00:00'),
      clockOut: new Date('2026-03-10T12:00:00'),
      notes: 'Manhã - trabalho normal',
      ipAddress: '192.168.1.100',
      device: 'Desktop - Chrome on Windows',
      status: 'PENDING',
    },
    {
      userId: '50d2c9d7-ab40-44ba-8858-e161b1bb929f',
      clockIn: new Date('2026-03-10T13:00:00'),
      clockOut: new Date('2026-03-10T18:00:00'),
      notes: 'Tarde - trabalho normal',
      ipAddress: '192.168.1.100',
      device: 'Desktop - Chrome on Windows',
      status: 'APPROVED',
    },
    {
      userId: '50d2c9d7-ab40-44ba-8858-e161b1bb929f',
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
            userId: '50d2c9d7-ab40-44ba-8858-e161b1bb929f',
            status: 'APPROVED',
          },
        })
      )?.id,
      reviewerId: '0baa0bc9-6092-422c-a3a6-81d8dfbba261', // Supervisor 1
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
  };

  console.log('\n📊 Estatísticas do banco de dados:');
  console.log(`   👥 Usuários: ${stats.users}`);
  console.log(`   ⏰ Registros de ponto: ${stats.timeEntries}`);
  console.log(`   📝 Logs de aprovação: ${stats.approvalLogs}`);

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
