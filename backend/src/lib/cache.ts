import IORedis from 'ioredis';

let cacheClient: IORedis | null = null;

function getCacheClient(): IORedis | null {
  if (cacheClient) {
    return cacheClient;
  }

  const host = process.env.REDIS_HOST;
  const portRaw = process.env.REDIS_PORT;
  if (!host || !portRaw) {
    return null;
  }

  cacheClient = new IORedis({
    host,
    port: parseInt(portRaw, 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  cacheClient.on('error', (error) => {
    console.error('[Cache] Redis error:', error.message);
  });

  return cacheClient;
}

export async function getCached<T>(key: string): Promise<T | null> {
  const client = getCacheClient();
  if (!client) {
    return null;
  }

  const value = await client.get(key);
  if (!value) {
    return null;
  }

  return JSON.parse(value) as T;
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const client = getCacheClient();
  if (!client) {
    return;
  }

  await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}
