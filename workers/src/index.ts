import dotenv from 'dotenv';
import { Queue, Worker, JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

dotenv.config();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const connection = new IORedis(process.env.REDIS_URL || 'redis://redis:6379');

export const queues = {
  alerts: new Queue('alerts', { connection }),
  scraping: new Queue('scraping', { connection }),
};

// QueueScheduler not needed for BullMQ v5+

new Worker('alerts', async (job) => {
  logger.info({ jobId: job.id, name: job.name }, 'alerts worker received job');
  // placeholder
}, { connection });

new Worker('scraping', async (job) => {
  logger.info({ jobId: job.id, name: job.name }, 'scraping worker received job');
  // placeholder
}, { connection });

async function main() {
  logger.info('Workers started');
  const opts: JobsOptions = { removeOnComplete: true, removeOnFail: 100 };
  await queues.alerts.add('heartbeat', { at: new Date().toISOString() }, opts);
}

main().catch((err) => {
  logger.error(err, 'Worker crashed');
  process.exit(1);
});

