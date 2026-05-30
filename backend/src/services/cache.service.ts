import Redis from 'ioredis';

const DEFAULT_TTL = 15 * 60; // 15 minutes for job searches
const STATS_TTL = 5 * 60; // 5 minutes for source stats
const JOB_SEARCH_TTL = 15 * 60; // 15 minutes for job search results

// Initialize Redis client - fallback to localhost if not configured
let redis: Redis;

function getRedisClient(): Redis {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 3) {
          console.error('Redis connection failed after 3 attempts');
          return null; // Stop retrying
        }
        return Math.min(times * 200, 2000);
      },
    });

    redis.on('error', (err) => {
      console.error('Redis error:', err.message);
    });

    redis.on('connect', () => {
      console.log('Redis connected');
    });
  }
  return redis;
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const client = getRedisClient();
    const data = await client.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
}

export async function setCache(
  key: string,
  value: unknown,
  ttl: number = DEFAULT_TTL
): Promise<void> {
  try {
    const client = getRedisClient();
    await client.setex(key, ttl, JSON.stringify(value));
  } catch (error) {
    console.error('Cache set error:', error);
  }
}

export async function invalidatePattern(pattern: string): Promise<void> {
  try {
    const client = getRedisClient();
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
      console.log(`Invalidated ${keys.length} cache entries matching ${pattern}`);
    }
  } catch (error) {
    console.error('Cache invalidate error:', error);
  }
}

export async function invalidateApiKeysCache(): Promise<void> {
  // Invalidate all job search cache when user saves new API keys
  await invalidatePattern('jobsearch:*');
}

// Generate cache key for job search
export function getJobSearchCacheKey(
  keywords?: string,
  location?: string,
  remote?: boolean
): string {
  const key = `jobsearch:${keywords || ''}:${location || ''}:${remote ? 'remote' : 'all'}`;
  return key.toLowerCase().replace(/\s+/g, '-');
}

// Export TTL constants for external use
export { JOB_SEARCH_TTL, STATS_TTL, DEFAULT_TTL };