import express from 'express';
import { body, validationResult } from 'express-validator';
import passport from 'passport';
import { AuthService } from '../services/authService';
import { AppError, catchAsync } from '../middleware/errorHandler';
import { protect, validateRefreshToken, logUserActivity } from '../middleware/auth';

const router = express.Router();

// Validation middleware
const validateRegister = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  body('phone')
    .optional()
    .isMobilePhone('any')
    .withMessage('Please provide a valid phone number'),
];

const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

const validateChangePassword = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one uppercase letter, one lowercase letter, and one number'),
];

// Helper function to handle validation errors
const handleValidationErrors = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(`Validation error: ${errors.array().map(err => err.msg).join(', ')}`, 400));
  }
  next();
};

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               phone:
 *                 type: string
 *                 format: phone
 *     responses:
 *       201:
 *         description: User registered successfully
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
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *       400:
 *         description: Validation error or user already exists
 */
router.post('/register', validateRegister, handleValidationErrors, catchAsync(async (req, res) => {
  const { name, email, phone, password } = req.body;

  const result = await AuthService.register({ name, email, phone, password });

  res.status(201).json({
    status: 'success',
    message: 'User registered successfully',
    data: result,
  });
}));

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
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
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', validateLogin, handleValidationErrors, catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const result = await AuthService.login({ email, password });

  res.json({
    status: 'success',
    message: 'Login successful',
    data: result,
  });
}));

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post('/refresh', validateRefreshToken, catchAsync(async (req, res) => {
  const { refreshToken } = req.body;
  const user = req.user!;

  const result = await AuthService.refreshToken(user, refreshToken);

  res.json({
    status: 'success',
    message: 'Token refreshed successfully',
    data: result,
  });
}));

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Logout successful
 */
router.post('/logout', protect, catchAsync(async (req, res) => {
  const { refreshToken } = req.body;
  const user = req.user!;

  if (refreshToken) {
    await AuthService.logout(user, refreshToken);
  }

  res.json({
    status: 'success',
    message: 'Logout successful',
  });
}));

/**
 * @swagger
 * /api/auth/logout-all:
 *   post:
 *     summary: Logout from all devices
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout from all devices successful
 */
router.post('/logout-all', protect, catchAsync(async (req, res) => {
  const user = req.user!;

  await AuthService.logoutAll(user);

  res.json({
    status: 'success',
    message: 'Logout from all devices successful',
  });
}));

/**
 * @swagger
 * /api/auth/change-password:
 *   put:
 *     summary: Change user password
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Invalid current password or validation error
 */
router.put('/change-password', protect, validateChangePassword, handleValidationErrors, catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = req.user!;

  await AuthService.changePassword(user, currentPassword, newPassword);

  res.json({
    status: 'success',
    message: 'Password changed successfully',
  });
}));

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request password reset
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Password reset email sent
 *       404:
 *         description: User not found
 */
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const { email } = req.body;

  await AuthService.forgotPassword(email);

  res.json({
    status: 'success',
    message: 'Password reset email sent',
  });
}));

/**
 * @swagger
 * /api/auth/verify-email:
 *   post:
 *     summary: Verify email address
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid or expired token
 */
router.post('/verify-email', catchAsync(async (req, res) => {
  const { token } = req.body;

  if (!token) {
    throw new AppError('Verification token is required', 400);
  }

  await AuthService.verifyEmail(token);

  res.json({
    status: 'success',
    message: 'Email verified successfully',
  });
}));

/**
 * @swagger
 * /api/auth/send-verification:
 *   post:
 *     summary: Send email verification
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Verification email sent
 *       400:
 *         description: Email already verified
 */
router.post('/send-verification', protect, catchAsync(async (req, res) => {
  const user = req.user!;

  await AuthService.sendEmailVerification(user);

  res.json({
    status: 'success',
    message: 'Verification email sent',
  });
}));

/**
 * @swagger
 * /api/auth/send-phone-verification:
 *   post:
 *     summary: Send phone verification OTP
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Verification SMS sent
 *       400:
 *         description: Phone number required or already verified
 */
router.post('/send-phone-verification', protect, catchAsync(async (req, res) => {
  const user = req.user!;

  await AuthService.sendPhoneVerification(user);

  res.json({
    status: 'success',
    message: 'Verification SMS sent',
  });
}));

/**
 * @swagger
 * /api/auth/verify-phone:
 *   post:
 *     summary: Verify phone number with OTP
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - otp
 *             properties:
 *               otp:
 *                 type: string
 *                 pattern: '^[0-9]{6}$'
 *     responses:
 *       200:
 *         description: Phone verified successfully
 *       400:
 *         description: Invalid OTP
 */
router.post('/verify-phone', protect, [
  body('otp').matches(/^\d{6}$/).withMessage('OTP must be 6 digits'),
], handleValidationErrors, catchAsync(async (req, res) => {
  const { otp } = req.body;
  const user = req.user!;

  await AuthService.verifyPhone(user, otp);

  res.json({
    status: 'success',
    message: 'Phone verified successfully',
  });
}));

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
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
 *                     user:
 *                       $ref: '#/components/schemas/User'
 */
router.get('/me', protect, logUserActivity('profile_view'), catchAsync(async (req, res) => {
  const user = req.user!;

  res.json({
    status: 'success',
    data: {
      user: user.toJSON(),
    },
  });
}));

// Google OAuth routes (if using Passport.js)
// Note: You'll need to configure Passport.js with Google strategy
/*
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  catchAsync(async (req, res) => {
    // Handle successful authentication
    const user = req.user as any;
    const result = await AuthService.googleAuth({
      googleId: user.googleId,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
    });

    // Redirect to frontend with tokens
    const redirectUrl = `${process.env.FRONTEND_URL}/auth/callback?token=${result.accessToken}&refresh=${result.refreshToken}`;
    res.redirect(redirectUrl);
  })
);
*/

export default router;