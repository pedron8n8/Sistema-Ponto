const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ✅ Passa o schema direto no adapter — forma correta com PrismaPg
const adapter = new PrismaPg(pool, {
  schema: 'schema_automation',
});

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
  adapter,
});

process.on('beforeExit', async () => {
  await prisma.$disconnect();
  await pool.end();
});

module.exports = { prisma, pool };