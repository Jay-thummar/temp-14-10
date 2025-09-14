import { Router } from 'express';

export const router = Router();

router.get('/', async (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

