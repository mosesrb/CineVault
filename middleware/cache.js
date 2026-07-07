const { createClient } = require('redis');

// Initialize Redis client
let redisClient = null;
let isRedisConnected = false;

async function initRedis() {
    if (!process.env.REDIS_URL && process.env.NODE_ENV !== 'test') {
        console.log('No REDIS_URL provided, caching disabled.');
        return;
    }

    // In test environment, skip redis initialization
    if (process.env.NODE_ENV === 'test') {
        return;
    }

    try {
        redisClient = createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379'
        });

        redisClient.on('error', (err) => console.error('Redis Client Error', err));
        redisClient.on('connect', () => console.log('Redis Client Connected'));
        redisClient.on('ready', () => {
            isRedisConnected = true;
            console.log('Redis is ready to accept commands');
        });

        await redisClient.connect();
    } catch (ex) {
        console.error('Failed to connect to Redis', ex);
    }
}

initRedis();

/**
 * Middleware to cache API responses
 * @param {number} duration - Time to live in seconds (default 3600 = 1 hour)
 */
function cache(duration = 3600) {
    return async (req, res, next) => {
        // Only cache GET requests
        if (req.method !== 'GET') {
            return next();
        }

        // If Redis isn't connected or we're testing, skip caching
        if (!isRedisConnected || process.env.NODE_ENV === 'test') {
            return next();
        }

        // Create a unique key based on the URL and user ID (if auth is present)
        // Note: For routes like /api/v1/movies, the response depends on req.genreFilter which is user specific.
        // So we include user._id in the cache key if it exists.
        const userPart = req.user ? `_user:${req.user._id}` : '';
        const key = `__express__${req.originalUrl || req.url}${userPart}`;

        try {
            const cachedResponse = await redisClient.get(key);
            if (cachedResponse) {
                // Send cached response
                res.setHeader('X-Cache', 'HIT');
                res.setHeader('Content-Type', 'application/json');
                return res.send(cachedResponse);
            }

            // Cache MISS - Override res.send to intercept the response
            res.setHeader('X-Cache', 'MISS');
            const originalSend = res.send;
            res.send = function (body) {
                // Only cache successful JSON responses
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    // Stringify if it's an object, otherwise save as is
                    const content = typeof body === 'object' ? JSON.stringify(body) : body;
                    redisClient.setEx(key, duration, content).catch(err => {
                        console.error('Redis setEx error:', err);
                    });
                }
                originalSend.call(this, body);
            };

            next();
        } catch (err) {
            console.error('Redis cache error:', err);
            next();
        }
    };
}

/**
 * Function to clear cache by a pattern
 * @param {string} pattern - Redis key pattern (e.g., *movies*)
 */
async function clearCache(pattern) {
    if (!isRedisConnected || process.env.NODE_ENV === 'test') return;
    
    try {
        const keys = await redisClient.keys(`*${pattern}*`);
        if (keys.length > 0) {
            await redisClient.del(keys);
            console.log(`Cleared ${keys.length} cache keys for pattern: ${pattern}`);
        }
    } catch (err) {
        console.error(`Error clearing cache for ${pattern}:`, err);
    }
}

module.exports = {
    cache,
    clearCache
};
