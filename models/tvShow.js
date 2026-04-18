const mongoose = require('mongoose');
const Joi = require('joi');

const castMemberSchema = new mongoose.Schema({
    name: { type: String, required: true },
    character: { type: String, default: '' },
    profileUrl: { type: String, default: '' },
    order: { type: Number, default: 0 }
});

const tvShowSchema = new mongoose.Schema({
    title: {
        type: String,
        minlength: 1,
        maxlength: 500,
        trim: true,
        required: true
    },
    year: { type: Number, min: 1888, max: 2100 },
    type: {
        type: String,
        enum: ['tvshow'],
        default: 'tvshow'
    },
    genres: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Genre'
    }],
    status: {
        type: String,
        enum: ['ongoing', 'ended', 'cancelled', 'unknown'],
        default: 'unknown'
    },
    totalSeasons: { type: Number, default: 0 },
    totalEpisodes: { type: Number, default: 0 },

    // --- Metadata (TMDB / manual) ---
    isConflict: { type: Boolean, default: false },
    conflictOptions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    tmdbId: { type: String, default: '' },
    imdbId: { type: String, default: '' },
    description: { type: String, default: '' },
    tagline: { type: String, default: '' },
    rating: { type: Number, min: 0, max: 10, default: 0 },
    posterUrl: { type: String, default: '' },
    backdropUrl: { type: String, default: '' },
    images: { type: [String], default: [] },
    facts: { type: mongoose.Schema.Types.Mixed, default: {} },
    trailerUrl: { type: String, default: '' },
    runtime: { type: Number, default: 0 },           // average episode runtime (TMDB)
    cast: [castMemberSchema],
    network: { type: String, default: '' },
    firstAirDate: { type: Date },
    lastAirDate: { type: Date },

    // --- Sync Info ---
    metaSyncedAt: { type: Date },
    metaSource: {
        type: String,
        enum: ['tmdb', 'omdb', 'manual', 'none'],
        default: 'none'
    },

    addedAt: { type: Date, default: Date.now }
});

tvShowSchema.index({ title: 'text', description: 'text' });
tvShowSchema.index({ genres: 1 });

const TVShow = mongoose.model('TVShow', tvShowSchema);

function validateTVShow(show) {
    const schema = {
        title: Joi.string().min(1).max(500).required(),
        year: Joi.number().min(1888).max(2100),
        genreIds: Joi.array().items(Joi.objectId()),
        status: Joi.string().valid('ongoing', 'ended', 'cancelled', 'unknown'),
        totalSeasons: Joi.number().min(0),
        tmdbId: Joi.string().allow(''),
        imdbId: Joi.string().allow(''),
        description: Joi.string().allow(''),
        tagline: Joi.string().allow(''),
        rating: Joi.number().min(0).max(10),
        posterUrl: Joi.string().allow(''),
        backdropUrl: Joi.string().allow(''),
        trailerUrl: Joi.string().allow(''),
        runtime: Joi.number().min(0),
        network: Joi.string().allow(''),
        firstAirDate: Joi.date().allow(null),
        lastAirDate: Joi.date().allow(null),
        metaSource: Joi.string().valid('tmdb', 'omdb', 'manual', 'none'),
        isConflict: Joi.boolean(),
        conflictOptions: Joi.array().items(Joi.any())
    };
    return Joi.validate(show, schema);
}

function validateTVShowPatch(show) {
    const schema = {
        title: Joi.string().min(1).max(500),
        year: Joi.number().min(1888).max(2100),
        genreIds: Joi.array().items(Joi.objectId()),
        status: Joi.string().valid('ongoing', 'ended', 'cancelled', 'unknown'),
        totalSeasons: Joi.number().min(0),
        tmdbId: Joi.string().allow(''),
        imdbId: Joi.string().allow(''),
        description: Joi.string().allow(''),
        tagline: Joi.string().allow(''),
        rating: Joi.number().min(0).max(10),
        posterUrl: Joi.string().allow(''),
        backdropUrl: Joi.string().allow(''),
        trailerUrl: Joi.string().allow(''),
        runtime: Joi.number().min(0),
        network: Joi.string().allow(''),
        firstAirDate: Joi.date().allow(null),
        lastAirDate: Joi.date().allow(null),
        isConflict: Joi.boolean(),
        conflictOptions: Joi.array().items(Joi.any()),
        metaSource: Joi.string().valid('tmdb', 'omdb', 'manual', 'none')
    };
    return Joi.validate(show, schema);
}

module.exports.TVShow = TVShow;
module.exports.validateTVShow = validateTVShow;
module.exports.validateTVShowPatch = validateTVShowPatch;
