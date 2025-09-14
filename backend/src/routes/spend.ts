import express from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { SpendRecord } from '../models/SpendRecord';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { protect } from '../middleware/auth';

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
 * /api/spend:
 *   get:
 *     summary: Get user's spending records
 *     tags: [Spend Tracking]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', protect, catchAsync(async (req, res) => {
  const user = req.user!;
  const { month, year, platform, limit = 50, page = 1 } = req.query;

  const query: any = { userId: user._id };

  if (month && year) {
    const startDate = new Date(parseInt(year as string), parseInt(month as string) - 1, 1);
    const endDate = new Date(parseInt(year as string), parseInt(month as string), 0);
    query.orderDate = { $gte: startDate, $lte: endDate };
  }

  if (platform) {
    query.platform = platform;
  }

  const spendRecords = await SpendRecord.find(query)
    .sort({ orderDate: -1 })
    .limit(parseInt(limit as string))
    .skip((parseInt(page as string) - 1) * parseInt(limit as string))
    .populate('productMasterId');

  res.json({
    status: 'success',
    data: spendRecords,
  });
}));

/**
 * @swagger
 * /api/spend:
 *   post:
 *     summary: Add spending record
 *     tags: [Spend Tracking]
 *     security:
 *       - bearerAuth: []
 */
router.post('/', protect, [
  body('platform').isIn(['amazon', 'flipkart', 'myntra', 'snapdeal', 'paytm', 'nykaa', 'ajio', 'other']).withMessage('Invalid platform'),
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be positive'),
  body('orderDate').isISO8601().withMessage('Invalid order date'),
  body('productTitle').optional().isLength({ max: 300 }).withMessage('Product title too long'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const user = req.user!;
  const {
    productMasterId,
    platform,
    amount,
    orderDate,
    orderUrl,
    orderId,
    productTitle,
    category,
    paymentMethod,
    status = 'confirmed',
    notes,
  } = req.body;

  const spendRecord = new SpendRecord({
    userId: user._id,
    productMasterId,
    platform,
    amount,
    orderDate: new Date(orderDate),
    orderUrl,
    orderId,
    productTitle,
    category,
    paymentMethod,
    status,
    notes,
  });

  await spendRecord.save();

  res.status(201).json({
    status: 'success',
    message: 'Spending record added successfully',
    data: spendRecord,
  });
}));

/**
 * @swagger
 * /api/spend/summary:
 *   get:
 *     summary: Get spending summary
 *     tags: [Spend Tracking]
 *     security:
 *       - bearerAuth: []
 */
router.get('/summary', protect, catchAsync(async (req, res) => {
  const user = req.user!;
  const { startDate, endDate } = req.query;

  const summary = await SpendRecord.getSpendingSummary(
    user._id.toString(),
    startDate ? new Date(startDate as string) : undefined,
    endDate ? new Date(endDate as string) : undefined
  );

  res.json({
    status: 'success',
    data: summary[0] || {
      totalAmount: 0,
      totalOrders: 0,
      avgOrderValue: 0,
      platformSummary: {},
    },
  });
}));

/**
 * @swagger
 * /api/spend/trend:
 *   get:
 *     summary: Get monthly spending trend
 *     tags: [Spend Tracking]
 *     security:
 *       - bearerAuth: []
 */
router.get('/trend', protect, catchAsync(async (req, res) => {
  const user = req.user!;
  const { months = 12 } = req.query;

  const trend = await SpendRecord.getMonthlySpendingTrend(
    user._id.toString(),
    parseInt(months as string)
  );

  res.json({
    status: 'success',
    data: trend,
  });
}));

/**
 * @swagger
 * /api/spend/platforms:
 *   get:
 *     summary: Get platform-wise spending
 *     tags: [Spend Tracking]
 *     security:
 *       - bearerAuth: []
 */
router.get('/platforms', protect, catchAsync(async (req, res) => {
  const user = req.user!;
  const { startDate, endDate } = req.query;

  const platformSpending = await SpendRecord.getPlatformSpending(
    user._id.toString(),
    startDate ? new Date(startDate as string) : undefined,
    endDate ? new Date(endDate as string) : undefined
  );

  res.json({
    status: 'success',
    data: platformSpending,
  });
}));

/**
 * @swagger
 * /api/spend/{recordId}:
 *   put:
 *     summary: Update spending record
 *     tags: [Spend Tracking]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:recordId', protect, [
  param('recordId').isMongoId().withMessage('Invalid record ID'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const user = req.user!;
  const { recordId } = req.params;

  const spendRecord = await SpendRecord.findOne({
    _id: recordId,
    userId: user._id,
  });

  if (!spendRecord) {
    throw new AppError('Spending record not found', 404);
  }

  Object.assign(spendRecord, req.body);
  await spendRecord.save();

  res.json({
    status: 'success',
    message: 'Spending record updated successfully',
    data: spendRecord,
  });
}));

/**
 * @swagger
 * /api/spend/{recordId}:
 *   delete:
 *     summary: Delete spending record
 *     tags: [Spend Tracking]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:recordId', protect, [
  param('recordId').isMongoId().withMessage('Invalid record ID'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const user = req.user!;
  const { recordId } = req.params;

  const spendRecord = await SpendRecord.findOneAndDelete({
    _id: recordId,
    userId: user._id,
  });

  if (!spendRecord) {
    throw new AppError('Spending record not found', 404);
  }

  res.json({
    status: 'success',
    message: 'Spending record deleted successfully',
  });
}));

export default router;