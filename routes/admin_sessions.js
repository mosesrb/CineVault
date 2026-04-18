const express = require('express');
const router = express.Router();
const { Session } = require('../models/session');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

// GET /api/admin/sessions - List all active sessions (Admin only)
router.get('/', [auth, admin], async (req, res) => {
    const sessions = await Session.find()
        .populate('userId', 'name email')
        .sort('-lastActiveAt');
    res.send(sessions);
});

// DELETE /api/admin/sessions/:id - Revoke a session (Admin only)
router.get('/revoke/:id', [auth, admin], async (req, res) => {
    const session = await Session.findByIdAndDelete(req.params.id);
    if (!session) return res.status(404).send('Session not found.');
    res.send(session);
});

// GET /api/admin/sessions/clear - Revoke all sessions EXCEPT current (Admin only)
router.get('/clear', [auth, admin], async (req, res) => {
    const token = req.header('x-auth-token') || req.query.token;
    const result = await Session.deleteMany({ token: { $ne: token } });
    res.send({ count: result.deletedCount });
});

module.exports = router;
