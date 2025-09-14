import puppeteer, { Browser, Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { BaseConnector, ConnectorConfig, ProductSearchResult, ProductDetail, SearchOptions } from '../base/BaseConnector';
import { logger } from '../../utils/logger';

export interface ScraperConfig extends ConnectorConfig {
  useHeadlessBrowser: boolean;
  userAgents: string[];
  proxies?: Array<{
    host: string;
    port: number;
    username?: string;
    password?: string;
  }>;
  selectors: {
    searchResults: string;
    productTitle: string;
    productPrice: string;
    productImage: string;
    productLink: string;
    productRating?: string;
    productReviews?: string;
    stockStatus?: string;
    originalPrice?: string;
    discount?: string;
  };
  urls: {
    search: string;
    product: string;
  };
}

export abstract class BaseScraper extends BaseConnector {
  protected scraperConfig: ScraperConfig;
  protected browser: Browser | null = null;
  protected axiosInstance: AxiosInstance;
  private currentUserAgentIndex = 0;
  private currentProxyIndex = 0;

  constructor(config: ScraperConfig) {
    super(config);
    this.scraperConfig = config;
    this.setupAxios();
  }

  private setupAxios(): void {
    this.axiosInstance = axios.create({
      timeout: this.config.timeout,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    // Add request interceptor for rotation
    this.axiosInstance.interceptors.request.use((config) => {
      // Rotate user agents
      if (this.scraperConfig.userAgents.length > 0) {
        config.headers!['User-Agent'] = this.getNextUserAgent();
      }

      // Add proxy if available
      const proxy = this.getNextProxy();
      if (proxy) {
        config.proxy = {
          host: proxy.host,
          port: proxy.port,
          auth: proxy.username && proxy.password ? {
            username: proxy.username,
            password: proxy.password,
          } : undefined,
        };
      }

      return config;
    });
  }

  private getNextUserAgent(): string {
    const userAgent = this.scraperConfig.userAgents[this.currentUserAgentIndex];
    this.currentUserAgentIndex = (this.currentUserAgentIndex + 1) % this.scraperConfig.userAgents.length;
    return userAgent;
  }

  private getNextProxy() {
    if (!this.scraperConfig.proxies || this.scraperConfig.proxies.length === 0) {
      return null;
    }

    const proxy = this.scraperConfig.proxies[this.currentProxyIndex];
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.scraperConfig.proxies.length;
    return proxy;
  }

  // Browser management
  protected async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: this.scraperConfig.useHeadlessBrowser,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
        ],
      });
    }
    return this.browser;
  }

  protected async getPage(): Promise<Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    // Set user agent
    if (this.scraperConfig.userAgents.length > 0) {
      await page.setUserAgent(this.getNextUserAgent());
    }

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    // Block unnecessary resources to speed up scraping
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    return page;
  }

  protected async closePage(page: Page): Promise<void> {
    try {
      await page.close();
    } catch (error) {
      logger.warn('Error closing page:', error);
    }
  }

  // HTTP request with retry and rotation
  protected async makeRequest(url: string, options: AxiosRequestConfig = {}): Promise<cheerio.CheerioAPI> {
    await this.checkRateLimit();

    return this.retryWithBackoff(async () => {
      try {
        const response = await this.axiosInstance.get(url, {
          ...options,
          validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        });

        if (response.status === 429) {
          throw new Error('Rate limited by server');
        }

        if (response.status >= 400) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return cheerio.load(response.data);
      } catch (error) {
        logger.error(`Request failed for ${url}:`, error);
        throw error;
      }
    });
  }

  // Browser-based scraping with retry
  protected async scrapePage(url: string, waitForSelector?: string): Promise<cheerio.CheerioAPI> {
    await this.checkRateLimit();

    return this.retryWithBackoff(async () => {
      const page = await this.getPage();
      
      try {
        await page.goto(url, { 
          waitUntil: 'networkidle2',
          timeout: this.config.timeout 
        });

        if (waitForSelector) {
          await page.waitForSelector(waitForSelector, { timeout: 10000 });
        }

        // Random delay to mimic human behavior
        await this.sleep(Math.random() * 2000 + 1000);

        const content = await page.content();
        return cheerio.load(content);
      } finally {
        await this.closePage(page);
      }
    });
  }

  // Abstract methods for specific scrapers to implement
  abstract buildSearchUrl(options: SearchOptions): string;
  abstract parseSearchResults($: cheerio.CheerioAPI): ProductSearchResult[];
  abstract buildProductUrl(platformSku: string): string;
  abstract parseProductDetail($: cheerio.CheerioAPI, url: string): ProductDetail | null;

  // Implement base connector methods
  async search(options: SearchOptions): Promise<ProductSearchResult[]> {
    if (!this.config.isEnabled) {
      throw new Error(`${this.config.platform} connector is disabled`);
    }

    try {
      const searchUrl = this.buildSearchUrl(options);
      logger.info(`Searching ${this.config.platform}: ${searchUrl}`);

      const $ = this.scraperConfig.useHeadlessBrowser 
        ? await this.scrapePage(searchUrl, this.scraperConfig.selectors.searchResults)
        : await this.makeRequest(searchUrl);

      const results = this.parseSearchResults($);
      
      logger.info(`Found ${results.length} results from ${this.config.platform}`);
      return results;
    } catch (error) {
      logger.error(`Search failed for ${this.config.platform}:`, error);
      throw error;
    }
  }

  async getProduct(platformSku: string): Promise<ProductDetail | null> {
    if (!this.config.isEnabled) {
      throw new Error(`${this.config.platform} connector is disabled`);
    }

    try {
      const productUrl = this.buildProductUrl(platformSku);
      logger.info(`Getting product ${platformSku} from ${this.config.platform}: ${productUrl}`);

      const $ = this.scraperConfig.useHeadlessBrowser
        ? await this.scrapePage(productUrl)
        : await this.makeRequest(productUrl);

      const product = this.parseProductDetail($, productUrl);
      
      if (product) {
        logger.info(`Successfully scraped product ${platformSku} from ${this.config.platform}`);
      } else {
        logger.warn(`No product data found for ${platformSku} from ${this.config.platform}`);
      }

      return product;
    } catch (error) {
      logger.error(`Failed to get product ${platformSku} from ${this.config.platform}:`, error);
      throw error;
    }
  }

  async getPriceHistory(platformSku: string, days: number = 30): Promise<Array<{ date: Date; price: number }>> {
    // Most scrapers don't provide price history directly
    // This would typically come from our own database
    logger.warn(`Price history not available from scraper for ${this.config.platform}`);
    return [];
  }

  // Helper methods for parsing
  protected extractPrice($: cheerio.CheerioAPI, selector: string): number {
    const priceText = $(selector).first().text().trim();
    return this.normalizePrice(priceText);
  }

  protected extractText($: cheerio.CheerioAPI, selector: string): string {
    return $(selector).first().text().trim();
  }

  protected extractAttribute($: cheerio.CheerioAPI, selector: string, attribute: string): string | undefined {
    return $(selector).first().attr(attribute);
  }

  protected extractMultipleTexts($: cheerio.CheerioAPI, selector: string): string[] {
    const texts: string[] = [];
    $(selector).each((_, element) => {
      const text = $(element).text().trim();
      if (text) texts.push(text);
    });
    return texts;
  }

  protected extractSpecifications($: cheerio.CheerioAPI, containerSelector: string): Record<string, any> {
    const specs: Record<string, any> = {};
    
    $(containerSelector).find('tr, .spec-item, .specification-item').each((_, element) => {
      const $element = $(element);
      
      // Try different patterns for key-value pairs
      const key = $element.find('.spec-key, .spec-name, td:first-child, dt').first().text().trim();
      const value = $element.find('.spec-value, .spec-detail, td:last-child, dd').first().text().trim();
      
      if (key && value) {
        specs[key] = value;
      }
    });

    return specs;
  }

  protected extractImages($: cheerio.CheerioAPI, containerSelector: string): string[] {
    const images: string[] = [];
    
    $(containerSelector).find('img').each((_, element) => {
      const imageUrl = this.extractImageUrl($(element));
      if (imageUrl && !images.includes(imageUrl)) {
        images.push(imageUrl);
      }
    });

    return images;
  }

  // Cleanup
  async cleanup(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
        this.browser = null;
        logger.info(`Browser closed for ${this.config.platform}`);
      } catch (error) {
        logger.error(`Error closing browser for ${this.config.platform}:`, error);
      }
    }
  }

  // Override health check for scrapers
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      // Test with a simple request first
      const testUrl = this.buildSearchUrl({ query: 'test', limit: 1 });
      
      if (this.scraperConfig.useHeadlessBrowser) {
        await this.scrapePage(testUrl);
      } else {
        await this.makeRequest(testUrl);
      }
      
      return { status: 'healthy', message: 'Scraper is working properly' };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        message: `Scraper error: ${(error as Error).message}` 
      };
    }
  }
}