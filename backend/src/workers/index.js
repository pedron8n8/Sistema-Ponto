require('dotenv').config();

const { createReportWorker } = require('./reportWorker');
const { createProactiveAlertWorker } = require('./proactiveAlertWorker');
const redis = require('../config/redis');

const startWorkers = async () => {
  const reportWorker = createReportWorker();
  console.log('Report worker initialized');

  const proactiveAlertWorker = await createProactiveAlertWorker();
  console.log('Proactive alert worker initialized');

  const shutdown = async (signal) => {
    console.log(`${signal} received. Closing workers...`);

    await Promise.allSettled([
      reportWorker.close(),
      proactiveAlertWorker.close(),
      redis.quit(),
    ]);

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

startWorkers().catch(async (error) => {
  console.error('Failed to initialize background workers:', error?.message || error);
  await redis.quit().catch(() => {});
  process.exit(1);
});
