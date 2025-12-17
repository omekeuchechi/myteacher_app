const redisClient = require('../config/redis');

const cacheMiddleware = (ttl = 3600, keyGenerator = null) => {
  return async (req, res, next) => {
    if (!redisClient.isRedisConnected()) {
      return next();
    }

    try {
      const cacheKey = keyGenerator 
        ? keyGenerator(req)
        : `${req.method}:${req.originalUrl}:${JSON.stringify(req.query)}`;

      const cachedData = await redisClient.get(cacheKey);
      
      if (cachedData) {
        console.log(`Cache hit for key: ${cacheKey}`);
        return res.json(cachedData);
      }

      console.log(`Cache miss for key: ${cacheKey}`);
      
      const originalJson = res.json;
      res.json = function(data) {
        if (res.statusCode === 200) {
          redisClient.set(cacheKey, data, ttl).catch(err => {
            console.error('Failed to set cache:', err);
          });
        }
        return originalJson.call(this, data);
      };

      next();
    } catch (error) {
      console.error('Cache middleware error:', error);
      next();
    }
  };
};

const invalidateCache = (pattern) => {
  return async (req, res, next) => {
    try {
      if (redisClient.isRedisConnected()) {
        await redisClient.delPattern(pattern);
        console.log(`Cache invalidated for pattern: ${pattern}`);
      }
    } catch (error) {
      console.error('Cache invalidation error:', error);
    }
    next();
  };
};

const invalidateCacheByKey = (keyGenerator) => {
  return async (req, res, next) => {
    try {
      if (redisClient.isRedisConnected()) {
        const key = keyGenerator(req);
        await redisClient.del(key);
        console.log(`Cache invalidated for key: ${key}`);
      }
    } catch (error) {
      console.error('Cache invalidation error:', error);
    }
    next();
  };
};

module.exports = {
  cacheMiddleware,
  invalidateCache,
  invalidateCacheByKey
};
