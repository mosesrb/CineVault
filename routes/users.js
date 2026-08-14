const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const validateObjectId = require('../middleware/validateObjectId');

const { User, validateUser, validateProfileUpdate, hashPassword } = require('../models/user');
const { Movie } = require('../models/movie');
const { TVShow } = require('../models/tvShow');
const { Genre } = require('../models/genre');

// ─── POST /api/users/register — Public registration ───────────
router.post('/register', async (req, res) => {
    const { error } = validateUser(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    let user = await User.findOne({ email: req.body.email });
    if (user) return res.status(409).send('User already registered.');

    // Bootstrap logic: First user is Admin
    const userCount = await User.countDocuments();
    const isAdmin = userCount === 0;

    const password = await hashPassword(req.body.password);
    user = new User({
        name: req.body.name,
        email: req.body.email,
        password,
        isAdmin,
        isApproved: isAdmin // First user is auto-approved, others are pending
    });

    await user.save();

    const token = user.generateAuthToken();
    res.header('x-auth-token', token).send({
        token,
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin
    });
});

// ─── GET /api/users/me — Current user profile ─────────────────
router.get('/me', auth, async (req, res) => {
    const user = await User.findById(req.user._id)
        .select('-password')
        .populate('allowedGenres', 'name slug');
    
    if (!user) return res.status(404).send('User not found.');

    const { Episode } = require('../models/episode');

    // Collect distinct media and episode IDs for batch queries (eliminates N+1 DB roundtrips)
    const movieIds = [];
    const showIds = [];
    const episodeIds = [];

    for (const item of (user.watchHistory || [])) {
        if (item.mediaType === 'movie' && item.mediaId) movieIds.push(item.mediaId);
        if (item.mediaType === 'tvshow' && item.mediaId) {
            showIds.push(item.mediaId);
            if (item.episodeId) episodeIds.push(item.episodeId);
        }
    }

    // Execute batch queries in parallel
    const [movies, shows, episodes] = await Promise.all([
        movieIds.length ? Movie.find({ _id: { $in: movieIds } }).select('title posterUrl backdropUrl year duration genres') : [],
        showIds.length ? TVShow.find({ _id: { $in: showIds } }).select('title posterUrl backdropUrl year totalEpisodes genres') : [],
        episodeIds.length ? Episode.find({ _id: { $in: episodeIds } }).select('title season episode runtime') : []
    ]);

    // Build lookup maps for O(1) matching
    const movieMap = new Map(movies.map(m => [m._id.toString(), m]));
    const showMap = new Map(shows.map(s => [s._id.toString(), s]));
    const episodeMap = new Map(episodes.map(e => [e._id.toString(), e]));

    const populatedHistory = [];
    const seriesStats = {}; // { showId: { finished: 0 } }

    const hasAllowedGenres = user.allowedGenres && user.allowedGenres.length > 0;
    const allowedGenreSet = hasAllowedGenres ? new Set(user.allowedGenres.map(g => g._id.toString())) : null;

    for (const item of (user.watchHistory || [])) {
        const mid = item.mediaId ? item.mediaId.toString() : '';
        let mediaDoc = item.mediaType === 'movie' ? movieMap.get(mid) : showMap.get(mid);
        let episodeDoc = item.episodeId ? episodeMap.get(item.episodeId.toString()) : null;

        // Apply Genre Filter
        if (mediaDoc && allowedGenreSet) {
            const isAllowed = mediaDoc.genres && mediaDoc.genres.some(gId => allowedGenreSet.has(gId.toString()));
            if (!isAllowed) mediaDoc = null; // Filter out restricted content
        }

        // Track finished episodes for series progress
        if (mediaDoc && item.mediaType === 'tvshow' && item.completed) {
            if (!seriesStats[mid]) seriesStats[mid] = { finished: 0 };
            seriesStats[mid].finished++;
        }

        if (mediaDoc) {
            populatedHistory.push({
                ...item.toObject(),
                media: mediaDoc,
                episode: episodeDoc
            });
        }
    }

    // Sort history by watchedAt descending (newest first)
    populatedHistory.sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt));

    const userObj = user.toObject();
    userObj.watchHistory = populatedHistory;
    
    // Inject calculated series metrics
    userObj.seriesProgress = Object.keys(seriesStats).map(sid => ({
        showId: sid,
        completionPercentage: 0,
        finishedEpisodes: seriesStats[sid].finished
    }));

    res.send(userObj);
});

