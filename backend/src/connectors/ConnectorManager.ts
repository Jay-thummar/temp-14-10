import { BaseConnector, ProductSearchResult, ProductDetail, SearchOptions } from './base/BaseConnector';
import { AmazonScraper } from './scrapers/AmazonScraper';
import { FlipkartScraper } from './scrapers/FlipkartScraper';
import { logger } from '../utils/logger';
import { CacheService } from '../config/redis';

export interface AggregatedSearchResult {
  masterId?: string;
  canonicalTitle: string;
  brand: string;
  category: string;
  subcategory?: string;
  images: string[];
  cheapestPrice: {
    platform: string;
    price: number;
    currency: string;
    url: string;
  };
  platforms: Array<{
    platform: string;
    sku: string;
    price: number;
    originalPrice?: number;
    currency: string;
    discount?: number;
    url: string;
    rating?: number;
    reviewCount?: number;
    stockStatus: string;
    shipping: {
      cost: number;
      currency: string;
      estimatedDays: number;
      isFree: boolean;
    };
    couponMeta: {
      available: boolean;
      codes: string[];
      description?: string;
    };
  }>;
  averageRating?: number;
  totalReviews: number;
  metadata: {
    searchedAt: Date;
    resultsCount: number;
    platforms: string[];
  };
}

export class ConnectorManager {
  private connectors: Map<string, BaseConnector> = new Map();
  private enabledPlatforms: Set<string> = new Set();

  constructor() {
    this.initializeConnectors();
  }

  private initializeConnectors(): void {
    // Initialize scrapers
    const amazonScraper = new AmazonScraper();
    const flipkartScraper = new FlipkartScraper();

    this.connectors.set('amazon', amazonScraper);
    this.connectors.set('flipkart', flipkartScraper);

    // Add enabled platforms
    this.enabledPlatforms.add('amazon');
    this.enabledPlatforms.add('flipkart');

    logger.info(`Initialized ${this.connectors.size} connectors: ${Array.from(this.connectors.keys()).join(', ')}`);
  }

  // Add a new connector
  addConnector(platform: string, connector: BaseConnector): void {
    this.connectors.set(platform, connector);
    if (connector.getInfo().isEnabled) {
      this.enabledPlatforms.add(platform);
    }
    logger.info(`Added connector for ${platform}`);
  }

  // Remove a connector
  removeConnector(platform: string): void {
    this.connectors.delete(platform);
    this.enabledPlatforms.delete(platform);
    logger.info(`Removed connector for ${platform}`);
  }

