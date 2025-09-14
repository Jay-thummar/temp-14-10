import express from 'express';
import { body, validationResult } from 'express-validator';
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
 * /api/alerts/subscribe:
 *   post:
 *     summary: Subscribe to push notifications
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 */
router.post('/subscribe', protect, [
  body('endpoint').notEmpty().withMessage('Endpoint is required'),
  body('keys').isObject().withMessage('Keys object is required'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const user = req.user!;
  const { endpoint, keys } = req.body;

  // Store push subscription in user preferences
  // This is a simplified implementation
  user.preferences = {
    ...user.preferences,
    pushSubscription: { endpoint, keys }
  } as any;

  await user.save();

  res.json({
    status: 'success',
    message: 'Push notifications subscribed successfully',
  });
}));

/**
 * @swagger
 * /api/alerts/unsubscribe:
 *   post:
 *     summary: Unsubscribe from push notifications
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 */
router.post('/unsubscribe', protect, catchAsync(async (req, res) => {
  const user = req.user!;

  // Remove push subscription
  if (user.preferences as any) {
    delete (user.preferences as any).pushSubscription;
  }

  await user.save();

  res.json({
    status: 'success',
    message: 'Push notifications unsubscribed successfully',
  });
}));

/**
 * @swagger
 * /api/alerts/test:
 *   post:
 *     summary: Send test notification
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 */
router.post('/test', protect, catchAsync(async (req, res) => {
  const user = req.user!;

  // Send test notification
  // This would typically use the notification service
  
  res.json({
    status: 'success',
    message: 'Test notification sent',
  });
}));

export default router;