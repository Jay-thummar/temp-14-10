import { Job as BullJob } from 'bullmq';
import { connectorManager } from '../../connectors/ConnectorManager';
import { ProductMaster } from '../../models/ProductMaster';
import { PlatformItem } from '../../models/PlatformItem';
import { PriceHistory } from '../../models/PriceHistory';
import { JobData } from '../queue';
import { logger } from '../../utils/logger';
import stringSimilarity from 'string-similarity';

export class ScrapeProcessor {
  // Process product scraping job
  static async processScrapeProduct(job: BullJob<JobData['scrapeProduct']>): Promise<void> {
    const { platform, platformSku, productMasterId } = job.data;
    
    try {
      logger.info(`Processing scrape job for ${platform}:${platformSku}`);
      
      // Update job progress
      await job.updateProgress(10);

      // Scrape product data
      const productData = await connectorManager.getProduct(platform, platformSku);
      if (!productData) {
        throw new Error(`No product data found for ${platform}:${platformSku}`);
      }

      await job.updateProgress(40);

      // Find or create product master
      let productMaster;
      if (productMasterId) {
        productMaster = await ProductMaster.findById(productMasterId);
      } else {
        productMaster = await this.findOrCreateProductMaster(productData);
      }

      if (!productMaster) {
        throw new Error('Failed to find or create product master');
      }

      await job.updateProgress(60);

      // Create or update platform item
      const platformItem = await this.createOrUpdatePlatformItem(productData, productMaster._id);

      await job.updateProgress(80);

      // Add price history record
      await this.addPriceHistoryRecord(platformItem);

      await job.updateProgress(100);

      logger.info(`Successfully processed scrape job for ${platform}:${platformSku}`, {
        productMasterId: productMaster._id,
        platformItemId: platformItem._id,
      });

    } catch (error) {
      logger.error(`Scrape job failed for ${platform}:${platformSku}:`, error);
      throw error;
    }
  }

  // Process search scraping job
  static async processScrapeSearch(job: BullJob<JobData['scrapeSearch']>): Promise<void> {
    const { query, platforms, options } = job.data;
    
    try {
      logger.info(`Processing search scrape job for query: ${query}`);
      
      await job.updateProgress(10);

      // Perform search across platforms
      const searchResults = await connectorManager.search(options, platforms);

      await job.updateProgress(50);

      // Process each result
      const processedCount = 0;
      for (let i = 0; i < searchResults.length; i++) {
        const result = searchResults[i];
        
        try {
          // Find or create product master for each result
          const productMaster = await this.findOrCreateProductMasterFromSearch(result);
          
          // Create platform items for each platform
          for (const platformData of result.platforms) {
            await this.createOrUpdatePlatformItemFromSearch(platformData, productMaster._id);
          }

          await job.updateProgress(50 + (i / searchResults.length) * 40);
        } catch (error) {
          logger.warn(`Failed to process search result for ${result.canonicalTitle}:`, error);
        }
      }

      await job.updateProgress(100);

      logger.info(`Successfully processed search scrape job for query: ${query}`, {
        resultsFound: searchResults.length,
        processed: processedCount,
      });

    } catch (error) {
      logger.error(`Search scrape job failed for query: ${query}:`, error);
      throw error;
    }
  }

  // Find or create product master from detailed product data
  private static async findOrCreateProductMaster(productData: any): Promise<any> {
    // Try to find existing product by title similarity
    const existingProducts = await ProductMaster.find({
      brand: productData.brand,
      category: productData.category,
      isActive: true,
    }).limit(20);

    // Check for similar titles
    for (const existing of existingProducts) {
      const similarity = stringSimilarity.compareTwoStrings(
        existing.canonicalTitle.toLowerCase(),
        productData.title.toLowerCase()
      );
      
      if (similarity > 0.8) {
        // Update existing product with new data
        existing.images = [...new Set([...existing.images, ...productData.images])];
        existing.aliases = [...new Set([...existing.aliases, productData.title])];
        existing.specifications = { ...existing.specifications, ...productData.specifications };
        
        if (productData.description && productData.description.length > existing.description.length) {
          existing.description = productData.description;
        }

        await existing.save();
        return existing;
      }
    }

    // Create new product master
    const productMaster = new ProductMaster({
      canonicalTitle: productData.title,
      brand: productData.brand,
      category: productData.category,
      subcategory: productData.subcategory,
      description: productData.description,
      images: productData.images,
      specifications: productData.specifications,
      normalizedKeys: this.generateNormalizedKeys(productData.title),
      tags: this.extractTags(productData),
    });

    await productMaster.save();
    logger.info(`Created new product master: ${productMaster.canonicalTitle}`);
    
    return productMaster;
  }

