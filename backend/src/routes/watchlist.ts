import express from 'express';
import { body, param, validationResult } from 'express-validator';
import { Watchlist } from '../models/Watchlist';
import { ProductMaster } from '../models/ProductMaster';
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
 * /api/watchlist:
 *   get:
 *     summary: Get user's watchlist
 *     tags: [Watchlist]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', protect, catchAsync(async (req, res) => {
  const user = req.user!;

  const watchlist = await Watchlist.getUserWatchlistWithProducts(user._id.toString());

  res.json({
    status: 'success',
    data: watchlist,
  });
}));

/**
 * @swagger
 * /api/watchlist:
 *   post:
 *     summary: Add product to watchlist
 *     tags: [Watchlist]
 *     security:
 *       - bearerAuth: []
 */
router.post('/', protect, [
  body('productMasterId').isMongoId().withMessage('Invalid product ID'),
  body('targetPrice').optional().isFloat({ min: 0 }).withMessage('Target price must be positive'),
  body('platformPreferences').optional().isArray().withMessage('Platform preferences must be an array'),
  body('alertFrequency').optional().isIn(['instant', 'daily', 'weekly']).withMessage('Invalid alert frequency'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const user = req.user!;
  const { productMasterId, targetPrice, platformPreferences, alertFrequency, notes } = req.body;

  // Check if product exists
  const product = await ProductMaster.findById(productMasterId);
  if (!product || !product.isActive) {
    throw new AppError('Product not found', 404);
  }

  // Check if already in watchlist
  const existing = await Watchlist.findOne({
    userId: user._id,
    productMasterId,
  });

  if (existing) {
    throw new AppError('Product is already in your watchlist', 400);
  }

  // Create watchlist entry
  const watchlistItem = new Watchlist({
    userId: user._id,
    productMasterId,
    targetPrice,
    platformPreferences: platformPreferences || [],
    alertFrequency: alertFrequency || 'instant',
    notes,
  });

  await watchlistItem.save();
  await watchlistItem.populate('product');

  res.status(201).json({
    status: 'success',
    message: 'Product added to watchlist',
    data: watchlistItem,
  });
}));

/**
 * @swagger
 * /api/watchlist/{watchlistId}:
 *   put:
 *     summary: Update watchlist item
 *     tags: [Watchlist]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:watchlistId', protect, [
  param('watchlistId').isMongoId().withMessage('Invalid watchlist ID'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const user = req.user!;
  const { watchlistId } = req.params;
  const { targetPrice, platformPreferences, alertFrequency, isEnabled, notes } = req.body;

  const watchlistItem = await Watchlist.findOne({
    _id: watchlistId,
    userId: user._id,
  });

  if (!watchlistItem) {
    throw new AppError('Watchlist item not found', 404);
  }

  // Update fields
  if (targetPrice !== undefined) watchlistItem.targetPrice = targetPrice;
  if (platformPreferences !== undefined) watchlistItem.platformPreferences = platformPreferences;
  if (alertFrequency !== undefined) watchlistItem.alertFrequency = alertFrequency;
  if (isEnabled !== undefined) watchlistItem.isEnabled = isEnabled;
  if (notes !== undefined) watchlistItem.notes = notes;

  await watchlistItem.save();
  await watchlistItem.populate('product');

  res.json({
    status: 'success',
    message: 'Watchlist item updated',
    data: watchlistItem,
  });
}));

/**
 * @swagger
 * /api/watchlist/{watchlistId}:
 *   delete:
 *     summary: Remove item from watchlist
 *     tags: [Watchlist]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:watchlistId', protect, [
  param('watchlistId').isMongoId().withMessage('Invalid watchlist ID'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const user = req.user!;
  const { watchlistId } = req.params;

  const watchlistItem = await Watchlist.findOneAndDelete({
    _id: watchlistId,
    userId: user._id,
  });

  if (!watchlistItem) {
    throw new AppError('Watchlist item not found', 404);
  }

  res.json({
    status: 'success',
    message: 'Item removed from watchlist',
  });
}));

export default router;