import { BaseScraper, ScraperConfig } from './BaseScraper';
import { ProductSearchResult, ProductDetail, SearchOptions } from '../base/BaseConnector';
import * as cheerio from 'cheerio';
import { logger } from '../../utils/logger';

export class FlipkartScraper extends BaseScraper {
  constructor() {
    const config: ScraperConfig = {
      platform: 'flipkart',
      baseUrl: 'https://www.flipkart.com',
      useHeadlessBrowser: true, // Flipkart requires JavaScript rendering
      userAgents: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      ],
      rateLimit: {
        requestsPerMinute: 20,
        requestsPerHour: 800,
      },
      timeout: 20000,
      retryAttempts: 3,
      isEnabled: true,
      selectors: {
        searchResults: '[data-id], ._1AtVbE, ._13oc-S',
        productTitle: '._4rR01T, .s1Q9rs, ._2WkVRV',
        productPrice: '._30jeq3, ._1_WHN1, ._3tbF8',
        productImage: '._396cs4 img, ._2r_T1I img, .CXW8mj img',
        productLink: '._1fQZEK, .s1Q9rs, ._2WkVRV',
        productRating: '._3LWZlK, .gUuXy-, ._3Oa-yE',
        productReviews: '._2_R_DZ, .gUuXy-, ._38sUEc',
        stockStatus: '._16FRp0, ._3xFhiH',
        originalPrice: '._3I9_wc, ._2Tpdn3',
        discount: '._3Ay6Sb, ._31Dcoz',
      },
      urls: {
        search: 'https://www.flipkart.com/search?q={query}&page={page}',
        product: 'https://www.flipkart.com{path}',
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
      // Flipkart uses category in the path, but we'll add as filter
      params.append('facets.brand[]', category);
    }

    if (minPrice !== undefined) {
      params.append('facets.price_range.gte', minPrice.toString());
    }

    if (maxPrice !== undefined) {
      params.append('facets.price_range.lte', maxPrice.toString());
    }

    if (sortBy) {
      params.append('sort', this.getSortParameter(sortBy));
    }

    const paramString = params.toString();
    if (paramString) {
      url += '&' + paramString;
    }

    return url;
  }

  buildProductUrl(platformSku: string): string {
    // Flipkart SKU is actually the product path
    return this.scraperConfig.urls.product.replace('{path}', platformSku);
  }