  // Enable/disable a platform
  setPlatformEnabled(platform: string, enabled: boolean): void {
    const connector = this.connectors.get(platform);
    if (connector) {
      connector.setEnabled(enabled);
      if (enabled) {
        this.enabledPlatforms.add(platform);
      } else {
        this.enabledPlatforms.delete(platform);
      }
      logger.info(`${platform} connector ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  // Get list of available platforms
  getAvailablePlatforms(): string[] {
    return Array.from(this.connectors.keys());
  }

  // Get list of enabled platforms
  getEnabledPlatforms(): string[] {
    return Array.from(this.enabledPlatforms);
  }

  // Health check for all connectors
  async healthCheck(): Promise<Record<string, { status: 'healthy' | 'unhealthy'; message: string }>> {
    const results: Record<string, { status: 'healthy' | 'unhealthy'; message: string }> = {};
    
    const promises = Array.from(this.connectors.entries()).map(async ([platform, connector]) => {
      try {
        const health = await connector.healthCheck();
        results[platform] = health;
      } catch (error) {
        results[platform] = {
          status: 'unhealthy',
          message: `Health check failed: ${(error as Error).message}`,
        };
      }
    });

    await Promise.allSettled(promises);
    return results;
  }

  // Search across multiple platforms
  async search(options: SearchOptions, platforms?: string[]): Promise<AggregatedSearchResult[]> {
    const startTime = Date.now();
    const searchPlatforms = platforms?.filter(p => this.enabledPlatforms.has(p)) || 
                           Array.from(this.enabledPlatforms);

    if (searchPlatforms.length === 0) {
      throw new Error('No enabled platforms available for search');
    }

    // Check cache first
    const cacheKey = `search:${JSON.stringify({ ...options, platforms: searchPlatforms.sort() })}`;
    const cachedResults = await CacheService.getJSON<AggregatedSearchResult[]>(cacheKey);
    
    if (cachedResults) {
      logger.info(`Returning cached search results for query: ${options.query}`);
      return cachedResults;
    }

    logger.info(`Searching across ${searchPlatforms.length} platforms: ${searchPlatforms.join(', ')}`);

    // Execute searches in parallel
    const searchPromises = searchPlatforms.map(async (platform) => {
      const connector = this.connectors.get(platform);
      if (!connector) return { platform, results: [], error: 'Connector not found' };

      try {
        const results = await connector.search(options);
        return { platform, results, error: null };
      } catch (error) {
        logger.error(`Search failed for ${platform}:`, error);
        return { platform, results: [], error: (error as Error).message };
      }
    });

    const searchResults = await Promise.allSettled(searchPromises);
    
    // Collect all results
    const allResults: Array<ProductSearchResult & { platform: string }> = [];
    const errors: Record<string, string> = {};

    searchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { platform, results, error } = result.value;
        if (error) {
          errors[platform] = error;
        } else {
          results.forEach(r => allResults.push({ ...r, platform }));
        }
      } else {
        const platform = searchPlatforms[index];
        errors[platform] = result.reason?.message || 'Unknown error';
      }
    });

    logger.info(`Collected ${allResults.length} results from ${searchPlatforms.length} platforms in ${Date.now() - startTime}ms`);

    // Aggregate and deduplicate results
    const aggregatedResults = this.aggregateResults(allResults);

    // Cache results for 5 minutes
    await CacheService.setJSON(cacheKey, aggregatedResults, 300);

    return aggregatedResults;
  }

  // Get product details from a specific platform
  async getProduct(platform: string, platformSku: string): Promise<ProductDetail | null> {
    const connector = this.connectors.get(platform);
    if (!connector) {
      throw new Error(`Connector for platform ${platform} not found`);
    }

    if (!this.enabledPlatforms.has(platform)) {
      throw new Error(`Platform ${platform} is not enabled`);
    }

    // Check cache first
    const cacheKey = `product:${platform}:${platformSku}`;
    const cachedProduct = await CacheService.getJSON<ProductDetail>(cacheKey);
    
    if (cachedProduct) {
      logger.info(`Returning cached product details for ${platform}:${platformSku}`);
      return cachedProduct;
    }

    try {
      const product = await connector.getProduct(platformSku);
      
      if (product) {
        // Cache for 30 minutes
        await CacheService.setJSON(cacheKey, product, 1800);
      }

      return product;
    } catch (error) {
      logger.error(`Failed to get product ${platformSku} from ${platform}:`, error);
      throw error;
    }
  }

  // Get price history from a platform
  async getPriceHistory(platform: string, platformSku: string, days?: number): Promise<Array<{ date: Date; price: number }>> {
    const connector = this.connectors.get(platform);
    if (!connector) {
      throw new Error(`Connector for platform ${platform} not found`);
    }

    try {
      return await connector.getPriceHistory(platformSku, days);
    } catch (error) {
      logger.error(`Failed to get price history for ${platformSku} from ${platform}:`, error);
      throw error;
    }
  }

  // Aggregate search results by grouping similar products
  private aggregateResults(results: Array<ProductSearchResult & { platform: string }>): AggregatedSearchResult[] {
    const groups = new Map<string, Array<ProductSearchResult & { platform: string }>>();

    // Group results by normalized title and brand
    results.forEach(result => {
      const normalizedTitle = this.normalizeTitle(result.title);
      const brand = this.extractBrand(result.title);
      const groupKey = `${brand}:${normalizedTitle}`.toLowerCase();
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(result);
    });

    // Convert groups to aggregated results
    const aggregated: AggregatedSearchResult[] = [];

    groups.forEach((groupResults, groupKey) => {
      if (groupResults.length === 0) return;

      // Sort by price to find cheapest
      groupResults.sort((a, b) => a.price - b.price);
      const cheapest = groupResults[0];

      // Calculate average rating and total reviews
      const ratingsAndReviews = groupResults
        .filter(r => r.rating !== undefined && r.reviewCount !== undefined)
        .map(r => ({ rating: r.rating!, reviewCount: r.reviewCount! }));

      const averageRating = ratingsAndReviews.length > 0
        ? ratingsAndReviews.reduce((sum, r) => sum + r.rating, 0) / ratingsAndReviews.length
        : undefined;

      const totalReviews = ratingsAndReviews.reduce((sum, r) => sum + r.reviewCount, 0);

      // Collect all unique images
      const allImages = [...new Set(groupResults
        .map(r => r.imageUrl)
        .filter(img => img !== undefined) as string[])];

      // Determine category from the most specific result
      const categorizedResult = groupResults.find(r => r.metadata?.breadcrumbs?.length > 0) || cheapest;
      const { category, subcategory } = this.categorizeProduct(cheapest.title, categorizedResult.metadata?.breadcrumbs);

      const aggregatedResult: AggregatedSearchResult = {
        canonicalTitle: cheapest.title,
        brand: this.extractBrand(cheapest.title),
        category,
        subcategory,
        images: allImages,
        cheapestPrice: {
          platform: cheapest.platform,
          price: cheapest.price,
          currency: cheapest.currency,
          url: cheapest.productUrl,
        },
        platforms: groupResults.map(result => ({
          platform: result.platform,
          sku: result.platformSku,
          price: result.price,
          originalPrice: result.originalPrice,
          currency: result.currency,
          discount: result.discount,
          url: result.productUrl,
          rating: result.rating,
          reviewCount: result.reviewCount,
          stockStatus: result.stockStatus,
          shipping: result.shipping,
          couponMeta: result.couponMeta,
        })),
        averageRating,
        totalReviews,
        metadata: {
          searchedAt: new Date(),
          resultsCount: groupResults.length,
          platforms: [...new Set(groupResults.map(r => r.platform))],
        },
      };

      aggregated.push(aggregatedResult);
    });

    // Sort by cheapest price
    aggregated.sort((a, b) => a.cheapestPrice.price - b.cheapestPrice.price);

    return aggregated;
  }

  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50); // Take first 50 chars for grouping
  }

  private extractBrand(title: string): string {
    const words = title.split(' ');
    return words.length > 0 ? words[0] : 'Unknown';
  }

  private categorizeProduct(title: string, breadcrumbs?: string[]): { category: string; subcategory?: string } {
    if (breadcrumbs && breadcrumbs.length > 0) {
      return {
        category: breadcrumbs[0] || 'Other',
        subcategory: breadcrumbs[1]
      };
    }

    // Basic categorization based on title
    const lowerTitle = title.toLowerCase();
    
    if (lowerTitle.includes('phone') || lowerTitle.includes('mobile')) {
      return { category: 'Electronics', subcategory: 'Mobile Phones' };
    }
    
    if (lowerTitle.includes('laptop') || lowerTitle.includes('computer')) {
      return { category: 'Electronics', subcategory: 'Computers' };
    }
    
    if (lowerTitle.includes('shirt') || lowerTitle.includes('jeans') || lowerTitle.includes('dress')) {
      return { category: 'Fashion', subcategory: 'Clothing' };
    }

    return { category: 'Other' };
  }

  // Cleanup method
  async cleanup(): Promise<void> {
    const cleanupPromises = Array.from(this.connectors.values()).map(async (connector) => {
      if (typeof (connector as any).cleanup === 'function') {
        await (connector as any).cleanup();
      }
    });

    await Promise.allSettled(cleanupPromises);
    logger.info('All connectors cleaned up');
  }
}

// Export singleton instance
export const connectorManager = new ConnectorManager();