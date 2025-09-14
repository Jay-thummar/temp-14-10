import { Queue, Worker, Job as BullJob } from 'bullmq';
import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';

// Define job types
export interface JobData {
  scrapeProduct: {
    platform: string;
    platformSku: string;
    productMasterId?: string;
  };
  scrapeSearch: {
    query: string;
    platforms: string[];
    options: any;
  };
  updatePriceHistory: {
    platformItemId: string;
  };
  sendPriceAlert: {
    userId: string;
    productMasterId: string;
    oldPrice: number;
    newPrice: number;
    platform: string;
  };
  processWatchlist: {
    userId?: string;
  };
  cleanupOldData: {
    days: number;
  };
  generateSitemap: {};
  backupDatabase: {};
  sendDigestEmail: {
    userId: string;
    frequency: 'daily' | 'weekly';
  };
  updateProductRatings: {
    productMasterId: string;
  };
  syncAffiliateData: {
    platform: string;
  };
}

// Queue configuration
const queueConfig = {
  connection: redisClient,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
};

// Create queues for different job types
export const queues = {
  // High priority queue for real-time operations
  high: new Queue('high-priority', {
    ...queueConfig,
    defaultJobOptions: {
      ...queueConfig.defaultJobOptions,
      priority: 10,
    },
  }),

  // Normal priority queue for regular operations
  normal: new Queue('normal-priority', {
    ...queueConfig,
    defaultJobOptions: {
      ...queueConfig.defaultJobOptions,
      priority: 5,
    },
  }),

  // Low priority queue for background maintenance
  low: new Queue('low-priority', {
    ...queueConfig,
    defaultJobOptions: {
      ...queueConfig.defaultJobOptions,
      priority: 1,
    },
  }),

  // Scheduled queue for cron-like jobs
  scheduled: new Queue('scheduled', {
    ...queueConfig,
    defaultJobOptions: {
      ...queueConfig.defaultJobOptions,
      repeat: { pattern: '0 */6 * * *' }, // Every 6 hours
    },
  }),
};

// Job scheduling functions
export class JobScheduler {
  // Add scraping job
  static async addScrapeProductJob(
    data: JobData['scrapeProduct'],
    options: { delay?: number; priority?: number } = {}
  ): Promise<void> {
    const queue = options.priority === 10 ? queues.high : queues.normal;
    
    await queue.add('scrapeProduct', data, {
      delay: options.delay,
      priority: options.priority || 5,
      jobId: `scrape-${data.platform}-${data.platformSku}`,
    });

    logger.info(`Scheduled scrape job for ${data.platform}:${data.platformSku}`);
  }

  // Add search job
  static async addScrapeSearchJob(
    data: JobData['scrapeSearch'],
    options: { delay?: number } = {}
  ): Promise<void> {
    await queues.normal.add('scrapeSearch', data, {
      delay: options.delay,
      jobId: `search-${data.query}-${Date.now()}`,
    });

    logger.info(`Scheduled search job for query: ${data.query}`);
  }

  // Add price history update job
  static async addUpdatePriceHistoryJob(
    data: JobData['updatePriceHistory']
  ): Promise<void> {
    await queues.normal.add('updatePriceHistory', data, {
      jobId: `price-history-${data.platformItemId}`,
    });

    logger.info(`Scheduled price history update for item: ${data.platformItemId}`);
  }

  // Add price alert job
  static async addSendPriceAlertJob(
    data: JobData['sendPriceAlert']
  ): Promise<void> {
    await queues.high.add('sendPriceAlert', data, {
      priority: 10, // High priority for alerts
    });

    logger.info(`Scheduled price alert for user: ${data.userId}`);
  }

  // Add watchlist processing job
  static async addProcessWatchlistJob(
    data: JobData['processWatchlist'] = {}
  ): Promise<void> {
    await queues.scheduled.add('processWatchlist', data, {
      repeat: { pattern: '0 */2 * * *' }, // Every 2 hours
      jobId: 'process-watchlist',
    });

    logger.info('Scheduled watchlist processing job');
  }

  // Add cleanup job
  static async addCleanupJob(
    data: JobData['cleanupOldData']
  ): Promise<void> {
    await queues.low.add('cleanupOldData', data, {
      repeat: { pattern: '0 2 * * *' }, // Daily at 2 AM
      jobId: 'cleanup-old-data',
    });

    logger.info(`Scheduled cleanup job for ${data.days} days`);
  }

  // Add digest email job
  static async addDigestEmailJob(
    data: JobData['sendDigestEmail']
  ): Promise<void> {
    const pattern = data.frequency === 'daily' ? '0 9 * * *' : '0 9 * * 1'; // 9 AM daily or Monday
    
    await queues.scheduled.add('sendDigestEmail', data, {
      repeat: { pattern },
      jobId: `digest-${data.userId}-${data.frequency}`,
    });

    logger.info(`Scheduled ${data.frequency} digest email for user: ${data.userId}`);
  }

