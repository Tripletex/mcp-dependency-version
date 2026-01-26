/**
 * Simple in-memory cache with TTL support
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class Cache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private defaultTtlMs: number;

  /**
   * Create a new cache instance
   * @param defaultTtlMs Default time-to-live in milliseconds (default: 5 minutes)
   */
  constructor(defaultTtlMs: number = 5 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Get a value from the cache
   */
  get(key: string): T | undefined {
    const entry = this.store.get(key);

    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a value in the cache
   * @param key Cache key
   * @param value Value to store
   * @param ttlMs Optional TTL override in milliseconds
   */
  set(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a key from the cache
   */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the number of entries in the cache (including expired)
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Remove all expired entries
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Get a value or compute it if missing/expired
   */
  async getOrSet(
    key: string,
    compute: () => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    const existing = this.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const value = await compute();
    this.set(key, value, ttlMs);
    return value;
  }
}

// Shared cache instances for different data types
export const versionCache = new Cache<unknown>(5 * 60 * 1000); // 5 minutes
export const vulnerabilityCache = new Cache<unknown>(15 * 60 * 1000); // 15 minutes
