const express = require('express');
const mongoose = require('mongoose');
const { getRedisStatus } = require('../middleware/cache');

function createHealthRouter() {
    const router = express.Router();

    router.get('/live', (_req, res) => {
        res.json({
            status: 'live',
            uptimeSeconds: Math.floor(process.uptime()),
            version: require('../package.json').version
        });
    });

    router.get('/ready', async (_req, res) => {
        const redis = getRedisStatus();
        const databaseConnected = mongoose.connection.readyState === 1;
        let databaseReady = false;

        if (databaseConnected) {
            try {
                await mongoose.connection.db.command({ ping: 1 });
                databaseReady = true;
            } catch (_) {
                databaseReady = false;
            }
        }

        const redisReady = !redis.configured || redis.ready;
        const ready = databaseReady && redisReady;
        res.status(ready ? 200 : 503).json({
            status: ready ? 'ready' : 'not_ready',
            dependencies: {
                database: databaseReady ? 'ready' : 'not_ready',
                redis: redis.configured ? (redis.ready ? 'ready' : 'not_ready') : 'disabled'
            }
        });
    });

    return router;
}

module.exports = { createHealthRouter };
