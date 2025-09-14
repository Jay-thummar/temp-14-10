import express from 'express';
import { param, validationResult } from 'express-validator';
import { connectorManager } from '../connectors/ConnectorManager';
import { ProductMaster } from '../models/ProductMaster';
import { PlatformItem } from '../models/PlatformItem';
import { PriceHistory } from '../models/PriceHistory';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { optionalAuth } from '../middleware/auth';
import { CacheService } from '../config/redis';

const router = express.Router();

const handleValidationErrors = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(`Validation error: ${errors.array().map(err => err.msg).join(', ')}`, 400));
  }
  next();
};

/**
 * @swagger
 * /api/product/{masterId}:
 *   get:
 *     summary: Get product details by master ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: masterId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product master ID
 *     responses:
 *       200:
 *         description: Product details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   $ref: '#/components/schemas/ProductDetail'
 *       404:
 *         description: Product not found
 */
router.get('/:masterId', optionalAuth, [
  param('masterId').isMongoId().withMessage('Invalid product ID'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const { masterId } = req.params;

  // Check cache first
  const cacheKey = `product:master:${masterId}`;
  let productData = await CacheService.getJSON(cacheKey);

  if (!productData) {
    // Get product master
    const productMaster = await ProductMaster.findById(masterId);
    if (!productMaster || !productMaster.isActive) {
      throw new AppError('Product not found', 404);
    }

    // Get all platform items for this product
    const platformItems = await PlatformItem.find({
      productMasterId: masterId,
      isActive: true,
    }).sort({ price: 1 });

    // Get price history for the last 30 days
    const priceHistory = await PriceHistory.getPriceTrend(masterId, undefined, 30);

    // Calculate statistics
    const inStockItems = platformItems.filter(item => 
      item.stockStatus === 'in_stock' || item.stockStatus === 'limited_stock'
    );

    const priceRange = inStockItems.length > 0 ? {
      min: Math.min(...inStockItems.map(item => item.price)),
      max: Math.max(...inStockItems.map(item => item.price)),
      average: inStockItems.reduce((sum, item) => sum + item.price, 0) / inStockItems.length,
    } : null;

    const ratingsData = platformItems.filter(item => item.rating && item.reviewCount);
    const averageRating = ratingsData.length > 0
      ? ratingsData.reduce((sum, item) => sum + (item.rating || 0), 0) / ratingsData.length
      : null;
    const totalReviews = platformItems.reduce((sum, item) => sum + (item.reviewCount || 0), 0);

    productData = {
      product: productMaster,
      platforms: platformItems.map(item => ({
        platform: item.platform,
        sku: item.platformSku,
        title: item.title,
        price: item.price,
        originalPrice: item.originalPrice,
        currency: item.currency,
        discount: item.discount,
        url: item.productUrl,
        imageUrl: item.imageUrl,
        rating: item.rating,
        reviewCount: item.reviewCount,
        stockStatus: item.stockStatus,
        shipping: item.shipping,
        couponMeta: item.couponMeta,
        specifications: item.specifications,
        lastScrapedAt: item.lastScrapedAt,
      })),
      priceHistory,
      statistics: {
        priceRange,
        averageRating,
        totalReviews,
        availablePlatforms: platformItems.length,
        inStockPlatforms: inStockItems.length,
      },
      metadata: {
        lastUpdated: new Date(),
      },
    };

    // Cache for 15 minutes
    await CacheService.setJSON(cacheKey, productData, 900);
  }

  res.json({
    status: 'success',
    data: productData,
  });
}));

/**
 * @swagger
 * /api/product/{platform}/{platformSku}:
 *   get:
 *     summary: Get product details from specific platform
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: platform
 *         required: true
 *         schema:
 *           type: string
 *           enum: [amazon, flipkart, myntra, snapdeal, paytm, nykaa, ajio]
 *         description: Platform name
 *       - in: path
 *         name: platformSku
 *         required: true
 *         schema:
 *           type: string
 *         description: Platform-specific product SKU
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Force refresh from platform (bypass cache)
 *     responses:
 *       200:
 *         description: Platform-specific product details
 *       404:
 *         description: Product not found on platform
 */
router.get('/:platform/:platformSku', optionalAuth, [
  param('platform')
    .isIn(['amazon', 'flipkart', 'myntra', 'snapdeal', 'paytm', 'nykaa', 'ajio'])
    .withMessage('Invalid platform'),
  param('platformSku').notEmpty().withMessage('Platform SKU is required'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const { platform, platformSku } = req.params;
  const { refresh = false } = req.query;

  let productData;

  if (refresh === 'true') {
    // Force refresh from platform
    productData = await connectorManager.getProduct(platform, platformSku);
  } else {
    // Check database first
    const existingItem = await PlatformItem.findOne({
      platform,
      platformSku,
      isActive: true,
    }).populate('productMasterId');

    if (existingItem && existingItem.lastScrapedAt > new Date(Date.now() - 24 * 60 * 60 * 1000)) {
      // Use cached data if less than 24 hours old
      productData = existingItem;
    } else {
      // Fetch fresh data from platform
      productData = await connectorManager.getProduct(platform, platformSku);
    }
  }

  if (!productData) {
    throw new AppError(`Product not found on ${platform}`, 404);
  }

  res.json({
    status: 'success',
    data: productData,
  });
}));

