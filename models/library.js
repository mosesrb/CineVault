const mongoose = require('mongoose');
const Joi = require('joi');

const librarySchema = new mongoose.Schema({
    // Only one library config document should exist
    vaultRootPath: {
        type: String,
        required: true,
        trim: true
    },
    inboxPath: {
        type: String,
        trim: true,
        default: ''     // If empty, defaults to vaultRootPath + '/Inbox'
    },
    // Stats (updated on scan)
    totalMovies: { type: Number, default: 0 },
    totalShows: { type: Number, default: 0 },
    totalEpisodes: { type: Number, default: 0 },
    totalSizeBytes: { type: Number, default: 0 },
    lastScannedAt: { type: Date },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Library = mongoose.model('Library', librarySchema);

function validateLibraryConfig(config) {
    const schema = {
        vaultRootPath: Joi.string().min(1).required(),
        inboxPath: Joi.string().allow('')
    };
    return Joi.validate(config, schema);
}

module.exports.Library = Library;
module.exports.validateLibraryConfig = validateLibraryConfig;
