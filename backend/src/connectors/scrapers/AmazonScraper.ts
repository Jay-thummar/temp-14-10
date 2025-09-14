import { BaseScraper, ScraperConfig } from './BaseScraper';
import { ProductSearchResult, ProductDetail, SearchOptions } from '../base/BaseConnector';
import * as cheerio from 'cheerio';
import { logger } from '../../utils/logger';

export class AmazonScraper extends BaseScraper {
  constructor() {
    const config: ScraperConfig = {
      platform: 'amazon',
      baseUrl: 'https://www.amazon.in',
      useHeadlessBrowser: false, // Amazon works well with HTTP requests
      userAgents: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      ],
      rateLimit: {
        requestsPerMinute: 30,
        requestsPerHour: 1000,
      },
      timeout: 15000,
      retryAttempts: 3,
      isEnabled: true,
      selectors: {
        searchResults: '[data-component-type="s-search-result"]',
        productTitle: 'h2 a span, h2 span',
        productPrice: '.a-price-whole, .a-offscreen',
        productImage: 'img.s-image',
        productLink: 'h2 a',
        productRating: '.a-icon-alt',
        productReviews: '.a-size-base',
        stockStatus: '.a-color-success, .a-color-price',
        originalPrice: '.a-price.a-text-price .a-offscreen',
        discount: '.a-size-large.a-color-price',
      },
      urls: {
        search: 'https://www.amazon.in/s?k={query}&ref=sr_pg_{page}',
        product: 'https://www.amazon.in/dp/{sku}',
      },
    };

