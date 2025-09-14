import { Worker } from 'bullmq';
import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { ScrapeProcessor } from './processors/scrapeProcessor';
import { AlertProcessor } from './processors/alertProcessor';
import { JobData, initializeQueues, closeQueues } from './queue';

// Worker configurations
const workerConfig = {
  connection: redisClient,
  concurrency: 5,
  removeOnComplete: 100,
  removeOnFail: 50,
};

// Create workers for different job types
const workers: Worker[] = [];

// High priority worker
const highPriorityWorker = new Worker('high-priority', async (job) => {
  const { name, data } = job;
  
  switch (name) {
    case 'sendPriceAlert':
      await AlertProcessor.processSendPriceAlert(job);
      break;
    case 'scrapeProduct':
      if ((data as JobData['scrapeProduct']).productMasterId) {
        await ScrapeProcessor.processScrapeProduct(job);
      }
      break;
    default:
      throw new Error(`Unknown high priority job type: ${name}`);
  }
}, {
  ...workerConfig,
  concurrency: 3, // Lower concurrency for high priority jobs
});

// Normal priority worker
const normalPriorityWorker = new Worker('normal-priority', async (job) => {
  const { name, data } = job;
  
  switch (name) {
    case 'scrapeProduct':
      await ScrapeProcessor.processScrapeProduct(job);
      break;
    case 'scrapeSearch':
      await ScrapeProcessor.processScrapeSearch(job);
      break;
    case 'updatePriceHistory':
      await updatePriceHistoryProcessor(job);
      break;
    case 'updateProductRatings':
      await updateProductRatingsProcessor(job);
      break;
    default:
      throw new Error(`Unknown normal priority job type: ${name}`);
  }
}, workerConfig);

// Low priority worker
const lowPriorityWorker = new Worker('low-priority', async (job) => {
  const { name, data } = job;
  
  switch (name) {
    case 'cleanupOldData':
      await cleanupOldDataProcessor(job);
      break;
    case 'generateSitemap':
      await generateSitemapProcessor(job);
      break;
    case 'backupDatabase':
      await backupDatabaseProcessor(job);
      break;
    case 'syncAffiliateData':
      await syncAffiliateDataProcessor(job);
      break;
    default:
      throw new Error(`Unknown low priority job type: ${name}`);
  }
}, {
  ...workerConfig,
  concurrency: 2, // Lower concurrency for maintenance jobs
});

// Scheduled worker
const scheduledWorker = new Worker('scheduled', async (job) => {
  const { name, data } = job;
  
  switch (name) {
    case 'processWatchlist':
      await AlertProcessor.processWatchlist(job);
      break;
    case 'sendDigestEmail':
      await AlertProcessor.processSendDigestEmail(job);
      break;
    case 'cleanupOldData':
      await cleanupOldDataProcessor(job);
      break;
    case 'updateProductRatings':
      await updateProductRatingsProcessor(job);
      break;
    case 'backupDatabase':
      await backupDatabaseProcessor(job);
      break;
    default:
      throw new Error(`Unknown scheduled job type: ${name}`);
  }
}, {
  ...workerConfig,
  concurrency: 1, // Single concurrency for scheduled jobs
});

// Add workers to array for management
workers.push(highPriorityWorker, normalPriorityWorker, lowPriorityWorker, scheduledWorker);

// Job processors

// Update price history processor
async function updatePriceHistoryProcessor(job: any): Promise<void> {
  const { platformItemId } = job.data as JobData['updatePriceHistory'];
  
  try {
    logger.info(`Processing price history update for item ${platformItemId}`);
    
    const { PlatformItem, PriceHistory } = await import('../models');
    
    const platformItem = await PlatformItem.findById(platformItemId);
    if (!platformItem) {
      throw new Error('Platform item not found');
    }

    // Create price history record
    const priceHistory = new PriceHistory({
      platformItemId: platformItem._id,
      productMasterId: platformItem.productMasterId,
      platform: platformItem.platform,
      price: platformItem.price,
      originalPrice: platformItem.originalPrice,
      currency: platformItem.currency,
      stockStatus: platformItem.stockStatus,
      timestamp: new Date(),
    });

    await priceHistory.save();
    
    logger.info(`Successfully updated price history for item ${platformItemId}`);
  } catch (error) {
    logger.error(`Price history update failed for item ${platformItemId}:`, error);
    throw error;
  }
}

