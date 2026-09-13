const mongoose = require('mongoose');
const crypto = require('crypto');

function hashSessionToken(token) {
    if (typeof token !== 'string' || !token) return undefined;
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function removeSecrets(_doc, ret) {
    delete ret.token;
    delete ret.tokenDigest;
    return ret;
}

const sessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    token: {
        type: String,
        select: false
    },
    tokenDigest: {
        type: String,
        index: true,
        select: false
    },
    ip: String,
    userAgent: String,
    device: {
        browser: String,
        os: String,
        platform: String,
        isMobile: Boolean
    },
    lastActiveAt: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    toJSON: { transform: removeSecrets },
    toObject: { transform: removeSecrets }
});

// Transitional compatibility: convert newly supplied plaintext tokens before
// persistence. Existing plaintext records are upgraded opportunistically by
// the auth middleware and can later be covered by the versioned migration.
sessionSchema.pre('validate', function (next) {
    if (!this.tokenDigest && this.token) {
        this.tokenDigest = hashSessionToken(this.token);
        this.token = undefined;
    }
    if (!this.tokenDigest) {
        return next(new Error('Session token digest is required.'));
    }
    next();
});

// 30-day automatic session TTL index
sessionSchema.index({ lastActiveAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const Session = mongoose.model('Session', sessionSchema);

exports.Session = Session;
exports.hashSessionToken = hashSessionToken;
