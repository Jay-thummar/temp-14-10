import express from 'express';
import { body, validationResult } from 'express-validator';
import { User } from '../models/User';
import { SearchLog } from '../models/SearchLog';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { protect, checkOwnership } from '../middleware/auth';

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
 * /api/user/profile:
 *   get:
 *     summary: Get user profile
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 */
router.get('/profile', protect, catchAsync(async (req, res) => {
  const user = req.user!;

  res.json({
    status: 'success',
    data: {
      user: user.toJSON(),
    },
  });
}));

/**
 * @swagger
 * /api/user/profile:
 *   put:
 *     summary: Update user profile
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 */
router.put('/profile', protect, [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('phone')
    .optional()
    .isMobilePhone('any')
    .withMessage('Please provide a valid phone number'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const user = req.user!;
  const { name, phone } = req.body;

  if (name) user.name = name;
  if (phone) user.phone = phone;

  await user.save();

  res.json({
    status: 'success',
    message: 'Profile updated successfully',
    data: {
      user: user.toJSON(),
    },
  });
}));

/**
 * @swagger
 * /api/user/preferences:
 *   put:
 *     summary: Update user preferences
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 */
router.put('/preferences', protect, catchAsync(async (req, res) => {
  const user = req.user!;
  const { language, currency, theme, notifications, platforms } = req.body;

  if (language) user.preferences.language = language;
  if (currency) user.preferences.currency = currency;
  if (theme) user.preferences.theme = theme;
  if (notifications) user.preferences.notifications = { ...user.preferences.notifications, ...notifications };
  if (platforms) user.preferences.platforms = platforms;

  await user.save();

  res.json({
    status: 'success',
    message: 'Preferences updated successfully',
    data: {
      preferences: user.preferences,
    },
  });
}));

/**
 * @swagger
 * /api/user/search-history:
 *   get:
 *     summary: Get user search history
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 */
router.get('/search-history', protect, catchAsync(async (req, res) => {
  const user = req.user!;
  const { limit = 20 } = req.query;

  const searchHistory = await SearchLog.getUserSearchHistory(
    user._id.toString(),
    parseInt(limit as string)
  );

  res.json({
    status: 'success',
    data: searchHistory,
  });
}));

/**
 * @swagger
 * /api/user/delete-account:
 *   delete:
 *     summary: Delete user account
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/delete-account', protect, catchAsync(async (req, res) => {
  const user = req.user!;

  // Soft delete - deactivate account
  user.isActive = false;
  await user.save();

  res.json({
    status: 'success',
    message: 'Account deactivated successfully',
  });
}));

export default router;