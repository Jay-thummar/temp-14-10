import { Job as BullJob } from 'bullmq';
import { Watchlist } from '../../models/Watchlist';
import { PlatformItem } from '../../models/PlatformItem';
import { User } from '../../models/User';
import { ProductMaster } from '../../models/ProductMaster';
import { emailService } from '../../services/emailService';
import { smsService } from '../../services/smsService';
import { JobData, JobScheduler } from '../queue';
import { logger } from '../../utils/logger';

export class AlertProcessor {
  // Process price alert job
  static async processSendPriceAlert(job: BullJob<JobData['sendPriceAlert']>): Promise<void> {
    const { userId, productMasterId, oldPrice, newPrice, platform } = job.data;
    
    try {
      logger.info(`Processing price alert for user ${userId}, product ${productMasterId}`);
      
      await job.updateProgress(10);

      // Get user and product details
      const [user, product] = await Promise.all([
        User.findById(userId),
        ProductMaster.findById(productMasterId),
      ]);

      if (!user || !product) {
        throw new Error('User or product not found');
      }

      await job.updateProgress(30);

      // Calculate savings
      const savings = oldPrice - newPrice;
      const discountPercentage = Math.round((savings / oldPrice) * 100);

      // Get platform item for URL
      const platformItem = await PlatformItem.findOne({
        productMasterId,
        platform,
        isActive: true,
      });

      await job.updateProgress(50);

      // Send email alert if enabled
      if (user.preferences.notifications.email) {
        await emailService.sendEmail({
          to: user.email,
          subject: `🎉 Price Drop Alert: ${product.canonicalTitle}`,
          template: 'price-alert',
          data: {
            name: user.name,
            productTitle: product.canonicalTitle,
            platform: platform.charAt(0).toUpperCase() + platform.slice(1),
            oldPrice: oldPrice.toFixed(2),
            newPrice: newPrice.toFixed(2),
            savings: savings.toFixed(2),
            discountPercentage,
            productUrl: platformItem?.productUrl || '#',
          },
        });
      }

      await job.updateProgress(70);

      // Send SMS alert if phone is verified and SMS is enabled
      if (user.phoneVerified && user.phone && user.preferences.notifications.push) {
        await smsService.sendPriceAlert(
          user.phone,
          product.canonicalTitle,
          newPrice,
          platform
        );
      }

      await job.updateProgress(90);

      // Send push notification if subscribed
      if (user.preferences.notifications.push && (user.preferences as any).pushSubscription) {
        await this.sendPushNotification(user, {
          title: '🎉 Price Drop Alert!',
          body: `${product.canonicalTitle} is now ₹${newPrice.toFixed(2)} on ${platform}`,
          url: platformItem?.productUrl,
        });
      }

      await job.updateProgress(100);

      logger.info(`Successfully sent price alert to user ${userId}`, {
        productTitle: product.canonicalTitle,
        platform,
        oldPrice,
        newPrice,
        savings,
      });

    } catch (error) {
      logger.error(`Price alert job failed for user ${userId}:`, error);
      throw error;
    }
  }

  // Process watchlist monitoring job
  static async processWatchlist(job: BullJob<JobData['processWatchlist']>): Promise<void> {
    const { userId } = job.data;
    
    try {
      logger.info(`Processing watchlist${userId ? ` for user ${userId}` : ' for all users'}`);
      
      await job.updateProgress(10);

      // Get watchlist items to process
      const query: any = { isEnabled: true };
      if (userId) query.userId = userId;

      const watchlistItems = await Watchlist.find(query)
        .populate('product')
        .populate('user');

      if (watchlistItems.length === 0) {
        logger.info('No watchlist items to process');
        return;
      }

      await job.updateProgress(30);

      let alertsSent = 0;
      const totalItems = watchlistItems.length;

      // Process each watchlist item
      for (let i = 0; i < totalItems; i++) {
        const watchlistItem = watchlistItems[i];
        
        try {
          const shouldAlert = await this.checkPriceAlert(watchlistItem);
          
          if (shouldAlert) {
            await this.triggerPriceAlert(watchlistItem, shouldAlert);
            alertsSent++;
          }

          await job.updateProgress(30 + (i / totalItems) * 60);
        } catch (error) {
          logger.warn(`Failed to process watchlist item ${watchlistItem._id}:`, error);
        }
      }

      await job.updateProgress(100);

      logger.info(`Watchlist processing completed`, {
        itemsProcessed: totalItems,
        alertsSent,
      });

    } catch (error) {
      logger.error('Watchlist processing job failed:', error);
      throw error;
    }
  }

  // Process digest email job
  static async processSendDigestEmail(job: BullJob<JobData['sendDigestEmail']>): Promise<void> {
    const { userId, frequency } = job.data;
    
    try {
      logger.info(`Processing ${frequency} digest email for user ${userId}`);
      
      await job.updateProgress(10);

      // Get user
      const user = await User.findById(userId);
      if (!user || !user.preferences.notifications.email) {
        return; // Skip if user not found or email disabled
      }

      await job.updateProgress(30);

      // Get user's watchlist with recent price changes
      const watchlistItems = await this.getWatchlistWithPriceChanges(userId, frequency);

      if (watchlistItems.length === 0) {
        logger.info(`No price changes found for ${frequency} digest for user ${userId}`);
        return;
      }

      await job.updateProgress(60);

      // Send digest email
      await this.sendDigestEmail(user, watchlistItems, frequency);

      await job.updateProgress(100);

      logger.info(`Successfully sent ${frequency} digest email to user ${userId}`, {
        itemsIncluded: watchlistItems.length,
      });

    } catch (error) {
      logger.error(`Digest email job failed for user ${userId}:`, error);
      throw error;
    }
  }

