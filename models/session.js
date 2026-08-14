const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    token: {
        type: String,
        required: true,
        index: true
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
});

// 30-day automatic session TTL index
sessionSchema.index({ lastActiveAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const Session = mongoose.model('Session', sessionSchema);

exports.Session = Session;
