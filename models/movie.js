const mongoose = require('mongoose');
const Joi = require('joi');

const castMemberSchema = new mongoose.Schema({
    name: { type: String, required: true },
    character: { type: String, default: '' },
    profileUrl: { type: String, default: '' },
    order: { type: Number, default: 0 }
});

const movieSchema = new mongoose.Schema({
    title: {
        type: String,
        minlength: 1,
        maxlength: 500,
        trim: true,
        required: true
    },
    year: {
        type: Number,
        min: 1888,
        max: 2100
    },
    type: {
        type: String,
        enum: ['movie'],
        default: 'movie'
    },
    genres: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Genre'
    }],

    // --- File Info ---
    vaultPath: {
        type: String,
        default: '',
        unique: true
    },
    originalSourcePath: {
        type: String,
        default: ''     // where it came from before ingest
    },
    fileSize: { type: Number, default: 0 },         // bytes
    format: { type: String, default: '' },           // e.g. 'mkv', 'mp4'
    resolution: { type: String, default: '' },       // e.g. '1080p', '4K'
    duration: { type: Number, default: 0 },          // seconds

    // --- Hash (Duplicate Detection) ---
    sparseHash: { type: String, default: '' },       // partial file hash (MD5)
    deepHash: { type: String, default: '' },         // full file hash (SHA-256)

    // --- Metadata (TMDB / manual) ---
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
    runtime: { type: Number, default: 0 },           // minutes (TMDB)
    cast: [castMemberSchema],
    director: { type: String, default: '' },
    releaseDate: { type: Date },

    // --- Sync Info ---
    metaSyncedAt: { type: Date },
    metaSource: {
        type: String,
        enum: ['tmdb', 'omdb', 'manual', 'none'],
        default: 'none'
    },

    addedAt: { type: Date, default: Date.now }
});

// Indexes for fast search
movieSchema.index({ title: 'text', description: 'text', director: 'text' });
movieSchema.index({ genres: 1 });
movieSchema.index({ year: 1 });

const Movie = mongoose.model('Movie', movieSchema);

function validateMovie(movie) {
    const schema = {
        title: Joi.string().min(1).max(500).required(),
        year: Joi.number().min(1888).max(2100),
        genreIds: Joi.array().items(Joi.objectId()),
        vaultPath: Joi.string().allow(''),
        originalSourcePath: Joi.string().allow(''),
        fileSize: Joi.number().min(0),
        format: Joi.string().allow(''),
        resolution: Joi.string().allow(''),
        duration: Joi.number().min(0),
        sparseHash: Joi.string().allow(''),
        deepHash: Joi.string().allow(''),
        runtime: Joi.number().min(0),
        tmdbId: Joi.string().allow(''),
        imdbId: Joi.string().allow(''),
        description: Joi.string().allow(''),
        tagline: Joi.string().allow(''),
        rating: Joi.number().min(0).max(10),
        posterUrl: Joi.string().allow(''),
        backdropUrl: Joi.string().allow(''),
        trailerUrl: Joi.string().allow(''),
        director: Joi.string().allow(''),
        releaseDate: Joi.date().allow(null),
        metaSource: Joi.string().valid('tmdb', 'omdb', 'manual', 'none')
    };
    return Joi.validate(movie, schema);
}

function validateMoviePatch(movie) {
    const schema = {
        title: Joi.string().min(1).max(500),
        year: Joi.number().min(1888).max(2100),
        genreIds: Joi.array().items(Joi.objectId()),
        description: Joi.string().allow(''),
        tagline: Joi.string().allow(''),
        rating: Joi.number().min(0).max(10),
        runtime: Joi.number().min(0),
        posterUrl: Joi.string().allow(''),
        backdropUrl: Joi.string().allow(''),
        trailerUrl: Joi.string().allow(''),
        director: Joi.string().allow(''),
        releaseDate: Joi.date().allow(null),
    };
    return Joi.validate(movie, schema);
}

module.exports.Movie = Movie;
module.exports.validateMovie = validateMovie;
module.exports.validateMoviePatch = validateMoviePatch;
