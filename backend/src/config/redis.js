const Redis = require('ioredis');
require('dotenv').config();

// Pegamos a URL do .env ou usamos o padrão de rede do Docker que descobrimos
const redisUrl = process.env.REDIS_URL || 'redis://redis_shared:6379';

// Cliente Redis usando a URL
const redis = new Redis(redisUrl, {
  // Configurações obrigatórias para o BullMQ funcionar corretamente
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on('connect', () => {
  console.log('✅ Redis connected successfully to:', redisUrl);
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

module.exports = redis;