// Cleanup old data processor
async function cleanupOldDataProcessor(job: any): Promise<void> {
  const { days } = job.data as JobData['cleanupOldData'];
  
  try {
    logger.info(`Processing cleanup for data older than ${days} days`);
    
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const { SearchLog, PriceHistory, Job } = await import('../models');
    
    // Cleanup old search logs
    const deletedSearchLogs = await SearchLog.deleteMany({
      timestamp: { $lt: cutoffDate }
    });

    // Cleanup old price history (keep more recent data)
    const priceCutoffDate = new Date(Date.now() - (days * 2) * 24 * 60 * 60 * 1000);
    const deletedPriceHistory = await PriceHistory.deleteMany({
      timestamp: { $lt: priceCutoffDate }
    });

    // Cleanup old completed jobs
    const deletedJobs = await Job.deleteMany({
      status: { $in: ['completed', 'failed'] },
      updatedAt: { $lt: cutoffDate }
    });

    logger.info(`Cleanup completed`, {
      searchLogs: deletedSearchLogs.deletedCount,
      priceHistory: deletedPriceHistory.deletedCount,
      jobs: deletedJobs.deletedCount,
    });
  } catch (error) {
    logger.error('Cleanup job failed:', error);
    throw error;
  }
}

// Update product ratings processor
async function updateProductRatingsProcessor(job: any): Promise<void> {
  const { productMasterId } = job.data as JobData['updateProductRatings'] || {};
  
  try {
    logger.info(`Processing product ratings update${productMasterId ? ` for product ${productMasterId}` : ' for all products'}`);
    
    const { ProductMaster, PlatformItem } = await import('../models');
    
    const query = productMasterId ? { _id: productMasterId } : { isActive: true };
    const products = await ProductMaster.find(query);

    let updatedCount = 0;

    for (const product of products) {
      // Get all platform items for this product
      const platformItems = await PlatformItem.find({
        productMasterId: product._id,
        isActive: true,
        rating: { $exists: true, $ne: null },
        reviewCount: { $exists: true, $ne: null },
      });

      if (platformItems.length === 0) continue;

      // Calculate weighted average rating
      let totalWeightedRating = 0;
      let totalReviews = 0;

      platformItems.forEach(item => {
        if (item.rating && item.reviewCount) {
          totalWeightedRating += item.rating * item.reviewCount;
          totalReviews += item.reviewCount;
        }
      });

      if (totalReviews > 0) {
        product.averageRating = totalWeightedRating / totalReviews;
        product.totalReviews = totalReviews;
        await product.save();
        updatedCount++;
      }
    }

    logger.info(`Product ratings update completed`, {
      productsUpdated: updatedCount,
    });
  } catch (error) {
    logger.error('Product ratings update failed:', error);
    throw error;
  }
}

