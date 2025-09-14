import express from 'express';
import { query, param, validationResult } from 'express-validator';
import { connectorManager } from '../connectors/ConnectorManager';
import { Job } from '../models/Job';
import { SearchLog } from '../models/SearchLog';
import { User } from '../models/User';
import { ProductMaster } from '../models/ProductMaster';
import { PlatformItem } from '../models/PlatformItem';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { protect, restrictTo } from '../middleware/auth';

const router = express.Router();

// All admin routes require admin role
router.use(protect);
router.use(restrictTo('admin'));

const handleValidationErrors = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(`Validation error: ${errors.array().map(err => err.msg).join(', ')}`, 400));
  }
  next();
};

/**
 * @swagger
 * /api/admin/dashboard:
 *   get:
 *     summary: Get admin dashboard statistics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/dashboard', catchAsync(async (req, res) => {
  const [
    totalUsers,
    activeUsers,
    totalProducts,
    totalPlatformItems,
    recentSearches,
    jobStats,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isActive: true }),
    ProductMaster.countDocuments({ isActive: true }),
    PlatformItem.countDocuments({ isActive: true }),
    SearchLog.countDocuments({ timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    Job.getJobStats(24),
  ]);

  const platformBreakdown = await PlatformItem.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$platform', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  res.json({
    status: 'success',
    data: {
      users: {
        total: totalUsers,
        active: activeUsers,
      },
      products: {
        total: totalProducts,
        platformItems: totalPlatformItems,
        platformBreakdown,
      },
      activity: {
        searchesLast24h: recentSearches,
      },
      jobs: jobStats,
      connectors: connectorManager.getAvailablePlatforms().map(platform => ({
        platform,
        enabled: connectorManager.getEnabledPlatforms().includes(platform),
      })),
    },
  });
}));

/**
 * @swagger
 * /api/admin/connectors:
 *   get:
 *     summary: Get connector status
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/connectors', catchAsync(async (req, res) => {
  const healthCheck = await connectorManager.healthCheck();
  
  const connectors = connectorManager.getAvailablePlatforms().map(platform => ({
    platform,
    enabled: connectorManager.getEnabledPlatforms().includes(platform),
    health: healthCheck[platform],
  }));

  res.json({
    status: 'success',
    data: connectors,
  });
}));

/**
 * @swagger
 * /api/admin/connectors/{platform}/toggle:
 *   post:
 *     summary: Enable/disable a connector
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.post('/connectors/:platform/toggle', [
  param('platform').isIn(['amazon', 'flipkart', 'myntra', 'snapdeal', 'paytm', 'nykaa', 'ajio']).withMessage('Invalid platform'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const { platform } = req.params;
  const { enabled } = req.body;

  connectorManager.setPlatformEnabled(platform, enabled);

  res.json({
    status: 'success',
    message: `${platform} connector ${enabled ? 'enabled' : 'disabled'}`,
  });
}));

/**
 * @swagger
 * /api/admin/jobs:
 *   get:
 *     summary: Get job queue status
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/jobs', catchAsync(async (req, res) => {
  const { status, type, limit = 50, page = 1 } = req.query;

  const query: any = {};
  if (status) query.status = status;
  if (type) query.type = type;

  const jobs = await Job.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit as string))
    .skip((parseInt(page as string) - 1) * parseInt(limit as string));

  const stats = await Job.getJobStats(24);

  res.json({
    status: 'success',
    data: {
      jobs,
      stats,
    },
  });
}));

/**
 * @swagger
 * /api/admin/jobs/{jobId}/retry:
 *   post:
 *     summary: Retry a failed job
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.post('/jobs/:jobId/retry', [
  param('jobId').isMongoId().withMessage('Invalid job ID'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const { jobId } = req.params;

  const job = await Job.findById(jobId);
  if (!job) {
    throw new AppError('Job not found', 404);
  }

  await job.retry();

  res.json({
    status: 'success',
    message: 'Job queued for retry',
    data: job,
  });
}));

/**
 * @swagger
 * /api/admin/analytics:
 *   get:
 *     summary: Get analytics data
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/analytics', catchAsync(async (req, res) => {
  const { days = 30 } = req.query;

  const [
    searchAnalytics,
    popularSearches,
    userGrowth,
  ] = await Promise.all([
    SearchLog.getSearchAnalytics(parseInt(days as string)),
    SearchLog.getPopularSearches(parseInt(days as string)),
    User.aggregate([
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          },
          newUsers: { $sum: 1 },
        },
      },
      { $sort: { '_id.date': 1 } },
      { $limit: parseInt(days as string) },
    ]),
  ]);

  res.json({
    status: 'success',
    data: {
      searchAnalytics,
      popularSearches,
      userGrowth,
    },
  });
}));

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get users list
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/users', catchAsync(async (req, res) => {
  const { status, limit = 50, page = 1, search } = req.query;

  const query: any = {};
  if (status === 'active') query.isActive = true;
  if (status === 'inactive') query.isActive = false;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const users = await User.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit as string))
    .skip((parseInt(page as string) - 1) * parseInt(limit as string));

  const total = await User.countDocuments(query);

  res.json({
    status: 'success',
    data: {
      users,
      pagination: {
        total,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        pages: Math.ceil(total / parseInt(limit as string)),
      },
    },
  });
}));

/**
 * @swagger
 * /api/admin/users/{userId}/toggle:
 *   post:
 *     summary: Activate/deactivate user
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.post('/users/:userId/toggle', [
  param('userId').isMongoId().withMessage('Invalid user ID'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const { userId } = req.params;

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  user.isActive = !user.isActive;
  await user.save();

  res.json({
    status: 'success',
    message: `User ${user.isActive ? 'activated' : 'deactivated'}`,
    data: user,
  });
}));

/**
 * @swagger
 * /api/admin/products/merge:
 *   post:
 *     summary: Merge duplicate products
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.post('/products/merge', catchAsync(async (req, res) => {
  const { sourceId, targetId } = req.body;

  const [sourceProduct, targetProduct] = await Promise.all([
    ProductMaster.findById(sourceId),
    ProductMaster.findById(targetId),
  ]);

  if (!sourceProduct || !targetProduct) {
    throw new AppError('One or both products not found', 404);
  }

  // Move platform items from source to target
  await PlatformItem.updateMany(
    { productMasterId: sourceId },
    { productMasterId: targetId }
  );

  // Merge product data
  targetProduct.images = [...new Set([...targetProduct.images, ...sourceProduct.images])];
  targetProduct.aliases = [...new Set([...targetProduct.aliases, ...sourceProduct.aliases, sourceProduct.canonicalTitle])];
  targetProduct.normalizedKeys = [...new Set([...targetProduct.normalizedKeys, ...sourceProduct.normalizedKeys])];
  
  await targetProduct.save();

  // Deactivate source product
  sourceProduct.isActive = false;
  await sourceProduct.save();

  res.json({
    status: 'success',
    message: 'Products merged successfully',
    data: targetProduct,
  });
}));

export default router;