// ─── PUT /api/users/me/profile — Update own profile ──────────
router.put('/me/profile', auth, async (req, res) => {
    const { error } = validateProfileUpdate(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    const update = {};
    if (req.body.name) update.name = req.body.name;
    if (req.body.profilePicUrl !== undefined) update.profilePicUrl = req.body.profilePicUrl;
    if (req.body.password) update.password = await hashPassword(req.body.password);

    const user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: update },
        { new: true }
    ).select('-password');

    res.send(user);
});

// ─── GET /api/users/me/watchlist ──────────────────────────────
router.get('/me/watchlist', auth, async (req, res) => {
    const user = await User.findById(req.user._id).select('watchlist allowedGenres');
    if (!user) return res.status(404).send('User not found.');

    const movieIds = [];
    const showIds = [];

    for (const item of (user.watchlist || [])) {
        if (item.mediaType === 'movie' && item.mediaId) movieIds.push(item.mediaId);
        if (item.mediaType === 'tvshow' && item.mediaId) showIds.push(item.mediaId);
    }

    const [movies, shows] = await Promise.all([
        movieIds.length ? Movie.find({ _id: { $in: movieIds } }).select('title posterUrl backdropUrl year duration genres') : [],
        showIds.length ? TVShow.find({ _id: { $in: showIds } }).select('title posterUrl backdropUrl year totalEpisodes genres') : []
    ]);

    const movieMap = new Map(movies.map(m => [m._id.toString(), m]));
    const showMap = new Map(shows.map(s => [s._id.toString(), s]));

    const populatedWatchlist = [];
    const hasAllowedGenres = user.allowedGenres && user.allowedGenres.length > 0;
    const allowedGenreSet = hasAllowedGenres ? new Set(user.allowedGenres.map(g => g.toString())) : null;

    for (const item of (user.watchlist || [])) {
        const mid = item.mediaId ? item.mediaId.toString() : '';
        let mediaDoc = item.mediaType === 'movie' ? movieMap.get(mid) : showMap.get(mid);

        if (mediaDoc && allowedGenreSet) {
            const isAllowed = mediaDoc.genres && mediaDoc.genres.some(gId => allowedGenreSet.has(gId.toString()));
            if (!isAllowed) mediaDoc = null;
        }

        if (mediaDoc) {
            populatedWatchlist.push({
                ...item.toObject(),
                media: mediaDoc
            });
        }
    }

    res.send(populatedWatchlist);
});

// ─── POST /api/users/me/watchlist ─────────────────────────────
router.post('/me/watchlist', auth, async (req, res) => {
    const { mediaId, mediaType } = req.body;
    if (!mediaId || !mediaType) return res.status(400).send('mediaId and mediaType are required.');
    if (!['movie', 'tvshow'].includes(mediaType)) return res.status(400).send('mediaType must be movie or tvshow.');

    const user = await User.findById(req.user._id);
    const exists = user.watchlist.find(
        w => w.mediaId.toString() === mediaId && w.mediaType === mediaType
    );
    if (exists) return res.status(409).send('Already in watchlist.');

    user.watchlist.push({ mediaId, mediaType });
    await user.save();
    res.send(user.watchlist);
});

// ─── DELETE /api/users/me/watchlist/:mediaId ──────────────────
router.delete('/me/watchlist/:mediaId', auth, async (req, res) => {
    const user = await User.findById(req.user._id);
    user.watchlist = user.watchlist.filter(
        w => w.mediaId.toString() !== req.params.mediaId
    );
    await user.save();
    res.send(user.watchlist);
});

