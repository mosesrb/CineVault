const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const genreGuard = require('../middleware/genreGuard');
const validateObjectId = require('../middleware/validateObjectId');

const { Movie, validateMovie, validateMoviePatch } = require('../models/movie');
const { Genre } = require('../models/genre');
const { fetchMetadata, searchTMDB, fetchMetadataById } = require('../services/metadataService');
const { deleteVaultFile } = require('../services/vaultService');

// ─── HELPERS ────────────────────────────────────────────────
async function ensureGenres(genreNames) {
    if (!genreNames || !genreNames.length) return [];
    const genreIds = [];
    for (const name of genreNames) {
        let genre = await Genre.findOne({ name: new RegExp(`^${name}$`, 'i') });
        if (!genre) {
            genre = new Genre({ name });
            await genre.save();
        }
        genreIds.push(genre._id);
    }
    return genreIds;
}

// ─── GET /api/movies ─────────────────────────────────────────
// Browse all movies with optional filters (genre, search, year, rating, duration, watched)
// genreGuard automatically filters by user's allowedGenres
router.get('/', [auth, genreGuard], async (req, res) => {
    const filter = {};

    if (req.query.genre) {
        const g = await Genre.findOne({ slug: req.query.genre });
        if (g) {
            if (req.genreFilter) {
                const allowed = req.genreFilter.some(id => id.toString() === g._id.toString());
                filter.genres = allowed ? g._id : new mongoose.Types.ObjectId();
            } else {
                filter.genres = g._id;
            }
        }
    } else if (req.genreFilter) {
        filter.genres = { $in: req.genreFilter };
    }

    if (req.query.year)      filter.year = parseInt(req.query.year, 10);
    if (req.query.q)         filter.$text = { $search: req.query.q };
    if (req.query.minRating) filter.rating = { ...filter.rating, $gte: parseFloat(req.query.minRating) };
    if (req.query.maxDuration) filter.duration = { $lte: parseInt(req.query.maxDuration, 10) };
    if (req.query.minYear)   filter.year = { ...filter.year, $gte: parseInt(req.query.minYear, 10) };
    if (req.query.maxYear)   filter.year = { ...filter.year, $lte: parseInt(req.query.maxYear, 10) };

    // Watched/unwatched filter (requires matching against user's watch history)
    if (req.query.watched === 'watched' || req.query.watched === 'unwatched') {
        const { User } = require('../models/user');
        const user = await User.findById(req.user._id).select('watchHistory');
        const watchedIds = (user.watchHistory || [])
            .filter(h => h.mediaType === 'movie' && h.progressSeconds > 30)
            .map(h => h.mediaId.toString());
        if (req.query.watched === 'watched') {
            filter._id = { $in: watchedIds.map(id => new mongoose.Types.ObjectId(id)) };
        } else {
            filter._id = { $nin: watchedIds.map(id => new mongoose.Types.ObjectId(id)) };
        }
    }

    const movies = await Movie.find(filter)
        .select('-cast -originalSourcePath')
        .populate('genres', 'name slug')
        .sort({ addedAt: -1 });

    res.send(movies);
});

// ─── GET /api/movies/search-tmdb ──────────────────────────────
// Admin: search for media identities on TMDB
// Must be ABOVE /:id to prevent being caught as a parameter
router.get('/search-tmdb', [auth, admin], async (req, res) => {
    if (!req.query.q) return res.status(400).send('Search query is required.');
    const type = req.query.type || 'movie';
    const results = await searchTMDB(req.query.q, type);
    res.send(results);
});

// ─── GET /api/movies/conflicts ────────────────────────────────
// Admin: fetch movies that require manual metadata confirmation
router.get('/conflicts', [auth, admin], async (req, res) => {
    const conflicts = await Movie.find({ isConflict: true }).sort({ addedAt: -1 });
    res.send(conflicts);
});

// ─── GET /api/movies/:id ─────────────────────────────────────
router.get('/:id', [auth, genreGuard, validateObjectId], async (req, res) => {
    const movie = await Movie.findById(req.params.id).populate('genres', 'name slug');
    if (!movie) return res.status(404).send('Movie not found.');

    // Check genre restriction
    if (req.genreFilter) {
        const allowed = movie.genres.some(g =>
            req.genreFilter.some(id => id.toString() === g._id.toString())
        );
        if (!allowed) return res.status(403).send('Access restricted to this content.');
    }

    // Inject user-specific progress
    const { User } = require('../models/user');
    const user = await User.findById(req.user._id).select('watchHistory');
    const historyItem = user.watchHistory.find(h => h.mediaId.toString() === movie._id.toString());
    
    const movieObj = movie.toObject();
    movieObj.userProgress = historyItem ? {
        progressSeconds: historyItem.progressSeconds || 0,
        completed: historyItem.completed || false,
        watchedAt: historyItem.watchedAt
    } : null;

    const { findSidecarFile } = require('../services/vaultService');
    const subPath = await findSidecarFile(movie.vaultPath);
    movieObj.hasSidecarSubtitles = !!subPath;

    res.send(movieObj);
});

