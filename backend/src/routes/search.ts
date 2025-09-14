import express from 'express';
import { query, validationResult } from 'express-validator';
import { SearchService } from '../services/searchService';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { optionalAuth } from '../middleware/auth';

const router = express.Router();

// Validation middleware
const validateSearch = [
  query('q')
    .notEmpty()
    .withMessage('Search query is required')
    .isLength({ min: 2, max: 200 })
    .withMessage('Query must be between 2 and 200 characters'),
  query('category')
    .optional()
    .isIn(['Electronics', 'Fashion', 'Home', 'Books', 'Sports', 'Beauty', 'Health', 'Automotive', 'Toys', 'Grocery', 'Other'])
    .withMessage('Invalid category'),
  query('minPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Minimum price must be a positive number'),
  query('maxPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Maximum price must be a positive number'),
  query('sortBy')
    .optional()
    .isIn(['relevance', 'price_low', 'price_high', 'rating', 'newest'])
    .withMessage('Invalid sort option'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
  query('platforms')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        const platforms = value.split(',');
        const validPlatforms = ['amazon', 'flipkart', 'myntra', 'snapdeal', 'paytm', 'nykaa', 'ajio'];
        return platforms.every(p => validPlatforms.includes(p.trim()));
      }
      return true;
    })
    .withMessage('Invalid platforms specified'),
];

const handleValidationErrors = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(`Validation error: ${errors.array().map(err => err.msg).join(', ')}`, 400));
  }
  next();
};

/**
 * @swagger
 * /api/search:
 *   get:
 *     summary: Search products across multiple platforms
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *           maxLength: 200
 *         description: Search query
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [Electronics, Fashion, Home, Books, Sports, Beauty, Health, Automotive, Toys, Grocery, Other]
 *         description: Product category filter
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Minimum price filter
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Maximum price filter
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [relevance, price_low, price_high, rating, newest]
 *           default: relevance
 *         description: Sort order
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *         description: Number of results per page
 *       - in: query
 *         name: platforms
 *         schema:
 *           type: string
 *         description: Comma-separated list of platforms (amazon,flipkart,myntra,etc.)
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     results:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/SearchResult'
 *                     metadata:
 *                       type: object
 *                       properties:
 *                         query:
 *                           type: string
 *                         totalResults:
 *                           type: integer
 *                         platforms:
 *                           type: array
 *                           items:
 *                             type: string
 *                         latencyMs:
 *                           type: integer
 *                         cached:
 *                           type: boolean
 *       400:
 *         description: Validation error
 */
router.get('/', optionalAuth, validateSearch, handleValidationErrors, catchAsync(async (req, res) => {
  const {
    q: query,
    category,
    minPrice,
    maxPrice,
    sortBy,
    page = 1,
    limit = 20,
    platforms: platformsParam,
  } = req.query;

  const platforms = platformsParam ? (platformsParam as string).split(',').map(p => p.trim()) : undefined;

  const searchOptions = {
    query: query as string,
    category: category as string,
    minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
    maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
    sortBy: sortBy as any,
    page: parseInt(page as string),
    limit: parseInt(limit as string),
    platforms,
    userId: req.user?._id.toString(),
    sessionId: req.headers['x-session-id'] as string,
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  };

  const result = await SearchService.search(searchOptions);

  res.json({
    status: 'success',
    data: result,
  });
}));

/**
 * @swagger
 * /api/search/suggestions:
 *   get:
 *     summary: Get search suggestions
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *         description: Partial search query
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 20
 *           default: 10
 *         description: Number of suggestions to return
 *     responses:
 *       200:
 *         description: Search suggestions
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
 *                       query:
 *                         type: string
 *                       category:
 *                         type: string
 *                       popularity:
 *                         type: integer
 */
router.get('/suggestions', [
  query('q')
    .notEmpty()
    .withMessage('Query parameter is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('Query must be between 1 and 100 characters'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('Limit must be between 1 and 20'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const { q: query, limit = 10 } = req.query;

  const suggestions = await SearchService.getSuggestions(
    query as string,
    parseInt(limit as string)
  );

  res.json({
    status: 'success',
    data: suggestions,
  });
}));

/**
 * @swagger
 * /api/search/trending:
 *   get:
 *     summary: Get trending searches
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 20
 *           default: 10
 *         description: Number of trending searches to return
 *     responses:
 *       200:
 *         description: Trending searches
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
 *                       query:
 *                         type: string
 *                       popularity:
 *                         type: integer
 */
router.get('/trending', [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('Limit must be between 1 and 20'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const { limit = 10 } = req.query;

  const trending = await SearchService.getTrendingSearches(parseInt(limit as string));

  res.json({
    status: 'success',
    data: trending,
  });
}));

/**
 * @swagger
 * /api/search/database:
 *   get:
 *     summary: Search in existing products database
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Search query
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Product category filter
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Minimum price filter
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Maximum price filter
 *       - in: query
 *         name: platforms
 *         schema:
 *           type: string
 *         description: Comma-separated list of platforms
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *         description: Number of results per page
 *     responses:
 *       200:
 *         description: Database search results
 */
router.get('/database', optionalAuth, [
  query('q')
    .notEmpty()
    .withMessage('Search query is required')
    .isLength({ min: 2, max: 200 })
    .withMessage('Query must be between 2 and 200 characters'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const {
    q: query,
    category,
    minPrice,
    maxPrice,
    platforms: platformsParam,
    page = 1,
    limit = 20,
  } = req.query;

  const platforms = platformsParam ? (platformsParam as string).split(',').map(p => p.trim()) : undefined;

  const options = {
    category: category as string,
    minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
    maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
    platforms,
    skip: (parseInt(page as string) - 1) * parseInt(limit as string),
    limit: parseInt(limit as string),
  };

  const results = await SearchService.searchDatabase(query as string, options);

  res.json({
    status: 'success',
    data: {
      results,
      metadata: {
        query: query as string,
        totalResults: results.length,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      },
    },
  });
}));

export default router;