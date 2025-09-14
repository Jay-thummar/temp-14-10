import { connectorManager, AggregatedSearchResult } from '../connectors/ConnectorManager';
import { SearchOptions } from '../connectors/base/BaseConnector';
import { SearchLog } from '../models/SearchLog';
import { ProductMaster } from '../models/ProductMaster';
import { PlatformItem } from '../models/PlatformItem';
import { CacheService } from '../config/redis';
import { logger } from '../utils/logger';
import stringSimilarity from 'string-similarity';

export interface SearchServiceOptions extends SearchOptions {
  userId?: string;
  sessionId?: string;
  userAgent?: string;
  ipAddress?: string;
  platforms?: string[];
}

export interface SearchSuggestion {
  query: string;
  category?: string;
  popularity: number;
}

export interface SearchResult extends AggregatedSearchResult {
  masterId?: string;
  similarity?: number;
}

export class SearchService {
  // Main search method
  static async search(options: SearchServiceOptions): Promise<{
    results: SearchResult[];
    metadata: {
      query: string;
      totalResults: number;
      platforms: string[];
      latencyMs: number;
      cached: boolean;
    };
  }> {
    const startTime = Date.now();
    const { userId, sessionId, userAgent, ipAddress, platforms, ...searchOptions } = options;

    try {
      // Normalize query
      const normalizedQuery = this.normalizeQuery(options.query);
      
      // Log search
      const searchLogPromise = this.logSearch({
        userId,
        query: options.query,
        normalizedQuery,
        filters: { ...searchOptions, platforms },
        sessionId,
        userAgent,
        ipAddress,
      });

      // Check cache first
      const cacheKey = `search:${JSON.stringify({ ...searchOptions, platforms: platforms?.sort() })}`;
      let cached = false;
      let results = await CacheService.getJSON<AggregatedSearchResult[]>(cacheKey);

      if (!results) {
        // Perform live search
        results = await connectorManager.search(searchOptions, platforms);
        
        // Cache results for 5 minutes
        await CacheService.setJSON(cacheKey, results, 300);
      } else {
        cached = true;
        logger.info(`Returning cached search results for query: ${options.query}`);
      }

      // Enhance results with database data
      const enhancedResults = await this.enhanceWithDatabaseData(results, normalizedQuery);

      // Sort by relevance and price
      const sortedResults = this.sortResults(enhancedResults, searchOptions.sortBy || 'relevance', normalizedQuery);

      const latencyMs = Date.now() - startTime;

      // Update search log with results
      searchLogPromise.then(async (searchLog) => {
        if (searchLog) {
          searchLog.resultsCount = sortedResults.length;
          searchLog.latencyMs = latencyMs;
          searchLog.platforms = platforms || connectorManager.getEnabledPlatforms();
          await searchLog.save();
        }
      }).catch(error => {
        logger.error('Failed to update search log:', error);
      });

      return {
        results: sortedResults,
        metadata: {
          query: options.query,
          totalResults: sortedResults.length,
          platforms: platforms || connectorManager.getEnabledPlatforms(),
          latencyMs,
          cached,
        },
      };
    } catch (error) {
      logger.error('Search failed:', error);
      
      // Log failed search
      await this.logSearch({
        userId,
        query: options.query,
        normalizedQuery: this.normalizeQuery(options.query),
        filters: { ...searchOptions, platforms },
        sessionId,
        userAgent,
        ipAddress,
        resultsCount: 0,
        latencyMs: Date.now() - startTime,
      });

      throw error;
    }
  }