// ─── POST /api/movies ─────────────────────────────────────────
// Admin: add a movie manually
router.post('/', [auth, admin], async (req, res) => {
    const { error } = validateMovie(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    const existing = await Movie.findOne({ title: req.body.title, year: req.body.year });
    if (existing) return res.status(409).send('A movie with this title and year already exists.');

    const genres = req.body.genreIds
        ? await Genre.find({ _id: { $in: req.body.genreIds } })
        : [];

    const movie = new Movie({
        title: req.body.title,
        year: req.body.year,
        genres: genres.map(g => g._id),
        vaultPath: req.body.vaultPath || '',
        originalSourcePath: req.body.originalSourcePath || '',
        fileSize: req.body.fileSize || 0,
        format: req.body.format || '',
        resolution: req.body.resolution || '',
        duration: req.body.duration || 0,
        description: req.body.description || '',
        posterUrl: req.body.posterUrl || '',
        backdropUrl: req.body.backdropUrl || '',
        trailerUrl: req.body.trailerUrl || '',
        director: req.body.director || '',
        rating: req.body.rating || 0,
        metaSource: req.body.metaSource || 'manual'
    });

    await movie.save();
    res.status(201).send(movie);
});

// ─── PUT /api/movies/:id ─────────────────────────────────────
// Admin: update movie metadata
router.put('/:id', [auth, admin, validateObjectId], async (req, res) => {
    const { error } = validateMoviePatch(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    const update = { ...req.body };
    if (req.body.genreIds) {
        const genres = await Genre.find({ _id: { $in: req.body.genreIds } });
        update.genres = genres.map(g => g._id);
        delete update.genreIds;
    }

    const movie = await Movie.findByIdAndUpdate(
        req.params.id,
        { $set: update },
        { new: true }
    ).populate('genres', 'name slug');

    if (!movie) return res.status(404).send('Movie not found.');
    res.send(movie);
});

// ─── DELETE /api/movies/:id ───────────────────────────────────
// Admin: remove movie from library (optionally delete physical file)
router.delete('/:id', [auth, admin, validateObjectId], async (req, res) => {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).send('Movie not found.');

    const deletePhysical = req.query.deleteFile === 'true';
    let fileDeleted = false;

    if (deletePhysical && movie.vaultPath) {
        try {
            fileDeleted = await deleteVaultFile(movie.vaultPath);
        } catch (err) {
            console.error(`Failed to delete file: ${movie.vaultPath}`, err);
            // We continue with DB deletion even if file delete fails (maybe it was already gone)
        }
    }

    await Movie.findByIdAndDelete(req.params.id);
    res.send({ message: 'Movie removed.', fileDeleted });
});

// ─── POST /api/movies/:id/sync ────────────────────────────────
// Admin: re-fetch metadata from TMDB for this movie
router.post('/:id/sync', [auth, admin, validateObjectId], async (req, res) => {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).send('Movie not found.');

    const meta = await fetchMetadata(movie.title, movie.year, 'movie');
    
    // Fix: Convert genre strings to ObjectIds
    const genreIds = await ensureGenres(meta.genres);

    const updated = await Movie.findByIdAndUpdate(
        req.params.id,
        { $set: { ...meta, genres: genreIds, metaSyncedAt: new Date() } },
        { new: true }
    ).populate('genres', 'name slug');

    res.send(updated);
});



// ─── POST /api/movies/:id/link ───────────────────────────────
// Admin: link a movie to a specific TMDB ID
router.post('/:id/link', [auth, admin, validateObjectId], async (req, res) => {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).send('Movie not found.');

    const tmdbId = req.body.tmdbId;
    if (!tmdbId) return res.status(400).send('tmdbId is required.');

    const meta = await fetchMetadataById(tmdbId, 'movie');
    if (!meta || meta.metaSource === 'none') {
        return res.status(422).send('Could not fetch metadata for this TMDB ID.');
    }

    const genreIds = await ensureGenres(meta.genres);
    const updated = await Movie.findByIdAndUpdate(
        req.params.id,
        { 
            $set: { 
                ...meta, 
                genres: genreIds,
                isConflict: false,
                conflictOptions: []
            } 
        },
        { new: true }
    ).populate('genres', 'name slug');

    res.send(updated);
});

module.exports = router;