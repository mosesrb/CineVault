const mongoose = require('mongoose');
const Joi = require('joi');

const episodeSchema = new mongoose.Schema({
    showId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TVShow',
        required: true
    },
    season: {
        type: Number,
        min: 1,
        required: true
    },
    episode: {
        type: Number,
        min: 1,
        required: true
    },
    title: {
        type: String,
        maxlength: 500,
        trim: true,
        default: ''
    },
    description: { type: String, default: '' },
    airDate: { type: Date },
    runtime: { type: Number, default: 0 },           // seconds

    // --- File Info ---
    vaultPath: { type: String, default: '', unique: true },         // relative inside vault
    originalSourcePath: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },           // bytes
    format: { type: String, default: '' },
    resolution: { type: String, default: '' },

    // --- Hash (Duplicate Detection) ---
    sparseHash: { type: String, default: '' },
    deepHash: { type: String, default: '' },

    // --- Metadata ---
    tmdbEpisodeId: { type: String, default: '' },
    stillUrl: { type: String, default: '' },          // episode thumbnail
    rating: { type: Number, min: 0, max: 10, default: 0 },

    addedAt: { type: Date, default: Date.now }
});

// Ensure no duplicate episodes for same show
episodeSchema.index({ showId: 1, season: 1, episode: 1 }, { unique: true });

const Episode = mongoose.model('Episode', episodeSchema);

function validateEpisode(ep) {
    const schema = {
        showId: Joi.objectId().required(),
        season: Joi.number().min(1).required(),
        episode: Joi.number().min(1).required(),
        title: Joi.string().max(500).allow(''),
        description: Joi.string().allow(''),
        airDate: Joi.date().allow(null),
        runtime: Joi.number().min(0),
        vaultPath: Joi.string().allow(''),
        originalSourcePath: Joi.string().allow(''),
        fileSize: Joi.number().min(0),
        format: Joi.string().allow(''),
        resolution: Joi.string().allow(''),
        sparseHash: Joi.string().allow(''),
        deepHash: Joi.string().allow(''),
        tmdbEpisodeId: Joi.string().allow(''),
        stillUrl: Joi.string().allow(''),
        rating: Joi.number().min(0).max(10)
    };
    return Joi.validate(ep, schema);
}

module.exports.Episode = Episode;
module.exports.validateEpisode = validateEpisode;
