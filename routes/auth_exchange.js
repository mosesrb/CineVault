const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('config');
const { randomUUID } = require('node:crypto');
const { configuration } = require('../services/controlPlane/configuration');
const { readServerIdentity } = require('../services/serverIdentityService');
const { verifyCloudMembership, ExchangeFailure } = require('../services/supabaseExchangeAuthority');
const { findCloudLinkedUser, matchesCloudLinkedUser, isLocalExchangeRequest } = require('../services/cloudIdentityLink');
const { createSessionForRequest } = require('../services/sessionService');
const auth = require('../middleware/auth');
const { loadAuthoritativeUser } = auth;
const { Session } = require('../models/session');

const router = express.Router();
const sessionLifetimeSeconds = 300;

router.get('/config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const settings = configuration();
    if (!isLocalExchangeRequest(req) || settings.mode !== 'ready') return res.sendStatus(404);
    return res.json({ publishableKey: settings.publishableKey });
});

router.post('/logout', auth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.auth?.cloudBinding) return res.sendStatus(403);
    try {
        await Session.deleteOne({ _id: req.auth.sessionId, userId: req.user._id });
        return res.sendStatus(204);
    } catch {
        return res.sendStatus(503);
    }
});

router.post('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isLocalExchangeRequest(req)) return res.sendStatus(404);
    if (Object.keys(req.query).length || req.get('transfer-encoding') ||
        (req.get('content-length') && req.get('content-length') !== '0')) {
        return res.sendStatus(400);
    }
    const bearer = /^Bearer ([\w.-]{1,8192})$/i.exec(req.get('authorization') || '');
    if (!bearer || req.get('x-auth-token')) return res.sendStatus(401);
    const settings = configuration();
    if (settings.mode !== 'ready') return res.sendStatus(503);

    try {
        const { serverId } = await readServerIdentity();
        const cloud = await verifyCloudMembership({
            token: bearer[1],
            serverInstanceId: serverId,
            publishableKey: settings.publishableKey,
            allowPasswordChangeRequired: true
        });
        const cloudBinding = {
            subject: cloud.subject, serverInstanceId: serverId, downloadAllowed: cloud.downloadAllowed
        };
        const link = await findCloudLinkedUser(cloudBinding);
        if (!link) return res.sendStatus(403);
        cloudBinding.generation = link.identityLinkBackup.generation;
        const current = await loadAuthoritativeUser(link._id);
        if (!current.user) return res.sendStatus(403);
        if (cloud.mustChangePassword) {
            return res.status(403).json({ error: 'password_change_required' });
        }

        const now = Math.floor(Date.now() / 1000);
        const expiresAt = Math.min(now + sessionLifetimeSeconds, cloud.expiresAt);
        if (expiresAt <= now) return res.sendStatus(401);
        const token = jwt.sign({
            _id: String(link._id), tokenType: 'access', cloudBinding, iat: now, exp: expiresAt,
            sessionGeneration: current.user.sessionGeneration
        }, config.get('jwtPrivateKey'), {
            algorithm: 'HS256', issuer: 'cinevault', audience: 'cinevault-api', jwtid: randomUUID()
        });
        const session = await createSessionForRequest(current.user, token, req, { cloudLinkGeneration: cloudBinding.generation });
        let issueSession = false;
        try {
            // Unlink removes the binding before deleting its sessions. A save that
            // lands after that cleanup must remove its own row before responding.
            issueSession = await matchesCloudLinkedUser(String(link._id), cloudBinding) &&
                Math.floor(Date.now() / 1000) < expiresAt;
        } finally {
            if (!issueSession) await Session.deleteOne({ _id: session._id, userId: link._id,
                cloudLinkGeneration: cloudBinding.generation });
        }
        return issueSession ? res.json({ token, expiresAt }) : res.sendStatus(401);
    } catch (error) {
        return res.sendStatus(error instanceof ExchangeFailure ? error.status : 503);
    }
});

module.exports = router;