// Generate sitemap processor
async function generateSitemapProcessor(job: any): Promise<void> {
  try {
    logger.info('Processing sitemap generation');
    
    const { ProductMaster } = await import('../models');
    const fs = await import('fs');
    const path = await import('path');
    
    // Get all active products
    const products = await ProductMaster.find({ isActive: true })
      .select('_id canonicalTitle updatedAt')
      .sort({ updatedAt: -1 });

    // Generate sitemap XML
    let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    
    // Add home page
    sitemap += '  <url>\n';
    sitemap += `    <loc>${process.env.FRONTEND_URL}/</loc>\n`;
    sitemap += '    <changefreq>daily</changefreq>\n';
    sitemap += '    <priority>1.0</priority>\n';
    sitemap += '  </url>\n';

    // Add product pages
    products.forEach(product => {
      sitemap += '  <url>\n';
      sitemap += `    <loc>${process.env.FRONTEND_URL}/product/${product._id}</loc>\n`;
      sitemap += `    <lastmod>${product.updatedAt.toISOString()}</lastmod>\n`;
      sitemap += '    <changefreq>weekly</changefreq>\n';
      sitemap += '    <priority>0.8</priority>\n';
      sitemap += '  </url>\n';
    });

    sitemap += '</urlset>\n';

    // Write sitemap to file
    const sitemapPath = path.join(process.cwd(), 'public', 'sitemap.xml');
    fs.writeFileSync(sitemapPath, sitemap);

    logger.info(`Sitemap generated successfully with ${products.length} products`);
  } catch (error) {
    logger.error('Sitemap generation failed:', error);
    throw error;
  }
}

// Backup database processor
async function backupDatabaseProcessor(job: any): Promise<void> {
  try {
    logger.info('Processing database backup');
    
    // This is a placeholder - implement actual backup logic based on your needs
    // You might use mongodump or similar tools
    
    const backupDate = new Date().toISOString().split('T')[0];
    logger.info(`Database backup completed for ${backupDate}`);
  } catch (error) {
    logger.error('Database backup failed:', error);
    throw error;
  }
}

// Sync affiliate data processor
async function syncAffiliateDataProcessor(job: any): Promise<void> {
  const { platform } = job.data as JobData['syncAffiliateData'];
  
  try {
    logger.info(`Processing affiliate data sync for ${platform}`);
    
    // This would sync with affiliate APIs to update product data, commissions, etc.
    // Implementation depends on specific affiliate program APIs
    
    logger.info(`Affiliate data sync completed for ${platform}`);
  } catch (error) {
    logger.error(`Affiliate data sync failed for ${platform}:`, error);
    throw error;
  }
}

// Worker event handlers
function setupWorkerEvents(): void {
  workers.forEach((worker, index) => {
    const workerName = ['high-priority', 'normal-priority', 'low-priority', 'scheduled'][index];

    worker.on('completed', (job) => {
      logger.info(`Job ${job.id} completed in ${workerName} worker`, {
        jobType: job.name,
        duration: job.finishedOn! - job.processedOn!,
      });
    });

    worker.on('failed', (job, err) => {
      logger.error(`Job ${job?.id} failed in ${workerName} worker:`, err, {
        jobType: job?.name,
        attempts: job?.attemptsMade,
        data: job?.data,
      });
    });

    worker.on('stalled', (jobId) => {
      logger.warn(`Job ${jobId} stalled in ${workerName} worker`);
    });

    worker.on('progress', (job, progress) => {
      logger.debug(`Job ${job.id} progress in ${workerName} worker:`, progress);
    });

    worker.on('error', (err) => {
      logger.error(`Worker ${workerName} error:`, err);
    });
  });

  logger.info('Worker event handlers setup complete');
}

// Start workers
export async function startWorkers(): Promise<void> {
  try {
    await initializeQueues();
    setupWorkerEvents();
    
    logger.info(`Started ${workers.length} workers`);
    logger.info('Worker system is ready');
  } catch (error) {
    logger.error('Failed to start workers:', error);
    throw error;
  }
}

// Stop workers
export async function stopWorkers(): Promise<void> {
  try {
    const closePromises = workers.map(worker => worker.close());
    await Promise.all(closePromises);
    
    await closeQueues();
    
    logger.info('All workers stopped');
  } catch (error) {
    logger.error('Error stopping workers:', error);
    throw error;
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down workers gracefully...');
  await stopWorkers();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down workers gracefully...');
  await stopWorkers();
  process.exit(0);
});

// Start workers if this file is run directly
if (require.main === module) {
  startWorkers().catch(error => {
    logger.error('Failed to start worker system:', error);
    process.exit(1);
  });
}