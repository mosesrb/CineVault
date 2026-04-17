const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const genreGuard = require('../middleware/genreGuard');
const validateObjectId = require('../middleware/validateObjectId');

const { TVShow, validateTVShow } = require('../models/tvShow');
const { Episode, validateEpisode } = require('../models/episode');
const { Genre } = require('../models/genre');
const { fetchMetadata } = require('../services/metadataService');
const { deleteVaultFile } = require('../services/vaultService');

// ─── TV SHOWS ─────────────────────────────────────────────────

// GET /api/tvshows
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
    if (req.query.status)    filter.status = req.query.status;
    if (req.query.q)         filter.$text = { $search: req.query.q };
    if (req.query.minRating) filter.rating = { $gte: parseFloat(req.query.minRating) };
    if (req.query.minYear)   filter.year   = { ...filter.year, $gte: parseInt(req.query.minYear, 10) };
    if (req.query.maxYear)   filter.year   = { ...filter.year, $lte: parseInt(req.query.maxYear, 10) };

    // Watched/unwatched filter
    if (req.query.watched === 'watched' || req.query.watched === 'unwatched') {
        const { User } = require('../models/user');
        const user = await User.findById(req.user._id).select('watchHistory');
        const watchedIds = (user.watchHistory || [])
            .filter(h => h.mediaType === 'tvshow' && h.progressSeconds > 30)
            .map(h => h.mediaId.toString());
        if (req.query.watched === 'watched') {
            filter._id = { $in: watchedIds.map(id => new mongoose.Types.ObjectId(id)) };
        } else {
            filter._id = { $nin: watchedIds.map(id => new mongoose.Types.ObjectId(id)) };
        }
    }

    const shows = await TVShow.find(filter)
        .select('-cast -originalSourcePath')
        .populate('genres', 'name slug')
        .sort({ addedAt: -1 });

    res.send(shows);
});

// GET /api/tvshows/:id
router.get('/:id', [auth, genreGuard, validateObjectId], async (req, res) => {
    const show = await TVShow.findById(req.params.id).populate('genres', 'name slug');
    if (!show) return res.status(404).send('TV Show not found.');

    if (req.genreFilter) {
        const allowed = show.genres.some(g =>
            req.genreFilter.some(id => id.toString() === g._id.toString())
        );
        if (!allowed) return res.status(403).send('Access restricted to this content.');
    }

    const showObj = show.toObject();

    // Inject user-specific resume point
    const { User } = require('../models/user');
    const user = await User.findById(req.user._id).select('watchHistory');
    
    // Find most recent episode for this show
    const history = (user.watchHistory || [])
        .filter(h => h.mediaId.toString() === show._id.toString() && h.mediaType === 'tvshow')
        .sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt));
        
    const latest = history[0];
    if (latest && latest.episodeId) {
        const resumePoint = {
            episodeId: latest.episodeId,
            progressSeconds: latest.progressSeconds || 0,
            completed: latest.completed || false
        };
        const { Episode } = require('../models/episode');
        const ep = await Episode.findById(latest.episodeId).select('season episode title runtime');
        if (ep) {
            resumePoint.season = ep.season;
            resumePoint.episode = ep.episode;
            resumePoint.title = ep.title;
            resumePoint.duration = ep.runtime;
        }
        showObj.resumePoint = resumePoint;
    }

    res.send(showObj);
});

