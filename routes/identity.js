const express = require('express');
const { readServerIdentity } = require('../services/serverIdentityService');
const router = express.Router();

// Public and intentionally minimal: no account, endpoint, host or key material.
// Reads never create an identity; startup owns initialization.
router.get('/', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        res.json(await readServerIdentity());
    } catch {
        res.status(503).json({ error: 'Server identity unavailable.' });
    }
});

module.exports = router;
