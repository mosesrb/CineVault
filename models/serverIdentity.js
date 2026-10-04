const mongoose = require('mongoose');

const IDENTITY_KEY = 'primary';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const schema = new mongoose.Schema({
    _id: { type: String, enum: [IDENTITY_KEY], required: true },
    serverId: { type: String, match: UUID_V4, required: true, immutable: true },
    schemaVersion: { type: Number, enum: [1], required: true, immutable: true },
    name: { type: String, required: true, maxlength: 128 },
    createdAt: { type: Date, required: true, immutable: true }
}, { collection: 'server_identity', versionKey: false, strict: 'throw', autoCreate: false, autoIndex: false });

module.exports = {
    ServerIdentity: mongoose.model('ServerIdentity', schema),
    IDENTITY_KEY,
    UUID_V4
};
