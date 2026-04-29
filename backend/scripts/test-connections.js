const path = require('path');
// Forçamos o dotenv a buscar o arquivo .env na raiz do projeto (um nível acima de /scripts)
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');



const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
const { PrismaPg } = require('@prisma/adapter-pg');
const { pool } = require('../src/config/database');

async function testConnections() {
  console.log('🚀 Iniciando testes de infraestrutura...\n');

  // Log de debug para garantir que o caminho do .env foi resolvido
  console.log('🔍 Verificando variáveis de ambiente...');
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✅ Encontrada' : '❌ Não encontrada');
  console.log('REDIS_URL:', process.env.REDIS_URL ? '✅ Encontrada' : '⚠️ Usando padrão localhost');

    // Criar pool de conexão do PostgreSQL
    const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    });

    const adapter = new PrismaPg(pool);

  // --- Teste do Prisma ---
  // Passamos a URL diretamente no construtor para evitar o erro de inicialização
  // No seu test-connections.js ou check-infra.js

    const prisma = new PrismaClient({
        adapter,
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

  try {
    console.log('📦 Testando conexão com Postgres (Prisma)...');
    await prisma.$connect(); // Primeiro tenta conectar
    await prisma.$queryRaw`SELECT 1`; // Depois tenta uma query simples
    console.log('✅ Postgres: Conectado com sucesso!');
  } catch (error) {
    console.error('❌ Postgres: Erro na conexão:');
    console.error(error.message);
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n' + '-'.repeat(30) + '\n');

  // --- Teste do Redis ---
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    // Se o seu Redis tiver senha e você estiver usando uma URL simples:
    retryStrategy: (times) => null // Não tenta reconectar se falhar de primeira
  });

  try {
    console.log(`🚩 Testando conexão com Redis...`);
    const pong = await redis.ping();
    console.log('✅ Redis: Conectado com sucesso! (Resposta:', pong, ')');
  } catch (error) {
    console.error('❌ Redis: Erro na conexão:');
    console.error(error.message);
  } finally {
    redis.disconnect();
  }

  console.log('\n🏁 Testes finalizados.');
  process.exit(0);
}

testConnections();