// POST /api/tvshows — Admin
router.post('/', [auth, admin], async (req, res) => {
    const { error } = validateTVShow(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    const existing = await TVShow.findOne({ title: req.body.title, year: req.body.year });
    if (existing) return res.status(409).send('A TV show with this title and year already exists.');

    const genres = req.body.genreIds
        ? await Genre.find({ _id: { $in: req.body.genreIds } })
        : [];

    const show = new TVShow({
        title: req.body.title,
        year: req.body.year,
        genres: genres.map(g => g._id),
        status: req.body.status || 'unknown',
        description: req.body.description || '',
        posterUrl: req.body.posterUrl || '',
        backdropUrl: req.body.backdropUrl || '',
        trailerUrl: req.body.trailerUrl || '',
        network: req.body.network || '',
        metaSource: req.body.metaSource || 'manual'
    });

    await show.save();
    res.status(201).send(show);
});

// PUT /api/tvshows/:id — Admin
router.put('/:id', [auth, admin, validateObjectId], async (req, res) => {
    const update = { ...req.body };
    if (req.body.genreIds) {
        const genres = await Genre.find({ _id: { $in: req.body.genreIds } });
        update.genres = genres.map(g => g._id);
        delete update.genreIds;
    }

    const show = await TVShow.findByIdAndUpdate(
        req.params.id,
        { $set: update },
        { new: true }
    ).populate('genres', 'name slug');
    if (!show) return res.status(404).send('TV Show not found.');
    res.send(show);
});

// DELETE /api/tvshows/:id — Admin
router.delete('/:id', [auth, admin, validateObjectId], async (req, res) => {
    const show = await TVShow.findByIdAndDelete(req.params.id);
    if (!show) return res.status(404).send('TV Show not found.');
    // Also delete all episodes
    await Episode.deleteMany({ showId: req.params.id });
    res.send(show);
});

// POST /api/tvshows/:id/sync — Admin: re-fetch TMDB metadata
router.post('/:id/sync', [auth, admin, validateObjectId], async (req, res) => {
    const show = await TVShow.findById(req.params.id);
    if (!show) return res.status(404).send('TV Show not found.');

    const meta = await fetchMetadata(show.title, show.year, 'tvshow');
    
    // Fix: Convert genre strings to ObjectIds
    const genreIds = await ensureGenres(meta.genres);

    const updated = await TVShow.findByIdAndUpdate(
        req.params.id,
        { $set: { ...meta, genres: genreIds, metaSyncedAt: new Date() } },
        { new: true }
    ).populate('genres', 'name slug');

    res.send(updated);
});

// ─── EPISODES ─────────────────────────────────────────────────

// GET /api/tvshows/:id/episodes — All episodes across all seasons
router.get('/:id/episodes', [auth, validateObjectId], async (req, res) => {
    const show = await TVShow.findById(req.params.id);
    if (!show) return res.status(404).send('TV Show not found.');

    const episodes = await Episode.find({ showId: req.params.id })
        .sort({ season: 1, episode: 1 });

    // Inject user-specific progress
    const { User } = require('../models/user');
    const user = await User.findById(req.user._id).select('watchHistory');
    
    const { findSidecarFile } = require('../services/vaultService');
    const episodesWithProgress = await Promise.all(episodes.map(async (ep) => {
        const historyItem = user.watchHistory.find(h => 
            h.mediaId.toString() === show._id.toString() && 
            h.episodeId?.toString() === ep._id.toString()
        );
        
        const epObj = ep.toObject();
        epObj.userProgress = historyItem ? {
            progressSeconds: historyItem.progressSeconds || 0,
            completed: historyItem.completed || false,
            watchedAt: historyItem.watchedAt
        } : null;

        // Check for subtitles
        const subPath = await findSidecarFile(ep.vaultPath);
        epObj.hasSidecarSubtitles = !!subPath;

        return epObj;
    }));

    res.send(episodesWithProgress);
});

// GET /api/tvshows/:id/seasons/:season/episodes
router.get('/:id/seasons/:season/episodes', [auth, validateObjectId], async (req, res) => {
    const episodes = await Episode.find({
        showId: req.params.id,
        season: parseInt(req.params.season, 10)
    }).sort({ episode: 1 });
    res.send(episodes);
});

// POST /api/tvshows/:id/episodes — Admin: add episode
router.post('/:id/episodes', [auth, admin, validateObjectId], async (req, res) => {
    const show = await TVShow.findById(req.params.id);
    if (!show) return res.status(404).send('TV Show not found.');

    const body = { ...req.body, showId: req.params.id };
    const { error } = validateEpisode(body);
    if (error) return res.status(400).send(error.details[0].message);

    const ep = new Episode(body);
    await ep.save();
    res.status(201).send(ep);
});

// PUT /api/tvshows/:id/episodes/:epId — Admin: update episode
router.put('/:id/episodes/:epId', [auth, admin], async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.epId))
        return res.status(400).send('Invalid episode ID.');

    const ep = await Episode.findOneAndUpdate(
        { _id: req.params.epId, showId: req.params.id },
        { $set: req.body },
        { new: true }
    );
    if (!ep) return res.status(404).send('Episode not found.');
    res.send(ep);
});

// DELETE /api/tvshows/:id/episodes/:epId — Admin
router.delete('/:id/episodes/:epId', [auth, admin], async (req, res) => {
    const episode = await Episode.findOne({
        _id: req.params.epId,
        showId: req.params.id
    });
    if (!episode) return res.status(404).send('Episode not found.');

    const deletePhysical = req.query.deleteFile === 'true';
    let fileDeleted = false;

    if (deletePhysical && episode.vaultPath) {
        try {
            fileDeleted = await deleteVaultFile(episode.vaultPath);
        } catch (err) {
            console.error(`Failed to delete episode file: ${episode.vaultPath}`, err);
        }
    }

    await Episode.findByIdAndDelete(req.params.epId);
    res.send({ message: 'Episode removed.', fileDeleted });
});

module.exports = router;
