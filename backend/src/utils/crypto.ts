import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export async function hashPassword(plain: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function sha256Base64(input: string): string {
  return crypto.createHash('sha256').update(input).digest('base64');
}

export function generateSecureToken(length = 48): string {
  return crypto.randomBytes(length).toString('hex');
}