  // Find or create product master from search result
  private static async findOrCreateProductMasterFromSearch(searchResult: any): Promise<any> {
    // Try to find existing product
    const existingProducts = await ProductMaster.find({
      brand: searchResult.brand,
      category: searchResult.category,
      isActive: true,
    }).limit(20);

    // Check for similar titles
    for (const existing of existingProducts) {
      const similarity = stringSimilarity.compareTwoStrings(
        existing.canonicalTitle.toLowerCase(),
        searchResult.canonicalTitle.toLowerCase()
      );
      
      if (similarity > 0.8) {
        // Update existing product
        existing.images = [...new Set([...existing.images, ...searchResult.images])];
        existing.aliases = [...new Set([...existing.aliases, searchResult.canonicalTitle])];
        await existing.save();
        return existing;
      }
    }

    // Create new product master
    const productMaster = new ProductMaster({
      canonicalTitle: searchResult.canonicalTitle,
      brand: searchResult.brand,
      category: searchResult.category,
      subcategory: searchResult.subcategory,
      description: searchResult.canonicalTitle, // Use title as description for search results
      images: searchResult.images,
      normalizedKeys: this.generateNormalizedKeys(searchResult.canonicalTitle),
      tags: [],
    });

    await productMaster.save();
    return productMaster;
  }

  // Create or update platform item from detailed product data
  private static async createOrUpdatePlatformItem(productData: any, productMasterId: string): Promise<any> {
    const existingItem = await PlatformItem.findOne({
      platform: productData.platform,
      platformSku: productData.platformSku,
    });

    const itemData = {
      productMasterId,
      platform: productData.platform,
      platformSku: productData.platformSku,
      title: productData.title,
      price: productData.price,
      originalPrice: productData.originalPrice,
      currency: productData.currency,
      discount: productData.discount,
      shipping: productData.shipping,
      stockStatus: productData.stockStatus,
      productUrl: productData.productUrl,
      imageUrl: productData.imageUrl,
      rating: productData.rating,
      reviewCount: productData.reviewCount,
      couponMeta: productData.couponMeta,
      specifications: productData.specifications,
      lastScrapedAt: new Date(),
      metadata: productData.metadata,
    };

    if (existingItem) {
      Object.assign(existingItem, itemData);
      await existingItem.save();
      return existingItem;
    } else {
      const newItem = new PlatformItem(itemData);
      await newItem.save();
      return newItem;
    }
  }

  // Create or update platform item from search result
  private static async createOrUpdatePlatformItemFromSearch(platformData: any, productMasterId: string): Promise<any> {
    const existingItem = await PlatformItem.findOne({
      platform: platformData.platform,
      platformSku: platformData.sku,
    });

    const itemData = {
      productMasterId,
      platform: platformData.platform,
      platformSku: platformData.sku,
      title: platformData.title || 'Unknown',
      price: platformData.price,
      originalPrice: platformData.originalPrice,
      currency: platformData.currency,
      discount: platformData.discount,
      shipping: platformData.shipping,
      stockStatus: platformData.stockStatus,
      productUrl: platformData.url,
      imageUrl: platformData.imageUrl,
      rating: platformData.rating,
      reviewCount: platformData.reviewCount,
      couponMeta: platformData.couponMeta,
      lastScrapedAt: new Date(),
    };

    if (existingItem) {
      Object.assign(existingItem, itemData);
      await existingItem.save();
      return existingItem;
    } else {
      const newItem = new PlatformItem(itemData);
      await newItem.save();
      return newItem;
    }
  }

  // Add price history record
  private static async addPriceHistoryRecord(platformItem: any): Promise<void> {
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
  }

  // Generate normalized keys for search
  private static generateNormalizedKeys(title: string): string[] {
    const normalized = title
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = normalized.split(' ').filter(word => word.length > 2);
    const combinations: string[] = [];

    // Add individual words
    combinations.push(...words);

    // Add 2-word combinations
    for (let i = 0; i < words.length - 1; i++) {
      combinations.push(`${words[i]} ${words[i + 1]}`);
    }

    // Add 3-word combinations
    for (let i = 0; i < words.length - 2; i++) {
      combinations.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }

    return [...new Set(combinations)];
  }

  // Extract tags from product data
  private static extractTags(productData: any): string[] {
    const tags: string[] = [];

    // Add category and subcategory as tags
    if (productData.category) tags.push(productData.category.toLowerCase());
    if (productData.subcategory) tags.push(productData.subcategory.toLowerCase());

    // Extract tags from features
    if (productData.features) {
      productData.features.forEach((feature: string) => {
        const words = feature.toLowerCase().split(' ').filter(word => word.length > 3);
        tags.push(...words);
      });
    }

    // Extract tags from specifications
    if (productData.specifications) {
      Object.keys(productData.specifications).forEach(key => {
        if (key.length > 3) {
          tags.push(key.toLowerCase());
        }
      });
    }

    return [...new Set(tags)].slice(0, 20); // Limit to 20 tags
  }
}