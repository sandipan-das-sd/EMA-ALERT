import { createClient } from 'redis';

class RedisService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.enabled = process.env.REDIS_ENABLED === 'true';
    this.lastErrorLogAt = 0;
    this.lastReconnectLogAt = 0;
  }

  async connect() {
    if (!this.enabled) {
      console.log('[Redis] Disabled via REDIS_ENABLED=false');
      return false;
    }

    if (this.connected) {
      return true;
    }

    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      const maxRetries = (() => {
        const v = parseInt(process.env.REDIS_MAX_RETRIES, 10);
        return Number.isFinite(v) && v >= 0 ? v : 6;
      })();

      this.client = createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries >= maxRetries) {
              return new Error(`Redis reconnect limit reached (${maxRetries}). Falling back to in-memory.`);
            }
            return Math.min(200 * Math.pow(2, retries), 5000);
          },
        },
      });

      this.client.on('error', (err) => {
        const now = Date.now();
        if (now - this.lastErrorLogAt > 60_000) {
          console.error('[Redis] Connection error:', err.message);
          this.lastErrorLogAt = now;
        }
        this.connected = false;
      });

      this.client.on('reconnecting', () => {
        const now = Date.now();
        if (now - this.lastReconnectLogAt > 60_000) {
          console.log('[Redis] Reconnecting...');
          this.lastReconnectLogAt = now;
        }
      });

      await this.client.connect();
      this.connected = true;
      console.log(`[Redis] ✓ Connected to ${process.env.REDIS_URL || 'localhost'}`);
      return true;
    } catch (error) {
      console.warn('[Redis] Connection failed:', error.message);
      this.connected = false;
      return false;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      this.connected = false;
    }
  }

  /**
   * Set a key with TTL expiry
   * @param {string} key - Redis key
   * @param {string} value - Value to store
   * @param {number} ttlSeconds - Time to live in seconds
   */
  async setWithTTL(key, value, ttlSeconds) {
    if (!this.connected) {
      return false;
    }

    try {
      await this.client.setEx(key, ttlSeconds, value);
      return true;
    } catch (err) {
      console.error('[Redis] setWithTTL error:', err.message);
      return false;
    }
  }

  /**
   * Get a key value
   */
  async get(key) {
    if (!this.connected) {
      return null;
    }

    try {
      return await this.client.get(key);
    } catch (err) {
      console.error('[Redis] get error:', err.message);
      return null;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    if (!this.connected) {
      return false;
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (err) {
      console.error('[Redis] exists error:', err.message);
      return false;
    }
  }

  /**
   * Delete a key
   */
  async delete(key) {
    if (!this.connected) {
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (err) {
      console.error('[Redis] delete error:', err.message);
      return false;
    }
  }

  /**
   * Get remaining TTL for a key (in seconds)
   */
  async getTTL(key) {
    if (!this.connected) {
      return -1;
    }

    try {
      return await this.client.ttl(key);
    } catch (err) {
      console.error('[Redis] getTTL error:', err.message);
      return -1;
    }
  }

  /**
   * Increment a counter
   */
  async increment(key) {
    if (!this.connected) {
      return 0;
    }

    try {
      return await this.client.incr(key);
    } catch (err) {
      console.error('[Redis] increment error:', err.message);
      return 0;
    }
  }

  /**
   * Check if Redis is available
   */
  isConnected() {
    return this.connected && this.client?.isOpen;
  }
}

// Singleton instance
let redisServiceInstance = null;

export function getRedisService() {
  if (!redisServiceInstance) {
    redisServiceInstance = new RedisService();
  }
  return redisServiceInstance;
}
