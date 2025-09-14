import { logger } from '../../utils/logger';

export interface ProductSearchResult {
  platformSku: string;
  title: string;
  price: number;
  originalPrice?: number;
  currency: string;
  discount?: number;
  shipping: {
    cost: number;
    currency: string;
    estimatedDays: number;
    isFree: boolean;
  };
  stockStatus: 'in_stock' | 'out_of_stock' | 'limited_stock' | 'preorder';
  productUrl: string;
  imageUrl?: string;
  rating?: number;
  reviewCount?: number;
  couponMeta: {
    available: boolean;
    codes: string[];
    maxDiscount?: number;
    description?: string;
  };
  specifications: Record<string, any>;
  metadata: Record<string, any>;
}

export interface ProductDetail extends ProductSearchResult {
  description: string;
  images: string[];
  brand: string;
  category: string;
  subcategory?: string;
  features: string[];
  variants?: Array<{
    name: string;
    value: string;
    price?: number;
    sku?: string;
  }>;
}

export interface SearchOptions {
  query: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: 'relevance' | 'price_low' | 'price_high' | 'rating' | 'newest';
  page?: number;
  limit?: number;
}

export interface ConnectorConfig {
  platform: string;
  apiKey?: string;
  secretKey?: string;
  baseUrl?: string;
  rateLimit: {
    requestsPerMinute: number;
    requestsPerHour: number;
  };
  timeout: number;
  retryAttempts: number;
  isEnabled: boolean;
}

export abstract class BaseConnector {
  protected config: ConnectorConfig;
  protected requestCount: { minute: number; hour: number } = { minute: 0, hour: 0 };
  private lastMinuteReset: number = Date.now();
  private lastHourReset: number = Date.now();

  constructor(config: ConnectorConfig) {
    this.config = config;
    this.resetRateLimit();
  }

  // Abstract methods that must be implemented by each connector
  abstract search(options: SearchOptions): Promise<ProductSearchResult[]>;
  abstract getProduct(platformSku: string): Promise<ProductDetail | null>;
  abstract getPriceHistory(platformSku: string, days?: number): Promise<Array<{ date: Date; price: number }>>;

  // Rate limiting
  protected async checkRateLimit(): Promise<void> {
    const now = Date.now();

    // Reset counters if time window has passed
    if (now - this.lastMinuteReset >= 60000) {
      this.requestCount.minute = 0;
      this.lastMinuteReset = now;
    }

    if (now - this.lastHourReset >= 3600000) {
      this.requestCount.hour = 0;
      this.lastHourReset = now;
    }

    // Check rate limits
    if (this.requestCount.minute >= this.config.rateLimit.requestsPerMinute) {
      const waitTime = 60000 - (now - this.lastMinuteReset);
      logger.warn(`Rate limit exceeded for ${this.config.platform}. Waiting ${waitTime}ms`);
      await this.sleep(waitTime);
      this.requestCount.minute = 0;
      this.lastMinuteReset = Date.now();
    }

    if (this.requestCount.hour >= this.config.rateLimit.requestsPerHour) {
      const waitTime = 3600000 - (now - this.lastHourReset);
      logger.warn(`Hourly rate limit exceeded for ${this.config.platform}. Waiting ${waitTime}ms`);
      await this.sleep(waitTime);
      this.requestCount.hour = 0;
      this.lastHourReset = Date.now();
    }

    // Increment counters
    this.requestCount.minute++;
    this.requestCount.hour++;
  }

  // Utility methods
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected normalizePrice(price: string | number): number {
    if (typeof price === 'number') return price;
    
    // Remove currency symbols and parse
    const cleanPrice = price.toString()
      .replace(/[₹$€£¥,\s]/g, '')
      .replace(/[^\d.]/g, '');
    
    return parseFloat(cleanPrice) || 0;
  }

  protected normalizeUrl(url: string, baseUrl?: string): string {
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (baseUrl && url.startsWith('/')) return baseUrl + url;
    return url;
  }

  protected extractImageUrl(imageElement: any): string | undefined {
    if (!imageElement) return undefined;
    
    // Handle different image attribute patterns
    const src = imageElement.src || 
                imageElement.getAttribute?.('src') ||
                imageElement.getAttribute?.('data-src') ||
                imageElement.getAttribute?.('data-lazy-src');
    
    return src ? this.normalizeUrl(src) : undefined;
  }

  protected calculateDiscount(originalPrice: number, currentPrice: number): number {
    if (originalPrice <= currentPrice) return 0;
    return Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
  }

