const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const genreGuard = require('../middleware/genreGuard');
const { Movie } = require('../models/movie');
const { TVShow } = require('../models/tvShow');
const { User } = require('../models/user');

/**
 * GET /api/discover/smart
 * Returns pre-computed dynamic rows of content
 */
router.get('/smart', [auth, genreGuard], async (req, res) => {
    const filter = req.genreFilter ? { genres: { $in: req.genreFilter } } : {};

    // Top Rated Movies
    const topRatedMovies = await Movie.find(filter)
        .select('_id title year posterUrl backdropUrl tagline description rating genres resolution')
        .populate('genres', 'name slug')
        .sort({ rating: -1 })
        .limit(15);

    // Recently Added Movies
    const recentMovies = await Movie.find(filter)
        .select('_id title year posterUrl backdropUrl tagline description rating genres resolution addedAt')
        .populate('genres', 'name slug')
        .sort({ addedAt: -1 })
        .limit(15);

    // Hidden Gems (Older highly rated movies, randomize slightly if possible)
    const hiddenGems = await Movie.find({ ...filter, rating: { $gte: 6.5 }, year: { $lt: 2010 } })
        .select('_id title year posterUrl backdropUrl tagline description rating genres resolution')
        .populate('genres', 'name slug')
        .sort({ rating: -1 })
        .limit(15);

    // Recently Added TV Shows
    const recentShows = await TVShow.find(filter)
        .select('_id title year posterUrl backdropUrl tagline description rating genres status addedAt')
        .populate('genres', 'name slug')
        .sort({ addedAt: -1 })
        .limit(15);

    res.send({
        topRatedMovies,
        recentMovies,
        hiddenGems,
        recentShows
    });
});

/**
 * GET /api/discover/recommended
 * Returns personalized recommendations based on the user's watch history.
 */
router.get('/recommended', [auth, genreGuard], async (req, res) => {
    // 1. Get user history
    const user = await User.findById(req.user._id).select('watchHistory');
    if (!user || !user.watchHistory || user.watchHistory.length === 0) return res.send([]);
    
    // Extract unique media IDs the user has interacted with
    const watchedMediaIds = [...new Set(user.watchHistory.map(h => h.mediaId.toString()))];
    
    // 2. Fetch genres for watched items
    const [movies, shows] = await Promise.all([
        Movie.find({ _id: { $in: watchedMediaIds } }).select('genres'),
        TVShow.find({ _id: { $in: watchedMediaIds } }).select('genres')
    ]);
    
    // 3. Tally genre frequencies
    const genreCounts = {};
    const countGenres = (items) => {
        items.forEach(item => {
            if (item.genres) {
                item.genres.forEach(gId => {
                    const idStr = gId.toString();
                    genreCounts[idStr] = (genreCounts[idStr] || 0) + 1;
                });
            }
        });
    };
    countGenres(movies);
    countGenres(shows);
    
    // Get top 3 genres
    const topGenres = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(e => e[0]);
        
    if (topGenres.length === 0) return res.send([]);
    
    // 4. Build recommendation filter combining base genre guard with top matching genres
    let allowedGenres = topGenres;
    if (req.genreFilter) {
        // Intersect top genres with globally allowed genres
        allowedGenres = topGenres.filter(g => req.genreFilter.map(String).includes(String(g)));
        // Fallback to allowed genres if intersection fails
        if (allowedGenres.length === 0) allowedGenres = req.genreFilter;
    }
    
    const recFilter = {
        _id: { $nin: watchedMediaIds },
        genres: { $in: allowedGenres }
    };
    
    // 5. Query for top rated unwatched content in those genres
    const recommendedMovies = await Movie.find(recFilter)
        .select('_id title year posterUrl backdropUrl tagline description rating genres resolution')
        .populate('genres', 'name slug')
        .sort({ rating: -1 })
        .limit(10);
        
    const recommendedShows = await TVShow.find(recFilter)
        .select('_id title year posterUrl backdropUrl tagline description rating genres status')
        .populate('genres', 'name slug')
        .sort({ rating: -1 })
        .limit(10);
        
    const combined = [
        ...recommendedMovies.map(m => ({...m.toObject(), _type: 'movie'})),
        ...recommendedShows.map(s => ({...s.toObject(), _type: 'tvshow'}))
    ];
    
    // Sort by rating descend and limit to max 15
    combined.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    
    res.send(combined.slice(0, 15));
});

module.exports = router;
