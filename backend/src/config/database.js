const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

// Criar pool de conexão do PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Criar adapter do Prisma
const adapter = new PrismaPg(pool);

// Criar instância do Prisma Client com o adapter
const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
  await pool.end();
});

module.exports = prisma;
