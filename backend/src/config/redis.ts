import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

export let redisClient: RedisClientType;

export const connectRedis = async (): Promise<void> => {
  try {
    const redisUrl = process.env.REDIS_URL;
    
    if (!redisUrl) {
      throw new Error('Redis URL is not defined in environment variables');
    }

    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 60000,
        lazyConnect: true,
      },
      retry_delay_on_failover: 100,
      retry_delay_on_cluster_down: 300,
      max_attempts: 3,
    });

    redisClient.on('connect', () => {
      logger.info('✅ Redis client connected');
    });

    redisClient.on('ready', () => {
      logger.info('✅ Redis client ready');
    });

    redisClient.on('error', (err) => {
      logger.error('❌ Redis client error:', err);
    });

    redisClient.on('end', () => {
      logger.warn('⚠️ Redis client disconnected');
    });

    await redisClient.connect();

    // Test the connection
    await redisClient.ping();
    logger.info('✅ Redis connection established successfully');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      try {
        await redisClient.quit();
        logger.info('Redis connection closed through app termination');
      } catch (err) {
        logger.error('Error closing Redis connection:', err);
      }
    });

  } catch (error) {
    logger.error('❌ Failed to connect to Redis:', error);
    throw error;
  }
};

export const disconnectRedis = async (): Promise<void> => {
  try {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
      logger.info('Redis connection closed');
    }
  } catch (error) {
    logger.error('Error closing Redis connection:', error);
    throw error;
  }
};

// Cache utilities
export class CacheService {
  private static readonly DEFAULT_TTL = 3600; // 1 hour

  static async get(key: string): Promise<string | null> {
    try {
      return await redisClient.get(key);
    } catch (error) {
      logger.error(`Error getting key ${key} from cache:`, error);
      return null;
    }
  }

  static async set(key: string, value: string, ttl: number = this.DEFAULT_TTL): Promise<boolean> {
    try {
      await redisClient.setEx(key, ttl, value);
      return true;
    } catch (error) {
      logger.error(`Error setting key ${key} in cache:`, error);
      return false;
    }
  }

  static async getJSON<T>(key: string): Promise<T | null> {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error(`Error getting JSON key ${key} from cache:`, error);
      return null;
    }
  }

  static async setJSON<T>(key: string, value: T, ttl: number = this.DEFAULT_TTL): Promise<boolean> {
    try {
      await redisClient.setEx(key, ttl, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error(`Error setting JSON key ${key} in cache:`, error);
      return false;
    }
  }

  static async del(key: string): Promise<boolean> {
    try {
      await redisClient.del(key);
      return true;
    } catch (error) {
      logger.error(`Error deleting key ${key} from cache:`, error);
      return false;
    }
  }

  static async exists(key: string): Promise<boolean> {
    try {
      const result = await redisClient.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Error checking existence of key ${key} in cache:`, error);
      return false;
    }
  }

  static async setWithExpiry(key: string, value: string, seconds: number): Promise<boolean> {
    try {
      await redisClient.setEx(key, seconds, value);
      return true;
    } catch (error) {
      logger.error(`Error setting key ${key} with expiry in cache:`, error);
      return false;
    }
  }

  static async increment(key: string, increment: number = 1): Promise<number | null> {
    try {
      return await redisClient.incrBy(key, increment);
    } catch (error) {
      logger.error(`Error incrementing key ${key} in cache:`, error);
      return null;
    }
  }

  static async expire(key: string, seconds: number): Promise<boolean> {
    try {
      const result = await redisClient.expire(key, seconds);
      return result === 1;
    } catch (error) {
      logger.error(`Error setting expiry for key ${key} in cache:`, error);
      return false;
    }
  }

  static async keys(pattern: string): Promise<string[]> {
    try {
      return await redisClient.keys(pattern);
    } catch (error) {
      logger.error(`Error getting keys with pattern ${pattern} from cache:`, error);
      return [];
    }
  }

  static async flushAll(): Promise<boolean> {
    try {
      await redisClient.flushAll();
      return true;
    } catch (error) {
      logger.error('Error flushing cache:', error);
      return false;
    }
  }
}