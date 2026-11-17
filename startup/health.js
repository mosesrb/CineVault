const express = require('express');
const mongoose = require('mongoose');
const { getRedisStatus } = require('../middleware/cache');

async function readReadiness() {
    const redis = getRedisStatus();
    let databaseReady = false;
    if (mongoose.connection.readyState === 1) {
        try {
            await mongoose.connection.db.command({ ping: 1 });
            databaseReady = true;
        } catch (_) {
            databaseReady = false;
        }
    }
    const ready = databaseReady && (!redis.configured || redis.ready);
    return {
        status: ready ? 'ready' : 'not_ready',
        dependencies: {
            database: databaseReady ? 'ready' : 'not_ready',
            redis: redis.configured ? (redis.ready ? 'ready' : 'not_ready') : 'disabled'
        }
    };
}

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
        const result = await readReadiness();
        res.status(result.status === 'ready' ? 200 : 503).json(result);
    });

    return router;
}

module.exports = { createHealthRouter, readReadiness };