  protected determineStockStatus(text: string): 'in_stock' | 'out_of_stock' | 'limited_stock' | 'preorder' {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('out of stock') || lowerText.includes('not available') || lowerText.includes('sold out')) {
      return 'out_of_stock';
    }
    
    if (lowerText.includes('limited') || lowerText.includes('few left') || lowerText.includes('hurry')) {
      return 'limited_stock';
    }
    
    if (lowerText.includes('preorder') || lowerText.includes('pre-order') || lowerText.includes('coming soon')) {
      return 'preorder';
    }
    
    return 'in_stock';
  }

  protected extractRating(ratingText: string): number | undefined {
    const match = ratingText.match(/(\d+\.?\d*)\s*(?:out of|\/)\s*5|(\d+\.?\d*)\s*stars?/i);
    if (match) {
      const rating = parseFloat(match[1] || match[2]);
      return rating >= 0 && rating <= 5 ? rating : undefined;
    }
    return undefined;
  }

  protected extractReviewCount(reviewText: string): number | undefined {
    const match = reviewText.match(/(\d+(?:,\d+)*)\s*(?:reviews?|ratings?)/i);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''));
    }
    return undefined;
  }

  protected cleanTitle(title: string): string {
    return title
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s-()]/g, '')
      .substring(0, 200);
  }

  protected extractBrand(title: string, specifications: Record<string, any>): string {
    // Try to extract brand from specifications first
    if (specifications.brand || specifications.Brand) {
      return specifications.brand || specifications.Brand;
    }

    // Extract from title (first word is often the brand)
    const words = title.split(' ');
    if (words.length > 0) {
      return words[0];
    }

    return 'Unknown';
  }

  protected categorizeProduct(title: string, breadcrumbs?: string[]): { category: string; subcategory?: string } {
    const lowerTitle = title.toLowerCase();
    
    // Define category mappings
    const categoryMappings = {
      'Electronics': ['phone', 'mobile', 'laptop', 'computer', 'tablet', 'headphone', 'earphone', 'camera', 'tv', 'television'],
      'Fashion': ['shirt', 'jeans', 'dress', 'shoes', 'sneakers', 'jacket', 'tshirt', 't-shirt'],
      'Home & Kitchen': ['furniture', 'kitchen', 'home', 'decor', 'appliance', 'cookware'],
      'Books': ['book', 'novel', 'textbook', 'magazine'],
      'Sports': ['sports', 'fitness', 'gym', 'exercise', 'outdoor'],
      'Beauty': ['cosmetics', 'makeup', 'skincare', 'beauty', 'perfume'],
      'Health': ['health', 'medicine', 'supplement', 'medical'],
      'Automotive': ['car', 'bike', 'automotive', 'vehicle', 'parts'],
      'Toys': ['toy', 'game', 'kids', 'children', 'baby'],
      'Grocery': ['food', 'snacks', 'grocery', 'beverages', 'organic']
    };

    // Check breadcrumbs first
    if (breadcrumbs && breadcrumbs.length > 0) {
      return {
        category: breadcrumbs[0] || 'Other',
        subcategory: breadcrumbs[1]
      };
    }

    // Match against title
    for (const [category, keywords] of Object.entries(categoryMappings)) {
      if (keywords.some(keyword => lowerTitle.includes(keyword))) {
        return { category };
      }
    }

    return { category: 'Other' };
  }

  // Retry mechanism with exponential backoff
  protected async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxAttempts: number = this.config.retryAttempts
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxAttempts) {
          throw lastError;
        }

        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10 seconds
        logger.warn(`Attempt ${attempt} failed for ${this.config.platform}, retrying in ${delay}ms:`, error);
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  // Health check
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      // Perform a simple search to test connectivity
      await this.search({ query: 'test', limit: 1 });
      return { status: 'healthy', message: 'Connector is working properly' };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        message: `Connector error: ${(error as Error).message}` 
      };
    }
  }

  // Get connector info
  getInfo(): { platform: string; isEnabled: boolean; rateLimit: ConnectorConfig['rateLimit'] } {
    return {
      platform: this.config.platform,
      isEnabled: this.config.isEnabled,
      rateLimit: this.config.rateLimit,
    };
  }

  // Enable/disable connector
  setEnabled(enabled: boolean): void {
    this.config.isEnabled = enabled;
    logger.info(`${this.config.platform} connector ${enabled ? 'enabled' : 'disabled'}`);
  }

  private resetRateLimit(): void {
    // Reset rate limit counters every minute and hour
    setInterval(() => {
      this.requestCount.minute = 0;
    }, 60000);

    setInterval(() => {
      this.requestCount.hour = 0;
    }, 3600000);
  }
}