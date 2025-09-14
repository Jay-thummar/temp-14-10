import { Router } from 'express';
import { z } from 'zod';
import { connectMongo } from '../../config/db.js';
import { User } from '../../models/User.js';
import { generateSecureToken, hashPassword, sha256Base64, verifyPassword } from '../../utils/crypto.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../services/jwt.js';

export const router = Router();

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8)
});

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, email, phone, password } = parsed.data;
  await connectMongo();
  const existing = await User.findOne({ email }).lean();
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await hashPassword(password);
  const user = await User.create({ name, email, phone, passwordHash, roles: ['user'] });

  const jti = generateSecureToken(16);
  const accessToken = signAccessToken({ sub: user._id.toString(), roles: user.roles });
  const refreshToken = signRefreshToken({ sub: user._id.toString(), jti });
  const tokenHash = sha256Base64(refreshToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  user.refreshTokens.push({ tokenHash, createdAt: new Date(), expiresAt });
  await user.save();

  res.status(201).json({
    user: { id: user._id, name: user.name, email: user.email, roles: user.roles },
    accessToken,
    refreshToken
  });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;
  await connectMongo();
  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const jti = generateSecureToken(16);
  const accessToken = signAccessToken({ sub: user._id.toString(), roles: user.roles });
  const refreshToken = signRefreshToken({ sub: user._id.toString(), jti });
  const tokenHash = sha256Base64(refreshToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  user.refreshTokens.push({ tokenHash, createdAt: new Date(), expiresAt });
  await user.save();

  res.json({
    user: { id: user._id, name: user.name, email: user.email, roles: user.roles },
    accessToken,
    refreshToken
  });
});

const refreshSchema = z.object({ refreshToken: z.string().min(10) });

router.post('/refresh', async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { refreshToken } = parsed.data;
  await connectMongo();
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const tokenHash = sha256Base64(refreshToken);
  const user = await User.findById(payload.sub);
  if (!user) return res.status(401).json({ error: 'Invalid token' });
  const exists = user.refreshTokens.find(rt => rt.tokenHash === tokenHash && rt.expiresAt > new Date());
  if (!exists) return res.status(401).json({ error: 'Invalid token' });

  const accessToken = signAccessToken({ sub: user._id.toString(), roles: user.roles });
  res.json({ accessToken });
});