    super(config);
  }

  buildSearchUrl(options: SearchOptions): string {
    const { query, category, minPrice, maxPrice, sortBy, page = 1 } = options;
    
    let url = this.scraperConfig.urls.search
      .replace('{query}', encodeURIComponent(query))
      .replace('{page}', page.toString());

    const params = new URLSearchParams();

    if (category) {
      params.append('rh', `n:${this.getCategoryId(category)}`);
    }

    if (minPrice !== undefined) {
      params.append('low-price', minPrice.toString());
    }

    if (maxPrice !== undefined) {
      params.append('high-price', maxPrice.toString());
    }

    if (sortBy) {
      params.append('s', this.getSortParameter(sortBy));
    }

    const paramString = params.toString();
    if (paramString) {
      url += (url.includes('?') ? '&' : '?') + paramString;
    }

    return url;
  }

  buildProductUrl(platformSku: string): string {
    return this.scraperConfig.urls.product.replace('{sku}', platformSku);
  }

  parseSearchResults($: cheerio.CheerioAPI): ProductSearchResult[] {
    const results: ProductSearchResult[] = [];
    const searchResultSelector = this.scraperConfig.selectors.searchResults;

    $(searchResultSelector).each((index, element) => {
      try {
        const $element = $(element);

        // Extract basic product info
        const titleElement = $element.find(this.scraperConfig.selectors.productTitle).first();
        const title = this.cleanTitle(titleElement.text());
        
        if (!title) return; // Skip if no title

        // Extract product link and SKU
        const linkElement = $element.find(this.scraperConfig.selectors.productLink).first();
        const href = linkElement.attr('href');
        if (!href) return;

        const productUrl = this.normalizeUrl(href, this.scraperConfig.baseUrl);
        const platformSku = this.extractSkuFromUrl(productUrl);
        if (!platformSku) return;

        // Extract price
        const priceElement = $element.find(this.scraperConfig.selectors.productPrice).first();
        const priceText = priceElement.text().trim();
        const price = this.normalizePrice(priceText);
        if (price <= 0) return; // Skip if no valid price

        // Extract original price (if on sale)
        const originalPriceElement = $element.find(this.scraperConfig.selectors.originalPrice!).first();
        const originalPriceText = originalPriceElement.text().trim();
        const originalPrice = originalPriceText ? this.normalizePrice(originalPriceText) : undefined;

        // Extract image
        const imageElement = $element.find(this.scraperConfig.selectors.productImage).first();
        const imageUrl = this.extractImageUrl(imageElement);

        // Extract rating
        const ratingElement = $element.find(this.scraperConfig.selectors.productRating!).first();
        const ratingText = ratingElement.attr('alt') || ratingElement.text();
        const rating = ratingText ? this.extractRating(ratingText) : undefined;

        // Extract review count
        const reviewElement = $element.find(this.scraperConfig.selectors.productReviews!).first();
        const reviewText = reviewElement.text();
        const reviewCount = reviewText ? this.extractReviewCount(reviewText) : undefined;

        // Extract stock status
        const stockElement = $element.find(this.scraperConfig.selectors.stockStatus!).first();
        const stockText = stockElement.text() || 'in stock';
        const stockStatus = this.determineStockStatus(stockText);

        // Calculate discount
        const discount = originalPrice ? this.calculateDiscount(originalPrice, price) : undefined;

        // Check for coupons (Amazon often shows coupon info)
        const couponElement = $element.find('.s-coupon-highlight-color, .a-color-success').first();
        const couponText = couponElement.text();
        const hasCoupon = couponText.toLowerCase().includes('coupon') || couponText.includes('₹');

        const result: ProductSearchResult = {
          platformSku,
          title,
          price,
          originalPrice,
          currency: 'INR',
          discount,
          shipping: {
            cost: 0,
            currency: 'INR',
            estimatedDays: 2, // Amazon typically delivers in 1-2 days
            isFree: true, // Most Amazon products have free delivery
          },
          stockStatus,
          productUrl,
          imageUrl,
          rating,
          reviewCount,
          couponMeta: {
            available: hasCoupon,
            codes: hasCoupon ? ['COUPON'] : [],
            description: hasCoupon ? couponText : undefined,
          },
          specifications: {},
          metadata: {
            scrapedAt: new Date(),
            searchIndex: index,
          },
        };

        results.push(result);
      } catch (error) {
        logger.warn(`Error parsing Amazon search result ${index}:`, error);
      }
    });

    return results;
  }

  parseProductDetail($: cheerio.CheerioAPI, url: string): ProductDetail | null {
    try {
      // Extract basic info
      const title = this.cleanTitle($('#productTitle').text());
      if (!title) return null;

      const platformSku = this.extractSkuFromUrl(url);
      if (!platformSku) return null;

      // Extract price
      const priceElement = $('.a-price.a-text-price.a-size-medium.apexPriceToPay .a-offscreen, .a-price .a-offscreen').first();
      const price = this.normalizePrice(priceElement.text());
      if (price <= 0) return null;

      // Extract original price
      const originalPriceElement = $('.a-price.a-text-price .a-offscreen').first();
      const originalPrice = originalPriceElement.length ? this.normalizePrice(originalPriceElement.text()) : undefined;

      // Extract images
      const images: string[] = [];
      $('#landingImage, #imgTagWrapperId img, .a-dynamic-image').each((_, element) => {
        const imageUrl = this.extractImageUrl($(element));
        if (imageUrl && !images.includes(imageUrl)) {
          images.push(imageUrl);
        }
      });

      // Extract description
      const description = $('#feature-bullets ul, #aplus_feature_div, #productDescription p').first().text().trim() || title;

      // Extract specifications
      const specifications: Record<string, any> = {};
      
      // Technical details table
      $('#technicalSpecifications_section_1 tr, #prodDetails tr').each((_, element) => {
        const $row = $(element);
        const key = $row.find('td:first-child, th:first-child').text().trim();
        const value = $row.find('td:last-child, td:nth-child(2)').text().trim();
        if (key && value) {
          specifications[key] = value;
        }
      });

      // Additional info
      $('#detailBullets_feature_div li, #detail-bullets li').each((_, element) => {
        const $item = $(element);
        const text = $item.text().trim();
        const colonIndex = text.indexOf(':');
        if (colonIndex > 0) {
          const key = text.substring(0, colonIndex).trim();
          const value = text.substring(colonIndex + 1).trim();
          if (key && value) {
            specifications[key] = value;
          }
        }
      });

      // Extract brand
      const brand = this.extractBrand(title, specifications);

      // Extract category
      const breadcrumbs: string[] = [];
      $('#wayfinding-breadcrumbs_feature_div a, .a-breadcrumb a').each((_, element) => {
        const text = $(element).text().trim();
        if (text && !text.toLowerCase().includes('amazon')) {
          breadcrumbs.push(text);
        }
      });

      const { category, subcategory } = this.categorizeProduct(title, breadcrumbs);

      // Extract rating and reviews
      const ratingElement = $('span.a-icon-alt').first();
      const rating = ratingElement.length ? this.extractRating(ratingElement.text()) : undefined;

      const reviewElement = $('#acrCustomerReviewText').first();
      const reviewCount = reviewElement.length ? this.extractReviewCount(reviewElement.text()) : undefined;

      // Extract stock status
      const stockElement = $('#availability span, #merchant-info').first();
      const stockStatus = this.determineStockStatus(stockElement.text() || 'in stock');

      // Extract features
      const features: string[] = [];
      $('#feature-bullets li span, .a-unordered-list.a-vertical li span').each((_, element) => {
        const feature = $(element).text().trim();
        if (feature && feature.length > 10) { // Filter out short/meaningless text
          features.push(feature);
        }
      });

      // Extract variants (size, color, etc.)
      const variants: Array<{ name: string; value: string; price?: number; sku?: string }> = [];
      
      // Size variants
      $('#variation_size_name .a-dropdown-item').each((_, element) => {
        const $item = $(element);
        const value = $item.text().trim();
        if (value) {
          variants.push({ name: 'Size', value });
        }
      });

      // Color variants
      $('#variation_color_name .a-dropdown-item').each((_, element) => {
        const $item = $(element);
        const value = $item.text().trim();
        if (value) {
          variants.push({ name: 'Color', value });
        }
      });

      // Check for coupons
      const couponElement = $('#vpcButton, .a-color-success').first();
      const couponText = couponElement.text();
      const hasCoupon = couponText.toLowerCase().includes('coupon') || couponText.includes('₹');

      const result: ProductDetail = {
        platformSku,
        title,
        price,
        originalPrice,
        currency: 'INR',
        discount: originalPrice ? this.calculateDiscount(originalPrice, price) : undefined,
        shipping: {
          cost: 0,
          currency: 'INR',
          estimatedDays: 2,
          isFree: true,
        },
        stockStatus,
        productUrl: url,
        imageUrl: images[0],
        rating,
        reviewCount,
        couponMeta: {
          available: hasCoupon,
          codes: hasCoupon ? ['COUPON'] : [],
          description: hasCoupon ? couponText : undefined,
        },
        specifications,
        description,
        images,
        brand,
        category,
        subcategory,
        features,
        variants: variants.length > 0 ? variants : undefined,
        metadata: {
          scrapedAt: new Date(),
          breadcrumbs,
        },
      };

      return result;
    } catch (error) {
      logger.error('Error parsing Amazon product detail:', error);
      return null;
    }
  }

  private extractSkuFromUrl(url: string): string | null {
    // Amazon URLs contain ASIN (Amazon Standard Identification Number)
    const match = url.match(/\/dp\/([A-Z0-9]{10})|\/product\/([A-Z0-9]{10})|\/gp\/product\/([A-Z0-9]{10})/i);
    return match ? (match[1] || match[2] || match[3]) : null;
  }

  private getCategoryId(category: string): string {
    // Amazon category IDs mapping
    const categoryMap: Record<string, string> = {
      'electronics': '976419031',
      'fashion': '1571271031',
      'home': '976442031',
      'books': '976389031',
      'sports': '976419031',
      'beauty': '1355016031',
      'health': '1350384031',
      'automotive': '4772060031',
      'toys': '1350387031',
      'grocery': '2454178031',
    };

    return categoryMap[category.toLowerCase()] || '';
  }

  private getSortParameter(sortBy: SearchOptions['sortBy']): string {
    const sortMap: Record<string, string> = {
      'relevance': 'relevanceblender',
      'price_low': 'price-asc-rank',
      'price_high': 'price-desc-rank',
      'rating': 'review-rank',
      'newest': 'date-desc-rank',
    };

    return sortMap[sortBy || 'relevance'] || 'relevanceblender';
  }
}