// ─── POST /api/users/me/history — Track watch progress ────────
router.post('/me/history', auth, async (req, res) => {
    const { mediaId, mediaType, episodeId, progressSeconds, completed } = req.body;
    if (!mediaId || !mediaType) return res.status(400).send('mediaId and mediaType are required.');

    const user = await User.findById(req.user._id);

    const existingIndex = user.watchHistory.findIndex(
        h => h.mediaId.toString() === mediaId &&
             h.mediaType === mediaType &&
             (!episodeId || (h.episodeId && h.episodeId.toString() === episodeId))
    );

    if (existingIndex >= 0) {
        user.watchHistory[existingIndex].progressSeconds = progressSeconds || 0;
        user.watchHistory[existingIndex].completed = completed || false;
        user.watchHistory[existingIndex].watchedAt = new Date();
    } else {
        user.watchHistory.unshift({ mediaId, mediaType, episodeId, progressSeconds, completed });
        if (user.watchHistory.length > 200) user.watchHistory = user.watchHistory.slice(0, 200);
    }

    await user.save();
    res.send({ success: true });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — User management
// ══════════════════════════════════════════════════════════════

// GET /api/users — List all users
router.get('/', [auth, admin], async (req, res) => {
    const users = await User.find().select('-password').populate('allowedGenres', 'name slug');
    res.send(users);
});

// GET /api/users/:id
router.get('/:id', [auth, admin, validateObjectId], async (req, res) => {
    const user = await User.findById(req.params.id)
        .select('-password')
        .populate('allowedGenres', 'name slug');
    if (!user) return res.status(404).send('User not found.');
    res.send(user);
});

// POST /api/users — Admin creates a user
router.post('/', [auth, admin], async (req, res) => {
    const { error } = validateUser(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    const exists = await User.findOne({ email: req.body.email });
    if (exists) return res.status(409).send('Email already in use.');

    const password = await hashPassword(req.body.password);
    const user = new User({
        name: req.body.name,
        email: req.body.email,
        password,
        isAdmin: req.body.isAdmin || false,
        isApproved: true // Admin-created users are auto-approved
    });

    await user.save();
    res.status(201).send({ _id: user._id, name: user.name, email: user.email });
});

// PUT /api/users/:id — Admin updates user
router.put('/:id', [auth, admin, validateObjectId], async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).send('User not found.');

    const update = {};
    if (req.body.name) update.name = req.body.name;
    if (req.body.isAdmin !== undefined) update.isAdmin = req.body.isAdmin;
    if (req.body.password) update.password = await hashPassword(req.body.password);
    if (req.body.isApproved !== undefined) update.isApproved = req.body.isApproved;

    const updated = await User.findByIdAndUpdate(
        req.params.id,
        { $set: update },
        { new: true }
    ).select('-password');
    res.send(updated);
});

// DELETE /api/users/:id — Admin deletes user
router.delete('/:id', [auth, admin, validateObjectId], async (req, res) => {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).send('User not found.');
    res.send({ message: 'User deleted.', _id: user._id });
});

// ─── PUT /api/users/:id/ban — Admin bans/unbans user ──────────
// Body: { ban: true, reason: "...", expiresAt: "2026-12-31" }
// Body: { ban: false }  to lift ban
router.put('/:id/ban', [auth, admin, validateObjectId], async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).send('User not found.');
    if (user.isAdmin) return res.status(403).send('Cannot ban an admin account.');

    if (req.body.ban === false) {
        user.isBanned = false;
        user.banExpiresAt = null;
        user.banReason = '';
    } else {
        user.isBanned = true;
        user.banReason = req.body.reason || '';
        user.banExpiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
    }

    await user.save();
    res.send({ _id: user._id, isBanned: user.isBanned, banExpiresAt: user.banExpiresAt });
});

// ─── PUT /api/users/:id/genres — Admin sets genre restrictions ─
// Body: { genreIds: ["id1", "id2"] } — empty array removes all restrictions
router.put('/:id/genres', [auth, admin, validateObjectId], async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).send('User not found.');

    const genreIds = req.body.genreIds || [];
    const genres = genreIds.length
        ? await Genre.find({ _id: { $in: genreIds } })
        : [];

    user.allowedGenres = genres.map(g => g._id);
    await user.save();

    res.send({
        _id: user._id,
        allowedGenres: genres.map(g => ({ _id: g._id, name: g.name }))
    });
});

// ─── PUT /api/users/:id/approve — Admin approves user ─────────
router.put('/:id/approve', [auth, admin, validateObjectId], async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).send('User not found.');

    user.isApproved = req.body.approve !== false; // Default to true
    await user.save();

    res.send({ _id: user._id, isApproved: user.isApproved });
});

module.exports = router;