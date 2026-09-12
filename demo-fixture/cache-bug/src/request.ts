import { ReconnectableCache } from "./cache";

/** Retry helper for cache-backed requests. */
export function shouldRetry(attempt: number, maxRetries: number): boolean {
  return attempt < maxRetries;
}

/** Fetch through the cache with bounded retries on transient misses. */
export function fetchWithCache(
  cache: ReconnectableCache,
  key: string,
  loader: () => unknown,
  maxRetries = 3,
): unknown {
  let attempt = 0;
  for (;;) {
    try {
      return cache.get(key);
    } catch (err) {
      if (!shouldRetry(attempt, maxRetries)) throw err;
      attempt += 1;
      const value = loader();
      cache.set(key, value);
      return value;
    }
  }
}

export { ReconnectableCache };
