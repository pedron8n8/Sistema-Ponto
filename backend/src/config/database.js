const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 10),
  // Sem isso o default é 0 = espera infinita por um slot. Como o Postgres é
  // compartilhado (postgres_shared), esgotar o pool pendurava a request para
  // sempre em vez de falhar rápido.
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 5000),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
});

// O @prisma/adapter-pg registra o próprio listener de 'error' no pool, mas só
// repassa via onPoolError — sem isso a queda de conexão ociosa é invisível.
pool.on('error', (err) => console.error('❌ pg pool error:', err));

// ✅ Passa o schema direto no adapter — forma correta com PrismaPg
const adapter = new PrismaPg(pool, {
  schema: 'schema_automation',
  onPoolError: (err) => console.error('❌ prisma pool error:', err),
  onConnectionError: (err) => console.error('❌ prisma connection error:', err),
});

const prisma = new PrismaClient({
  // log: ['query', 'info', 'warn', 'error'],
  adapter,
});

process.on('beforeExit', async () => {
  await prisma.$disconnect();
  await pool.end();
});

module.exports = { prisma, pool };