import { Router } from 'express';
import { router as healthRouter } from './v1/health.js';
import { router as authRouter } from './v1/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

export const router = Router();

router.use('/health', healthRouter);
router.use('/auth', authLimiter, authRouter);