  // Get search suggestions
  static async getSuggestions(query: string, limit: number = 10): Promise<SearchSuggestion[]> {
    try {
      const cacheKey = `suggestions:${query.toLowerCase()}`;
      let suggestions = await CacheService.getJSON<SearchSuggestion[]>(cacheKey);

      if (!suggestions) {
        const normalizedQuery = this.normalizeQuery(query);
        
        // Get popular searches from logs
        const popularSearches = await SearchLog.aggregate([
          {
            $match: {
              normalizedQuery: { $regex: normalizedQuery, $options: 'i' },
              timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
            },
          },
          {
            $group: {
              _id: '$query',
              count: { $sum: 1 },
              avgResults: { $avg: '$resultsCount' },
            },
          },
          { $sort: { count: -1 } },
          { $limit: limit },
        ]);

        // Get suggestions from product titles
        const productSuggestions = await ProductMaster.aggregate([
          {
            $match: {
              $text: { $search: normalizedQuery },
              isActive: true,
            },
          },
          {
            $project: {
              canonicalTitle: 1,
              category: 1,
              score: { $meta: 'textScore' },
            },
          },
          { $sort: { score: { $meta: 'textScore' } } },
          { $limit: limit },
        ]);

        suggestions = [
          ...popularSearches.map(s => ({
            query: s._id,
            popularity: s.count,
          })),
          ...productSuggestions.map(p => ({
            query: p.canonicalTitle,
            category: p.category,
            popularity: Math.round(p.score),
          })),
        ];

        // Remove duplicates and sort by popularity
        const uniqueSuggestions = suggestions
          .filter((s, index, arr) => arr.findIndex(x => x.query.toLowerCase() === s.query.toLowerCase()) === index)
          .sort((a, b) => b.popularity - a.popularity)
          .slice(0, limit);

        // Cache for 1 hour
        await CacheService.setJSON(cacheKey, uniqueSuggestions, 3600);
        suggestions = uniqueSuggestions;
      }

      return suggestions;
    } catch (error) {
      logger.error('Failed to get search suggestions:', error);
      return [];
    }
  }

  // Get trending searches
  static async getTrendingSearches(limit: number = 10): Promise<SearchSuggestion[]> {
    try {
      const cacheKey = 'trending_searches';
      let trending = await CacheService.getJSON<SearchSuggestion[]>(cacheKey);

      if (!trending) {
        const trendingSearches = await SearchLog.aggregate([
          {
            $match: {
              timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
              resultsCount: { $gt: 0 },
            },
          },
          {
            $group: {
              _id: '$normalizedQuery',
              count: { $sum: 1 },
              avgResults: { $avg: '$resultsCount' },
              lastQuery: { $last: '$query' },
            },
          },
          { $sort: { count: -1 } },
          { $limit: limit },
        ]);

        trending = trendingSearches.map(t => ({
          query: t.lastQuery,
          popularity: t.count,
        }));

        // Cache for 30 minutes
        await CacheService.setJSON(cacheKey, trending, 1800);
      }

      return trending;
    } catch (error) {
      logger.error('Failed to get trending searches:', error);
      return [];
    }
  }

  // Search in existing products (database)
  static async searchDatabase(
    query: string,
    options: {
      category?: string;
      minPrice?: number;
      maxPrice?: number;
      platforms?: string[];
      limit?: number;
      skip?: number;
    } = {}
  ): Promise<SearchResult[]> {
    try {
      const normalizedQuery = this.normalizeQuery(query);
      
      // Build search query
      const searchQuery: any = {
        isActive: true,
        $text: { $search: normalizedQuery },
      };

      if (options.category) {
        searchQuery.category = options.category;
      }

      // Execute search
      const products = await ProductMaster.find(searchQuery)
        .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
        .limit(options.limit || 20)
        .skip(options.skip || 0)
        .populate('platformItems');

      // Convert to search results
      const results: SearchResult[] = [];

      for (const product of products) {
        const platformItems = await PlatformItem.find({
          productMasterId: product._id,
          isActive: true,
          stockStatus: { $in: ['in_stock', 'limited_stock'] },
          ...(options.platforms && { platform: { $in: options.platforms } }),
          ...(options.minPrice && { price: { $gte: options.minPrice } }),
          ...(options.maxPrice && { price: { $lte: options.maxPrice } }),
        }).sort({ price: 1 });

        if (platformItems.length === 0) continue;

        // Find cheapest item
        const cheapest = platformItems[0];

        // Calculate average rating and total reviews
        const itemsWithRatings = platformItems.filter(item => item.rating && item.reviewCount);
        const averageRating = itemsWithRatings.length > 0
          ? itemsWithRatings.reduce((sum, item) => sum + (item.rating || 0), 0) / itemsWithRatings.length
          : undefined;
        const totalReviews = platformItems.reduce((sum, item) => sum + (item.reviewCount || 0), 0);

        const result: SearchResult = {
          masterId: product._id.toString(),
          canonicalTitle: product.canonicalTitle,
          brand: product.brand,
          category: product.category,
          subcategory: product.subcategory,
          images: product.images,
          cheapestPrice: {
            platform: cheapest.platform,
            price: cheapest.price,
            currency: cheapest.currency,
            url: cheapest.productUrl,
          },
          platforms: platformItems.map(item => ({
            platform: item.platform,
            sku: item.platformSku,
            price: item.price,
            originalPrice: item.originalPrice,
            currency: item.currency,
            discount: item.discount,
            url: item.productUrl,
            rating: item.rating,
            reviewCount: item.reviewCount,
            stockStatus: item.stockStatus,
            shipping: item.shipping,
            couponMeta: item.couponMeta,
          })),
          averageRating,
          totalReviews,
          similarity: stringSimilarity.compareTwoStrings(normalizedQuery, product.canonicalTitle.toLowerCase()),
          metadata: {
            searchedAt: new Date(),
            resultsCount: platformItems.length,
            platforms: [...new Set(platformItems.map(item => item.platform))],
          },
        };

        results.push(result);
      }

      return results;
    } catch (error) {
      logger.error('Database search failed:', error);
      throw error;
    }
  }