/**
 * @swagger
 * /api/product/{masterId}/price-history:
 *   get:
 *     summary: Get price history for a product
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: masterId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product master ID
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           default: 30
 *         description: Number of days of history to return
 *       - in: query
 *         name: platforms
 *         schema:
 *           type: string
 *         description: Comma-separated list of platforms to include
 *     responses:
 *       200:
 *         description: Price history data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date
 *                       platform:
 *                         type: string
 *                       price:
 *                         type: number
 *                       currency:
 *                         type: string
 */
router.get('/:masterId/price-history', optionalAuth, [
  param('masterId').isMongoId().withMessage('Invalid product ID'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const { masterId } = req.params;
  const { days = 30, platforms: platformsParam } = req.query;

  const platforms = platformsParam ? (platformsParam as string).split(',').map(p => p.trim()) : undefined;

  // Check if product exists
  const productMaster = await ProductMaster.findById(masterId);
  if (!productMaster || !productMaster.isActive) {
    throw new AppError('Product not found', 404);
  }

  // Check cache first
  const cacheKey = `price-history:${masterId}:${days}:${platforms?.join(',') || 'all'}`;
  let priceHistory = await CacheService.getJSON(cacheKey);

  if (!priceHistory) {
    priceHistory = await PriceHistory.getPriceTrend(
      masterId,
      platforms,
      parseInt(days as string)
    );

    // Cache for 1 hour
    await CacheService.setJSON(cacheKey, priceHistory, 3600);
  }

  res.json({
    status: 'success',
    data: priceHistory,
  });
}));

/**
 * @swagger
 * /api/product/{masterId}/similar:
 *   get:
 *     summary: Get similar products
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: masterId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product master ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 20
 *           default: 10
 *         description: Number of similar products to return
 *     responses:
 *       200:
 *         description: Similar products
 */
router.get('/:masterId/similar', optionalAuth, [
  param('masterId').isMongoId().withMessage('Invalid product ID'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const { masterId } = req.params;
  const { limit = 10 } = req.query;

  // Get the original product
  const originalProduct = await ProductMaster.findById(masterId);
  if (!originalProduct || !originalProduct.isActive) {
    throw new AppError('Product not found', 404);
  }

  // Check cache first
  const cacheKey = `similar:${masterId}:${limit}`;
  let similarProducts = await CacheService.getJSON(cacheKey);

  if (!similarProducts) {
    // Find similar products based on category, brand, and tags
    const similarQuery = {
      _id: { $ne: masterId },
      isActive: true,
      $or: [
        { category: originalProduct.category, brand: originalProduct.brand },
        { category: originalProduct.category, tags: { $in: originalProduct.tags } },
        { tags: { $in: originalProduct.tags } },
      ],
    };

    similarProducts = await ProductMaster.find(similarQuery)
      .limit(parseInt(limit as string))
      .populate('platformItems')
      .sort({ averageRating: -1, createdAt: -1 });

    // Cache for 30 minutes
    await CacheService.setJSON(cacheKey, similarProducts, 1800);
  }

  res.json({
    status: 'success',
    data: similarProducts,
  });
}));

/**
 * @swagger
 * /api/product/{masterId}/lowest-price:
 *   get:
 *     summary: Get lowest price history for a product
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: masterId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product master ID
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           default: 30
 *         description: Number of days to look back
 *     responses:
 *       200:
 *         description: Lowest price information
 */
router.get('/:masterId/lowest-price', optionalAuth, [
  param('masterId').isMongoId().withMessage('Invalid product ID'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const { masterId } = req.params;
  const { days = 30 } = req.query;

  // Check if product exists
  const productMaster = await ProductMaster.findById(masterId);
  if (!productMaster || !productMaster.isActive) {
    throw new AppError('Product not found', 404);
  }

  // Get current lowest price
  const currentLowest = await PlatformItem.findCheapest(masterId);

  // Get historical lowest price
  const historicalLowest = await PriceHistory.getLowestPriceInRange(
    masterId,
    parseInt(days as string)
  );

  const data = {
    current: currentLowest ? {
      platform: currentLowest.platform,
      price: currentLowest.price,
      currency: currentLowest.currency,
      url: currentLowest.productUrl,
      lastUpdated: currentLowest.lastScrapedAt,
    } : null,
    historical: historicalLowest ? {
      platform: historicalLowest.platform,
      price: historicalLowest.price,
      currency: historicalLowest.currency,
      date: historicalLowest.timestamp,
    } : null,
    savingsOpportunity: currentLowest && historicalLowest && currentLowest.price > historicalLowest.price
      ? {
          amount: currentLowest.price - historicalLowest.price,
          percentage: Math.round(((currentLowest.price - historicalLowest.price) / currentLowest.price) * 100),
        }
      : null,
  };

  res.json({
    status: 'success',
    data,
  });
}));

export default router;