  parseSearchResults($: cheerio.CheerioAPI): ProductSearchResult[] {
    const results: ProductSearchResult[] = [];
    const searchResultSelector = this.scraperConfig.selectors.searchResults;

    $(searchResultSelector).each((index, element) => {
      try {
        const $element = $(element);

        // Extract title
        const titleElement = $element.find(this.scraperConfig.selectors.productTitle).first();
        const title = this.cleanTitle(titleElement.text() || titleElement.attr('title') || '');
        
        if (!title) return;

        // Extract product link
        const linkElement = $element.find(this.scraperConfig.selectors.productLink).first();
        let href = linkElement.attr('href');
        
        if (!href) {
          // Try parent link
          href = $element.find('a').first().attr('href');
        }
        
        if (!href || !href.startsWith('/')) return;

        const productUrl = this.normalizeUrl(href, this.scraperConfig.baseUrl);
        const platformSku = href; // Use the path as SKU for Flipkart

        // Extract price
        const priceElement = $element.find(this.scraperConfig.selectors.productPrice).first();
        const priceText = priceElement.text().trim();
        const price = this.normalizePrice(priceText);
        if (price <= 0) return;

        // Extract original price
        const originalPriceElement = $element.find(this.scraperConfig.selectors.originalPrice!).first();
        const originalPriceText = originalPriceElement.text().trim();
        const originalPrice = originalPriceText ? this.normalizePrice(originalPriceText) : undefined;

        // Extract image
        const imageElement = $element.find(this.scraperConfig.selectors.productImage).first();
        const imageUrl = this.extractImageUrl(imageElement);

        // Extract rating
        const ratingElement = $element.find(this.scraperConfig.selectors.productRating!).first();
        const ratingText = ratingElement.text() || ratingElement.attr('alt') || '';
        const rating = ratingText ? this.extractRating(ratingText) : undefined;

        // Extract review count
        const reviewElement = $element.find(this.scraperConfig.selectors.productReviews!).first();
        const reviewText = reviewElement.text();
        const reviewCount = reviewText ? this.extractReviewCount(reviewText) : undefined;

        // Extract discount
        const discountElement = $element.find(this.scraperConfig.selectors.discount!).first();
        const discountText = discountElement.text();
        let discount = originalPrice ? this.calculateDiscount(originalPrice, price) : undefined;
        
        // If discount text contains percentage, use that
        const discountMatch = discountText.match(/(\d+)%/);
        if (discountMatch) {
          discount = parseInt(discountMatch[1]);
        }

        // Extract stock status
        const stockElement = $element.find(this.scraperConfig.selectors.stockStatus!).first();
        const stockText = stockElement.text() || 'in stock';
        const stockStatus = this.determineStockStatus(stockText);

        // Check for offers/coupons
        const offerElement = $element.find('._2ZdXFF, ._3xFhiH').first();
        const offerText = offerElement.text();
        const hasOffer = offerText.toLowerCase().includes('offer') || 
                        offerText.toLowerCase().includes('extra') ||
                        offerText.toLowerCase().includes('cashback');

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
            estimatedDays: 3, // Flipkart typically delivers in 2-4 days
            isFree: price >= 500, // Free delivery above ₹500
          },
          stockStatus,
          productUrl,
          imageUrl,
          rating,
          reviewCount,
          couponMeta: {
            available: hasOffer,
            codes: hasOffer ? ['OFFER'] : [],
            description: hasOffer ? offerText : undefined,
          },
          specifications: {},
          metadata: {
            scrapedAt: new Date(),
            searchIndex: index,
          },
        };

        results.push(result);
      } catch (error) {
        logger.warn(`Error parsing Flipkart search result ${index}:`, error);
      }
    });

    return results;
  }

  parseProductDetail($: cheerio.CheerioAPI, url: string): ProductDetail | null {
    try {
      // Extract title
      const title = this.cleanTitle($('span.B_NuCI, .x-item-title-value, h1').first().text());
      if (!title) return null;

      const platformSku = this.extractSkuFromUrl(url);
      if (!platformSku) return null;

      // Extract price
      const priceElement = $('._30jeq3, ._1_WHN1, ._3tbF8').first();
      const price = this.normalizePrice(priceElement.text());
      if (price <= 0) return null;

      // Extract original price
      const originalPriceElement = $('._3I9_wc, ._2Tpdn3').first();
      const originalPrice = originalPriceElement.length ? this.normalizePrice(originalPriceElement.text()) : undefined;

      // Extract images
      const images: string[] = [];
      $('._396cs4 img, ._2r_T1I img, .CXW8mj img, ._3kidJX img').each((_, element) => {
        const imageUrl = this.extractImageUrl($(element));
        if (imageUrl && !images.includes(imageUrl)) {
          images.push(imageUrl);
        }
      });

      // Extract description
      const descriptionElements = $('._1mXcCf, ._3WHvuP, .gSANR-');
      let description = '';
      descriptionElements.each((_, element) => {
        const text = $(element).text().trim();
        if (text.length > description.length) {
          description = text;
        }
      });
      
      if (!description) description = title;

      // Extract specifications
      const specifications: Record<string, any> = {};
      
      // Specifications table
      $('._1s_Smc tr, ._3k-BhJ tr').each((_, element) => {
        const $row = $(element);
        const key = $row.find('td:first-child').text().trim();
        const value = $row.find('td:last-child').text().trim();
        if (key && value) {
          specifications[key] = value;
        }
      });

      // Additional specifications from list
      $('._2418kt li, ._3WHvuP li').each((_, element) => {
        const text = $(element).text().trim();
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

      // Extract category from breadcrumbs
      const breadcrumbs: string[] = [];
      $('._1MR4o5 a, ._2whKao a').each((_, element) => {
        const text = $(element).text().trim();
        if (text && !text.toLowerCase().includes('flipkart')) {
          breadcrumbs.push(text);
        }
      });

      const { category, subcategory } = this.categorizeProduct(title, breadcrumbs);

      // Extract rating and reviews
      const ratingElement = $('._3LWZlK, .gUuXy-').first();
      const rating = ratingElement.length ? this.extractRating(ratingElement.text()) : undefined;

      const reviewElement = $('._2_R_DZ span, ._38sUEc').first();
      const reviewCount = reviewElement.length ? this.extractReviewCount(reviewElement.text()) : undefined;

      // Extract stock status
      const stockElement = $('._16FRp0, ._3xFhiH').first();
      const stockStatus = this.determineStockStatus(stockElement.text() || 'in stock');

      // Extract features/highlights
      const features: string[] = [];
      $('.rgWa7D li, ._2418kt li, ._3WHvuP li').each((_, element) => {
        const feature = $(element).text().trim();
        if (feature && feature.length > 10 && !feature.includes(':')) {
          features.push(feature);
        }
      });

      // Extract variants
      const variants: Array<{ name: string; value: string; price?: number; sku?: string }> = [];
      
      // Size variants
      $('._1fGeJ5 a, ._3V2wUG a').each((_, element) => {
        const $item = $(element);
        const value = $item.text().trim();
        if (value) {
          variants.push({ name: 'Size', value });
        }
      });

      // Color variants
      $('._3V2wUG img').each((_, element) => {
        const $item = $(element);
        const value = $item.attr('alt') || $item.attr('title') || '';
        if (value) {
          variants.push({ name: 'Color', value });
        }
      });

      // Check for offers
      const offerElement = $('._2ZdXFF, ._3xFhiH, .yN+eNk').first();
      const offerText = offerElement.text();
      const hasOffer = offerText.toLowerCase().includes('offer') || 
                      offerText.toLowerCase().includes('extra') ||
                      offerText.toLowerCase().includes('cashback');

      // Calculate discount
      const discount = originalPrice ? this.calculateDiscount(originalPrice, price) : undefined;

      const result: ProductDetail = {
        platformSku,
        title,
        price,
        originalPrice,
        currency: 'INR',
        discount,
        shipping: {
          cost: 0,
          currency: 'INR',
          estimatedDays: 3,
          isFree: price >= 500,
        },
        stockStatus,
        productUrl: url,
        imageUrl: images[0],
        rating,
        reviewCount,
        couponMeta: {
          available: hasOffer,
          codes: hasOffer ? ['OFFER'] : [],
          description: hasOffer ? offerText : undefined,
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
      logger.error('Error parsing Flipkart product detail:', error);
      return null;
    }
  }

  private extractSkuFromUrl(url: string): string | null {
    // Flipkart URLs contain product path which we use as SKU
    const match = url.match(/flipkart\.com(.+)/);
    return match ? match[1] : null;
  }

  private getSortParameter(sortBy: SearchOptions['sortBy']): string {
    const sortMap: Record<string, string> = {
      'relevance': 'relevance',
      'price_low': 'price_asc',
      'price_high': 'price_desc',
      'rating': 'popularity',
      'newest': 'recency_desc',
    };

    return sortMap[sortBy || 'relevance'] || 'relevance';
  }
}