  // Private helper methods
  private static normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ');
  }

  private static async logSearch(data: {
    userId?: string;
    query: string;
    normalizedQuery: string;
    filters: any;
    sessionId?: string;
    userAgent?: string;
    ipAddress?: string;
    resultsCount?: number;
    latencyMs?: number;
  }): Promise<any> {
    try {
      const searchLog = new SearchLog({
        userId: data.userId,
        query: data.query,
        normalizedQuery: data.normalizedQuery,
        filters: data.filters,
        resultsCount: data.resultsCount || 0,
        latencyMs: data.latencyMs || 0,
        platforms: data.filters.platforms || [],
        userAgent: data.userAgent,
        ipAddress: data.ipAddress,
        sessionId: data.sessionId,
        timestamp: new Date(),
      });

      return await searchLog.save();
    } catch (error) {
      logger.error('Failed to log search:', error);
      return null;
    }
  }

  private static async enhanceWithDatabaseData(
    results: AggregatedSearchResult[],
    normalizedQuery: string
  ): Promise<SearchResult[]> {
    const enhanced: SearchResult[] = [];

    for (const result of results) {
      // Try to find existing product master
      const existingProduct = await ProductMaster.findOne({
        $or: [
          { canonicalTitle: { $regex: result.canonicalTitle, $options: 'i' } },
          { aliases: { $in: [result.canonicalTitle] } },
          { normalizedKeys: { $in: [normalizedQuery] } },
        ],
      });

      const enhancedResult: SearchResult = {
        ...result,
        masterId: existingProduct?._id.toString(),
        similarity: stringSimilarity.compareTwoStrings(normalizedQuery, result.canonicalTitle.toLowerCase()),
      };

      enhanced.push(enhancedResult);
    }

    return enhanced;
  }

  private static sortResults(
    results: SearchResult[],
    sortBy: SearchOptions['sortBy'],
    query: string
  ): SearchResult[] {
    const sortedResults = [...results];

    switch (sortBy) {
      case 'price_low':
        return sortedResults.sort((a, b) => a.cheapestPrice.price - b.cheapestPrice.price);
      
      case 'price_high':
        return sortedResults.sort((a, b) => b.cheapestPrice.price - a.cheapestPrice.price);
      
      case 'rating':
        return sortedResults.sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0));
      
      case 'newest':
        return sortedResults.sort((a, b) => 
          new Date(b.metadata.searchedAt).getTime() - new Date(a.metadata.searchedAt).getTime()
        );
      
      case 'relevance':
      default:
        return sortedResults.sort((a, b) => {
          // Sort by similarity first, then by rating, then by price
          const similarityDiff = (b.similarity || 0) - (a.similarity || 0);
          if (Math.abs(similarityDiff) > 0.1) return similarityDiff;
          
          const ratingDiff = (b.averageRating || 0) - (a.averageRating || 0);
          if (Math.abs(ratingDiff) > 0.5) return ratingDiff;
          
          return a.cheapestPrice.price - b.cheapestPrice.price;
        });
    }
  }
}