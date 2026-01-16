import { Redis } from 'ioredis';

/**
 * Create a Redis connection for BullMQ
 *
 * BullMQ requires specific Redis configuration for optimal performance:
 * - maxRetriesPerRequest: null (required for BullMQ)
 * - enableReadyCheck: false (faster connection)
 *
 * @param redisUrl - Redis connection URL
 * @returns Redis client instance
 */
export function createRedisConnection(redisUrl: string): Redis {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false, // Faster connection
    retryStrategy: (times) => {
      // Exponential backoff with max 2 second delay
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

  redis.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  redis.on('connect', () => {
    console.log('[Redis] Connected');
  });

  return redis;
}

/**
 * Create a duplicate Redis connection for workers
 * Workers need their own connection separate from the queue
 */
export function createWorkerConnection(redisUrl: string): Redis {
  return createRedisConnection(redisUrl);
}
