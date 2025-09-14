import dotenv from 'dotenv';

export function loadEnv() {
  dotenv.config();
  const {
    NODE_ENV,
    PORT,
    MONGODB_URI,
    JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET,
    REDIS_URL
  } = process.env;

  if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
    // eslint-disable-next-line no-console
    console.warn('Warning: JWT secrets are not set. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET');
  }

  return {
    NODE_ENV: NODE_ENV || 'development',
    PORT: PORT || '4000',
    MONGODB_URI: MONGODB_URI || 'mongodb://mongo:27017/pcm',
    JWT_ACCESS_SECRET: JWT_ACCESS_SECRET || 'dev_access',
    JWT_REFRESH_SECRET: JWT_REFRESH_SECRET || 'dev_refresh',
    REDIS_URL: REDIS_URL || 'redis://redis:6379'
  };
}

