const redis = require('redis');

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.redisDisabled = process.env.REDIS_DISABLED === 'true';
  }

  async connect() {
    if (this.redisDisabled) {
      console.log('Redis is disabled by environment variable');
      return null;
    }

    try {
      this.client = redis.createClient({
        socket: {
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT,
        },
        password: process.env.REDIS_PASSWORD || undefined,
        database: process.env.REDIS_DB,
      });

      this.client.on('error', (err) => {
        console.warn('Redis Client Error (Redis disabled):', err.message);
        this.isConnected = false;
        this.redisDisabled = true;
      });

      this.client.on('connect', () => {
        console.log('Redis Client Connected');
        this.isConnected = true;
      });

      this.client.on('ready', () => {
        console.log('Redis Client Ready');
        this.isConnected = true;
        this.redisDisabled = false;
      });

      this.client.on('end', () => {
        console.log('Redis Client Disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
      this.isConnected = true;
      this.redisDisabled = false;
      return this.client;
    } catch (error) {
      console.warn('Failed to connect to Redis, continuing without cache:', error.message);
      this.redisDisabled = true;
      this.isConnected = false;
      return null;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.disconnect();
    }
  }

  async set(key, value, ttl = 3600) {
    if (this.redisDisabled || !this.isConnected) {
      return false;
    }
    
    try {
      const serializedValue = JSON.stringify(value);
      await this.client.setEx(key, ttl, serializedValue);
      return true;
    } catch (error) {
      console.warn('Redis set error:', error.message);
      return false;
    }
  }

  async get(key) {
    if (this.redisDisabled || !this.isConnected) {
      return null;
    }
    
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.warn('Redis get error:', error.message);
      return null;
    }
  }

  async del(key) {
    if (this.redisDisabled || !this.isConnected) {
      return false;
    }
    
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.warn('Redis delete error:', error.message);
      return false;
    }
  }

  async delPattern(pattern) {
    if (this.redisDisabled || !this.isConnected) {
      return false;
    }
    
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    } catch (error) {
      console.warn('Redis pattern delete error:', error.message);
      return false;
    }
  }

  async exists(key) {
    if (this.redisDisabled || !this.isConnected) {
      return false;
    }
    
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.warn('Redis exists error:', error.message);
      return false;
    }
  }

  getClient() {
    return this.client;
  }

  isRedisConnected() {
    return this.isConnected && !this.redisDisabled;
  }
}

const redisClient = new RedisClient();

module.exports = redisClient;