  // Check if price alert should be triggered
  private static async checkPriceAlert(watchlistItem: any): Promise<any | null> {
    // Check if enough time has passed since last alert
    if (!watchlistItem.shouldSendAlert()) {
      return null;
    }

    // Get current prices for the product
    const platformQuery: any = {
      productMasterId: watchlistItem.productMasterId,
      isActive: true,
      stockStatus: { $in: ['in_stock', 'limited_stock'] },
    };

    // Filter by preferred platforms if specified
    if (watchlistItem.platformPreferences.length > 0) {
      platformQuery.platform = { $in: watchlistItem.platformPreferences };
    }

    const platformItems = await PlatformItem.find(platformQuery).sort({ price: 1 });

    if (platformItems.length === 0) {
      return null;
    }

    const cheapestItem = platformItems[0];

    // Check if target price is met
    if (watchlistItem.targetPrice && cheapestItem.price <= watchlistItem.targetPrice) {
      return {
        type: 'target_reached',
        oldPrice: watchlistItem.targetPrice,
        newPrice: cheapestItem.price,
        platform: cheapestItem.platform,
        platformItem: cheapestItem,
      };
    }

    // Check for significant price drops (>10% or >₹500)
    const priceDropThreshold = Math.max(cheapestItem.originalPrice * 0.1, 500);
    if (cheapestItem.originalPrice && 
        (cheapestItem.originalPrice - cheapestItem.price) >= priceDropThreshold) {
      return {
        type: 'significant_drop',
        oldPrice: cheapestItem.originalPrice,
        newPrice: cheapestItem.price,
        platform: cheapestItem.platform,
        platformItem: cheapestItem,
      };
    }

    return null;
  }

  // Trigger price alert
  private static async triggerPriceAlert(watchlistItem: any, alertData: any): Promise<void> {
    // Schedule price alert job
    await JobScheduler.addSendPriceAlertJob({
      userId: watchlistItem.userId.toString(),
      productMasterId: watchlistItem.productMasterId.toString(),
      oldPrice: alertData.oldPrice,
      newPrice: alertData.newPrice,
      platform: alertData.platform,
    });

    // Update watchlist item
    watchlistItem.lastAlertSent = new Date();
    watchlistItem.alertCount += 1;
    await watchlistItem.save();
  }

  // Get watchlist items with recent price changes for digest
  private static async getWatchlistWithPriceChanges(userId: string, frequency: 'daily' | 'weekly'): Promise<any[]> {
    const hoursBack = frequency === 'daily' ? 24 : 168; // 24 hours or 7 days
    const cutoffDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    // Get user's watchlist
    const watchlistItems = await Watchlist.find({
      userId,
      isEnabled: true,
    }).populate('product');

    const itemsWithChanges = [];

    for (const item of watchlistItems) {
      // Get recent price changes for this product
      const recentItems = await PlatformItem.find({
        productMasterId: item.productMasterId,
        lastScrapedAt: { $gte: cutoffDate },
        isActive: true,
      }).sort({ lastScrapedAt: -1 });

      if (recentItems.length > 0) {
        const cheapest = recentItems.sort((a, b) => a.price - b.price)[0];
        itemsWithChanges.push({
          ...item.toObject(),
          currentPrice: cheapest.price,
          platform: cheapest.platform,
          url: cheapest.productUrl,
          priceChange: item.targetPrice ? item.targetPrice - cheapest.price : null,
        });
      }
    }

    return itemsWithChanges;
  }

  // Send digest email
  private static async sendDigestEmail(user: any, watchlistItems: any[], frequency: 'daily' | 'weekly'): Promise<void> {
    const totalSavings = watchlistItems
      .filter(item => item.priceChange && item.priceChange > 0)
      .reduce((sum, item) => sum + item.priceChange, 0);

    await emailService.sendEmail({
      to: user.email,
      subject: `Your ${frequency} price update from ShopCompare`,
      template: 'digest',
      data: {
        name: user.name,
        frequency,
        items: watchlistItems,
        totalSavings: totalSavings.toFixed(2),
        itemCount: watchlistItems.length,
        dashboardUrl: `${process.env.FRONTEND_URL}/watchlist`,
      },
    });
  }

  // Send push notification
  private static async sendPushNotification(user: any, notification: {
    title: string;
    body: string;
    url?: string;
  }): Promise<void> {
    try {
      const webpush = require('web-push');
      
      // Configure VAPID keys
      webpush.setVapidDetails(
        process.env.VAPID_EMAIL!,
        process.env.VAPID_PUBLIC_KEY!,
        process.env.VAPID_PRIVATE_KEY!
      );

      const subscription = (user.preferences as any).pushSubscription;
      if (!subscription) return;

      const payload = JSON.stringify({
        title: notification.title,
        body: notification.body,
        icon: '/icon-192x192.png',
        badge: '/badge-72x72.png',
        url: notification.url,
        timestamp: Date.now(),
      });

      await webpush.sendNotification(subscription, payload);
      
      logger.info(`Push notification sent to user ${user._id}`);
    } catch (error) {
      logger.error(`Failed to send push notification to user ${user._id}:`, error);
      
      // Remove invalid subscription
      if (error.statusCode === 410 || error.statusCode === 404) {
        delete (user.preferences as any).pushSubscription;
        await user.save();
      }
    }
  }
}