  // Add bulk scraping jobs
  static async addBulkScrapeJobs(
    items: Array<{ platform: string; platformSku: string; productMasterId?: string }>,
    options: { batchSize?: number; delay?: number } = {}
  ): Promise<void> {
    const { batchSize = 10, delay = 1000 } = options;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      for (const [index, item] of batch.entries()) {
        await this.addScrapeProductJob(item, {
          delay: delay * (i + index),
          priority: 3, // Lower priority for bulk jobs
        });
      }

      logger.info(`Scheduled batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(items.length / batchSize)} scraping jobs`);
    }
  }

  // Schedule recurring jobs
  static async scheduleRecurringJobs(): Promise<void> {
    // Process watchlists every 2 hours
    await this.addProcessWatchlistJob();

    // Cleanup old data daily
    await this.addCleanupJob({ days: 90 });

    // Update product ratings daily
    await queues.scheduled.add('updateProductRatings', {}, {
      repeat: { pattern: '0 3 * * *' }, // Daily at 3 AM
      jobId: 'update-product-ratings',
    });

    // Backup database weekly
    await queues.scheduled.add('backupDatabase', {}, {
      repeat: { pattern: '0 4 * * 0' }, // Sunday at 4 AM
      jobId: 'backup-database',
    });

    logger.info('Scheduled all recurring jobs');
  }

  // Get queue statistics
  static async getQueueStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};

    for (const [name, queue] of Object.entries(queues)) {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
        queue.getDelayed(),
      ]);

      stats[name] = {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
      };
    }

    return stats;
  }

  // Clean completed jobs
  static async cleanCompletedJobs(): Promise<void> {
    for (const queue of Object.values(queues)) {
      await queue.clean(24 * 60 * 60 * 1000, 100, 'completed'); // Keep last 100 completed jobs for 24 hours
      await queue.clean(7 * 24 * 60 * 60 * 1000, 50, 'failed'); // Keep last 50 failed jobs for 7 days
    }

    logger.info('Cleaned completed and failed jobs');
  }

  // Pause all queues
  static async pauseAll(): Promise<void> {
    for (const queue of Object.values(queues)) {
      await queue.pause();
    }
    logger.info('All queues paused');
  }

  // Resume all queues
  static async resumeAll(): Promise<void> {
    for (const queue of Object.values(queues)) {
      await queue.resume();
    }
    logger.info('All queues resumed');
  }

  // Get job by ID
  static async getJob(queueName: string, jobId: string): Promise<BullJob | undefined> {
    const queue = (queues as any)[queueName];
    if (!queue) return undefined;

    return await queue.getJob(jobId);
  }

  // Cancel job
  static async cancelJob(queueName: string, jobId: string): Promise<boolean> {
    const job = await this.getJob(queueName, jobId);
    if (!job) return false;

    await job.remove();
    return true;
  }

  // Retry failed job
  static async retryJob(queueName: string, jobId: string): Promise<boolean> {
    const job = await this.getJob(queueName, jobId);
    if (!job || job.finishedOn === undefined) return false;

    await job.retry();
    return true;
  }
}

// Queue event handlers
export function setupQueueEvents(): void {
  Object.entries(queues).forEach(([name, queue]) => {
    queue.on('completed', (job: BullJob) => {
      logger.info(`Job ${job.id} completed in queue ${name}`, {
        jobType: job.name,
        duration: job.finishedOn! - job.processedOn!,
      });
    });

    queue.on('failed', (job: BullJob | undefined, err: Error) => {
      logger.error(`Job ${job?.id} failed in queue ${name}:`, err, {
        jobType: job?.name,
        attempts: job?.attemptsMade,
        data: job?.data,
      });
    });

    queue.on('stalled', (jobId: string) => {
      logger.warn(`Job ${jobId} stalled in queue ${name}`);
    });

    queue.on('progress', (job: BullJob, progress: number | object) => {
      logger.debug(`Job ${job.id} progress in queue ${name}:`, progress);
    });
  });

  logger.info('Queue event handlers setup complete');
}

// Graceful shutdown
export async function closeQueues(): Promise<void> {
  const closePromises = Object.values(queues).map(queue => queue.close());
  await Promise.all(closePromises);
  logger.info('All queues closed');
}

// Initialize queues
export async function initializeQueues(): Promise<void> {
  setupQueueEvents();
  await JobScheduler.scheduleRecurringJobs();
  logger.info('Queue system initialized');
}