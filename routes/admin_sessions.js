const express = require('express');
const router = express.Router();
const { Session } = require('../models/session');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

function extractCurrentToken(req) {
    let token = req.header('x-auth-token');
    const authHeader = req.header('Authorization');
    if (!token && authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }
    if (!token && req.query.token) {
        token = req.query.token;
    }
    return token;
}

// GET /api/admin/sessions - List all active sessions (Admin only)
router.get('/', [auth, admin], async (req, res) => {
    const sessions = await Session.find()
        .populate('userId', 'name email')
        .sort('-lastActiveAt');
    res.send(sessions);
});

// DELETE /api/admin/sessions/:id - Revoke a session (Admin only)
router.delete('/:id', [auth, admin], async (req, res) => {
    const session = await Session.findByIdAndDelete(req.params.id);
    if (!session) return res.status(404).send('Session not found.');
    res.send(session);
});

// Backward compatibility alias for revoke
router.get('/revoke/:id', [auth, admin], async (req, res) => {
    const session = await Session.findByIdAndDelete(req.params.id);
    if (!session) return res.status(404).send('Session not found.');
    res.send(session);
});

// POST /api/admin/sessions/clear - Revoke all sessions EXCEPT current (Admin only)
router.post('/clear', [auth, admin], async (req, res) => {
    const currentToken = extractCurrentToken(req);
    const filter = currentToken ? { token: { $ne: currentToken } } : {};
    const result = await Session.deleteMany(filter);
    res.send({ count: result.deletedCount });
});

// Backward compatibility alias for clear
router.get('/clear', [auth, admin], async (req, res) => {
    const currentToken = extractCurrentToken(req);
    const filter = currentToken ? { token: { $ne: currentToken } } : {};
    const result = await Session.deleteMany(filter);
    res.send({ count: result.deletedCount });
});

module.exports = router;
